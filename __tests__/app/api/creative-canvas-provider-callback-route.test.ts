import { NextRequest } from 'next/server'

const mockCompleteCreativeCanvasProviderCallback = jest.fn()

jest.mock('@/lib/creative-canvas/runs', () => ({
  completeCreativeCanvasProviderCallback: mockCompleteCreativeCanvasProviderCallback,
}))

describe('creative canvas Higgsfield provider callback API', () => {
  const previousSecret = process.env.HIGGSFIELD_WEBHOOK_SECRET

  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    process.env.HIGGSFIELD_WEBHOOK_SECRET = 'secret-1'
  })

  afterAll(() => {
    process.env.HIGGSFIELD_WEBHOOK_SECRET = previousSecret
  })

  it('rejects callbacks without the configured provider secret', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/provider-callbacks/higgsfield/route')

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/provider-callbacks/higgsfield', {
      method: 'POST',
      body: JSON.stringify({ orgId: 'org-1', providerJobId: 'hf-job-1' }),
    }))
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toMatchObject({ success: false, error: 'Invalid Higgsfield webhook secret' })
    expect(mockCompleteCreativeCanvasProviderCallback).not.toHaveBeenCalled()
  })

  it('ingests a Higgsfield callback with a valid provider secret', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/provider-callbacks/higgsfield/route')
    mockCompleteCreativeCanvasProviderCallback.mockResolvedValue({
      run: { id: 'run-1', status: 'completed' },
      outputNode: { id: 'model-1-output' },
    })

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/provider-callbacks/higgsfield', {
      method: 'POST',
      headers: { 'x-creative-canvas-provider-secret': 'secret-1' },
      body: JSON.stringify({
        orgId: 'org-1',
        providerKey: 'spoofed-provider',
        providerJobId: 'hf-job-1',
        output: {
          kind: 'video',
          url: 'https://cdn.example.com/render.mp4',
        },
        provenance: {
          costUnits: 18,
          costLabel: 'higgsfield_credits',
        },
      }),
    }))
    const body = await res.json()

    expect(mockCompleteCreativeCanvasProviderCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        providerKey: 'higgsfield',
        providerJobId: 'hf-job-1',
        output: expect.objectContaining({ kind: 'video' }),
        provenance: expect.objectContaining({ costUnits: 18 }),
      }),
      { uid: 'provider:higgsfield', type: 'system' },
    )
    expect(body).toMatchObject({
      success: true,
      data: {
        run: { id: 'run-1', status: 'completed' },
        outputNode: { id: 'model-1-output' },
      },
    })
  })
})
