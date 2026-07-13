import { NextRequest } from 'next/server'

const mockResolveContextReferences = jest.fn()
const mockCollection = jest.fn()
const mockLimit = jest.fn()
let mockAuthUser: Record<string, unknown>

jest.mock('@/lib/api/auth', () => ({ withAuth: (_role: string, handler: any) => async (req: NextRequest, ctx?: unknown) => handler(req, mockAuthUser, ctx) }))
jest.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: (...args: unknown[]) => mockCollection(...args) } }))
jest.mock('@/lib/context-references/registry', () => ({ resolveContextReferences: (...args: unknown[]) => mockResolveContextReferences(...args) }))
jest.mock('@/lib/creative-canvas/store', () => ({ listCreativeCanvases: jest.fn(), getCreativeCanvas: jest.fn() }))
jest.mock('@/lib/creative-canvas/runs', () => ({ listCreativeCanvasRuns: jest.fn() }))
jest.mock('@/lib/creative-canvas/collaboration', () => ({ listCreativeCanvasVersions: jest.fn() }))
jest.mock('@/lib/creative-canvas/credits', () => ({ getCanvasCredits: jest.fn() }))

const video = { orgId: 'org-1', channelWorkspaceId: 'channel-1', title: 'Launch film', videoType: 'long_form', status: 'publish_ready', objective: 'Launch', source: { intakeType: 'manual' }, linked: {}, approvalPolicy: {}, deleted: false }
const channel = { orgId: 'org-1', title: 'Acme TV', status: 'active', connectedAccountId: 'account-1', publishingReadiness: { accountStatus: 'connected', apiProjectStatus: 'verified', readiness: 'private_upload_ready', defaultUploadPrivacy: 'private', allowedModes: ['private_api_upload'] }, defaultPublishingPolicy: { allowedModes: ['private_api_upload'], defaultVisibility: 'private', privateFirstRequired: true, publicPublishRequiresAdmin: true, publicPublishRequiresClientConfirmation: true }, defaultApprovalPolicy: {}, contentPillars: [], avoidTopics: [], aiDisclosureDefaults: {}, deleted: false }

function query(docs: Array<{ id: string; data: () => Record<string, unknown> }> = []) {
  const value = { where: () => value, orderBy: () => value, limit: (count: number) => { mockLimit(count); return value }, get: async () => ({ docs }) }
  return value
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAuthUser = { uid: 'client-1', role: 'client', orgId: 'org-1', memberAccessPolicy: { mode: 'full' } }
  mockResolveContextReferences.mockResolvedValue([{ type: 'studio_artifact', id: 'youtube_studio:video_project:video-1', orgId: 'org-1' }])
  mockCollection.mockImplementation((name: string) => {
    if (name === 'youtube_video_projects') return { doc: () => ({ get: async () => ({ exists: true, data: () => video }) }) }
    if (name === 'youtube_channel_workspaces') return { doc: () => ({ get: async () => ({ exists: true, data: () => channel }) }) }
    if (name === 'youtube_render_jobs') return query([{ id: 'render-1', data: () => ({ orgId: 'org-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', title: 'Final render', renderType: 'full_video', targetFormat: 'horizontal_16_9', status: 'approved', versionNumber: 1, sourceAssetIds: [], clipCandidateIds: [], timeline: [], checks: {}, output: { previewUrl: 'https://cdn.test/final.mp4' }, deleted: false }) }])
    return query()
  })
})

async function get(id = 'youtube_studio:video_project:video-1') {
  const { GET } = await import('@/app/api/v1/chat-context/[kind]/[id]/route')
  return GET(new NextRequest(`http://localhost/api/v1/chat-context/studio_artifact/${id}`), { params: Promise.resolve({ kind: 'studio_artifact', id }) })
}

describe('YouTube Studio chat context API', () => {
  it('routes the namespace and bounds all child reads', async () => {
    const response = await get()
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.data.context).toEqual(expect.objectContaining({ id: 'youtube_studio:video_project:video-1', orgId: 'org-1' }))
    expect(body.data.artifacts).toEqual(expect.arrayContaining([expect.objectContaining({ resourceId: 'render-1', state: 'complete' })]))
    expect(mockLimit).toHaveBeenCalledTimes(7)
    expect(mockLimit).toHaveBeenCalledWith(20)
  })

  it('preserves the authorized reference href for an admin', async () => {
    mockAuthUser = { uid: 'admin-1', role: 'admin', orgId: 'org-1' }
    mockResolveContextReferences.mockResolvedValueOnce([{ type: 'studio_artifact', id: 'youtube_studio:video_project:video-1', orgId: 'org-1', href: '/admin/org/org-1/youtube-studio/video-1' }])
    const body = await (await get()).json()
    expect(body.data.context.href).toBe('/admin/org/org-1/youtube-studio/video-1')
    expect(body.data.artifacts[0].href).toBe('/admin/org/org-1/youtube-studio/video-1')
  })

  it('returns an indistinguishable 404 before child reads when access is denied', async () => {
    mockResolveContextReferences.mockResolvedValueOnce([])
    const response = await get()
    expect(response.status).toBe(404)
    expect(mockCollection).not.toHaveBeenCalledWith('youtube_render_jobs')
  })

  it.each([
    ['video', { ...video, visibility: { showInClientPortal: false } }, channel],
    ['channel', video, { ...channel, visibility: { showInClientPortal: false } }],
  ])('returns the same 404 before child reads when the %s is hidden from clients', async (_kind, hiddenVideo, hiddenChannel) => {
    mockCollection.mockImplementation((name: string) => {
      if (name === 'youtube_video_projects') return { doc: () => ({ get: async () => ({ exists: true, data: () => hiddenVideo }) }) }
      if (name === 'youtube_channel_workspaces') return { doc: () => ({ get: async () => ({ exists: true, data: () => hiddenChannel }) }) }
      return query()
    })

    const response = await get()
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual(expect.objectContaining({ error: 'Context unavailable' }))
    expect(mockCollection).not.toHaveBeenCalledWith('youtube_render_jobs')
  })

  it('filters hidden client artifacts and cross-org child records', async () => {
    mockCollection.mockImplementation((name: string) => {
      if (name === 'youtube_video_projects') return { doc: () => ({ get: async () => ({ exists: true, data: () => video }) }) }
      if (name === 'youtube_channel_workspaces') return { doc: () => ({ get: async () => ({ exists: true, data: () => channel }) }) }
      if (name === 'youtube_source_assets') return query([
        { id: 'hidden', data: () => ({ orgId: 'org-1', videoProjectId: 'video-1', title: 'Internal', assetType: 'thumbnail', status: 'ready', mediaFormat: 'horizontal', visibility: { showInClientPortal: false }, deleted: false }) },
        { id: 'foreign', data: () => ({ orgId: 'org-2', videoProjectId: 'video-1', title: 'Foreign', assetType: 'thumbnail', status: 'ready', mediaFormat: 'horizontal', deleted: false }) },
      ])
      return query()
    })
    const body = await (await get()).json()
    expect(JSON.stringify(body)).not.toContain('Internal')
    expect(JSON.stringify(body)).not.toContain('Foreign')
  })
})
