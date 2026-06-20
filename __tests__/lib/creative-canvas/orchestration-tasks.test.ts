const mockAdd = jest.fn()
const mockCollection = jest.fn()
const mockDoc = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}))

import { createCreativeCanvasOrchestrationTasks } from '@/lib/creative-canvas/orchestration-tasks'
import type { CreativeCanvas } from '@/lib/creative-canvas/types'

const ACTOR = { uid: 'user-1', type: 'user' as const }

beforeEach(() => {
  jest.clearAllMocks()
  mockAdd.mockResolvedValueOnce({ id: 'task-source' })
    .mockResolvedValueOnce({ id: 'task-prompt' })
    .mockResolvedValueOnce({ id: 'task-model' })
    .mockResolvedValueOnce({ id: 'task-review' })
  mockDoc.mockReturnValue({ collection: mockCollection })
  mockCollection.mockReturnValue({ doc: mockDoc, add: mockAdd })
})

describe('creative canvas orchestration tasks', () => {
  it('creates watcher-ready project tasks from graph orchestration steps', async () => {
    const canvas = {
      id: 'canvas-1',
      orgId: 'org-1',
      title: 'Launch Canvas',
      purpose: 'Launch product',
      linked: { projectId: 'project-1' },
      nodes: [
        {
          id: 'source-1',
          orgId: 'org-1',
          type: 'source',
          title: 'Product source',
          position: { x: 0, y: 0 },
          data: { requiredInputs: ['product_image'] },
          source: { kind: 'upload', referenceRole: 'product' },
        },
        {
          id: 'prompt-1',
          orgId: 'org-1',
          type: 'prompt',
          title: 'UGC prompt',
          position: { x: 200, y: 0 },
          data: { agentId: 'maya', requiredOutputs: ['hook', 'caption'] },
        },
        {
          id: 'model-1',
          orgId: 'org-1',
          type: 'model',
          title: 'Higgsfield render',
          position: { x: 400, y: 0 },
          data: {},
          provider: { key: 'higgsfield', model: 'nano_banana_flash' },
          edit: { operation: 'video_motion', outputKind: 'social_post_draft' },
        },
        {
          id: 'review-1',
          orgId: 'org-1',
          type: 'review',
          title: 'Brand review',
          position: { x: 600, y: 0 },
          data: {},
          review: { status: 'needed', requiredReviewerAgentId: 'quinn', syntheticMediaDisclosure: true, rightsStatus: 'needs_review', brandStatus: 'needs_review' },
        },
      ],
      edges: [
        { id: 'edge-1', orgId: 'org-1', sourceNodeId: 'source-1', targetNodeId: 'prompt-1' },
        { id: 'edge-2', orgId: 'org-1', sourceNodeId: 'prompt-1', targetNodeId: 'model-1' },
        { id: 'edge-3', orgId: 'org-1', sourceNodeId: 'model-1', targetNodeId: 'review-1' },
      ],
    } as CreativeCanvas & { id: string }

    const result = await createCreativeCanvasOrchestrationTasks(canvas, {}, ACTOR)

    expect(result).toMatchObject({
      projectId: 'project-1',
      createdTasks: [
        { id: 'task-source', nodeId: 'source-1', agentId: 'pip' },
        { id: 'task-prompt', nodeId: 'prompt-1', agentId: 'maya' },
        { id: 'task-model', nodeId: 'model-1', agentId: 'maya' },
        { id: 'task-review', nodeId: 'review-1', agentId: 'quinn' },
      ],
      skippedSteps: [],
    })
    expect(mockCollection).toHaveBeenCalledWith('projects')
    expect(mockDoc).toHaveBeenCalledWith('project-1')
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Creative Canvas: Product source',
      orgId: 'org-1',
      projectId: 'project-1',
      columnId: 'todo',
      assigneeAgentId: 'pip',
      agentStatus: 'pending',
      requiredCapability: 'research',
      expectedArtifacts: ['source:product_image'],
      labels: expect.arrayContaining(['creative-canvas', 'canvas:canvas-1', 'role:source_curator']),
      agentInput: expect.objectContaining({
        spec: expect.stringContaining('Creative Canvas: Launch Canvas'),
        constraints: expect.arrayContaining(['internal_output_only']),
        context: expect.objectContaining({
          source: 'creative_canvas_orchestration',
          canvasId: 'canvas-1',
          nodeId: 'source-1',
        }),
      }),
      createdBy: 'user-1',
      createdAt: 'SERVER_TIMESTAMP',
    }))
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Creative Canvas: Higgsfield render',
      priority: 'high',
      assigneeAgentId: 'maya',
      requiredCapability: 'content',
      dependsOn: ['task-prompt'],
    }))
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Creative Canvas: Brand review',
      assigneeAgentId: 'quinn',
      requiredCapability: 'qa',
      dependsOn: ['task-model'],
    }))
  })

  it('requires a project id before creating project tasks', async () => {
    await expect(createCreativeCanvasOrchestrationTasks({
      id: 'canvas-1',
      orgId: 'org-1',
      title: 'No project',
      purpose: '',
      linked: {},
      nodes: [],
      edges: [],
    } as CreativeCanvas & { id: string }, {}, ACTOR)).rejects.toThrow('linked.projectId or projectId')
    expect(mockAdd).not.toHaveBeenCalled()
  })
})
