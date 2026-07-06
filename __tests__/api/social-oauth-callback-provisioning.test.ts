import { NextRequest } from 'next/server'

const mockSafeProvision = jest.fn()
const mockStateGet = jest.fn()
const mockStateDelete = jest.fn()
const mockAccountsGet = jest.fn()
const mockAccountsAdd = jest.fn()

jest.mock('@/lib/youtube-studio/channel-provisioning', () => ({
  safeProvisionYouTubeChannelWorkspace: mockSafeProvision,
}))

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
      throw new Error(`Unexpected collection ${name}`)
    },
  },
}))

jest.mock('@/lib/social/oauth-config', () => ({
  getOAuthConfig: () => ({
    platform: 'youtube',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/youtube.upload'],
    extraAuthParams: {},
    usePKCE: false,
    useBasicAuth: false,
  }),
  getClientCredentials: () => ({ clientId: 'cid', clientSecret: 'secret' }),
  getCallbackUrl: () => 'http://localhost/api/v1/social/oauth/youtube/callback',
}))

jest.mock('@/lib/social/encryption', () => ({
  encryptTokenBlock: () => ({
    accessToken: 'enc', refreshToken: 'enc-r', tokenType: 'Bearer', expiresAt: null, iv: 'iv', tag: 'tag',
  }),
}))

jest.mock('@/lib/social/providers/registry', () => ({
  getProvider: () => ({
    getProfile: async () => ({
      platformAccountId: 'UC123',
      displayName: 'Acme Films',
      username: '@acmefilms',
      avatarUrl: '',
      profileUrl: 'https://www.youtube.com/@acmefilms',
      accountType: 'personal',
      meta: {},
    }),
  }),
}))

jest.mock('@/lib/social/audit', () => ({ logAudit: jest.fn() }))

jest.mock('firebase-admin/firestore', () => ({
  Timestamp: {
    now: () => 'NOW_TS',
    fromDate: (d: Date) => ({ toDate: () => d }),
  },
}))

function buildStateToken() {
  return Buffer.from(JSON.stringify({
    orgId: 'org-1',
    platform: 'youtube',
    nonce: 'nonce-1',
    redirectUrl: '/portal/youtube-studio',
    accountScope: 'org',
    ownerUid: 'user-1',
  })).toString('base64url')
}

function stageHappyPath() {
  mockStateGet.mockResolvedValue({
    exists: true,
    data: () => ({
      platform: 'youtube',
      orgId: 'org-1',
      expiresAt: { toDate: () => new Date(Date.now() + 60_000) },
    }),
  })
  mockStateDelete.mockResolvedValue(undefined)
  mockAccountsGet.mockResolvedValue({ docs: [] })
  mockAccountsAdd.mockResolvedValue({ id: 'acct-1' })
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ access_token: 'token', refresh_token: 'refresh', token_type: 'Bearer', expires_in: 3600 }),
  }) as jest.Mock
}

describe('OAuth callback → YouTube channel provisioning', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    stageHappyPath()
  })

  it('provisions a channel workspace after a successful YouTube account upsert', async () => {
    mockSafeProvision.mockResolvedValue({ ok: true, result: { channelWorkspaceId: 'channel-1', created: true } })
    const { GET } = await import('@/app/api/v1/social/oauth/[platform]/callback/route')

    const res = await GET(new NextRequest(
      `http://localhost/api/v1/social/oauth/youtube/callback?code=abc&state=${buildStateToken()}`,
    ))

    expect(mockSafeProvision).toHaveBeenCalledWith('org-1', 'acct-1', expect.objectContaining({
      platformAccountId: 'UC123',
      displayName: 'Acme Films',
      username: '@acmefilms',
    }))
    const location = new URL(res.headers.get('location') ?? '', 'http://localhost')
    expect(location.pathname).toBe('/portal/youtube-studio')
    expect(location.searchParams.get('status')).toBe('success')
    expect(location.searchParams.get('account')).toBe('acct-1')
    expect(location.searchParams.get('provision')).toBeNull()
  })

  it('appends provision=failed but keeps status=success when provisioning fails', async () => {
    mockSafeProvision.mockResolvedValue({ ok: false, error: 'boom' })
    const { GET } = await import('@/app/api/v1/social/oauth/[platform]/callback/route')

    const res = await GET(new NextRequest(
      `http://localhost/api/v1/social/oauth/youtube/callback?code=abc&state=${buildStateToken()}`,
    ))

    const location = new URL(res.headers.get('location') ?? '', 'http://localhost')
    expect(location.searchParams.get('status')).toBe('success')
    expect(location.searchParams.get('provision')).toBe('failed')
  })
})
