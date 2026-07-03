import { NextRequest } from 'next/server'

const mockAdd = jest.fn()
const mockDocUpdate = jest.fn()
const mockDoc = jest.fn()
const mockCollection = jest.fn()
const mockGetCreativeCanvas = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: any) => async (req: NextRequest, context?: unknown) =>
    handler(req, { uid: 'user-1', role: 'admin', authKind: 'test', orgId: 'org-1', orgIds: ['org-1'] }, context),
}))

jest.mock('@/lib/creative-canvas/store', () => ({
  getCreativeCanvas: mockGetCreativeCanvas,
  CREATIVE_CANVAS_COLLECTION: 'creative_canvases',
}))

function chapter(id: string, title: string, text: string) {
  return {
    id,
    orgId: 'org-1',
    type: 'prompt',
    title,
    position: { x: 0, y: 0 },
    data: { presentationType: 'chapter', text },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockDoc.mockReturnValue({ update: mockDocUpdate })
  mockCollection.mockReturnValue({ add: mockAdd, doc: mockDoc })
  mockAdd.mockResolvedValue({ id: 'created-1' })
  mockDocUpdate.mockResolvedValue(undefined)
  mockGetCreativeCanvas.mockResolvedValue({
    id: 'canvas-1',
    orgId: 'org-1',
    title: 'Harbour Story',
    purpose: '',
    linked: {},
    nodes: [
      chapter('ch-1', 'Chapter One', 'The harbour at dawn.'),
      chapter('ch-2', 'Chapter Two', 'The storm arrives.'),
    ],
    edges: [{ id: 'e1', orgId: 'org-1', sourceNodeId: 'ch-1', targetNodeId: 'ch-2' }],
  })
})

function post(id = 'canvas-1') {
  return new NextRequest(`http://test.local/api/v1/creative-canvas/${id}/exports/manuscript?orgId=org-1`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

describe('creative canvas manuscript export API', () => {
  it('compiles chapters, auto-creates the book project, and writes brief + export records', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/exports/manuscript/route')

    const res = await POST(post(), { params: Promise.resolve({ id: 'canvas-1' }) })
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data.chapterCount).toBe(2)
    expect(body.data.projectId).toBe('created-1')
    expect(body.data.briefId).toBe('created-1')
    expect(body.data.exportId).toBe('created-1')

    // Auto-created project links back onto the canvas.
    expect(mockCollection).toHaveBeenCalledWith('book_studio_projects')
    expect(mockDocUpdate).toHaveBeenCalledWith(expect.objectContaining({
      'linked.bookStudioProjectId': 'created-1',
    }))

    // The brief carries the compiled manuscript.
    expect(mockCollection).toHaveBeenCalledWith('book_studio_briefs')
    const briefCall = mockAdd.mock.calls.find(([record]) => record?.manuscript)
    expect(briefCall).toBeTruthy()
    expect(briefCall?.[0].manuscript).toEqual(expect.objectContaining({
      sourceCanvasId: 'canvas-1',
      chapterCount: 2,
      orderingFallback: false,
    }))
    expect(briefCall?.[0].description).toContain('## Chapter One')

    // Export record is an internal draft.
    expect(mockCollection).toHaveBeenCalledWith('creative_canvas_exports')
    const exportCall = mockAdd.mock.calls.find(([record]) => record?.target === 'book_studio' && record?.payload)
    expect(exportCall?.[0].payload).toEqual(expect.objectContaining({
      clientVisible: false,
      publishEnabled: false,
      wordCount: expect.any(Number),
    }))
  })

  it('reuses an already-linked book project', async () => {
    mockGetCreativeCanvas.mockResolvedValue({
      id: 'canvas-1',
      orgId: 'org-1',
      title: 'Harbour Story',
      linked: { bookStudioProjectId: 'project-existing' },
      nodes: [chapter('ch-1', 'Chapter One', 'text')],
      edges: [],
    })
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/exports/manuscript/route')

    const res = await POST(post(), { params: Promise.resolve({ id: 'canvas-1' }) })
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data.projectId).toBe('project-existing')
    expect(mockCollection).not.toHaveBeenCalledWith('book_studio_projects')
    expect(mockDocUpdate).not.toHaveBeenCalled()
  })

  it('400s when the board has no chapters', async () => {
    mockGetCreativeCanvas.mockResolvedValue({
      id: 'canvas-1',
      orgId: 'org-1',
      title: 'Empty',
      linked: {},
      nodes: [],
      edges: [],
    })
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/exports/manuscript/route')

    const res = await POST(post(), { params: Promise.resolve({ id: 'canvas-1' }) })
    expect(res.status).toBe(400)
  })

  it('404s on a foreign canvas', async () => {
    mockGetCreativeCanvas.mockResolvedValue(null)
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/exports/manuscript/route')

    const res = await POST(post('other'), { params: Promise.resolve({ id: 'other' }) })
    expect(res.status).toBe(404)
  })
})
