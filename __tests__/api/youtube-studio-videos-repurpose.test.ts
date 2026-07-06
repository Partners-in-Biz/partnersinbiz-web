import { NextRequest } from 'next/server'
import type { ApiUser } from '@/lib/api/types'

const mockOrgGet = jest.fn()
const mockVideoGet = jest.fn()
const mockVideoUpdate = jest.fn()
const mockPacketGet = jest.fn()
const mockPostsAdd = jest.fn()

let mockUser: ApiUser = { uid: 'admin-1', role: 'admin' } as ApiUser

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => {
      if (name === 'organizations') return { doc: () => ({ get: mockOrgGet }) }
      if (name === 'youtube_video_projects') return { doc: () => ({ get: mockVideoGet, update: mockVideoUpdate }) }
      if (name === 'youtube_publishing_packets') return { doc: () => ({ get: mockPacketGet }) }
      if (name === 'social_posts') return { add: mockPostsAdd }
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

jest.mock('@/lib/social/approval', () => ({
  emptyApprovalState: () => ({ __approval: 'empty' }),
}))

jest.mock('@/lib/social/audit', () => ({ logAudit: jest.fn() }))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => 'SERVER_TS',
    arrayUnion: (...items: unknown[]) => ({ __op: 'arrayUnion', items }),
  },
}))

function stage({ status = 'live', youtubeVideoId = 'yt-abc', publishPacketId = undefined as string | undefined } = {}) {
  mockOrgGet.mockResolvedValue({
    exists: true,
    data: () => ({ settings: { portalModules: { youtubeStudio: true } } }),
  })
  mockVideoGet.mockResolvedValue({
    exists: true,
    id: 'video-1',
    data: () => ({
      orgId: 'org-1',
      channelWorkspaceId: 'channel-1',
      title: 'Launch video',
      objective: 'Announce the launch',
      status,
      youtubeVideoId,
      publishPacketId,
      deleted: false,
    }),
  })
  mockPacketGet.mockResolvedValue({
    exists: true,
    data: () => ({ orgId: 'org-1', description: 'A long packet description that explains the launch in detail.', deleted: false }),
  })
  mockPostsAdd.mockResolvedValue({ id: 'post-new' })
  mockVideoUpdate.mockResolvedValue(undefined)
}

function postReq(body: unknown) {
  return new NextRequest('http://localhost/api/v1/youtube-studio/videos/video-1/repurpose', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/youtube-studio/videos/[id]/repurpose', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    mockUser = { uid: 'admin-1', role: 'admin' } as ApiUser
    stage()
  })

  it('creates one draft social post per platform with the YouTube URL', async () => {
    const { POST } = await import('@/app/api/v1/youtube-studio/videos/[id]/repurpose/route')
    const res = await POST(postReq({ platforms: ['linkedin', 'twitter'] }))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data.postIds).toEqual(['post-new', 'post-new'])
    expect(mockPostsAdd).toHaveBeenCalledTimes(2)

    const first = mockPostsAdd.mock.calls[0][0]
    expect(first).toMatchObject({
      orgId: 'org-1',
      platform: 'linkedin',
      platforms: ['linkedin'],
      status: 'draft',
      approval: { __approval: 'empty' },
      source: 'youtube_studio_repurpose',
    })
    expect(first.content.text).toContain('Launch video')
    expect(first.content.text).toContain('https://www.youtube.com/watch?v=yt-abc')

    const second = mockPostsAdd.mock.calls[1][0]
    expect(second.platform).toBe('x') // twitter maps to legacy 'x'
    expect(second.platforms).toEqual(['twitter'])
  })

  it('uses the packet description excerpt when a packet is linked', async () => {
    stage({ publishPacketId: 'packet-1' })
    const { POST } = await import('@/app/api/v1/youtube-studio/videos/[id]/repurpose/route')
    await POST(postReq({ platforms: ['linkedin'] }))

    expect(mockPostsAdd.mock.calls[0][0].content.text).toContain('A long packet description')
  })

  it('back-links created drafts onto the video project', async () => {
    const { POST } = await import('@/app/api/v1/youtube-studio/videos/[id]/repurpose/route')
    await POST(postReq({ platforms: ['linkedin'] }))

    expect(mockVideoUpdate).toHaveBeenCalledWith(expect.objectContaining({
      'linked.socialPostIds': { __op: 'arrayUnion', items: ['post-new'] },
    }))
  })

  it('409s when the video is not live', async () => {
    stage({ status: 'production' })
    const { POST } = await import('@/app/api/v1/youtube-studio/videos/[id]/repurpose/route')
    expect((await POST(postReq({ platforms: ['linkedin'] }))).status).toBe(409)
  })

  it('409s when the video has no youtubeVideoId', async () => {
    stage({ youtubeVideoId: '' })
    const { POST } = await import('@/app/api/v1/youtube-studio/videos/[id]/repurpose/route')
    expect((await POST(postReq({ platforms: ['linkedin'] }))).status).toBe(409)
  })

  it('400s on unsupported platforms', async () => {
    const { POST } = await import('@/app/api/v1/youtube-studio/videos/[id]/repurpose/route')
    expect((await POST(postReq({ platforms: ['myspace'] }))).status).toBe(400)
  })
})
