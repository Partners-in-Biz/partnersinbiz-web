const mockGet = jest.fn()
const mockAdd = jest.fn()
const mockDoc = jest.fn()
const mockDocGet = jest.fn()
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
  listCreativeCanvasVersions,
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
  mockDoc.mockReturnValue({ get: mockDocGet, update: mockDocUpdate })
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
