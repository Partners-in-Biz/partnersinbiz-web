// __tests__/api/v1/ads/google/oauth.test.ts
//
// Covers the Google-namespaced OAuth authorize + callback routes
// (`app/api/v1/ads/google/oauth/{authorize,callback}/route.ts`).
//
// Mirrors the Meta authorize/callback tests but pinned to the `platform:
// 'google'` state shape and the
// `/admin/org/{orgSlug}/ads/connections` redirect — the latter was the bug
// fixed in Sub-1 Phase 1 final review.
import { POST } from '@/app/api/v1/ads/google/oauth/authorize/route'
import { GET as CALLBACK_GET } from '@/app/api/v1/ads/google/oauth/callback/route'

// withAuth → identity passthrough so we can call the handler directly.
jest.mock('@/lib/api/auth', () => ({ withAuth: (_r: string, h: any) => h }))

const mockSet = jest.fn().mockResolvedValue(undefined)
const states = new Map<string, any>()
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (_path: string) => ({
      doc: (id: string) => ({
        set: (data: any) => {
          states.set(id, data)
          return mockSet(data)
        },
        get: async () => ({
          exists: states.has(id),
          data: () => states.get(id),
        }),
        delete: async () => states.delete(id),
      }),
    }),
  },
}))

jest.mock('@/lib/integrations/google_ads/oauth', () => {
  const actual = jest.requireActual('@/lib/integrations/google_ads/oauth')
  return {
    ...actual,
    exchangeCodeForTokens: jest.fn(),
  }
})

jest.mock('@/lib/ads/connections/store', () => ({
  createConnection: jest.fn(),
}))

const { exchangeCodeForTokens } = jest.requireMock(
  '@/lib/integrations/google_ads/oauth',
)
const { createConnection } = jest.requireMock('@/lib/ads/connections/store')

beforeEach(() => {
  mockSet.mockClear()
  states.clear()
  jest.clearAllMocks()
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-google-client-id'
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-google-client-secret'
  delete process.env.GOOGLE_ADS_CLIENT_ID
  delete process.env.GOOGLE_ADS_CLIENT_SECRET
  process.env.NEXT_PUBLIC_APP_URL = 'https://partnersinbiz.online'
})

function makeAuthorizeReq(headers: Record<string, string>) {
  return new Request('http://x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

describe('POST /api/v1/ads/google/oauth/authorize', () => {
  it('returns a Google authorize URL when authenticated as admin', async () => {
    const res = await POST(
      makeAuthorizeReq({ 'X-Org-Id': 'org_1' }) as any,
      { role: 'admin' } as any,
    )
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.authorizeUrl).toContain('accounts.google.com/o/oauth2/v2/auth')
    expect(body.data.authorizeUrl).toContain('access_type=offline')
    expect(body.data.authorizeUrl).toContain('prompt=consent')
    expect(body.data.state).toMatch(/^[a-f0-9]{32}$/)
  })

  it('persists state doc with orgId + orgSlug + platform=google', async () => {
    await POST(
      makeAuthorizeReq({ 'X-Org-Id': 'org_1', 'X-Org-Slug': 'acme' }) as any,
      { role: 'admin' } as any,
    )

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org_1',
        orgSlug: 'acme',
        platform: 'google',
      }),
    )
  })

  it('returns 400 when X-Org-Id header missing', async () => {
    const res = await POST(makeAuthorizeReq({}) as any, { role: 'admin' } as any)
    expect(res.status).toBe(400)
  })

  it('uses the GOOGLE_ADS OAuth credential pair when GOOGLE_OAUTH pair is incomplete', async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'partial-oauth-client-id'
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET
    process.env.GOOGLE_ADS_CLIENT_ID = 'ads-client-id'
    process.env.GOOGLE_ADS_CLIENT_SECRET = 'ads-s'

    const res = await POST(
      makeAuthorizeReq({ 'X-Org-Id': 'org_1' }) as any,
      { role: 'admin' } as any,
    )
    const body = await res.json()

    expect(body.success).toBe(true)
    const authorizeUrl = new URL(body.data.authorizeUrl)
    expect(authorizeUrl.searchParams.get('client_id')).toBe('ads-client-id')
  })

  it('returns 500 when no complete Google OAuth credential pair exists', async () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID
    delete process.env.GOOGLE_ADS_CLIENT_ID
    process.env.GOOGLE_ADS_CLIENT_SECRET = 'ads-s'
    const res = await POST(
      makeAuthorizeReq({ 'X-Org-Id': 'org_1' }) as any,
      { role: 'admin' } as any,
    )
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toMatch(/GOOGLE_OAUTH_CLIENT_ID\/GOOGLE_OAUTH_CLIENT_SECRET/)
  })
})

describe('GET /api/v1/ads/google/oauth/callback', () => {
  it('redirects to /admin/org/{orgSlug}/ads/connections on success', async () => {
    states.set('s_abc', {
      state: 's_abc',
      orgId: 'org_1',
      orgSlug: 'acme',
      platform: 'google',
      redirectUri:
        'https://partnersinbiz.online/api/v1/ads/google/oauth/callback',
      expiresAt: { toMillis: () => Date.now() + 60_000 },
    })

    exchangeCodeForTokens.mockResolvedValueOnce({
      access_token: 'fake-access',
      refresh_token: 'fake-refresh',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'https://www.googleapis.com/auth/adwords',
    })
    createConnection.mockResolvedValueOnce({ id: 'conn_g_1' })

    const url = new URL('https://x/api/v1/ads/google/oauth/callback')
    url.searchParams.set('code', 'AUTH_CODE')
    url.searchParams.set('state', 's_abc')

    const res = await CALLBACK_GET(new Request(url.toString()) as any)
    expect(res.status).toBe(302)
    const loc = res.headers.get('location') ?? ''
    expect(loc).toContain('/admin/org/acme/ads/connections')
    expect(loc).toContain('status=connected')
    expect(loc).toContain('provider=google')
    expect(loc).toContain('connectionId=conn_g_1')

    expect(createConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org_1',
        platform: 'google',
        accessToken: 'fake-access',
        refreshToken: 'fake-refresh',
        scopes: ['https://www.googleapis.com/auth/adwords'],
        expiresInSeconds: 3600,
        adAccounts: [],
      }),
    )
  })

  it('stores token response scopes and redirects to account selection after connect', async () => {
    states.set('s_scope', {
      state: 's_scope',
      orgId: 'org_1',
      orgSlug: 'acme',
      platform: 'google',
      redirectUri: 'https://partnersinbiz.online/api/v1/ads/google/oauth/callback',
      expiresAt: { toMillis: () => Date.now() + 60_000 },
    })
    exchangeCodeForTokens.mockResolvedValueOnce({
      access_token: 'fake-access',
      refresh_token: 'fake-refresh',
      expires_in: 1800,
      token_type: 'Bearer',
      scope: 'https://www.googleapis.com/auth/adwords https://www.googleapis.com/auth/userinfo.email',
    })
    createConnection.mockResolvedValueOnce({ id: 'conn_g_2' })

    const url = new URL('https://x/api/v1/ads/google/oauth/callback')
    url.searchParams.set('code', 'AUTH_CODE')
    url.searchParams.set('state', 's_scope')

    const res = await CALLBACK_GET(new Request(url.toString()) as any)
    const loc = res.headers.get('location') ?? ''
    expect(loc).toContain('needsAccountSelection=1')
    expect(createConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        refreshToken: 'fake-refresh',
        scopes: [
          'https://www.googleapis.com/auth/adwords',
          'https://www.googleapis.com/auth/userinfo.email',
        ],
      }),
    )
  })

  it('uses a complete GOOGLE_ADS credential pair in callback when GOOGLE_OAUTH pair is incomplete', async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'partial-oauth-client-id'
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET
    process.env.GOOGLE_ADS_CLIENT_ID = 'ads-client-id'
    process.env.GOOGLE_ADS_CLIENT_SECRET = 'ads-s'
    states.set('s_ads_pair', {
      state: 's_ads_pair',
      orgId: 'org_1',
      orgSlug: 'acme',
      platform: 'google',
      redirectUri: 'https://partnersinbiz.online/api/v1/ads/google/oauth/callback',
      expiresAt: { toMillis: () => Date.now() + 60_000 },
    })
    exchangeCodeForTokens.mockResolvedValueOnce({
      access_token: 'fake-access',
      refresh_token: 'fake-refresh',
      expires_in: 3600,
      token_type: 'Bearer',
    })
    createConnection.mockResolvedValueOnce({ id: 'conn_g_ads_pair' })

    const url = new URL('https://x/api/v1/ads/google/oauth/callback')
    url.searchParams.set('code', 'AUTH_CODE')
    url.searchParams.set('state', 's_ads_pair')

    await CALLBACK_GET(new Request(url.toString()) as any)

    expect(exchangeCodeForTokens).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'ads-client-id',
      clientSecret: 'ads-s',
    }))
  })

  it('redirects with status=error after validating state when Google returns an OAuth error', async () => {
    states.set('s_denied', {
      state: 's_denied',
      orgId: 'org_1',
      orgSlug: 'acme',
      platform: 'google',
      redirectUri: 'https://partnersinbiz.online/api/v1/ads/google/oauth/callback',
      expiresAt: { toMillis: () => Date.now() + 60_000 },
    })
    const url = new URL('https://x/api/v1/ads/google/oauth/callback')
    url.searchParams.set('error', 'access_denied')
    url.searchParams.set('state', 's_denied')

    const res = await CALLBACK_GET(new Request(url.toString()) as any)
    const loc = res.headers.get('location') ?? ''

    expect(res.status).toBe(302)
    expect(loc).toContain('/admin/org/acme/ads/connections')
    expect(loc).toContain('status=error')
    expect(loc).toContain('provider=google')
    expect(loc).toContain('message=access_denied')
    expect(exchangeCodeForTokens).not.toHaveBeenCalled()
  })

  it('does not accept an OAuth error callback with unknown state', async () => {
    const url = new URL('https://x/api/v1/ads/google/oauth/callback')
    url.searchParams.set('error', 'access_denied')
    url.searchParams.set('state', 'unknown')

    const res = await CALLBACK_GET(new Request(url.toString()) as any)
    const loc = res.headers.get('location') ?? ''

    expect(res.status).toBe(302)
    expect(loc).toContain('status=error')
    expect(loc).toContain('message=invalid_state')
    expect(exchangeCodeForTokens).not.toHaveBeenCalled()
  })

  it('redirects with status=error when state is unknown', async () => {
    const url = new URL('https://x/api/v1/ads/google/oauth/callback')
    url.searchParams.set('code', 'AUTH_CODE')
    url.searchParams.set('state', 'unknown')
    const res = await CALLBACK_GET(new Request(url.toString()) as any)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('status=error')
  })

  it('redirects with status=error when state platform != google', async () => {
    states.set('s_x', {
      state: 's_x',
      orgId: 'org_1',
      platform: 'meta',
      redirectUri: 'https://x/cb',
      expiresAt: { toMillis: () => Date.now() + 60_000 },
    })
    const url = new URL('https://x/api/v1/ads/google/oauth/callback')
    url.searchParams.set('code', 'AUTH_CODE')
    url.searchParams.set('state', 's_x')
    const res = await CALLBACK_GET(new Request(url.toString()) as any)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('expired_or_mismatched_state')
  })
})
