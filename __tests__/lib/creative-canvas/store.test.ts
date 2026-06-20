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
  CREATIVE_CANVAS_TEMPLATE_COLLECTION,
  CreativeCanvasVersionConflictError,
  createCreativeCanvas,
  createCreativeCanvasTemplate,
  getCreativeCanvas,
  listCreativeCanvases,
  listCreativeCanvasTemplates,
  updateCreativeCanvas,
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

  it('creates and lists reusable canvas templates', async () => {
    mockAdd.mockResolvedValue({ id: 'template-1' })
    const template = await createCreativeCanvasTemplate({
      title: 'UGC launch reusable flow',
      description: 'Reusable social graph',
      sourceCanvasId: 'canvas-1',
      sourceVersion: 3,
      nodes: [
        {
          id: 'source-1',
          type: 'source',
          title: 'Product source',
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: 'model-1',
          type: 'model',
          title: 'Higgsfield render',
          position: { x: 260, y: 0 },
          data: {},
          provider: { key: 'higgsfield', model: 'seedance_2_0_fast', mode: 'social_post_draft' },
        },
      ],
      edges: [{ id: 'edge-1', sourceNodeId: 'source-1', targetNodeId: 'model-1' }],
    }, 'org-1', ACTOR)

    expect(CREATIVE_CANVAS_TEMPLATE_COLLECTION).toBe('creative_canvas_templates')
    expect(mockCollection).toHaveBeenCalledWith('creative_canvas_templates')
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      title: 'UGC launch reusable flow',
      description: 'Reusable social graph',
      sourceCanvasId: 'canvas-1',
      sourceVersion: 3,
      createdBy: 'user-1',
      createdAt: 'SERVER_TIMESTAMP',
      nodes: expect.arrayContaining([
        expect.objectContaining({ id: 'model-1', orgId: 'org-1', provider: expect.objectContaining({ model: 'seedance_2_0_fast' }) }),
      ]),
      edges: expect.arrayContaining([expect.objectContaining({ id: 'edge-1', orgId: 'org-1' })]),
    }))
    expect(template).toMatchObject({ id: 'template-1', title: 'UGC launch reusable flow', nodes: expect.any(Array) })

    mockGet.mockResolvedValue({
      docs: [
        { id: 'template-2', data: () => ({ orgId: 'org-1', title: 'B template', deleted: false, nodes: [], edges: [] }) },
        { id: 'template-3', data: () => ({ orgId: 'org-1', title: 'A template', deleted: false, nodes: [], edges: [] }) },
        { id: 'template-deleted', data: () => ({ orgId: 'org-1', title: 'Deleted', deleted: true, nodes: [], edges: [] }) },
      ],
    })

    await expect(listCreativeCanvasTemplates('org-1')).resolves.toMatchObject([
      { id: 'template-3', title: 'A template' },
      { id: 'template-2', title: 'B template' },
    ])
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'org-1')
  })

  it('returns null for missing or cross-org canvases', async () => {
    mockDocGet.mockResolvedValueOnce({ exists: false })
    await expect(getCreativeCanvas('canvas-1', 'org-1')).resolves.toBeNull()

    mockDocGet.mockResolvedValueOnce({ exists: true, id: 'canvas-1', data: () => ({ orgId: 'org-2', deleted: false }) })
    await expect(getCreativeCanvas('canvas-1', 'org-1')).resolves.toBeNull()
  })

  it('patches persisted visual proof metadata without changing the graph version', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'canvas-1',
      data: () => ({
        orgId: 'org-1',
        title: 'Launch',
        purpose: 'Product launch',
        activeVersion: 2,
        status: 'draft',
        visibility: 'admin_agents',
        deleted: false,
        data: {
          visualProof: {
            desktop_1440: {
              screenshotUrl: 'https://proof.example.com/desktop.png',
              notes: 'Desktop captured',
            },
          },
          benchmarkProof: {
            editing_ergonomics: {
              proofUrl: 'https://proof.example.com/editing.mp4',
              notes: 'Editing captured',
            },
          },
        },
        nodes: [{ id: 'source-1', orgId: 'org-1', type: 'source', title: 'Source', position: { x: 0, y: 0 }, data: {} }],
        edges: [],
      }),
    })

    const updated = await updateCreativeCanvas('canvas-1', 'org-1', {
      data: {
        visualProof: {
          mobile_390: {
            screenshotUrl: ' https://proof.example.com/mobile.png ',
            notes: ' Mobile panel captured ',
            capturedAt: '2026-06-20T10:00:00.000Z',
            capturedBy: 'Pip',
            signedIn: true,
          },
        },
        benchmarkProof: {
          masking_inpainting: {
            proofUrl: ' https://proof.example.com/mask.mp4 ',
            notes: ' Brush mask captured ',
          },
        },
      },
    }, ACTOR)

    expect(mockDocUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        visualProof: expect.objectContaining({
          desktop_1440: expect.objectContaining({ screenshotUrl: 'https://proof.example.com/desktop.png' }),
          mobile_390: expect.objectContaining({
            screenshotUrl: 'https://proof.example.com/mobile.png',
            notes: 'Mobile panel captured',
            signedIn: true,
          }),
        }),
        benchmarkProof: expect.objectContaining({
          editing_ergonomics: expect.objectContaining({ proofUrl: 'https://proof.example.com/editing.mp4' }),
          masking_inpainting: expect.objectContaining({
            proofUrl: 'https://proof.example.com/mask.mp4',
            notes: 'Brush mask captured',
          }),
        }),
      },
      updatedAt: 'SERVER_TIMESTAMP',
    }))
    expect(updated).toMatchObject({
      id: 'canvas-1',
      activeVersion: 2,
      data: {
        visualProof: expect.objectContaining({
          mobile_390: expect.objectContaining({ screenshotUrl: 'https://proof.example.com/mobile.png' }),
        }),
        benchmarkProof: expect.objectContaining({
          masking_inpainting: expect.objectContaining({ proofUrl: 'https://proof.example.com/mask.mp4' }),
        }),
      },
    })
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

  it('records autosaved graph snapshots with an autosave reason', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'canvas-1',
      data: () => ({ orgId: 'org-1', title: 'Launch', activeVersion: 2, deleted: false }),
    })

    await updateCreativeCanvasGraph('canvas-1', 'org-1', {
      nodes: [{ id: 'source-1', type: 'source', title: 'Source', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    }, ACTOR, { reason: 'auto_graph_save' })

    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      version: 3,
      reason: 'auto_graph_save',
      nodes: [expect.objectContaining({ id: 'source-1', orgId: 'org-1' })],
    }))
  })

  it('rejects graph saves based on a stale activeVersion', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'canvas-1',
      data: () => ({ orgId: 'org-1', title: 'Launch', activeVersion: 4, deleted: false }),
    })

    await expect(updateCreativeCanvasGraph('canvas-1', 'org-1', {
      nodes: [{ id: 'source-1', type: 'source', title: 'Source', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    }, ACTOR, { expectedActiveVersion: 3 })).rejects.toMatchObject({
      name: 'CreativeCanvasVersionConflictError',
      currentActiveVersion: 4,
      expectedActiveVersion: 3,
    })
    await expect(updateCreativeCanvasGraph('canvas-1', 'org-1', {
      nodes: [{ id: 'source-1', type: 'source', title: 'Source', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    }, ACTOR, { expectedActiveVersion: 3 })).rejects.toBeInstanceOf(CreativeCanvasVersionConflictError)
    expect(mockDocUpdate).not.toHaveBeenCalled()
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('auto-merges stale graph saves when collaborators changed different nodes', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'canvas-1',
      data: () => ({
        orgId: 'org-1',
        title: 'Launch',
        activeVersion: 4,
        deleted: false,
        nodes: [
          { id: 'source-1', orgId: 'org-1', type: 'source', title: 'Source', position: { x: 0, y: 0 }, data: {} },
          { id: 'maya-model', orgId: 'org-1', type: 'model', title: 'Maya render', position: { x: 300, y: 0 }, data: {} },
        ],
        edges: [],
      }),
    })

    const updated = await updateCreativeCanvasGraph('canvas-1', 'org-1', {
      nodes: [
        { id: 'source-1', type: 'source', title: 'Source', position: { x: 0, y: 0 }, data: {} },
        { id: 'pip-prompt', type: 'prompt', title: 'Pip prompt', position: { x: 0, y: 240 }, data: {} },
      ],
      edges: [],
    }, ACTOR, {
      expectedActiveVersion: 2,
      mergeOnConflict: true,
      baseGraphInput: {
        nodes: [{ id: 'source-1', type: 'source', title: 'Source', position: { x: 0, y: 0 }, data: {} }],
        edges: [],
      },
    })

    expect(mockDocUpdate).toHaveBeenCalledWith(expect.objectContaining({
      activeVersion: 5,
      nodes: expect.arrayContaining([
        expect.objectContaining({ id: 'source-1' }),
        expect.objectContaining({ id: 'maya-model' }),
        expect.objectContaining({ id: 'pip-prompt' }),
      ]),
    }))
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      version: 5,
      reason: 'graph_auto_merge_from_v2',
      nodes: expect.arrayContaining([
        expect.objectContaining({ id: 'maya-model' }),
        expect.objectContaining({ id: 'pip-prompt' }),
      ]),
    }))
    expect(updated).toMatchObject({ id: 'canvas-1', activeVersion: 5 })
  })

  it('keeps conflicting stale graph edits blocked when both collaborators changed the same node', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'canvas-1',
      data: () => ({
        orgId: 'org-1',
        title: 'Launch',
        activeVersion: 4,
        deleted: false,
        nodes: [{ id: 'source-1', orgId: 'org-1', type: 'source', title: 'Source from Maya', position: { x: 10, y: 0 }, data: {} }],
        edges: [],
      }),
    })

    await expect(updateCreativeCanvasGraph('canvas-1', 'org-1', {
      nodes: [{ id: 'source-1', type: 'source', title: 'Source from Pip', position: { x: 0, y: 20 }, data: {} }],
      edges: [],
    }, ACTOR, {
      expectedActiveVersion: 2,
      mergeOnConflict: true,
      baseGraphInput: {
        nodes: [{ id: 'source-1', type: 'source', title: 'Source', position: { x: 0, y: 0 }, data: {} }],
        edges: [],
      },
    })).rejects.toMatchObject({
      conflicts: ['node:source-1'],
      conflictDetails: [
        expect.objectContaining({
          id: 'source-1',
          kind: 'node',
          reason: 'concurrent_update',
          baseLabel: 'Source',
          currentLabel: 'Source from Maya',
          proposedLabel: 'Source from Pip',
        }),
      ],
    })
    expect(mockDocUpdate).not.toHaveBeenCalled()
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('describes edge conflicts with labels for collaborator review', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'canvas-1',
      data: () => ({
        orgId: 'org-1',
        title: 'Launch',
        activeVersion: 4,
        deleted: false,
        nodes: [
          { id: 'source-1', orgId: 'org-1', type: 'source', title: 'Source', position: { x: 0, y: 0 }, data: {} },
          { id: 'model-1', orgId: 'org-1', type: 'model', title: 'Model', position: { x: 300, y: 0 }, data: {} },
        ],
        edges: [{ id: 'source-model', orgId: 'org-1', sourceNodeId: 'source-1', targetNodeId: 'model-1', label: 'Maya link' }],
      }),
    })

    await expect(updateCreativeCanvasGraph('canvas-1', 'org-1', {
      nodes: [
        { id: 'source-1', type: 'source', title: 'Source', position: { x: 0, y: 0 }, data: {} },
        { id: 'model-1', type: 'model', title: 'Model', position: { x: 300, y: 0 }, data: {} },
      ],
      edges: [{ id: 'source-model', sourceNodeId: 'source-1', targetNodeId: 'model-1', label: 'Pip link' }],
    }, ACTOR, {
      expectedActiveVersion: 2,
      mergeOnConflict: true,
      baseGraphInput: {
        nodes: [
          { id: 'source-1', type: 'source', title: 'Source', position: { x: 0, y: 0 }, data: {} },
          { id: 'model-1', type: 'model', title: 'Model', position: { x: 300, y: 0 }, data: {} },
        ],
        edges: [{ id: 'source-model', sourceNodeId: 'source-1', targetNodeId: 'model-1', label: 'Original link' }],
      },
    })).rejects.toMatchObject({
      conflicts: ['edge:source-model'],
      conflictDetails: [
        expect.objectContaining({
          id: 'source-model',
          kind: 'edge',
          label: 'Pip link',
          reason: 'concurrent_update',
          baseLabel: 'Original link',
          currentLabel: 'Maya link',
          proposedLabel: 'Pip link',
        }),
      ],
    })
    expect(mockDocUpdate).not.toHaveBeenCalled()
    expect(mockAdd).not.toHaveBeenCalled()
  })
})
