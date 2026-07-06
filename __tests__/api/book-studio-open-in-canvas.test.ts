import { NextRequest } from 'next/server'
import type { ApiUser } from '@/lib/api/types'

type MockAuthHandler = (req: NextRequest, user: ApiUser, context?: unknown) => Promise<Response>

const mockCollection = jest.fn()
const mockDoc = jest.fn()
const mockProjectGet = jest.fn()
const mockProjectSet = jest.fn()
const mockWhere = jest.fn()
const mockContentGet = jest.fn()
const mockOrgGet = jest.fn()
const mockCanAccessOrg = jest.fn()

const mockCreateCreativeCanvas = jest.fn()
const mockGetCreativeCanvas = jest.fn()
const mockUpdateCreativeCanvasGraph = jest.fn()
const mockBuildGraph = jest.fn()

let authUser: ApiUser = { uid: 'admin-1', role: 'admin' } as ApiUser

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockAuthHandler) => (req: NextRequest, ctx?: unknown) =>
    handler(req, authUser, ctx),
}))

jest.mock('@/lib/api/platformAdmin', () => ({
  canAccessOrg: (...args: unknown[]) => mockCanAccessOrg(...args),
}))

jest.mock('@/lib/organizations/portal-modules', () => ({
  isPortalModuleEnabled: () => true,
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/creative-canvas/store', () => ({
  createCreativeCanvas: (...args: unknown[]) => mockCreateCreativeCanvas(...args),
  getCreativeCanvas: (...args: unknown[]) => mockGetCreativeCanvas(...args),
  updateCreativeCanvasGraph: (...args: unknown[]) => mockUpdateCreativeCanvasGraph(...args),
}))

jest.mock('@/lib/book-studio/canvas-bridge', () => ({
  buildCanvasGraphFromBookProject: (...args: unknown[]) => mockBuildGraph(...args),
}))

const PROJECT_ID = 'proj-1'
const ORG_ID = 'org-1'

function stageFirestore({
  projectData,
  contentDocs = [],
}: {
  projectData: Record<string, unknown> | null
  contentDocs?: Array<{ id: string; data: Record<string, unknown> }>
}) {
  mockCanAccessOrg.mockReturnValue(true)
  mockOrgGet.mockResolvedValue({ exists: true, data: () => ({ settings: { portalModules: { bookStudio: true } } }) })
  mockProjectGet.mockResolvedValue({ exists: projectData !== null, data: () => projectData })
  mockContentGet.mockResolvedValue({ docs: contentDocs.map((d) => ({ id: d.id, data: () => d.data })) })
  mockWhere.mockReturnValue({ get: mockContentGet })

  mockDoc.mockImplementation((id: string) => {
    if (id === PROJECT_ID || id === 'missing') {
      return { get: mockProjectGet, set: mockProjectSet }
    }
    return { get: mockOrgGet }
  })

  mockCollection.mockImplementation((name: string) => {
    if (name === 'organizations') return { doc: mockDoc }
    if (name === 'book_studio_projects') return { doc: mockDoc }
    // chapters / pages collections
    return { where: mockWhere }
  })
}

const SEEDED_GRAPH = {
  nodes: [
    { id: `bk-${PROJECT_ID}-brief`, orgId: ORG_ID, type: 'brief', title: 'Book brief', position: { x: 0, y: 0 }, data: {} },
    { id: `bk-${PROJECT_ID}-cover`, orgId: ORG_ID, type: 'model', title: 'Book cover', position: { x: 320, y: 0 }, data: {} },
  ],
  edges: [{ id: `bk-${PROJECT_ID}-edge-brief-cover`, orgId: ORG_ID, sourceNodeId: `bk-${PROJECT_ID}-brief`, targetNodeId: `bk-${PROJECT_ID}-cover` }],
}

async function invoke(id = PROJECT_ID, orgHeader = ORG_ID) {
  const { POST } = await import('@/app/api/v1/book-studio/projects/[id]/open-in-canvas/route')
  return POST(
    new NextRequest(`http://localhost/api/v1/book-studio/projects/${id}/open-in-canvas`, {
      method: 'POST',
      headers: orgHeader ? { 'x-org-id': orgHeader } : undefined,
    }),
    { params: Promise.resolve({ id }) },
  )
}

describe('POST /api/v1/book-studio/projects/[id]/open-in-canvas', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    authUser = { uid: 'admin-1', role: 'admin' } as ApiUser
    mockProjectSet.mockResolvedValue(undefined)
    mockBuildGraph.mockReturnValue(SEEDED_GRAPH)
    mockCreateCreativeCanvas.mockResolvedValue({ id: 'canvas-new', orgId: ORG_ID })
    mockUpdateCreativeCanvasGraph.mockResolvedValue({ id: 'canvas-new' })
  })

  it('creates + links + returns 201 with created:true', async () => {
    stageFirestore({
      projectData: { orgId: ORG_ID, title: 'The Tiny Astronaut', format: 'kids_picture', deleted: false },
      contentDocs: [
        { id: 'page-1', data: { orgId: ORG_ID, projectId: PROJECT_ID, order: 1, prompt: 'planet 1' } },
        { id: 'page-2', data: { orgId: ORG_ID, projectId: PROJECT_ID, order: 2, prompt: 'planet 2' } },
      ],
    })

    const res = await invoke()
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data).toEqual({ canvasId: 'canvas-new', created: true })

    expect(mockBuildGraph).toHaveBeenCalledWith(expect.objectContaining({
      project: expect.objectContaining({ id: PROJECT_ID, title: 'The Tiny Astronaut' }),
      format: expect.objectContaining({ id: 'kids_picture' }),
    }))

    expect(mockCreateCreativeCanvas).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'The Tiny Astronaut',
        linked: { bookStudioProjectId: PROJECT_ID },
      }),
      ORG_ID,
      expect.objectContaining({ uid: 'admin-1' }),
    )

    expect(mockUpdateCreativeCanvasGraph).toHaveBeenCalledWith(
      'canvas-new',
      ORG_ID,
      { nodes: SEEDED_GRAPH.nodes, edges: SEEDED_GRAPH.edges },
      expect.objectContaining({ uid: 'admin-1' }),
      { expectedActiveVersion: 1, reason: 'book_open_in_canvas' },
    )

    expect(mockProjectSet).toHaveBeenCalledWith(
      expect.objectContaining({ creativeCanvasId: 'canvas-new' }),
      { merge: true },
    )
  })

  it('falls back to a default title when the project has no title', async () => {
    stageFirestore({ projectData: { orgId: ORG_ID, format: 'kids_picture', deleted: false } })
    await invoke()
    expect(mockCreateCreativeCanvas).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Book project' }),
      ORG_ID,
      expect.anything(),
    )
  })

  it('is idempotent — an existing live linked canvas returns created:false without creating', async () => {
    stageFirestore({
      projectData: { orgId: ORG_ID, title: 'The Tiny Astronaut', deleted: false, creativeCanvasId: 'canvas-existing' },
    })
    mockGetCreativeCanvas.mockResolvedValue({ id: 'canvas-existing', orgId: ORG_ID })

    const res = await invoke()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual({ canvasId: 'canvas-existing', created: false })
    expect(mockGetCreativeCanvas).toHaveBeenCalledWith('canvas-existing', ORG_ID)
    expect(mockCreateCreativeCanvas).not.toHaveBeenCalled()
    expect(mockUpdateCreativeCanvasGraph).not.toHaveBeenCalled()
  })

  it('recreates when the linked canvas is stale (deleted/gone)', async () => {
    stageFirestore({
      projectData: { orgId: ORG_ID, title: 'The Tiny Astronaut', deleted: false, creativeCanvasId: 'canvas-stale' },
    })
    mockGetCreativeCanvas.mockResolvedValue(null)

    const res = await invoke()
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data).toEqual({ canvasId: 'canvas-new', created: true })
    expect(mockCreateCreativeCanvas).toHaveBeenCalled()
    expect(mockProjectSet).toHaveBeenCalledWith(
      expect.objectContaining({ creativeCanvasId: 'canvas-new' }),
      { merge: true },
    )
  })

  it('returns 404 for an unknown project', async () => {
    stageFirestore({ projectData: null })
    const res = await invoke('missing')
    expect(res.status).toBe(404)
    expect(mockCreateCreativeCanvas).not.toHaveBeenCalled()
  })

  it('returns 404 for a soft-deleted project', async () => {
    stageFirestore({ projectData: { orgId: ORG_ID, title: 'Gone', deleted: true } })
    const res = await invoke()
    expect(res.status).toBe(404)
    expect(mockCreateCreativeCanvas).not.toHaveBeenCalled()
  })

  it('returns 404 for a cross-org project (indistinguishable from missing)', async () => {
    stageFirestore({ projectData: { orgId: 'org-2', title: 'Other org', deleted: false } })
    const res = await invoke(PROJECT_ID, ORG_ID)
    expect(res.status).toBe(404)
    expect(mockCreateCreativeCanvas).not.toHaveBeenCalled()
  })
})
