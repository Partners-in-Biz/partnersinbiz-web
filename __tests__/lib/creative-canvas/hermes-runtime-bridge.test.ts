const mockGetHermesProfileLink = jest.fn()
const mockCreateHermesRun = jest.fn()

jest.mock('@/lib/hermes/server', () => ({
  getHermesProfileLink: (...args: unknown[]) => mockGetHermesProfileLink(...args),
  createHermesRun: (...args: unknown[]) => mockCreateHermesRun(...args),
}))

import { submitCreativeCanvasRunToHermes } from '@/lib/creative-canvas/hermes-runtime-bridge'

const run = {
  id: 'run-1',
  orgId: 'org-1',
  canvasId: 'canvas-1',
  nodeId: 'model-1',
  providerKey: 'higgsfield',
  model: 'nano_banana_flash',
  status: 'queued',
  input: {
    promptSummary: 'Create a social launch video',
    sourceNodeIds: ['source-1'],
    sourceArtifactIds: [],
    outputKind: 'video',
    aspectRatio: '9:16',
    durationSeconds: 6,
    variantCount: 2,
    stylePreset: 'cinematic_product',
  },
  provenance: {
    generatedBy: 'agent',
    agentId: 'maya',
    promptStored: 'summary',
    syntheticMedia: true,
  },
} as const

describe('Creative Canvas Hermes runtime bridge', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('submits a Higgsfield canvas run to the linked Hermes profile', async () => {
    const link = {
      orgId: 'org-1',
      profile: 'maya',
      baseUrl: 'http://127.0.0.1:8651',
      enabled: true,
      capabilities: { runs: true },
    }
    mockGetHermesProfileLink.mockResolvedValue(link)
    mockCreateHermesRun.mockResolvedValue({
      response: { ok: true },
      data: { run_id: 'hermes-run-1', status: 'queued' },
      runDocId: 'doc-1',
    })

    const result = await submitCreativeCanvasRunToHermes({
      providerKey: 'higgsfield',
      run: run as never,
      canvas: {
        id: 'canvas-1',
        orgId: 'org-1',
        title: 'Launch Canvas',
        purpose: 'Social launch',
      },
      manifest: {
        providerKey: 'higgsfield',
        cli: {
          command: 'higgsfield',
          args: ['generate', 'create', 'nano_banana_flash'],
          display: 'higgsfield generate create nano_banana_flash --prompt launch',
        },
        sourceMedia: [{
          nodeId: 'source-1',
          flag: '--image',
          value: 'https://cdn.example.com/product.png',
          role: 'product',
        }],
      } as never,
      callback: {
        url: 'https://partnersinbiz.online/api/v1/creative-canvas/provider-callbacks/higgsfield',
        secretConfigured: true,
      },
    })

    expect(mockGetHermesProfileLink).toHaveBeenCalledWith('org-1')
    expect(mockCreateHermesRun).toHaveBeenCalledWith(link, 'creative-canvas-runtime', expect.objectContaining({
      metadata: expect.objectContaining({
        source: 'creative_canvas_higgsfield_runtime',
        orgId: 'org-1',
        canvasId: 'canvas-1',
        runId: 'run-1',
      }),
    }))
    const prompt = mockCreateHermesRun.mock.calls[0][2].prompt
    expect(prompt).toContain('Execute this Creative Canvas Higgsfield run')
    expect(prompt).toContain('Preferred Higgsfield command')
    expect(prompt).toContain('https://cdn.example.com/product.png')
    expect(prompt).toContain('Do not publish, schedule, share, launch ads')
    expect(result).toEqual({
      providerJobId: 'hermes-run-1',
      providerRequestId: 'doc-1',
      providerStatusUrl: '/api/v1/admin/hermes/profiles/org-1/runs/hermes-run-1',
      status: 'running',
      providerStatus: 'hermes_run_submitted',
      providerStatusMessage: 'Submitted Creative Canvas Higgsfield run to Hermes profile maya.',
    })
  })

  it('fails closed when the organisation has no linked Hermes profile', async () => {
    mockGetHermesProfileLink.mockResolvedValue(null)

    await expect(submitCreativeCanvasRunToHermes({
      providerKey: 'higgsfield',
      run: run as never,
    })).rejects.toThrow('Hermes profile link not found')
    expect(mockCreateHermesRun).not.toHaveBeenCalled()
  })
})
