import { NextRequest } from 'next/server'
import type { ApiUser } from '@/lib/api/types'

type MockAuthHandler = (req: NextRequest, user: ApiUser, context?: unknown) => Promise<Response>

const mockLoadScopedRecord = jest.fn()
const mockEnsureOrgAccess = jest.fn()
const mockListByOrg = jest.fn()
const mockCreateCreativeCanvas = jest.fn()
const mockGetCreativeCanvas = jest.fn()
const mockUpdateCreativeCanvasGraph = jest.fn()
const mockBuildGraph = jest.fn()

let authUser: ApiUser = { uid: 'admin-1', role: 'admin' }

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockAuthHandler) => (req: NextRequest, ctx?: unknown) =>
    handler(req, authUser, ctx),
}))

jest.mock('@/lib/youtube-studio/api', () => {
  const actual = jest.requireActual('@/lib/youtube-studio/api')
  return {
    YOUTUBE_COLLECTIONS: actual.YOUTUBE_COLLECTIONS,
    mergePatchForSanitizer: actual.mergePatchForSanitizer,
    updateActorFields: () => ({ updatedBy: 'admin-1', updatedByType: 'user', updatedAt: 'SERVER_TS' }),
    loadScopedRecord: (...args: unknown[]) => mockLoadScopedRecord(...args),
    ensureOrgAccess: (...args: unknown[]) => mockEnsureOrgAccess(...args),
    listByOrg: (...args: unknown[]) => mockListByOrg(...args),
  }
})

jest.mock('@/lib/creative-canvas/store', () => ({
  createCreativeCanvas: (...args: unknown[]) => mockCreateCreativeCanvas(...args),
  getCreativeCanvas: (...args: unknown[]) => mockGetCreativeCanvas(...args),
  updateCreativeCanvasGraph: (...args: unknown[]) => mockUpdateCreativeCanvasGraph(...args),
}))

jest.mock('@/lib/youtube-studio/canvas-bridge', () => ({
  buildCanvasGraphFromVideoProject: (...args: unknown[]) => mockBuildGraph(...args),
}))

function stageProject(data: Record<string, unknown> | null, set = jest.fn()) {
  if (!data) {
    mockLoadScopedRecord.mockResolvedValue(null)
    return { set }
  }
  const ref = { set }
  mockLoadScopedRecord.mockResolvedValue({ id: 'video-1', ref, data })
  return ref
}

const SEEDED_GRAPH = {
  nodes: [
    { id: 'yt-video-1-brief', orgId: 'org-1', type: 'brief', title: 'Video brief', position: { x: 0, y: 0 }, data: {} },
    { id: 'yt-video-1-render', orgId: 'org-1', type: 'model', title: 'Full video render', position: { x: 320, y: 0 }, data: {} },
  ],
  edges: [{ id: 'yt-video-1-edge', orgId: 'org-1', sourceNodeId: 'yt-video-1-brief', targetNodeId: 'yt-video-1-render' }],
}

async function invoke(id = 'video-1') {
  const { POST } = await import('@/app/api/v1/youtube-studio/videos/[id]/open-in-canvas/route')
  return POST(
    new NextRequest(`http://localhost/api/v1/youtube-studio/videos/${id}/open-in-canvas`, { method: 'POST' }),
    { params: Promise.resolve({ id }) },
  )
}

describe('POST /api/v1/youtube-studio/videos/[id]/open-in-canvas', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    authUser = { uid: 'admin-1', role: 'admin' }
    mockEnsureOrgAccess.mockResolvedValue(null)
    mockListByOrg.mockResolvedValue([])
    mockBuildGraph.mockReturnValue(SEEDED_GRAPH)
    mockCreateCreativeCanvas.mockResolvedValue({ id: 'canvas-new', orgId: 'org-1' })
    mockUpdateCreativeCanvasGraph.mockResolvedValue({ id: 'canvas-new' })
  })

  it('creates + links + returns 201 with created:true', async () => {
    const set = jest.fn().mockResolvedValue(undefined)
    stageProject({ orgId: 'org-1', title: 'Launch Teaser', deleted: false }, set)
    mockListByOrg.mockResolvedValue([
      { id: 'draft-1', data: () => ({ orgId: 'org-1', videoProjectId: 'video-1', versionNumber: 1 }) },
      { id: 'draft-2', data: () => ({ orgId: 'org-1', videoProjectId: 'video-1', versionNumber: 3 }) },
      { id: 'draft-other', data: () => ({ orgId: 'org-1', videoProjectId: 'video-9', versionNumber: 5 }) },
    ])

    const res = await invoke()
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data).toEqual({ canvasId: 'canvas-new', created: true })

    // Latest draft (highest versionNumber, this project) handed to the builder.
    expect(mockBuildGraph).toHaveBeenCalledWith(expect.objectContaining({
      project: expect.objectContaining({ id: 'video-1' }),
      latestDraft: expect.objectContaining({ id: 'draft-2', versionNumber: 3 }),
    }))

    // Canvas created with the YT title + youtube link.
    expect(mockCreateCreativeCanvas).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'YT: Launch Teaser',
        linked: { youtubeVideoProjectId: 'video-1' },
      }),
      'org-1',
      expect.objectContaining({ uid: 'admin-1' }),
    )

    // Graph seeded with builder nodes (>0).
    const graphArg = mockUpdateCreativeCanvasGraph.mock.calls[0][2] as { nodes: unknown[] }
    expect(graphArg.nodes.length).toBeGreaterThan(0)
    expect(mockUpdateCreativeCanvasGraph.mock.calls[0][0]).toBe('canvas-new')

    // Project updated with the new canvas id via the sanitizer path.
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ creativeCanvasId: 'canvas-new', orgId: 'org-1' }),
      { merge: true },
    )
  })

  it('falls back to a default title when the project has no title', async () => {
    stageProject({ orgId: 'org-1', deleted: false })
    await invoke()
    expect(mockCreateCreativeCanvas).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'YT: Video project' }),
      'org-1',
      expect.anything(),
    )
  })

  it('is idempotent — an existing live linked canvas returns created:false without creating', async () => {
    stageProject({ orgId: 'org-1', title: 'Launch Teaser', deleted: false, creativeCanvasId: 'canvas-existing' })
    mockGetCreativeCanvas.mockResolvedValue({ id: 'canvas-existing', orgId: 'org-1' })

    const res = await invoke()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual({ canvasId: 'canvas-existing', created: false })
    expect(mockGetCreativeCanvas).toHaveBeenCalledWith('canvas-existing', 'org-1')
    expect(mockCreateCreativeCanvas).not.toHaveBeenCalled()
    expect(mockUpdateCreativeCanvasGraph).not.toHaveBeenCalled()
  })

  it('recreates when the linked canvas is stale (deleted/gone)', async () => {
    const set = jest.fn().mockResolvedValue(undefined)
    stageProject({ orgId: 'org-1', title: 'Launch Teaser', deleted: false, creativeCanvasId: 'canvas-stale' }, set)
    mockGetCreativeCanvas.mockResolvedValue(null)

    const res = await invoke()
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data).toEqual({ canvasId: 'canvas-new', created: true })
    expect(mockCreateCreativeCanvas).toHaveBeenCalled()
    // Stale link overwritten with the freshly created canvas id.
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ creativeCanvasId: 'canvas-new' }),
      { merge: true },
    )
  })

  it('returns 404 for an unknown project', async () => {
    stageProject(null)
    const res = await invoke('missing')
    expect(res.status).toBe(404)
    expect(mockCreateCreativeCanvas).not.toHaveBeenCalled()
  })

  it('returns 404 for a soft-deleted project', async () => {
    stageProject({ orgId: 'org-1', title: 'Gone', deleted: true })
    const res = await invoke()
    expect(res.status).toBe(404)
    expect(mockCreateCreativeCanvas).not.toHaveBeenCalled()
  })

  it('enforces org isolation via ensureOrgAccess (project in another org → 403)', async () => {
    stageProject({ orgId: 'org-2', title: 'Other org', deleted: false })
    mockEnsureOrgAccess.mockResolvedValue(
      (await import('@/lib/api/response')).apiError('Forbidden', 403),
    )

    const res = await invoke()
    expect(res.status).toBe(403)
    expect(mockEnsureOrgAccess).toHaveBeenCalledWith(authUser, 'org-2')
    expect(mockCreateCreativeCanvas).not.toHaveBeenCalled()
  })
})
