const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockLimit = jest.fn()
const mockGet = jest.fn()
const mockDispatch = jest.fn()
const mockComplete = jest.fn()
const mockRefresh = jest.fn()
const mockGetConnection = jest.fn()
const mockDecrypt = jest.fn()
const mockResolve = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: mockCollection } }))
jest.mock('@/lib/creative-canvas/runs', () => ({
  CREATIVE_CANVAS_RUN_COLLECTION: 'creative_canvas_runs',
  completeCreativeCanvasRun: (...a: unknown[]) => mockComplete(...a),
  refreshCreativeCanvasProviderRunStatus: (...a: unknown[]) => mockRefresh(...a),
}))
jest.mock('@/lib/creative-canvas/connections/store', () => ({
  getCreativeProviderConnection: (...a: unknown[]) => mockGetConnection(...a),
}))
jest.mock('@/lib/creative-canvas/connections/crypto', () => ({
  decryptConnectionCredentials: (...a: unknown[]) => mockDecrypt(...a),
}))
jest.mock('@/lib/creative-canvas/connections/resolve', () => ({
  resolveCreativeProviderCredential: (...a: unknown[]) => mockResolve(...a),
}))
jest.mock('@/lib/creative-canvas/provider-runtime', () => ({
  dispatchCreativeCanvasRunNow: (...a: unknown[]) => mockDispatch(...a),
}))

import { drainDirectCreativeCanvasRuns } from '@/lib/creative-canvas/direct-provider-runtime'

function setupQuery(sequences: Array<Array<Record<string, unknown>>>) {
  const query = { where: mockWhere, limit: mockLimit, get: mockGet }
  mockWhere.mockReturnValue(query)
  mockLimit.mockReturnValue(query)
  mockCollection.mockReturnValue(query)
  mockGet.mockReset()
  sequences.forEach((docs) => {
    mockGet.mockResolvedValueOnce({ docs: docs.map((d) => ({ id: d.id, data: () => d })) })
  })
  mockGet.mockResolvedValue({ docs: [] })
}

const queuedXai = {
  id: 'run-q', orgId: 'org-1', canvasId: 'c-1', nodeId: 'model-1',
  providerKey: 'xai', model: 'grok-imagine-video', status: 'queued',
  input: { promptSummary: 'x', sourceNodeIds: [], sourceArtifactIds: [] },
  provenance: { generatedBy: 'agent', promptStored: 'summary', syntheticMedia: true },
}

const runningFal = {
  id: 'run-r', orgId: 'org-1', canvasId: 'c-1', nodeId: 'model-2',
  providerKey: 'fal', model: 'fal-kling-video-2-6-pro', status: 'running',
  input: { promptSummary: 'y', sourceNodeIds: [], sourceArtifactIds: [] },
  provenance: { generatedBy: 'agent', promptStored: 'summary', syntheticMedia: true, providerJobId: 'fal-req-9', connectionId: 'conn-9' },
}

describe('drainDirectCreativeCanvasRuns', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn() as jest.Mock
    delete process.env.XAI_API_KEY
  })

  it('submits a queued xai run via dispatchCreativeCanvasRunNow', async () => {
    setupQuery([[queuedXai], []]) // queued, then running (empty)
    mockDispatch.mockResolvedValue('submitted')

    const result = await drainDirectCreativeCanvasRuns()

    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ id: 'run-q' }), {})
    expect(result.submitted).toBe(1)
  })

  it('polls a running fal run with its connection decrypted key and completes it', async () => {
    setupQuery([[], [runningFal]]) // queued empty, running has the fal run
    mockGetConnection.mockResolvedValue({ id: 'conn-9', status: 'connected', credentialsEnc: 'ENC', scopeKeyRef: 'org-1' })
    mockDecrypt.mockReturnValue({ apiKey: 'fal-conn-key' })
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'COMPLETED' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ video: { url: 'https://cdn/kling.mp4' } }) })

    const result = await drainDirectCreativeCanvasRuns()

    expect(mockGetConnection).toHaveBeenCalledWith('conn-9')
    expect(mockDecrypt).toHaveBeenCalledWith('ENC', 'org-1')
    // status poll used the connection key
    expect((global.fetch as jest.Mock).mock.calls[0][1].headers.Authorization).toBe('Key fal-conn-key')
    expect(mockComplete).toHaveBeenCalledWith('run-r', 'org-1', expect.objectContaining({
      outputNodeId: 'model-2-output',
      output: expect.objectContaining({ kind: 'video', url: 'https://cdn/kling.mp4' }),
    }), { uid: 'agent:maya', type: 'agent' })
    expect(result.completed).toBe(1)
  })

  it('fails the run when the poll reports failure', async () => {
    setupQuery([[], [runningFal]])
    mockGetConnection.mockResolvedValue({ id: 'conn-9', status: 'connected', credentialsEnc: 'ENC', scopeKeyRef: 'org-1' })
    mockDecrypt.mockReturnValue({ apiKey: 'fal-conn-key' })
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ status: 'FAILED', detail: 'nsfw blocked' }) })

    const result = await drainDirectCreativeCanvasRuns()

    expect(mockRefresh).toHaveBeenCalledWith('run-r', 'org-1', expect.objectContaining({
      status: 'failed',
      error: expect.objectContaining({ message: expect.stringContaining('nsfw blocked') }),
    }), { uid: 'agent:maya', type: 'agent' })
    expect(result.failed).toBe(1)
  })

  it('fails a run with connection_lost when the recorded connection is revoked, without consulting the org resolver', async () => {
    setupQuery([[], [runningFal]]) // runningFal has connectionId: 'conn-9'
    mockGetConnection.mockResolvedValue({ id: 'conn-9', status: 'revoked', credentialsEnc: null, scopeKeyRef: 'org-1' })

    const result = await drainDirectCreativeCanvasRuns()

    // No key substitution: the org/env resolver must not be reached.
    expect(mockResolve).not.toHaveBeenCalled()
    // And no provider poll went out.
    expect(global.fetch).not.toHaveBeenCalled()
    expect(mockRefresh).toHaveBeenCalledWith('run-r', 'org-1', expect.objectContaining({
      status: 'failed',
      error: expect.objectContaining({ code: 'connection_lost', retryable: true }),
    }), { uid: 'agent:maya', type: 'agent' })
    expect(result.failed).toBe(1)
  })

  it('isolates a per-run poll failure so the rest of the batch still runs', async () => {
    const runningFalB = {
      ...runningFal,
      id: 'run-r2', nodeId: 'model-3',
      provenance: { ...runningFal.provenance, providerJobId: 'fal-req-10', connectionId: 'conn-10' },
    }
    setupQuery([[], [runningFal, runningFalB]]) // two running runs
    mockGetConnection.mockResolvedValue({ id: 'conn', status: 'connected', credentialsEnc: 'ENC', scopeKeyRef: 'org-1' })
    mockDecrypt.mockReturnValue({ apiKey: 'fal-conn-key' })
    // First run's poll rejects (network). Second run polls + completes.
    ;(global.fetch as jest.Mock)
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'COMPLETED' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ video: { url: 'https://cdn/kling.mp4' } }) })

    const result = await drainDirectCreativeCanvasRuns()

    // Second run was still polled and completed despite the first one throwing.
    expect(mockComplete).toHaveBeenCalledWith('run-r2', 'org-1', expect.anything(), { uid: 'agent:maya', type: 'agent' })
    expect(result.completed).toBe(1)
    expect(result.skipped).toBe(1)
  })
})
