import {
  generateInline,
  InlineNotSupportedError,
} from '@/lib/creative-canvas/inline-generation'
import { generateText } from 'ai'

jest.mock('ai', () => ({
  generateText: jest.fn(),
}))

const generateTextMock = generateText as jest.Mock

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
      model: 'grok-image',
      prompt: 'a sunset over mountains',
      aspectRatio: '16:9',
    })

    expect(result).toEqual({
      url: 'https://img.x.ai/generated/abc.png',
      mimeType: 'image/png',
    })

    // Verify it hit the current xAI Imagine endpoint with the supported payload.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.x.ai/v1/images/generations')
    const sentBody = JSON.parse((init as RequestInit).body as string)
    expect(sentBody).toEqual({
      model: 'grok-imagine-image-quality',
      prompt: 'a sunset over mountains',
    })
  })

  it('returns a data URL for xai when only b64_json is returned', async () => {
    process.env.XAI_API_KEY = 'test-key'

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: 'QUJD' }] }),
    }) as unknown as typeof fetch

    const result = await generateInline({
      providerKey: 'xai',
      model: 'grok-image',
      prompt: 'a logo',
    })

    expect(result.mimeType).toBe('image/png')
    expect(result.url).toBe('data:image/png;base64,QUJD')
  })

  it('returns { text, mimeType } for agent_task via the AI gateway', async () => {
    generateTextMock.mockResolvedValue({ text: '  The opening scene, rewritten.  ' })

    const result = await generateInline({
      providerKey: 'agent_task',
      model: 'agent-llm',
      prompt: 'Rewrite the chapter opening.',
    })

    expect(result).toEqual({ text: 'The opening scene, rewritten.', mimeType: 'text/plain' })
    expect(generateTextMock).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'Rewrite the chapter opening.',
    }))
  })

  it('throws when the agent LLM returns empty text', async () => {
    generateTextMock.mockResolvedValue({ text: '   ' })

    await expect(generateInline({
      providerKey: 'agent_task',
      model: 'agent-llm',
      prompt: 'Rewrite.',
    })).rejects.toThrow('No text returned from the agent LLM')
  })

  it('throws a normal Error (not InlineNotSupportedError) when the API key is missing', async () => {
    delete process.env.XAI_API_KEY

    const promise = generateInline({
      providerKey: 'xai',
      model: 'grok-image',
      prompt: 'a tree',
    })

    await expect(promise).rejects.toThrow('XAI_API_KEY not configured')
    await expect(promise).rejects.not.toBeInstanceOf(InlineNotSupportedError)
  })
})
