const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockLimit = jest.fn()
const mockGet = jest.fn()
const mockDoc = jest.fn()
const mockDocUpdate = jest.fn()
const mockGetCreativeCanvas = jest.fn()
const mockDispatchCreativeCanvasProviderRun = jest.fn()
const mockRefreshCreativeCanvasProviderRunStatus = jest.fn()
const mockCompleteCreativeCanvasRun = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}))

jest.mock('@/lib/creative-canvas/store', () => ({
  getCreativeCanvas: (...args: unknown[]) => mockGetCreativeCanvas(...args),
}))

jest.mock('@/lib/creative-canvas/runs', () => ({
  CREATIVE_CANVAS_RUN_COLLECTION: 'creative_canvas_runs',
  dispatchCreativeCanvasProviderRun: (...args: unknown[]) => mockDispatchCreativeCanvasProviderRun(...args),
  refreshCreativeCanvasProviderRunStatus: (...args: unknown[]) => mockRefreshCreativeCanvasProviderRunStatus(...args),
  completeCreativeCanvasRun: (...args: unknown[]) => mockCompleteCreativeCanvasRun(...args),
}))

import { drainHiggsfieldCreativeCanvasRuns, getHiggsfieldRuntimeReadiness } from '@/lib/creative-canvas/provider-runtime'

const queuedRun = {
  id: 'run-1',
  orgId: 'org-1',
  canvasId: 'canvas-1',
  nodeId: 'model-1',
  providerKey: 'higgsfield',
  model: 'nano_banana_flash',
  status: 'queued',
  input: {
    promptSummary: 'Create product video',
    sourceNodeIds: ['source-1'],
    sourceArtifactIds: [],
    outputKind: 'video',
    aspectRatio: '9:16',
  },
  provenance: {
    generatedBy: 'agent',
    agentId: 'maya',
    promptStored: 'summary',
    syntheticMedia: true,
  },
}

const runningRun = {
  ...queuedRun,
  id: 'run-2',
  status: 'running',
  provenance: {
    ...queuedRun.provenance,
    providerJobId: 'hf-job-2',
    providerStatusUrl: '/api/internal/creative-canvas/higgsfield-runtime/runs/hf-job-2?orgId=org-1',
  },
}

function setupFirestoreDocs(sequences: Array<Array<Record<string, unknown>>>) {
  const query = { where: mockWhere, limit: mockLimit, get: mockGet }
  mockWhere.mockReturnValue(query)
  mockLimit.mockReturnValue(query)
  mockDoc.mockReturnValue({ update: mockDocUpdate })
  mockCollection.mockReturnValue({ where: mockWhere, doc: mockDoc })
  mockGet.mockReset()
  sequences.forEach((docs) => {
    mockGet.mockResolvedValueOnce({
      docs: docs.map((doc) => ({
        id: doc.id,
        data: () => doc,
      })),
    })
  })
}

describe('Higgsfield creative canvas provider runtime', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn() as jest.Mock
  })

  it('does not claim queued runs when no runtime bridge is configured', async () => {
    const result = await drainHiggsfieldCreativeCanvasRuns({ env: {} as NodeJS.ProcessEnv })

    expect(result).toEqual({
      submitted: 0,
      polled: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      runtimeConfigured: false,
    })
    expect(mockCollection).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('reports safe Higgsfield runtime readiness diagnostics', () => {
    const readiness = getHiggsfieldRuntimeReadiness({
      canvas: { linked: { projectId: 'project-1' } },
      env: {
        HIGGSFIELD_RUNTIME_API_KEY: 'secret-key',
        NEXT_PUBLIC_APP_URL: 'https://partnersinbiz.online',
      } as NodeJS.ProcessEnv,
    })

    expect(readiness).toMatchObject({
      providerKey: 'higgsfield',
      runtimeConfigured: true,
      submitConfigured: true,
      statusPollingConfigured: true,
      internalBridgeConfigured: true,
      callbackBaseConfigured: true,
      webhookSecretConfigured: false,
      linkedProjectId: 'project-1',
      blockers: [],
      warnings: ['Provider webhook secret is not configured'],
    })
    expect(JSON.stringify(readiness)).not.toContain('secret-key')
  })

  it('reports runtime readiness blockers when runtime and project linkage are missing', () => {
    const readiness = getHiggsfieldRuntimeReadiness({ env: {} as NodeJS.ProcessEnv })

    expect(readiness.runtimeConfigured).toBe(false)
    expect(readiness.blockers).toEqual(expect.arrayContaining([
      'Higgsfield runtime submit URL or internal bridge is not configured',
      'Higgsfield runtime status polling is not configured',
      'Canvas is not linked to a project for agent task execution',
    ]))
  })

  it('submits queued Higgsfield runs through the configured runtime bridge', async () => {
    setupFirestoreDocs([[queuedRun], [], []])
    mockGetCreativeCanvas.mockResolvedValue({
      id: 'canvas-1',
      orgId: 'org-1',
      title: 'Launch Canvas',
      purpose: 'Product launch',
      nodes: [{
        id: 'source-1',
        orgId: 'org-1',
        type: 'source',
        title: 'Product clip',
        position: { x: 0, y: 0 },
        data: {},
        source: { kind: 'upload', url: 'https://cdn.example.com/source.png', mimeType: 'image/png' },
      }],
    })
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        providerJobId: 'hf-job-1',
        providerStatusUrl: 'https://runtime.example.com/jobs/hf-job-1',
        providerRequestId: 'req-1',
        status: 'running',
        providerStatusMessage: 'Submitted to Higgsfield',
      }),
    })

    const result = await drainHiggsfieldCreativeCanvasRuns({
      env: {
        HIGGSFIELD_RUNTIME_URL: 'https://runtime.example.com',
        HIGGSFIELD_RUNTIME_API_KEY: 'runtime-key',
        NEXT_PUBLIC_APP_URL: 'https://partnersinbiz.online',
        HIGGSFIELD_WEBHOOK_SECRET: 'hook-secret',
      } as NodeJS.ProcessEnv,
    })

    expect(result).toMatchObject({ submitted: 1, runtimeConfigured: true })
    expect(global.fetch).toHaveBeenCalledWith('https://runtime.example.com/creative-canvas/runs', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer runtime-key' }),
    }))
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body).toMatchObject({
      providerKey: 'higgsfield',
      run: { id: 'run-1', orgId: 'org-1' },
      callback: {
        url: 'https://partnersinbiz.online/api/v1/creative-canvas/provider-callbacks/higgsfield',
        secretConfigured: true,
      },
    })
    expect(body.manifest.sourceMedia[0]).toMatchObject({ nodeId: 'source-1', flag: '--image' })
    expect(mockDocUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'running',
      providerStatus: 'runtime_submission_started',
    }))
    expect(mockDispatchCreativeCanvasProviderRun).toHaveBeenCalledWith('run-1', 'org-1', expect.objectContaining({
      providerJobId: 'hf-job-1',
      providerStatusUrl: 'https://runtime.example.com/jobs/hf-job-1',
      providerRequestId: 'req-1',
    }), { uid: 'agent:maya', type: 'agent' })
    expect(mockRefreshCreativeCanvasProviderRunStatus).toHaveBeenCalledWith('run-1', 'org-1', expect.objectContaining({
      status: 'running',
      providerStatusMessage: 'Submitted to Higgsfield',
    }), { uid: 'agent:maya', type: 'agent' })
  })

  it('uses the internal runtime bridge when only the app URL and runtime key are configured', async () => {
    setupFirestoreDocs([[queuedRun], [], []])
    mockGetCreativeCanvas.mockResolvedValue({
      id: 'canvas-1',
      orgId: 'org-1',
      title: 'Launch Canvas',
      purpose: 'Product launch',
      nodes: [],
    })
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        providerJobId: 'hermes-run-1',
        status: 'running',
      }),
    })

    const result = await drainHiggsfieldCreativeCanvasRuns({
      env: {
        HIGGSFIELD_RUNTIME_API_KEY: 'runtime-key',
        NEXT_PUBLIC_APP_URL: 'https://partnersinbiz.online',
      } as NodeJS.ProcessEnv,
    })

    expect(result).toMatchObject({ submitted: 1, runtimeConfigured: true })
    expect(global.fetch).toHaveBeenCalledWith('https://partnersinbiz.online/api/internal/creative-canvas/higgsfield-runtime', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer runtime-key' }),
    }))
  })

  it('polls running jobs and completes canvas output when the runtime returns media', async () => {
    setupFirestoreDocs([[], [runningRun], []])
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        status: 'completed',
        providerJobId: 'hf-job-2',
        output: {
          kind: 'video',
          url: 'https://cdn.example.com/output.mp4',
          thumbnailUrl: 'https://cdn.example.com/output.jpg',
          textPreview: 'Generated product clip',
        },
      }),
    })

    const result = await drainHiggsfieldCreativeCanvasRuns({
      env: {
        HIGGSFIELD_RUNTIME_API_KEY: 'runtime-key',
        NEXT_PUBLIC_APP_URL: 'https://partnersinbiz.online',
      } as NodeJS.ProcessEnv,
    })

    expect(result).toMatchObject({ completed: 1, runtimeConfigured: true })
    expect(global.fetch).toHaveBeenCalledWith('https://partnersinbiz.online/api/internal/creative-canvas/higgsfield-runtime/runs/hf-job-2?orgId=org-1', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer runtime-key' }),
    }))
    expect(mockCompleteCreativeCanvasRun).toHaveBeenCalledWith('run-2', 'org-1', expect.objectContaining({
      outputNodeId: 'model-1-output',
      output: expect.objectContaining({
        kind: 'video',
        url: 'https://cdn.example.com/output.mp4',
        thumbnailUrl: 'https://cdn.example.com/output.jpg',
      }),
      provenance: expect.objectContaining({
        providerJobId: 'hf-job-2',
        costLabel: 'higgsfield_runtime',
      }),
    }), { uid: 'agent:maya', type: 'agent' })
  })
})
