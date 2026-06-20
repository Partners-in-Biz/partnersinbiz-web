import { NextRequest } from 'next/server'

const mockSubmitCreativeCanvasRunToHermes = jest.fn()

jest.mock('@/lib/creative-canvas/hermes-runtime-bridge', () => ({
  hasValidCreativeCanvasRuntimeKey: jest.requireActual('@/lib/creative-canvas/hermes-runtime-bridge').hasValidCreativeCanvasRuntimeKey,
  submitCreativeCanvasRunToHermes: (...args: unknown[]) => mockSubmitCreativeCanvasRunToHermes(...args),
}))

describe('internal Creative Canvas Higgsfield runtime route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.HIGGSFIELD_RUNTIME_API_KEY = 'runtime-key'
  })

  it('requires the runtime API key', async () => {
    const { POST } = await import('@/app/api/internal/creative-canvas/higgsfield-runtime/route')

    const res = await POST(new NextRequest('http://localhost/api/internal/creative-canvas/higgsfield-runtime', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong' },
      body: JSON.stringify({}),
    }))
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toMatchObject({ success: false, error: 'Unauthorized' })
    expect(mockSubmitCreativeCanvasRunToHermes).not.toHaveBeenCalled()
  })

  it('submits a Creative Canvas run to Hermes and returns normalized runtime metadata', async () => {
    const { POST } = await import('@/app/api/internal/creative-canvas/higgsfield-runtime/route')
    mockSubmitCreativeCanvasRunToHermes.mockResolvedValue({
      providerJobId: 'hermes-run-1',
      providerStatusUrl: '/api/v1/admin/hermes/profiles/org-1/runs/hermes-run-1',
      providerRequestId: 'doc-1',
      status: 'running',
      providerStatus: 'hermes_run_submitted',
      providerStatusMessage: 'Submitted Creative Canvas Higgsfield run to Hermes profile maya.',
    })

    const payload = {
      providerKey: 'higgsfield',
      run: {
        id: 'run-1',
        orgId: 'org-1',
        canvasId: 'canvas-1',
        nodeId: 'model-1',
        providerKey: 'higgsfield',
        status: 'queued',
        input: { sourceNodeIds: [], sourceArtifactIds: [] },
        provenance: { generatedBy: 'agent', promptStored: 'summary', syntheticMedia: true },
      },
    }
    const res = await POST(new NextRequest('http://localhost/api/internal/creative-canvas/higgsfield-runtime', {
      method: 'POST',
      headers: { Authorization: 'Bearer runtime-key' },
      body: JSON.stringify(payload),
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockSubmitCreativeCanvasRunToHermes).toHaveBeenCalledWith(payload)
    expect(body).toMatchObject({
      success: true,
      data: {
        providerJobId: 'hermes-run-1',
        status: 'running',
        providerStatus: 'hermes_run_submitted',
      },
    })
  })
})
