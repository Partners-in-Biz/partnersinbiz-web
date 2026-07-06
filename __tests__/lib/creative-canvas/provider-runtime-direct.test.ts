const mockCollection = jest.fn()
const mockGetCreativeCanvas = jest.fn()
const mockDispatchCreativeCanvasProviderRun = jest.fn()
const mockRefreshCreativeCanvasProviderRunStatus = jest.fn()
const mockCompleteCreativeCanvasRun = jest.fn()
const mockEnsureCreativeCanvasRunOutputNode = jest.fn()
const mockResolve = jest.fn()
const mockSubmitDirectRun = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: mockCollection } }))
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: jest.fn(() => 'TS') } }))
jest.mock('@/lib/creative-canvas/store', () => ({ getCreativeCanvas: (...a: unknown[]) => mockGetCreativeCanvas(...a) }))
jest.mock('@/lib/creative-canvas/runs', () => ({
  CREATIVE_CANVAS_RUN_COLLECTION: 'creative_canvas_runs',
  dispatchCreativeCanvasProviderRun: (...a: unknown[]) => mockDispatchCreativeCanvasProviderRun(...a),
  refreshCreativeCanvasProviderRunStatus: (...a: unknown[]) => mockRefreshCreativeCanvasProviderRunStatus(...a),
  completeCreativeCanvasRun: (...a: unknown[]) => mockCompleteCreativeCanvasRun(...a),
  ensureCreativeCanvasRunOutputNode: (...a: unknown[]) => mockEnsureCreativeCanvasRunOutputNode(...a),
}))
jest.mock('@/lib/creative-canvas/connections/resolve', () => ({
  resolveCreativeProviderCredential: (...a: unknown[]) => mockResolve(...a),
}))
jest.mock('@/lib/creative-canvas/direct-provider-runtime', () => ({
  submitDirectRun: (...a: unknown[]) => mockSubmitDirectRun(...a),
  pollDirectRun: jest.fn(),
  drainDirectCreativeCanvasRuns: jest.fn(),
}))

import { dispatchCreativeCanvasRunNow } from '@/lib/creative-canvas/provider-runtime'

const queuedXai = {
  id: 'run-x', orgId: 'org-1', canvasId: 'c-1', nodeId: 'model-1',
  providerKey: 'xai', model: 'grok-imagine-video', status: 'queued',
  input: { promptSummary: 'fox', sourceNodeIds: [], sourceArtifactIds: [], outputKind: 'video' },
  provenance: { generatedBy: 'agent', agentId: 'maya', promptStored: 'summary', syntheticMedia: true },
}

describe('dispatchCreativeCanvasRunNow — direct providers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn() as jest.Mock
  })

  it('higgsfield still routes to the executor (returns not_configured when unconfigured)', async () => {
    const result = await dispatchCreativeCanvasRunNow({ ...queuedXai, providerKey: 'higgsfield' } as never, { env: {} as NodeJS.ProcessEnv })
    expect(result).toBe('not_configured')
    expect(mockSubmitDirectRun).not.toHaveBeenCalled()
  })

  it('xai byok → submitDirectRun with decrypted creds, connectionId persisted', async () => {
    mockResolve.mockResolvedValue({ kind: 'byok', connection: { id: 'conn-1' }, credentials: { apiKey: 'xai-byok' } })
    mockSubmitDirectRun.mockResolvedValue({ providerJobId: 'job-1', providerStatusUrl: 'https://s' })

    const result = await dispatchCreativeCanvasRunNow(queuedXai as never, { uid: 'user-1' })

    expect(result).toBe('submitted')
    expect(mockResolve).toHaveBeenCalledWith({ provider: 'xai', orgId: 'org-1', uid: 'user-1' })
    expect(mockSubmitDirectRun).toHaveBeenCalledWith(queuedXai, { apiKey: 'xai-byok' })
    expect(mockDispatchCreativeCanvasProviderRun).toHaveBeenCalledWith('run-x', 'org-1', expect.objectContaining({
      providerJobId: 'job-1', providerStatusUrl: 'https://s', connectionId: 'conn-1',
    }), { uid: 'agent:maya', type: 'agent' })
  })

  it('connection_required → run failed non-retryable, no submit', async () => {
    mockResolve.mockResolvedValue({ kind: 'connection_required' })
    const result = await dispatchCreativeCanvasRunNow(queuedXai as never, {})
    expect(result).toBe('failed')
    expect(mockSubmitDirectRun).not.toHaveBeenCalled()
    expect(mockRefreshCreativeCanvasProviderRunStatus).toHaveBeenCalledWith('run-x', 'org-1', expect.objectContaining({
      status: 'failed',
      error: expect.objectContaining({ code: 'connection_required', retryable: false }),
    }), { uid: 'agent:maya', type: 'agent' })
  })

  it('shared xai (env) → submit with env key and no connectionId', async () => {
    process.env.XAI_API_KEY = 'xai-env'
    mockResolve.mockResolvedValue({ kind: 'shared' })
    mockSubmitDirectRun.mockResolvedValue({ providerJobId: 'job-2' })
    const result = await dispatchCreativeCanvasRunNow(queuedXai as never, {})
    expect(result).toBe('submitted')
    expect(mockSubmitDirectRun).toHaveBeenCalledWith(queuedXai, { apiKey: 'xai-env' })
    const dispatchArg = mockDispatchCreativeCanvasProviderRun.mock.calls[0][2]
    expect(dispatchArg.connectionId).toBeUndefined()
    delete process.env.XAI_API_KEY
  })

  it('submit throw → run failed retryable direct_submit_failed', async () => {
    mockResolve.mockResolvedValue({ kind: 'byok', connection: { id: 'conn-1' }, credentials: { apiKey: 'k' } })
    mockSubmitDirectRun.mockRejectedValue(new Error('provider boom'))
    const result = await dispatchCreativeCanvasRunNow(queuedXai as never, {})
    expect(result).toBe('failed')
    expect(mockRefreshCreativeCanvasProviderRunStatus).toHaveBeenCalledWith('run-x', 'org-1', expect.objectContaining({
      status: 'failed',
      error: expect.objectContaining({ code: 'direct_submit_failed', retryable: true }),
    }), { uid: 'agent:maya', type: 'agent' })
  })

  it('agent_task → not_configured', async () => {
    const result = await dispatchCreativeCanvasRunNow({ ...queuedXai, providerKey: 'agent_task', model: 'agent-llm' } as never, {})
    expect(result).toBe('not_configured')
  })

  it('non-queued run → not_configured', async () => {
    const result = await dispatchCreativeCanvasRunNow({ ...queuedXai, status: 'running' } as never, {})
    expect(result).toBe('not_configured')
  })
})
