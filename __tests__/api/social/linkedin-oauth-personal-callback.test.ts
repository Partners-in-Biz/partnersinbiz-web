import { NextRequest } from 'next/server'

const mockStateGet = jest.fn()
const mockStateDelete = jest.fn()
const mockAccountsGet = jest.fn()
const mockAccountsAdd = jest.fn()
const mockPendingSet = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => {
      if (name === 'social_oauth_states') {
        return { doc: () => ({ get: mockStateGet, delete: mockStateDelete }) }
      }
      if (name === 'social_accounts') {
        return {
          where: () => ({ where: () => ({ where: () => ({ limit: () => ({ get: mockAccountsGet }) }) }) }),
          add: mockAccountsAdd,
        }
      }
      if (name === 'social_oauth_pending') {
        return { doc: () => ({ set: mockPendingSet }) }
      }
      throw new Error(`Unexpected collection ${name}`)
    },
  },
}))

jest.mock('@/lib/social/encryption', () => ({
  encryptTokenBlock: () => ({
    accessToken: 'enc',
    refreshToken: 'enc-r',
    tokenType: 'Bearer',
    expiresAt: null,
    iv: 'iv',
    tag: 'tag',
  }),
}))

jest.mock('@/lib/social/audit', () => ({ logAudit: jest.fn() }))

jest.mock('firebase-admin/firestore', () => ({
  Timestamp: {
    now: () => 'NOW_TS',
    fromDate: (d: Date) => ({ toDate: () => d }),
  },
}))

function encodeState(overrides: Record<string, unknown> = {}) {
  return Buffer.from(JSON.stringify({
    orgId: 'org-1',
    platform: 'linkedin',
    nonce: 'nonce-1',
    redirectUrl: '/portal/social/accounts',
    accountScope: 'org',
    ownerUid: 'user-1',
    linkedinMode: 'organization',
    ...overrides,
  })).toString('base64url')
}

function stageState() {
  mockStateGet.mockResolvedValue({
    exists: true,
    data: () => ({
      platform: 'linkedin',
      orgId: 'org-1',
      expiresAt: { toDate: () => new Date(Date.now() + 60_000) },
    }),
  })
  mockStateDelete.mockResolvedValue(undefined)
  mockAccountsGet.mockResolvedValue({ docs: [] })
  mockAccountsAdd.mockResolvedValue({ id: 'li-personal-1' })
}

function mockLinkedInFetch(options: {
  tokenScope?: string
  orgAclsStatus?: number
  includePage?: boolean
}) {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/oauth/v2/accessToken')) {
      return {
        ok: true,
        json: async () => ({
          access_token: 'li-access',
          refresh_token: 'li-refresh',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: options.tokenScope ?? 'w_member_social openid profile',
        }),
        text: async () => '',
      } as Response
    }
    if (url.includes('/v2/userinfo')) {
      return {
        ok: true,
        json: async () => ({
          sub: 'person-1',
          name: 'Peet Stander',
          email: 'peet@example.com',
          picture: '',
        }),
        text: async () => '',
      } as Response
    }
    if (url.includes('/organizationAcls')) {
      return {
        ok: options.orgAclsStatus === undefined || options.orgAclsStatus < 400,
        status: options.orgAclsStatus ?? 403,
        json: async () => (options.includePage
          ? { elements: [{ organization: 'urn:li:organization:99', role: 'ADMINISTRATOR', state: 'APPROVED' }] }
          : { elements: [] }),
        text: async () => 'Insufficient permissions to access organizationAcls',
      } as Response
    }
    if (url.includes('/organizations/99')) {
      return {
        ok: true,
        json: async () => ({ id: 99, localizedName: 'Partners in Biz', vanityName: 'partners-in-biz' }),
        text: async () => '',
      } as Response
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => 'not found' } as Response
  }) as jest.Mock
}

describe('LinkedIn OAuth callback personal persist', () => {
  const envSnapshot = {
    LINKEDIN_CMA_ENABLED: process.env.LINKEDIN_CMA_ENABLED,
    LINKEDIN_CLIENT_ID: process.env.LINKEDIN_CLIENT_ID,
    LINKEDIN_CLIENT_SECRET: process.env.LINKEDIN_CLIENT_SECRET,
  }

  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    process.env.LINKEDIN_CLIENT_ID = 'li-id'
    process.env.LINKEDIN_CLIENT_SECRET = 'li-secret'
    delete process.env.LINKEDIN_CMA_ENABLED
    stageState()
  })

  afterEach(() => {
    if (envSnapshot.LINKEDIN_CMA_ENABLED === undefined) delete process.env.LINKEDIN_CMA_ENABLED
    else process.env.LINKEDIN_CMA_ENABLED = envSnapshot.LINKEDIN_CMA_ENABLED
    if (envSnapshot.LINKEDIN_CLIENT_ID === undefined) delete process.env.LINKEDIN_CLIENT_ID
    else process.env.LINKEDIN_CLIENT_ID = envSnapshot.LINKEDIN_CLIENT_ID
    if (envSnapshot.LINKEDIN_CLIENT_SECRET === undefined) delete process.env.LINKEDIN_CLIENT_SECRET
    else process.env.LINKEDIN_CLIENT_SECRET = envSnapshot.LINKEDIN_CLIENT_SECRET
  })

  it('refuses to persist a LinkedIn person profile onto organisation social', async () => {
    mockLinkedInFetch({ tokenScope: 'w_member_social openid profile', orgAclsStatus: 403 })
    const { GET } = await import('@/app/api/v1/social/oauth/[platform]/callback/route')

    const res = await GET(new NextRequest(
      `http://localhost/api/v1/social/oauth/linkedin/callback?code=abc&state=${encodeState()}`,
    ))

    expect(mockAccountsAdd).not.toHaveBeenCalled()
    expect(mockPendingSet).not.toHaveBeenCalled()
    const location = new URL(res.headers.get('location') ?? '', 'http://localhost')
    expect(location.pathname).toBe('/portal/social/accounts')
    expect(location.searchParams.get('status')).toBe('error')
    expect(location.searchParams.get('message')).toMatch(/company pages/i)
  })

  it('upserts a personal LinkedIn account on the personal marketing path', async () => {
    mockLinkedInFetch({ tokenScope: 'w_member_social openid profile', orgAclsStatus: 403 })
    const { GET } = await import('@/app/api/v1/social/oauth/[platform]/callback/route')

    const res = await GET(new NextRequest(
      `http://localhost/api/v1/social/oauth/linkedin/callback?code=abc&state=${encodeState({
        accountScope: 'personal',
        linkedinMode: 'personal',
        redirectUrl: '/portal/personal/social/accounts',
      })}`,
    ))

    expect(mockAccountsAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      platform: 'linkedin',
      platformAccountId: 'urn:li:person:person-1',
      displayName: 'Peet Stander',
      accountType: 'personal',
      status: 'active',
      accountScope: 'personal',
      ownerUid: 'user-1',
    }))
    const location = new URL(res.headers.get('location') ?? '', 'http://localhost')
    expect(location.pathname).toBe('/portal/personal/social/accounts')
    expect(location.searchParams.get('status')).toBe('success')
  })

  it('connects a LinkedIn company page on organisation OAuth when a page is available', async () => {
    process.env.LINKEDIN_CMA_ENABLED = 'true'
    mockLinkedInFetch({
      tokenScope: 'rw_organization_admin w_organization_social',
      orgAclsStatus: 200,
      includePage: true,
    })
    const { GET } = await import('@/app/api/v1/social/oauth/[platform]/callback/route')

    const res = await GET(new NextRequest(
      `http://localhost/api/v1/social/oauth/linkedin/callback?code=abc&state=${encodeState({ linkedinMode: 'organization' })}`,
    ))

    expect(mockPendingSet).not.toHaveBeenCalled()
    expect(mockAccountsAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      platform: 'linkedin',
      displayName: 'Partners in Biz',
      accountType: 'page',
      accountScope: 'org',
    }))
    const location = new URL(res.headers.get('location') ?? '', 'http://localhost')
    expect(location.pathname).toBe('/portal/social/accounts')
    expect(location.searchParams.get('status')).toBe('success')
    expect(location.searchParams.get('picker')).toBeNull()
  })
})
