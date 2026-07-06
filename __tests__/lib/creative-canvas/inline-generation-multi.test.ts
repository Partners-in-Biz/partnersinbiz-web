import { generateInline } from '@/lib/creative-canvas/inline-generation'

jest.mock('ai', () => ({
  generateText: jest.fn(async () => ({ text: 'agent text' })),
}))

describe('generateInline multi-provider', () => {
  afterEach(() => {
    ;(global.fetch as jest.Mock | undefined)?.mockReset?.()
    delete process.env.XAI_API_KEY
  })

  const okImage = { ok: true, json: async () => ({ data: [{ url: 'https://cdn/img.png' }] }) }

  it('xai uses the run model id and the provided BYOK key', async () => {
    global.fetch = jest.fn().mockResolvedValue(okImage) as unknown as typeof fetch
    const result = await generateInline({
      providerKey: 'xai', model: 'grok-imagine-image', prompt: 'a fox', aspectRatio: '16:9',
      credentials: { apiKey: 'xai-byok' },
    })
    expect(result.url).toBe('https://cdn/img.png')
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('https://api.x.ai/v1/images/generations')
    expect(init.headers.Authorization).toBe('Bearer xai-byok')
    expect(JSON.parse(init.body).model).toBe('grok-imagine-image')
    expect(JSON.parse(init.body).aspect_ratio).toBe('16:9')
  })

  it('google routes to the Gemini OpenAI-compat endpoint', async () => {
    global.fetch = jest.fn().mockResolvedValue(okImage) as unknown as typeof fetch
    await generateInline({ providerKey: 'google', model: 'imagen-4', prompt: 'a fox', credentials: { apiKey: 'AIza-x' } })
    expect((global.fetch as jest.Mock).mock.calls[0][0])
      .toBe('https://generativelanguage.googleapis.com/v1beta/openai/images/generations')
  })

  it('recraft routes to the Recraft compat endpoint', async () => {
    global.fetch = jest.fn().mockResolvedValue(okImage) as unknown as typeof fetch
    await generateInline({ providerKey: 'recraft', model: 'recraftv4', prompt: 'a logo', credentials: { apiKey: 'rk-1' } })
    expect((global.fetch as jest.Mock).mock.calls[0][0])
      .toBe('https://external.api.recraft.ai/v1/images/generations')
  })

  it('xai without credentials falls back to XAI_API_KEY env (platform-paid path)', async () => {
    process.env.XAI_API_KEY = 'xai-platform'
    global.fetch = jest.fn().mockResolvedValue(okImage) as unknown as typeof fetch
    await generateInline({ providerKey: 'xai', model: 'grok-imagine-image', prompt: 'x' })
    expect((global.fetch as jest.Mock).mock.calls[0][1].headers.Authorization).toBe('Bearer xai-platform')
  })

  it('google/recraft without credentials throw a connection error', async () => {
    await expect(generateInline({ providerKey: 'recraft', model: 'recraftv4', prompt: 'x' }))
      .rejects.toThrow('connection_required')
  })

  it('b64_json responses become data URLs', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ b64_json: 'QUJD' }] }) }) as unknown as typeof fetch
    const result = await generateInline({ providerKey: 'xai', model: 'grok-imagine-image', prompt: 'x', credentials: { apiKey: 'k' } })
    expect(result.url).toBe('data:image/png;base64,QUJD')
  })

  it('higgsfield still throws InlineNotSupportedError', async () => {
    await expect(generateInline({ providerKey: 'higgsfield', model: 'text2image_soul_v2', prompt: 'x' }))
      .rejects.toThrow('does not support inline generation')
  })

  it('agent_task path unchanged (returns text)', async () => {
    const result = await generateInline({ providerKey: 'agent_task', model: 'agent-llm', prompt: 'hi' })
    expect(result.text).toBe('agent text')
    expect(result.mimeType).toBe('text/plain')
  })
})
