const mockAdd = jest.fn()
const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}))

import { buildCreativeCanvasAgentTask } from '@/lib/creative-canvas/agent-bridge'
import { createCreativeCanvasRun } from '@/lib/creative-canvas/runs'
import type { CreativeCanvas } from '@/lib/creative-canvas/types'

const ACTOR = { uid: 'agent:maya', type: 'agent' as const }

beforeEach(() => {
  jest.clearAllMocks()
  mockCollection.mockReturnValue({ add: mockAdd })
})

describe('creative canvas runs', () => {
  it('queues a Higgsfield run with internal provenance and no client-visible output', async () => {
    mockAdd.mockResolvedValue({ id: 'run-1' })

    const run = await createCreativeCanvasRun({
      canvasId: 'canvas-1',
      nodeId: 'model-1',
      providerKey: 'higgsfield',
      model: 'nano_banana_flash',
      input: {
        promptSummary: 'Create a launch image',
        sourceNodeIds: ['source-1'],
        sourceArtifactIds: ['artifact-1'],
        aspectRatio: '1:1',
      },
      provenance: {
        syntheticMedia: true,
      },
    }, 'org-1', ACTOR)

    expect(mockCollection).toHaveBeenCalledWith('creative_canvas_runs')
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      canvasId: 'canvas-1',
      nodeId: 'model-1',
      providerKey: 'higgsfield',
      status: 'queued',
      createdAt: 'SERVER_TIMESTAMP',
      updatedAt: 'SERVER_TIMESTAMP',
      provenance: expect.objectContaining({
        generatedBy: 'agent',
        agentId: 'maya',
        model: 'nano_banana_flash',
        promptStored: 'summary',
        syntheticMedia: true,
      }),
    }))
    expect(run).toMatchObject({ id: 'run-1', status: 'queued', providerKey: 'higgsfield' })
    expect(run.output).toBeUndefined()
  })

  it('builds a reviewable agent task draft from a run and canvas', () => {
    const canvas = {
      id: 'canvas-1',
      orgId: 'org-1',
      title: 'Launch Canvas',
      purpose: 'Product launch',
    } as CreativeCanvas & { id: string }

    const task = buildCreativeCanvasAgentTask({
      id: 'run-1',
      orgId: 'org-1',
      canvasId: 'canvas-1',
      nodeId: 'model-1',
      providerKey: 'higgsfield',
      model: 'nano_banana_flash',
      status: 'queued',
      input: {
        promptSummary: 'Create a launch image',
        sourceNodeIds: ['source-1'],
        sourceArtifactIds: ['artifact-1'],
      },
      provenance: {
        generatedBy: 'agent',
        agentId: 'maya',
        model: 'nano_banana_flash',
        promptStored: 'summary',
        syntheticMedia: true,
      },
    }, canvas)

    expect(task).toMatchObject({
      title: 'Creative Canvas run: Launch Canvas',
      assigneeAgentId: 'maya',
      agentStatus: 'pending',
      reviewStatus: 'pending',
      agentInput: {
        source: 'creative_canvas',
        canvasId: 'canvas-1',
        runId: 'run-1',
        expectedArtifacts: ['creative_canvas_output'],
      },
    })
    expect(task.description).toContain('Do not publish, schedule, share, launch ads, or expose outputs to clients.')
  })
})
