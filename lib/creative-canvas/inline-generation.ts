/**
 * Provider-pure inline (synchronous) image generation for the Creative Canvas.
 *
 * Mirrors the Grok/xAI image path used by app/api/v1/social/ai/image/route.ts.
 * No Firestore, no Next request objects — just provider calls. Only the xAI
 * provider returns synchronously; async providers (e.g. Higgsfield) throw
 * InlineNotSupportedError so callers fall back to the job-based path.
 */

export class InlineNotSupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InlineNotSupportedError'
  }
}

export interface InlineGenerationInput {
  providerKey: string
  model: string
  prompt: string
  aspectRatio?: string
}

export interface InlineGenerationResult {
  url: string
  mimeType: string
}

/**
 * Single internal network call to the xAI (Grok) image endpoint.
 * Isolated so tests can mock global.fetch.
 */
async function callXaiImage(
  prompt: string,
  apiKey: string,
): Promise<InlineGenerationResult> {
  const response = await fetch('https://api.x.ai/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'grok-2-image',
      prompt,
      response_format: 'b64_json',
    }),
  })

  if (!response.ok) {
    const errorData = (await response.json().catch(() => ({}))) as {
      error?: string | { message?: string }
    }
    const msg = typeof errorData?.error === 'string'
      ? errorData.error
      : errorData?.error?.message ?? `xAI API error (${response.status})`
    if (response.status === 429) throw new Error('RATE_LIMIT')
    if (response.status === 400 && msg.toLowerCase().includes('policy')) {
      throw new Error('CONTENT_POLICY')
    }
    throw new Error(msg)
  }

  const data = (await response.json()) as {
    data: Array<{ url?: string; b64_json?: string }>
  }

  const image = data.data?.[0]
  if (!image?.url && !image?.b64_json) {
    throw new Error('No image returned from xAI')
  }

  if (image.url) {
    return { url: image.url, mimeType: 'image/png' }
  }

  return {
    url: `data:image/png;base64,${image.b64_json}`,
    mimeType: 'image/png',
  }
}

/**
 * Generate an image inline (synchronously). Only the 'xai' provider is
 * synchronous; all other providers throw InlineNotSupportedError.
 */
export async function generateInline(
  input: InlineGenerationInput,
): Promise<InlineGenerationResult> {
  if (input.providerKey !== 'xai') {
    throw new InlineNotSupportedError(
      `Provider "${input.providerKey}" does not support inline generation`,
    )
  }

  const apiKey = process.env.XAI_API_KEY
  if (!apiKey) {
    throw new Error('XAI_API_KEY not configured')
  }

  return callXaiImage(input.prompt, apiKey)
}
