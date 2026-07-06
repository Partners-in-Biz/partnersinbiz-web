const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockLimit = jest.fn()
const mockGet = jest.fn()
const mockDoc = jest.fn()
const mockDocUpdate = jest.fn()
const mockGetCreativeCanvas = jest.fn()
const mockDispatchCreativeCanvasProviderRun = jest.fn()
const mockRefreshCreativeCanvasProviderRunStatus = jest.fn()
const mockResolveCreativeProviderCredential = jest.fn()

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
  completeCreativeCanvasRun: jest.fn(),
  ensureCreativeCanvasRunOutputNode: jest.fn(),
}))

jest.mock('@/lib/creative-canvas/connections/resolve', () => ({
  resolveCreativeProviderCredential: (...args: unknown[]) => mockResolveCreativeProviderCredential(...args),
}))

import { dispatchCreativeCanvasRunNow } from '@/lib/creative-canvas/provider-runtime'

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

function setupFirestoreDocs() {
  const query = { where: mockWhere, limit: mockLimit, get: mockGet }
  mockWhere.mockReturnValue(query)
  mockLimit.mockReturnValue(query)
  mockDoc.mockReturnValue({ update: mockDocUpdate })
  mockCollection.mockReturnValue({ where: mockWhere, doc: mockDoc })
  mockGet.mockResolvedValue({ docs: [] })
}

const env = {
  HIGGSFIELD_RUNTIME_URL: 'https://runtime.example.com',
  HIGGSFIELD_RUNTIME_API_KEY: 'runtime-key',
  NEXT_PUBLIC_APP_URL: 'https://partnersinbiz.online',
} as NodeJS.ProcessEnv

describe('Higgsfield BYOK key passthrough to the executor', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn() as jest.Mock
    setupFirestoreDocs()
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
        providerJobId: 'hf-job-1',
        status: 'running',
      }),
    })
  })

  it('includes byokCredentials in the executor POST and persists connectionId when a user-scoped connection is resolved', async () => {
    mockResolveCreativeProviderCredential.mockResolvedValue({
      kind: 'byok',
      connection: { id: 'conn-123' },
      credentials: { apiKey: 'user-hf-key', apiSecret: 'user-hf-secret' },
    })

    const result = await dispatchCreativeCanvasRunNow(queuedRun as never, { uid: 'user-1', env })

    expect(result).toBe('submitted')
    expect(mockResolveCreativeProviderCredential).toHaveBeenCalledWith({
      provider: 'higgsfield',
      orgId: 'org-1',
      uid: 'user-1',
    })

    const parsedBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(parsedBody.byokCredentials).toEqual({ apiKey: 'user-hf-key', apiSecret: 'user-hf-secret' })

    expect(mockDispatchCreativeCanvasProviderRun).toHaveBeenCalledWith('run-1', 'org-1', expect.objectContaining({
      providerJobId: 'hf-job-1',
      connectionId: 'conn-123',
    }), { uid: 'agent:maya', type: 'agent' })
  })

  it('omits byokCredentials and connectionId entirely when the resolver returns shared', async () => {
    mockResolveCreativeProviderCredential.mockResolvedValue({ kind: 'shared' })

    const result = await dispatchCreativeCanvasRunNow(queuedRun as never, { uid: 'user-1', env })

    expect(result).toBe('submitted')
    const parsedBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect('byokCredentials' in parsedBody).toBe(false)

    expect(mockDispatchCreativeCanvasProviderRun).toHaveBeenCalledWith('run-1', 'org-1', expect.objectContaining({
      providerJobId: 'hf-job-1',
    }), { uid: 'agent:maya', type: 'agent' })
    const dispatchArgs = mockDispatchCreativeCanvasProviderRun.mock.calls[0][2]
    expect('connectionId' in dispatchArgs).toBe(false)
  })

  it('resolves with uid "" (org-scoped fallback only) when dispatched without an opts.uid, as happens from the cron drain path', async () => {
    mockResolveCreativeProviderCredential.mockResolvedValue({ kind: 'shared' })

    await dispatchCreativeCanvasRunNow(queuedRun as never, { env })

    expect(mockResolveCreativeProviderCredential).toHaveBeenCalledWith({
      provider: 'higgsfield',
      orgId: 'org-1',
      uid: '',
    })
  })
})
