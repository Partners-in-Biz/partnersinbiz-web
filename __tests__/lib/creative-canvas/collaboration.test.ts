const mockGet = jest.fn()
const mockAdd = jest.fn()
const mockDoc = jest.fn()
const mockDocGet = jest.fn()
const mockDocSet = jest.fn()
const mockDocUpdate = jest.fn()
const mockWhere = jest.fn()
const mockOrderBy = jest.fn()
const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}))

import { updateCreativeCanvasGraph } from '@/lib/creative-canvas/store'
import {
  attachCreativeCanvasNodeOutput,
  createCreativeCanvasComment,
  forkCreativeCanvasVersion,
  listCreativeCanvasComments,
  listCreativeCanvasVersions,
  heartbeatCreativeCanvasPresence,
  listCreativeCanvasPresence,
  restoreCreativeCanvasVersion,
  updateCreativeCanvasNodeReview,
} from '@/lib/creative-canvas/collaboration'

const ACTOR = { uid: 'user-1', type: 'user' as const }

function setupCanvasDoc() {
  mockDocGet.mockResolvedValue({
    exists: true,
    id: 'canvas-1',
    data: () => ({
      orgId: 'org-1',
      title: 'Launch',
      purpose: 'Launch pack',
      activeVersion: 1,
      deleted: false,
      nodes: [
        { id: 'output-1', orgId: 'org-1', type: 'output', title: 'Output', position: { x: 0, y: 0 }, data: {} },
        { id: 'review-1', orgId: 'org-1', type: 'review', title: 'Review', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [],
    }),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  const query = { get: mockGet, where: mockWhere, orderBy: mockOrderBy }
  mockWhere.mockReturnValue(query)
  mockOrderBy.mockReturnValue(query)
  mockDoc.mockReturnValue({ get: mockDocGet, set: mockDocSet, update: mockDocUpdate })
  mockCollection.mockReturnValue({ add: mockAdd, doc: mockDoc, where: mockWhere, orderBy: mockOrderBy })
})

describe('creative canvas collaboration helpers', () => {
  it('creates a version snapshot whenever graph changes', async () => {
    setupCanvasDoc()
    mockAdd.mockResolvedValue({ id: 'version-2' })

    const updated = await updateCreativeCanvasGraph('canvas-1', 'org-1', {
      nodes: [
        { id: 'source-1', type: 'source', title: 'Source', position: { x: 0, y: 0 }, data: {} },
        { id: 'prompt-1', type: 'prompt', title: 'Prompt', position: { x: 300, y: 0 }, data: {} },
      ],
      edges: [{ id: 'edge-1', sourceNodeId: 'source-1', targetNodeId: 'prompt-1' }],
    }, ACTOR)

    expect(mockCollection).toHaveBeenCalledWith('creative_canvas_versions')
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      canvasId: 'canvas-1',
      version: 2,
      nodes: expect.arrayContaining([expect.objectContaining({ id: 'source-1', orgId: 'org-1' })]),
      edges: expect.arrayContaining([expect.objectContaining({ id: 'edge-1', orgId: 'org-1' })]),
      createdBy: 'user-1',
      createdByType: 'user',
      createdAt: 'SERVER_TIMESTAMP',
    }))
    expect(updated.activeVersion).toBe(2)
  })

  it('lists versions scoped to one canvas and org', async () => {
    mockGet.mockResolvedValue({
      docs: [
        { id: 'v2', data: () => ({ orgId: 'org-1', canvasId: 'canvas-1', version: 2, nodes: [], edges: [] }) },
      ],
    })

    const versions = await listCreativeCanvasVersions('canvas-1', 'org-1')

    expect(mockCollection).toHaveBeenCalledWith('creative_canvas_versions')
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'org-1')
    expect(mockWhere).toHaveBeenCalledWith('canvasId', '==', 'canvas-1')
    expect(versions).toEqual([expect.objectContaining({ id: 'v2', orgId: 'org-1', canvasId: 'canvas-1', version: 2 })])
  })

  it('restores a prior version as a new active graph version', async () => {
    setupCanvasDoc()
    mockDocGet
      .mockResolvedValueOnce({
        exists: true,
        id: 'canvas-1',
        data: () => ({
          orgId: 'org-1',
          title: 'Launch',
          purpose: 'Launch pack',
          activeVersion: 3,
          deleted: false,
          nodes: [],
          edges: [],
        }),
      })
      .mockResolvedValueOnce({
        exists: true,
        id: 'v2',
        data: () => ({
          orgId: 'org-1',
          canvasId: 'canvas-1',
          version: 2,
          nodes: [{ id: 'source-restore', type: 'source', title: 'Restored source', position: { x: 0, y: 0 }, data: {} }],
          edges: [],
        }),
      })
    mockAdd.mockResolvedValue({ id: 'v4' })

    const result = await restoreCreativeCanvasVersion('canvas-1', 'org-1', 'v2', ACTOR)

    expect(mockDocUpdate).toHaveBeenCalledWith(expect.objectContaining({
      activeVersion: 4,
      nodes: [expect.objectContaining({ id: 'source-restore', orgId: 'org-1' })],
      updatedBy: 'user-1',
    }))
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      canvasId: 'canvas-1',
      version: 4,
      reason: 'restored_from_v2',
    }))
    expect(result.canvas.activeVersion).toBe(4)
  })

  it('forks a prior version into a new branch canvas', async () => {
    mockDocGet
      .mockResolvedValueOnce({
        exists: true,
        id: 'canvas-1',
        data: () => ({
          orgId: 'org-1',
          title: 'Launch',
          purpose: 'Launch pack',
          activeVersion: 3,
          visibility: 'admin_agents',
          linked: { projectId: 'project-1' },
          deleted: false,
          nodes: [],
          edges: [],
        }),
      })
      .mockResolvedValueOnce({
        exists: true,
        id: 'v2',
        data: () => ({
          orgId: 'org-1',
          canvasId: 'canvas-1',
          version: 2,
          nodes: [{ id: 'source-fork', type: 'source', title: 'Fork source', position: { x: 0, y: 0 }, data: {} }],
          edges: [],
        }),
      })
    mockAdd
      .mockResolvedValueOnce({ id: 'canvas-fork' })
      .mockResolvedValueOnce({ id: 'fork-version-1' })

    const result = await forkCreativeCanvasVersion('canvas-1', 'org-1', 'v2', { title: 'Launch alt branch' }, ACTOR)

    expect(mockAdd).toHaveBeenNthCalledWith(1, expect.objectContaining({
      title: 'Launch alt branch',
      activeVersion: 1,
      linked: { projectId: 'project-1' },
      nodes: [expect.objectContaining({ id: 'source-fork', orgId: 'org-1' })],
    }))
    expect(mockAdd).toHaveBeenNthCalledWith(2, expect.objectContaining({
      canvasId: 'canvas-fork',
      version: 1,
      reason: 'forked_from_canvas-1_v2',
    }))
    expect(result.canvas).toMatchObject({ id: 'canvas-fork', title: 'Launch alt branch', activeVersion: 1 })
  })

  it('creates a tenant-scoped node comment', async () => {
    mockAdd.mockResolvedValue({ id: 'comment-1' })

    const comment = await createCreativeCanvasComment('canvas-1', 'org-1', {
      nodeId: 'output-1',
      body: 'Needs a stronger hook',
      visibility: 'admin_agents',
    }, ACTOR)

    expect(mockCollection).toHaveBeenCalledWith('creative_canvas_comments')
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      canvasId: 'canvas-1',
      nodeId: 'output-1',
      body: 'Needs a stronger hook',
      visibility: 'admin_agents',
      createdBy: 'user-1',
      createdByType: 'user',
      resolved: false,
      createdAt: 'SERVER_TIMESTAMP',
    }))
    expect(comment).toMatchObject({ id: 'comment-1', body: 'Needs a stronger hook' })
  })

  it('lists tenant-scoped node comments for a canvas', async () => {
    mockGet.mockResolvedValue({
      docs: [
        {
          id: 'comment-1',
          data: () => ({
            orgId: 'org-1',
            canvasId: 'canvas-1',
            nodeId: 'output-1',
            body: 'Needs stronger product framing',
            visibility: 'admin_agents',
            resolved: false,
            createdBy: 'maya',
            createdByType: 'agent',
          }),
        },
      ],
    })

    const comments = await listCreativeCanvasComments('canvas-1', 'org-1')

    expect(mockCollection).toHaveBeenCalledWith('creative_canvas_comments')
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'org-1')
    expect(mockWhere).toHaveBeenCalledWith('canvasId', '==', 'canvas-1')
    expect(comments).toEqual([
      expect.objectContaining({
        id: 'comment-1',
        nodeId: 'output-1',
        body: 'Needs stronger product framing',
        createdBy: 'maya',
        createdByType: 'agent',
      }),
    ])
  })

  it('lists active collaborators and filters stale canvas presence', async () => {
    mockGet.mockResolvedValue({
      docs: [
        {
          id: 'canvas-1_maya',
          data: () => ({
            orgId: 'org-1',
            canvasId: 'canvas-1',
            actorUid: 'maya',
            actorType: 'agent',
            selectedNodeId: 'model-1',
            focus: 'runs',
            lastSeenAtMs: 2000,
            expiresAtMs: 6000,
          }),
        },
        {
          id: 'canvas-1_stale',
          data: () => ({
            orgId: 'org-1',
            canvasId: 'canvas-1',
            actorUid: 'stale-user',
            actorType: 'user',
            lastSeenAtMs: 1000,
            expiresAtMs: 3000,
          }),
        },
      ],
    })

    const presence = await listCreativeCanvasPresence('canvas-1', 'org-1', 5000)

    expect(mockCollection).toHaveBeenCalledWith('creative_canvas_presence')
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'org-1')
    expect(mockWhere).toHaveBeenCalledWith('canvasId', '==', 'canvas-1')
    expect(presence).toEqual([
      expect.objectContaining({ id: 'canvas-1_maya', actorUid: 'maya', selectedNodeId: 'model-1', focus: 'runs' }),
    ])
  })

  it('heartbeats canvas presence with selected node focus', async () => {
    const presence = await heartbeatCreativeCanvasPresence('canvas-1', 'org-1', {
      displayName: 'Peet',
      selectedNodeId: 'edit-1',
      focus: 'canvas',
      viewport: { zoom: 1.2, x: 20, y: 40 },
    }, ACTOR, 10_000)

    expect(mockCollection).toHaveBeenCalledWith('creative_canvas_presence')
    expect(mockDoc).toHaveBeenCalledWith('canvas-1_user-1')
    expect(mockDocSet).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      canvasId: 'canvas-1',
      actorUid: 'user-1',
      displayName: 'Peet',
      selectedNodeId: 'edit-1',
      focus: 'canvas',
      lastSeenAt: 'SERVER_TIMESTAMP',
      lastSeenAtMs: 10_000,
      expiresAtMs: 55_000,
    }), { merge: true })
    expect(presence).toMatchObject({ id: 'canvas-1_user-1', selectedNodeId: 'edit-1' })
  })

  it('attaches output and review metadata to a single node', async () => {
    setupCanvasDoc()

    const canvas = await attachCreativeCanvasNodeOutput('canvas-1', 'org-1', 'output-1', {
      kind: 'image',
      url: 'https://cdn.example.com/output.png',
      thumbnailUrl: 'https://cdn.example.com/thumb.png',
      textPreview: 'Launch hero',
      review: {
        status: 'needed',
        syntheticMediaDisclosure: true,
        rightsStatus: 'needs_review',
        brandStatus: 'needs_review',
      },
    }, ACTOR)

    expect(mockDocUpdate).toHaveBeenCalledWith(expect.objectContaining({
      nodes: expect.arrayContaining([
        expect.objectContaining({
          id: 'output-1',
          output: expect.objectContaining({ kind: 'image', url: 'https://cdn.example.com/output.png' }),
          review: expect.objectContaining({ status: 'needed', syntheticMediaDisclosure: true }),
        }),
      ]),
      updatedBy: 'user-1',
      updatedAt: 'SERVER_TIMESTAMP',
    }))
    expect(canvas.nodes.find((node) => node.id === 'output-1')?.output?.textPreview).toBe('Launch hero')
  })

  it('updates review status without touching other nodes', async () => {
    setupCanvasDoc()

    const canvas = await updateCreativeCanvasNodeReview('canvas-1', 'org-1', 'review-1', {
      status: 'passed',
      rightsStatus: 'cleared',
      brandStatus: 'passed',
      syntheticMediaDisclosure: true,
    }, ACTOR)

    const reviewNode = canvas.nodes.find((node) => node.id === 'review-1')
    const outputNode = canvas.nodes.find((node) => node.id === 'output-1')
    expect(reviewNode?.review).toMatchObject({ status: 'passed', rightsStatus: 'cleared', brandStatus: 'passed' })
    expect(outputNode?.review).toBeUndefined()
  })
})
