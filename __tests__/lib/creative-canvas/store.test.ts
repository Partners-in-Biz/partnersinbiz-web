const mockGet = jest.fn()
const mockAdd = jest.fn()
const mockDoc = jest.fn()
const mockDocGet = jest.fn()
const mockDocUpdate = jest.fn()
const mockWhere = jest.fn()
const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}))

import {
  CREATIVE_CANVAS_COLLECTION,
  createCreativeCanvas,
  getCreativeCanvas,
  listCreativeCanvases,
  updateCreativeCanvasGraph,
} from '@/lib/creative-canvas/store'

const ACTOR = { uid: 'user-1', type: 'user' as const }

beforeEach(() => {
  jest.clearAllMocks()
  const query = { get: mockGet, where: mockWhere }
  mockWhere.mockReturnValue(query)
  mockDoc.mockReturnValue({ get: mockDocGet, update: mockDocUpdate })
  mockCollection.mockReturnValue({ add: mockAdd, doc: mockDoc, where: mockWhere })
})

describe('creative canvas store', () => {
  it('uses the creative_canvases collection', async () => {
    mockGet.mockResolvedValue({ docs: [] })
    await listCreativeCanvases('org-1')
    expect(CREATIVE_CANVAS_COLLECTION).toBe('creative_canvases')
    expect(mockCollection).toHaveBeenCalledWith('creative_canvases')
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'org-1')
  })

  it('creates a tenant-scoped canvas with actor metadata', async () => {
    mockAdd.mockResolvedValue({ id: 'canvas-1' })
    const created = await createCreativeCanvas({ title: 'Launch Canvas', purpose: 'Product launch' }, 'org-1', ACTOR)

    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      title: 'Launch Canvas',
      createdBy: 'user-1',
      createdAt: 'SERVER_TIMESTAMP',
      updatedAt: 'SERVER_TIMESTAMP',
      nodes: [],
      edges: [],
    }))
    expect(created).toMatchObject({ id: 'canvas-1', orgId: 'org-1', title: 'Launch Canvas' })
  })

  it('returns null for missing or cross-org canvases', async () => {
    mockDocGet.mockResolvedValueOnce({ exists: false })
    await expect(getCreativeCanvas('canvas-1', 'org-1')).resolves.toBeNull()

    mockDocGet.mockResolvedValueOnce({ exists: true, id: 'canvas-1', data: () => ({ orgId: 'org-2', deleted: false }) })
    await expect(getCreativeCanvas('canvas-1', 'org-1')).resolves.toBeNull()
  })

  it('saves graph updates and increments activeVersion', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'canvas-1',
      data: () => ({ orgId: 'org-1', title: 'Launch', activeVersion: 2, deleted: false }),
    })

    const updated = await updateCreativeCanvasGraph('canvas-1', 'org-1', {
      nodes: [
        { id: 'source-1', type: 'source', title: 'Source', position: { x: 0, y: 0 }, data: {} },
        { id: 'prompt-1', type: 'prompt', title: 'Prompt', position: { x: 300, y: 0 }, data: {} },
      ],
      edges: [{ id: 'edge-1', sourceNodeId: 'source-1', targetNodeId: 'prompt-1' }],
    }, ACTOR)

    expect(mockDocUpdate).toHaveBeenCalledWith(expect.objectContaining({
      activeVersion: 3,
      updatedBy: 'user-1',
      updatedByType: 'user',
      updatedAt: 'SERVER_TIMESTAMP',
      nodes: expect.arrayContaining([expect.objectContaining({ id: 'source-1', orgId: 'org-1' })]),
      edges: expect.arrayContaining([expect.objectContaining({ id: 'edge-1', orgId: 'org-1' })]),
    }))
    expect(updated).toMatchObject({ id: 'canvas-1', activeVersion: 3 })
  })
})
