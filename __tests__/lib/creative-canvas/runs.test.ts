const mockAdd = jest.fn()
const mockDoc = jest.fn()
const mockDocGet = jest.fn()
const mockDocUpdate = jest.fn()
const mockWhere = jest.fn()
const mockGet = jest.fn()
const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}))

import { buildCreativeCanvasAgentTask } from '@/lib/creative-canvas/agent-bridge'
import {
  completeCreativeCanvasProviderCallback,
  completeCreativeCanvasRun,
  createCreativeCanvasRun,
  dispatchCreativeCanvasProviderRun,
  listCreativeCanvasRuns,
  refreshCreativeCanvasProviderRunStatus,
} from '@/lib/creative-canvas/runs'
import type { CreativeCanvas } from '@/lib/creative-canvas/types'

const ACTOR = { uid: 'agent:maya', type: 'agent' as const }

beforeEach(() => {
  jest.clearAllMocks()
  mockDoc.mockReturnValue({ get: mockDocGet, update: mockDocUpdate })
  const query = { where: mockWhere, get: mockGet }
  mockWhere.mockReturnValue(query)
  mockCollection.mockReturnValue({ add: mockAdd, doc: mockDoc, where: mockWhere })
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
        outputKind: 'video',
        operation: 'video_motion',
        variantCount: 3,
        seed: 'launch-seed-1',
        stylePreset: 'cinematic_product',
        cameraMotion: 'camera_push',
        negativePrompt: 'blurry, distorted hands',
        durationSeconds: 6,
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
      input: expect.objectContaining({
        outputKind: 'video',
        operation: 'video_motion',
        variantCount: 3,
        seed: 'launch-seed-1',
        stylePreset: 'cinematic_product',
        cameraMotion: 'camera_push',
        negativePrompt: 'blurry, distorted hands',
        durationSeconds: 6,
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
      nodes: [
        {
          id: 'source-1',
          orgId: 'org-1',
          type: 'source',
          title: 'Product image',
          position: { x: 0, y: 0 },
          data: {},
          source: { kind: 'upload', storagePath: '/tmp/product.png', mimeType: 'image/png' },
        },
      ],
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
        outputKind: 'video',
        operation: 'video_motion',
        aspectRatio: '9:16',
        durationSeconds: 6,
        variantCount: 2,
        stylePreset: 'cinematic_product',
        cameraMotion: 'camera_push',
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
        generationSettings: {
          outputKind: 'video',
          operation: 'video_motion',
          aspectRatio: '9:16',
          durationSeconds: 6,
          variantCount: 2,
          stylePreset: 'cinematic_product',
          cameraMotion: 'camera_push',
        },
        providerExecution: expect.objectContaining({
          providerKey: 'higgsfield',
          cli: expect.objectContaining({
            command: 'higgsfield',
            args: expect.arrayContaining(['generate', 'create', 'nano_banana_flash', '--prompt', 'Create a launch image', '--image', '/tmp/product.png']),
          }),
          dispatch: expect.objectContaining({
            path: '/api/v1/creative-canvas/canvas-1/runs/run-1/provider-dispatch?orgId=org-1',
          }),
          callback: expect.objectContaining({
            path: '/api/v1/creative-canvas/provider-callbacks/higgsfield',
          }),
        }),
        orchestration: expect.objectContaining({
          canvasId: 'canvas-1',
          agents: expect.arrayContaining([
            expect.objectContaining({ agentId: 'pip', roles: expect.arrayContaining(['source_curator']) }),
          ]),
          steps: expect.arrayContaining([
            expect.objectContaining({ nodeId: 'source-1', role: 'source_curator', agentId: 'pip' }),
          ]),
        }),
      },
    })
    expect(task.description).toContain('Do not publish, schedule, share, launch ads, or expose outputs to clients.')
  })

  it('completes a run by attaching a reviewed output node to the canvas', async () => {
    mockDocGet
      .mockResolvedValueOnce({
        exists: true,
        id: 'run-1',
        data: () => ({
          orgId: 'org-1',
          canvasId: 'canvas-1',
          nodeId: 'model-1',
          providerKey: 'higgsfield',
          model: 'nano_banana_flash',
          status: 'queued',
          input: { sourceNodeIds: ['source-1'], sourceArtifactIds: ['artifact-1'] },
          provenance: {
            generatedBy: 'agent',
            agentId: 'maya',
            model: 'nano_banana_flash',
            promptStored: 'summary',
            syntheticMedia: true,
          },
        }),
      })
      .mockResolvedValueOnce({
        exists: true,
        id: 'canvas-1',
        data: () => ({
          orgId: 'org-1',
          title: 'Launch Canvas',
          purpose: 'Launch',
          activeVersion: 3,
          deleted: false,
          nodes: [
            { id: 'model-1', orgId: 'org-1', type: 'model', title: 'Higgsfield', position: { x: 0, y: 0 }, data: {} },
          ],
          edges: [],
        }),
      })

    const result = await completeCreativeCanvasRun('run-1', 'org-1', {
      outputNodeId: 'output-1',
      output: {
        kind: 'image',
        url: 'https://cdn.example.com/output.png',
        thumbnailUrl: 'https://cdn.example.com/thumb.png',
        textPreview: 'Launch hero',
        rawProviderJobId: 'hf-job-1',
      },
      provenance: {
        providerJobId: 'hf-job-1',
        costUnits: 12,
        costLabel: 'higgsfield_credits',
      },
    }, ACTOR)

    expect(mockCollection).toHaveBeenCalledWith('creative_canvas_runs')
    expect(mockCollection).toHaveBeenCalledWith('creative_canvases')
    expect(mockDocUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'completed',
      output: expect.objectContaining({
        outputNodeId: 'output-1',
        url: 'https://cdn.example.com/output.png',
        rawProviderJobId: 'hf-job-1',
      }),
      provenance: expect.objectContaining({
        providerJobId: 'hf-job-1',
        costUnits: 12,
        costLabel: 'higgsfield_credits',
      }),
      updatedAt: 'SERVER_TIMESTAMP',
    }))
    expect(mockDocUpdate).toHaveBeenCalledWith(expect.objectContaining({
      activeVersion: 4,
      nodes: expect.arrayContaining([
        expect.objectContaining({
          id: 'output-1',
          type: 'output',
          output: expect.objectContaining({ kind: 'image', textPreview: 'Launch hero' }),
          review: expect.objectContaining({
            status: 'needed',
            syntheticMediaDisclosure: true,
            rightsStatus: 'needs_review',
            brandStatus: 'needs_review',
          }),
        }),
      ]),
      edges: expect.arrayContaining([
        expect.objectContaining({ sourceNodeId: 'model-1', targetNodeId: 'output-1' }),
      ]),
    }))
    expect(result.run.status).toBe('completed')
    expect(result.outputNode?.id).toBe('output-1')
  })

  it('ingests a Higgsfield provider callback by provider job id', async () => {
    mockGet.mockResolvedValueOnce({
      docs: [{
        id: 'run-1',
        data: () => ({
          orgId: 'org-1',
          canvasId: 'canvas-1',
          nodeId: 'model-1',
          providerKey: 'higgsfield',
          model: 'nano_banana_flash',
          status: 'running',
          input: { sourceNodeIds: ['source-1'], sourceArtifactIds: ['artifact-1'] },
          provenance: {
            generatedBy: 'agent',
            agentId: 'maya',
            providerJobId: 'hf-job-1',
            model: 'nano_banana_flash',
            promptStored: 'summary',
            syntheticMedia: true,
          },
        }),
      }],
    })
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: 'canvas-1',
      data: () => ({
        orgId: 'org-1',
        title: 'Launch Canvas',
        purpose: 'Launch',
        activeVersion: 5,
        deleted: false,
        nodes: [
          { id: 'model-1', orgId: 'org-1', type: 'model', title: 'Higgsfield', position: { x: 40, y: 60 }, data: {} },
        ],
        edges: [],
      }),
    })

    const result = await completeCreativeCanvasProviderCallback({
      orgId: 'org-1',
      providerKey: 'higgsfield',
      providerJobId: 'hf-job-1',
      output: {
        kind: 'video',
        url: 'https://cdn.example.com/render.mp4',
        thumbnailUrl: 'https://cdn.example.com/render.jpg',
        textPreview: 'Launch video render',
      },
      provenance: {
        costUnits: 18,
        costLabel: 'higgsfield_credits',
      },
    }, ACTOR)

    expect(mockWhere).toHaveBeenCalledWith('providerKey', '==', 'higgsfield')
    expect(mockWhere).toHaveBeenCalledWith('provenance.providerJobId', '==', 'hf-job-1')
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'org-1')
    expect(mockDocUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'completed',
      output: expect.objectContaining({
        outputNodeId: 'model-1-output',
        url: 'https://cdn.example.com/render.mp4',
        thumbnailUrl: 'https://cdn.example.com/render.jpg',
        rawProviderJobId: 'hf-job-1',
      }),
      provenance: expect.objectContaining({
        providerJobId: 'hf-job-1',
        costUnits: 18,
        costLabel: 'higgsfield_credits',
      }),
    }))
    expect(mockDocUpdate).toHaveBeenCalledWith(expect.objectContaining({
      activeVersion: 6,
      nodes: expect.arrayContaining([
        expect.objectContaining({
          id: 'model-1-output',
          output: expect.objectContaining({ kind: 'video', textPreview: 'Launch video render' }),
        }),
      ]),
    }))
    expect(result.run.status).toBe('completed')
  })

  it('marks a queued provider run as running after external dispatch', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: 'run-1',
      data: () => ({
        orgId: 'org-1',
        canvasId: 'canvas-1',
        nodeId: 'model-1',
        providerKey: 'higgsfield',
        model: 'nano_banana_flash',
        status: 'queued',
        input: { sourceNodeIds: ['source-1'], sourceArtifactIds: ['artifact-1'] },
        provenance: {
          generatedBy: 'agent',
          agentId: 'maya',
          model: 'nano_banana_flash',
          promptStored: 'summary',
          syntheticMedia: true,
        },
      }),
    })

    const run = await dispatchCreativeCanvasProviderRun('run-1', 'org-1', {
      providerJobId: 'hf-job-2',
      providerStatusUrl: 'https://api.higgsfield.ai/jobs/hf-job-2',
      providerRequestId: 'request-1',
    }, ACTOR)

    expect(mockDocUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'running',
      provenance: expect.objectContaining({
        providerJobId: 'hf-job-2',
        providerStatusUrl: 'https://api.higgsfield.ai/jobs/hf-job-2',
        providerRequestId: 'request-1',
      }),
      updatedBy: 'agent:maya',
      updatedByType: 'agent',
    }))
    expect(run).toMatchObject({
      id: 'run-1',
      status: 'running',
      provenance: expect.objectContaining({
        providerJobId: 'hf-job-2',
        providerStatusUrl: 'https://api.higgsfield.ai/jobs/hf-job-2',
      }),
    })
  })

  it('lists canvas runs for an organisation', async () => {
    mockGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'run-2',
          data: () => ({
            orgId: 'org-1',
            canvasId: 'canvas-1',
            nodeId: 'model-2',
            providerKey: 'higgsfield',
            model: 'nano_banana_flash',
            status: 'running',
            input: { sourceNodeIds: [], sourceArtifactIds: [] },
            provenance: {
              generatedBy: 'agent',
              agentId: 'maya',
              providerJobId: 'hf-job-2',
              promptStored: 'summary',
              syntheticMedia: true,
            },
          }),
        },
        {
          id: 'run-1',
          data: () => ({
            orgId: 'org-1',
            canvasId: 'canvas-1',
            nodeId: 'model-1',
            providerKey: 'higgsfield',
            model: 'nano_banana_flash',
            status: 'queued',
            input: { sourceNodeIds: [], sourceArtifactIds: [] },
            provenance: {
              generatedBy: 'agent',
              agentId: 'maya',
              promptStored: 'summary',
              syntheticMedia: true,
            },
          }),
        },
      ],
    })

    const runs = await listCreativeCanvasRuns('canvas-1', 'org-1')

    expect(mockWhere).toHaveBeenCalledWith('canvasId', '==', 'canvas-1')
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'org-1')
    expect(runs).toEqual([
      expect.objectContaining({ id: 'run-2', status: 'running' }),
      expect.objectContaining({ id: 'run-1', status: 'queued' }),
    ])
  })

  it('refreshes provider run status without attaching output nodes', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: 'run-1',
      data: () => ({
        orgId: 'org-1',
        canvasId: 'canvas-1',
        nodeId: 'model-1',
        providerKey: 'higgsfield',
        model: 'nano_banana_flash',
        status: 'running',
        input: { sourceNodeIds: [], sourceArtifactIds: [] },
        provenance: {
          generatedBy: 'agent',
          agentId: 'maya',
          providerJobId: 'hf-job-1',
          promptStored: 'summary',
          syntheticMedia: true,
        },
      }),
    })

    const run = await refreshCreativeCanvasProviderRunStatus('run-1', 'org-1', {
      status: 'failed',
      providerStatus: 'error',
      providerStatusMessage: 'Model queue timed out',
      error: {
        code: 'provider_timeout',
        message: 'Higgsfield job timed out',
        retryable: true,
      },
    }, ACTOR)

    expect(mockDocUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      providerStatus: 'error',
      providerStatusMessage: 'Model queue timed out',
      error: {
        code: 'provider_timeout',
        message: 'Higgsfield job timed out',
        retryable: true,
      },
      updatedBy: 'agent:maya',
      updatedByType: 'agent',
    }))
    expect(run).toMatchObject({
      id: 'run-1',
      status: 'failed',
      error: {
        code: 'provider_timeout',
        retryable: true,
      },
    })
    expect(mockCollection).toHaveBeenCalledWith('creative_canvas_runs')
    expect(mockCollection).not.toHaveBeenCalledWith('creative_canvases')
  })
})
