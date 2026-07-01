/**
 * POST /api/v1/social/ai/image — Generate images using xAI (Grok)
 *
 * xAI only. Gemini path removed 2026-05-04 due to runaway billing on Imagen.
 */
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess, apiError } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

interface ImageGenerationRequest {
  prompt: string
  size?: '1024x1024' | '1024x1536' | '1536x1024'
}

class XaiImageError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'XaiImageError'
    this.status = status
  }
}

const XAI_IMAGE_MODEL = 'grok-imagine-image-quality'

function safeProviderMessage(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value.slice(0, 500)
  if (Array.isArray(value)) {
    return value.map(safeProviderMessage).filter(Boolean).join('; ').slice(0, 500) || null
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return safeProviderMessage(obj.message)
      ?? safeProviderMessage(obj.error)
      ?? safeProviderMessage(obj.detail)
      ?? safeProviderMessage(obj.details)
      ?? safeProviderMessage(obj.errors)
  }
  return null
}

// ---------------------------------------------------------------------------
// xAI (Grok) image generation
// ---------------------------------------------------------------------------
async function generateWithXai(
  prompt: string,
  apiKey: string,
): Promise<{ url: string; revisedPrompt: string }> {
  const response = await fetch('https://api.x.ai/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: XAI_IMAGE_MODEL,
      prompt,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => null)
    const msg = safeProviderMessage(errorData) ?? `xAI API error (${response.status})`
    if (response.status === 429) throw new Error('RATE_LIMIT')
    if (response.status === 400 && msg.toLowerCase().includes('policy')) throw new Error('CONTENT_POLICY')
    throw new XaiImageError(msg, response.status)
  }

  const data = await response.json() as {
    data: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>
  }

  const image = data.data?.[0]
  if (!image?.url && !image?.b64_json) throw new Error('No image returned from xAI')

  return {
    url: image.url ?? `data:image/png;base64,${image.b64_json}`,
    revisedPrompt: image.revised_prompt ?? prompt,
  }
}

// ---------------------------------------------------------------------------
// Route handler — xAI only
// ---------------------------------------------------------------------------
export const POST = withAuth('admin', withTenant(async (req) => {
  const body = await req.json() as ImageGenerationRequest

  const prompt = body.prompt?.trim()
  if (!prompt) return apiError('prompt is required', 400)
  if (prompt.length > 4000) return apiError('prompt must be 4000 characters or less', 400)

  const size = body.size ?? '1024x1024'
  if (!['1024x1024', '1024x1536', '1536x1024'].includes(size)) {
    return apiError('size must be "1024x1024", "1024x1536", or "1536x1024"', 400)
  }

  const xaiKey = process.env.XAI_API_KEY
  if (!xaiKey) return apiError('XAI_API_KEY not configured', 500)

  try {
    const result = await generateWithXai(prompt, xaiKey)

    return apiSuccess({
      url: result.url,
      revisedPrompt: result.revisedPrompt,
      provider: 'xai',
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'

    if (message === 'RATE_LIMIT') {
      return apiError('Rate limit exceeded. Please try again later.', 429)
    }
    if (message === 'CONTENT_POLICY') {
      return apiError('Image prompt violates content policy. Please try a different prompt.', 400)
    }
    if (error instanceof XaiImageError) {
      return apiError(`xAI image generation failed: ${message}`, error.status)
    }

    console.error('Image generation error:', error)
    return apiError(`Image generation failed: ${message}`, 500)
  }
}))
