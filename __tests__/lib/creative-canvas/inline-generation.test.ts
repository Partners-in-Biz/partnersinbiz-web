import {
  generateInline,
  InlineNotSupportedError,
} from '@/lib/creative-canvas/inline-generation'

describe('generateInline', () => {
  const originalFetch = global.fetch
  const originalKey = process.env.XAI_API_KEY

  afterEach(() => {
    global.fetch = originalFetch
    if (originalKey === undefined) {
      delete process.env.XAI_API_KEY
    } else {
      process.env.XAI_API_KEY = originalKey
    }
    jest.restoreAllMocks()
  })

  it('rejects with InlineNotSupportedError for a non-sync provider', async () => {
    await expect(
      generateInline({
        providerKey: 'higgsfield',
        model: 'higgsfield-soul',
        prompt: 'a cat',
      }),
    ).rejects.toBeInstanceOf(InlineNotSupportedError)
  })

  it('returns { url, mimeType } for xai when the Grok call is mocked', async () => {
    process.env.XAI_API_KEY = 'test-key'

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ url: 'https://img.x.ai/generated/abc.png' }],
      }),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await generateInline({
      providerKey: 'xai',
      model: 'grok-2-image',
      prompt: 'a sunset over mountains',
      aspectRatio: '16:9',
    })

    expect(result).toEqual({
      url: 'https://img.x.ai/generated/abc.png',
      mimeType: 'image/png',
    })

    // Verify it hit the xAI endpoint with the landscape size mapping.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.x.ai/v1/images/generations')
    const sentBody = JSON.parse((init as RequestInit).body as string)
    expect(sentBody.size).toBe('landscape')
    expect(sentBody.model).toBe('grok-2-image')
  })

  it('returns a data URL for xai when only b64_json is returned', async () => {
    process.env.XAI_API_KEY = 'test-key'

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: 'QUJD' }] }),
    }) as unknown as typeof fetch

    const result = await generateInline({
      providerKey: 'xai',
      model: 'grok-2-image',
      prompt: 'a logo',
    })

    expect(result.mimeType).toBe('image/png')
    expect(result.url).toBe('data:image/png;base64,QUJD')
  })

  it('throws a normal Error (not InlineNotSupportedError) when the API key is missing', async () => {
    delete process.env.XAI_API_KEY

    const promise = generateInline({
      providerKey: 'xai',
      model: 'grok-2-image',
      prompt: 'a tree',
    })

    await expect(promise).rejects.toThrow('XAI_API_KEY not configured')
    await expect(promise).rejects.not.toBeInstanceOf(InlineNotSupportedError)
  })
})
