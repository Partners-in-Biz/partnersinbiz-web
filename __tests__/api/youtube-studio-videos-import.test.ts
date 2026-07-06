import { NextRequest } from 'next/server'
import type { ApiUser } from '@/lib/api/types'

const mockOrgGet = jest.fn()
const mockChannelGet = jest.fn()
const mockVideosAdd = jest.fn()
const mockAssetsAdd = jest.fn()

let mockUser: ApiUser = { uid: 'admin-1', role: 'admin' } as ApiUser

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => {
      if (name === 'organizations') return { doc: () => ({ get: mockOrgGet }) }
      if (name === 'youtube_channel_workspaces') return { doc: () => ({ get: mockChannelGet }) }
      if (name === 'youtube_video_projects') return { add: mockVideosAdd }
      if (name === 'youtube_source_assets') return { add: mockAssetsAdd }
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

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}))

function stage() {
  mockOrgGet.mockResolvedValue({
    exists: true,
    data: () => ({ settings: { portalModules: { youtubeStudio: true } } }),
  })
  mockChannelGet.mockResolvedValue({
    exists: true,
    id: 'channel-1',
    data: () => ({ orgId: 'org-1', title: 'Acme Films', deleted: false }),
  })
  mockVideosAdd.mockResolvedValue({ id: 'video-new' })
  mockAssetsAdd.mockResolvedValue({ id: 'asset-new' })
}

function postReq(body: unknown) {
  return new NextRequest('http://localhost/api/v1/youtube-studio/videos/import', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/youtube-studio/videos/import', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    mockUser = { uid: 'admin-1', role: 'admin' } as ApiUser
    stage()
  })

  it('creates a video project and a rendered_video source asset from a campaign video', async () => {
    const { POST } = await import('@/app/api/v1/youtube-studio/videos/import/route')
    const res = await POST(postReq({
      channelWorkspaceId: 'channel-1',
      title: 'Launch reel',
      sourceUrl: 'https://cdn.example/launch.mp4',
      mediaFormat: 'vertical',
      origin: { type: 'campaign', id: 'campaign-1' },
    }))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data).toEqual({ videoProjectId: 'video-new', sourceAssetId: 'asset-new' })

    const videoPayload = mockVideosAdd.mock.calls[0][0]
    expect(videoPayload).toMatchObject({
      orgId: 'org-1',
      channelWorkspaceId: 'channel-1',
      title: 'Launch reel',
      videoType: 'short',
      status: 'intake',
      deleted: false,
    })
    expect(videoPayload.source.campaignId).toBe('campaign-1')
    expect(videoPayload.linked.campaignId).toBe('campaign-1')

    const assetPayload = mockAssetsAdd.mock.calls[0][0]
    expect(assetPayload).toMatchObject({
      orgId: 'org-1',
      channelWorkspaceId: 'channel-1',
      videoProjectId: 'video-new',
      assetType: 'rendered_video',
      status: 'ready',
      mediaFormat: 'vertical',
      sourceUrl: 'https://cdn.example/launch.mp4',
      deleted: false,
    })
  })

  it('back-links social_post origins and defaults to long_form', async () => {
    const { POST } = await import('@/app/api/v1/youtube-studio/videos/import/route')
    await POST(postReq({
      channelWorkspaceId: 'channel-1',
      title: 'Webinar recording',
      sourceUrl: 'https://cdn.example/webinar.mp4',
      origin: { type: 'social_post', id: 'post-1' },
    }))

    const videoPayload = mockVideosAdd.mock.calls[0][0]
    expect(videoPayload.videoType).toBe('long_form')
    expect(videoPayload.linked.socialPostIds).toEqual(['post-1'])
  })

  it('400s without media reference or origin', async () => {
    const { POST } = await import('@/app/api/v1/youtube-studio/videos/import/route')
    expect((await POST(postReq({ channelWorkspaceId: 'channel-1', title: 'X', origin: { type: 'campaign', id: 'c1' } }))).status).toBe(400)
    expect((await POST(postReq({ channelWorkspaceId: 'channel-1', title: 'X', sourceUrl: 'https://a/b.mp4' }))).status).toBe(400)
  })

  it('400s when the channel belongs to another org', async () => {
    mockChannelGet.mockResolvedValue({
      exists: true,
      id: 'channel-1',
      data: () => ({ orgId: 'org-other', deleted: false }),
    })
    const { POST } = await import('@/app/api/v1/youtube-studio/videos/import/route')
    const res = await POST(postReq({
      channelWorkspaceId: 'channel-1',
      title: 'X',
      sourceUrl: 'https://a/b.mp4',
      origin: { type: 'campaign', id: 'c1' },
    }))
    expect(res.status).toBe(400)
  })
})
