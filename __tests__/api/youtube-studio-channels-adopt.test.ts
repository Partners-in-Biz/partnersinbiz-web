import { NextRequest } from 'next/server'
import type { ApiUser } from '@/lib/api/types'

const mockProvision = jest.fn()
const mockOrgGet = jest.fn()
const mockAccountGet = jest.fn()
const mockChannelsGet = jest.fn()

let mockUser: ApiUser = { uid: 'admin-1', role: 'admin' } as ApiUser

jest.mock('@/lib/youtube-studio/channel-provisioning', () => ({
  provisionYouTubeChannelWorkspace: mockProvision,
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => {
      if (name === 'organizations') return { doc: () => ({ get: mockOrgGet }) }
      if (name === 'social_accounts') return { doc: () => ({ get: mockAccountGet }) }
      if (name === 'youtube_channel_workspaces') return { where: () => ({ get: mockChannelsGet }) }
      throw new Error(`Unexpected collection ${name}`)
    },
  },
}))

type MockTenantHandler = (req: NextRequest, user: ApiUser, orgId: string) => Promise<Response>

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest) => Promise<Response>) => handler,
}))

jest.mock('@/lib/api/tenant', () => ({
  withTenant: (handler: MockTenantHandler) => (req: NextRequest) => handler(req, mockUser, 'org-1'),
}))

function stage({
  moduleEnabled = true,
  account = {
    orgId: 'org-1',
    platform: 'youtube',
    platformAccountId: 'UC123',
    displayName: 'Acme Films',
    username: '@acmefilms',
    avatarUrl: '',
    profileUrl: 'https://www.youtube.com/@acmefilms',
    platformMeta: {},
  } as Record<string, unknown> | null,
} = {}) {
  mockOrgGet.mockResolvedValue({
    exists: true,
    data: () => ({ settings: { portalModules: { youtubeStudio: moduleEnabled } } }),
  })
  mockAccountGet.mockResolvedValue({
    exists: account !== null,
    data: () => account ?? undefined,
  })
  mockProvision.mockResolvedValue({ channelWorkspaceId: 'channel-1', created: true })
}

function postReq(body: unknown) {
  return new NextRequest('http://localhost/api/v1/youtube-studio/channels/adopt', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/youtube-studio/channels/adopt', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    mockUser = { uid: 'admin-1', role: 'admin' } as ApiUser
  })

  it('provisions a workspace from an existing org YouTube account', async () => {
    stage()
    const { POST } = await import('@/app/api/v1/youtube-studio/channels/adopt/route')
    const res = await POST(postReq({ accountId: 'acct-1' }))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data).toEqual({ channelWorkspaceId: 'channel-1', created: true })
    expect(mockProvision).toHaveBeenCalledWith('org-1', 'acct-1', expect.objectContaining({
      platformAccountId: 'UC123',
      displayName: 'Acme Films',
    }))
  })

  it('returns 200 when the workspace already existed', async () => {
    stage()
    mockProvision.mockResolvedValue({ channelWorkspaceId: 'channel-1', created: false })
    const { POST } = await import('@/app/api/v1/youtube-studio/channels/adopt/route')
    const res = await POST(postReq({ accountId: 'acct-1' }))

    expect(res.status).toBe(200)
  })

  it('400s without accountId', async () => {
    stage()
    const { POST } = await import('@/app/api/v1/youtube-studio/channels/adopt/route')
    expect((await POST(postReq({}))).status).toBe(400)
  })

  it('404s when the account belongs to another org', async () => {
    stage({ account: { orgId: 'org-other', platform: 'youtube', platformAccountId: 'UC123' } })
    const { POST } = await import('@/app/api/v1/youtube-studio/channels/adopt/route')
    expect((await POST(postReq({ accountId: 'acct-1' }))).status).toBe(404)
  })

  it('400s for non-YouTube accounts', async () => {
    stage({ account: { orgId: 'org-1', platform: 'linkedin', platformAccountId: 'urn:li:person:1' } })
    const { POST } = await import('@/app/api/v1/youtube-studio/channels/adopt/route')
    expect((await POST(postReq({ accountId: 'acct-1' }))).status).toBe(400)
  })

  it('403s for client users when the youtubeStudio module is disabled', async () => {
    stage({ moduleEnabled: false })
    mockUser = { uid: 'client-1', role: 'client' } as ApiUser
    const { POST } = await import('@/app/api/v1/youtube-studio/channels/adopt/route')
    const res = await POST(postReq({ accountId: 'acct-1' }))
    expect(res.status).toBe(403)
    expect((await res.json()).moduleDisabled).toBe(true)
  })
})

describe('GET /api/v1/youtube-studio/channels/links', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    mockUser = { uid: 'admin-1', role: 'admin' } as ApiUser
  })

  it('lists accountId → channelWorkspaceId links for connected channels', async () => {
    mockChannelsGet.mockResolvedValue({
      docs: [
        { id: 'channel-1', data: () => ({ orgId: 'org-1', title: 'Acme Films', connectedAccountId: 'acct-1', deleted: false, publishingReadiness: { accountStatus: 'connected' } }) },
        { id: 'channel-2', data: () => ({ orgId: 'org-1', title: 'No account', deleted: false }) },
        { id: 'channel-3', data: () => ({ orgId: 'org-1', title: 'Dead', connectedAccountId: 'acct-9', deleted: true }) },
      ],
    })
    const { GET } = await import('@/app/api/v1/youtube-studio/channels/links/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/youtube-studio/channels/links'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.links).toEqual([
      { channelWorkspaceId: 'channel-1', accountId: 'acct-1', title: 'Acme Films', accountStatus: 'connected' },
    ])
  })
})
