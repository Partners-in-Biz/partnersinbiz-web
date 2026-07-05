import { submitDirectRun, pollDirectRun, FAL_ENDPOINTS } from '@/lib/creative-canvas/direct-provider-runtime'
import type { CreativeCanvasRun } from '@/lib/creative-canvas/types'

type RunWithId = CreativeCanvasRun & { id: string }

function baseRun(overrides: Partial<RunWithId> = {}): RunWithId {
  return {
    id: 'run-1',
    orgId: 'org-1',
    canvasId: 'canvas-1',
    nodeId: 'model-1',
    providerKey: 'xai',
    model: 'grok-imagine-video',
    status: 'queued',
    input: {
      promptSummary: 'a fox running',
      sourceNodeIds: [],
      sourceArtifactIds: [],
      aspectRatio: '16:9',
      durationSeconds: 6,
      outputKind: 'video',
    },
    provenance: {
      generatedBy: 'agent',
      agentId: 'maya',
      promptStored: 'summary',
      syntheticMedia: true,
    },
    ...overrides,
  } as RunWithId
}

describe('submitDirectRun — xai video', () => {
  afterEach(() => { (global.fetch as jest.Mock | undefined)?.mockReset?.() })

  it('POSTs the xai video endpoint with model/prompt/duration/aspect_ratio and returns providerJobId', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({ request_id: 'xai-req-1' }),
    }) as unknown as typeof fetch

    const run = baseRun({ input: { ...baseRun().input, referenceImageUrls: ['https://cdn/ref.png'] } })
    const result = await submitDirectRun(run, { apiKey: 'xai-k' })

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('https://api.x.ai/v1/videos/generations')
    expect(init.headers.Authorization).toBe('Bearer xai-k')
    const body = JSON.parse(init.body)
    expect(body.model).toBe('grok-imagine-video')
    expect(body.prompt).toBe('a fox running')
    expect(body.duration).toBe(6)
    expect(body.aspect_ratio).toBe('16:9')
    expect(body.image_url).toBe('https://cdn/ref.png')
    expect(result).toEqual({ providerJobId: 'xai-req-1' })
  })

  it('throws with provider message when xai submit is not ok', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 400, json: async () => ({ error: { message: 'bad request' } }),
    }) as unknown as typeof fetch
    await expect(submitDirectRun(baseRun(), { apiKey: 'k' })).rejects.toThrow('bad request')
  })

  it('throws when xai submit returns no request_id', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({}),
    }) as unknown as typeof fetch
    await expect(submitDirectRun(baseRun(), { apiKey: 'k' })).rejects.toThrow()
  })
})

describe('pollDirectRun — xai video', () => {
  afterEach(() => { (global.fetch as jest.Mock | undefined)?.mockReset?.() })

  function running(): RunWithId {
    return baseRun({ status: 'running', provenance: { ...baseRun().provenance, providerJobId: 'xai-req-1' } })
  }

  it('GETs the xai video status and maps completed + video.url to output', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({ status: 'completed', video: { url: 'https://cdn/out.mp4' } }),
    }) as unknown as typeof fetch
    const result = await pollDirectRun(running(), { apiKey: 'k' })
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('https://api.x.ai/v1/videos/xai-req-1')
    expect(result).toEqual({ status: 'completed', output: { kind: 'video', url: 'https://cdn/out.mp4' } })
  })

  it('maps completed without url to retryable failure xai_missing_output', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({ status: 'completed', video: {} }),
    }) as unknown as typeof fetch
    const result = await pollDirectRun(running(), { apiKey: 'k' })
    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('xai_missing_output')
    expect(result.error?.retryable).toBe(true)
  })

  it('maps status failed to a failure with the provider message', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({ status: 'failed', error: 'content blocked' }),
    }) as unknown as typeof fetch
    const result = await pollDirectRun(running(), { apiKey: 'k' })
    expect(result.status).toBe('failed')
    expect(result.error?.message).toContain('content blocked')
  })

  it('maps anything else to running', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({ status: 'processing' }),
    }) as unknown as typeof fetch
    const result = await pollDirectRun(running(), { apiKey: 'k' })
    expect(result.status).toBe('running')
  })
})

describe('submitDirectRun — fal', () => {
  afterEach(() => { (global.fetch as jest.Mock | undefined)?.mockReset?.() })

  it('POSTs the queue endpoint mapped from model id with Key auth', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({ request_id: 'fal-req-1', status_url: 'https://queue.fal.run/fal-ai/flux-2-pro/requests/fal-req-1/status' }),
    }) as unknown as typeof fetch

    const run = baseRun({ providerKey: 'fal', model: 'fal-flux-2-pro', input: { ...baseRun().input, outputKind: 'image' } })
    const result = await submitDirectRun(run, { apiKey: 'fal-k' })

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('https://queue.fal.run/fal-ai/flux-2-pro')
    expect(init.headers.Authorization).toBe('Key fal-k')
    expect(result.providerJobId).toBe('fal-req-1')
    expect(result.providerStatusUrl).toBe('https://queue.fal.run/fal-ai/flux-2-pro/requests/fal-req-1/status')
  })

  it('maps the fal video endpoints', () => {
    expect(FAL_ENDPOINTS['fal-kling-video-2-6-pro']).toBe('fal-ai/kling-video/v2.6/pro/text-to-video')
    expect(FAL_ENDPOINTS['fal-veo-3-1']).toBe('fal-ai/veo3.1')
  })
})

describe('pollDirectRun — fal', () => {
  afterEach(() => { (global.fetch as jest.Mock | undefined)?.mockReset?.() })

  function falRunning(model = 'fal-kling-video-2-6-pro'): RunWithId {
    return baseRun({
      providerKey: 'fal', model, status: 'running',
      provenance: { ...baseRun().provenance, providerJobId: 'fal-req-1' },
    })
  }

  it('fetches the result on COMPLETED and maps video.url to a video output', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'COMPLETED' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ video: { url: 'https://cdn/kling.mp4' } }) }) as unknown as typeof fetch
    const result = await pollDirectRun(falRunning(), { apiKey: 'k' })
    const secondUrl = (global.fetch as jest.Mock).mock.calls[1][0]
    expect(secondUrl).toBe('https://queue.fal.run/fal-ai/kling-video/v2.6/pro/text-to-video/requests/fal-req-1')
    expect(result).toEqual({ status: 'completed', output: { kind: 'video', url: 'https://cdn/kling.mp4' } })
  })

  it('maps images[0].url to an image output', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'COMPLETED' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ images: [{ url: 'https://cdn/flux.png' }] }) }) as unknown as typeof fetch
    const result = await pollDirectRun(falRunning('fal-flux-2-pro'), { apiKey: 'k' })
    expect(result).toEqual({ status: 'completed', output: { kind: 'image', url: 'https://cdn/flux.png' } })
  })

  it('maps FAILED to a failure with detail/error message', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({ status: 'FAILED', detail: 'nsfw blocked' }),
    }) as unknown as typeof fetch
    const result = await pollDirectRun(falRunning(), { apiKey: 'k' })
    expect(result.status).toBe('failed')
    expect(result.error?.message).toContain('nsfw blocked')
  })

  it('maps IN_QUEUE / IN_PROGRESS to running', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({ status: 'IN_PROGRESS' }),
    }) as unknown as typeof fetch
    const result = await pollDirectRun(falRunning(), { apiKey: 'k' })
    expect(result.status).toBe('running')
  })
})

describe('unknown provider', () => {
  it('submit throws', async () => {
    await expect(submitDirectRun(baseRun({ providerKey: 'higgsfield' }), { apiKey: 'k' })).rejects.toThrow()
  })
})
