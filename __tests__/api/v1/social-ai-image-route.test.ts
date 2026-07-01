import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: {
    verifyIdToken: jest.fn(),
    verifySessionCookie: jest.fn(),
  },
  adminDb: {
    collection: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
    })),
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}))

describe('POST /api/v1/social/ai/image', () => {
  const oldEnv = process.env

  beforeEach(() => {
    jest.resetModules()
    process.env = { ...oldEnv, AI_API_KEY: 'test-ai-key', XAI_API_KEY: 'test-xai-key' }
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ b64_json: 'iVBORw0KGgo=', revised_prompt: 'Revised campaign card' }],
      }),
    }) as jest.Mock
  })

  afterEach(() => {
    process.env = oldEnv
    jest.restoreAllMocks()
  })

  it('sends an xAI image payload without unsupported size fields and returns a data URL for agent upload flows', async () => {
    const { POST } = await import('@/app/api/v1/social/ai/image/route')

    const res = await POST(new NextRequest('http://localhost/api/v1/social/ai/image', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-ai-key',
        'x-org-id': 'pib-platform-owner',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ prompt: 'Premium PiB campaign card', size: '1024x1536' }),
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(global.fetch).toHaveBeenCalledWith('https://api.x.ai/v1/images/generations', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        model: 'grok-imagine-image-quality',
        prompt: 'Premium PiB campaign card',
      }),
    }))
    expect(body.data).toEqual(expect.objectContaining({
      url: 'data:image/png;base64,iVBORw0KGgo=',
      provider: 'xai',
      revisedPrompt: 'Revised campaign card',
    }))
  })

  it('returns the xAI status and message instead of hiding 400s behind a generic 500', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Argument not supported: size' }),
    })
    const { POST } = await import('@/app/api/v1/social/ai/image/route')

    const res = await POST(new NextRequest('http://localhost/api/v1/social/ai/image', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-ai-key',
        'x-org-id': 'pib-platform-owner',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ prompt: 'Premium PiB campaign card' }),
    }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain('Argument not supported: size')
  })

  it('extracts xAI validation details when the provider returns a non-OpenAI error shape', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ message: 'Invalid model: grok-2-image' }),
    })
    const { POST } = await import('@/app/api/v1/social/ai/image/route')

    const res = await POST(new NextRequest('http://localhost/api/v1/social/ai/image', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-ai-key',
        'x-org-id': 'pib-platform-owner',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ prompt: 'Premium PiB campaign card' }),
    }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain('Invalid model: grok-2-image')
  })
})
