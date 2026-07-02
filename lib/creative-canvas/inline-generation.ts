/**
 * Provider-pure inline (synchronous) generation for the Creative Canvas.
 *
 * Images mirror the Grok/xAI path used by app/api/v1/social/ai/image/route.ts;
 * text (the `agent_task` provider's `agent-llm` model) goes through the Vercel
 * AI Gateway like the email/SEO generators. No Firestore, no Next request
 * objects — just provider calls. Async providers (e.g. Higgsfield) throw
 * InlineNotSupportedError so callers fall back to the job-based path.
 */
import { generateText } from 'ai'
import { DRAFT_MODEL } from '@/lib/ai/client'

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
  url?: string
  mimeType: string
  /** Set for text generations (agent_task provider) instead of `url`. */
  text?: string
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
      model: XAI_IMAGE_MODEL,
      prompt,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => null)
    const msg = safeProviderMessage(errorData) ?? `xAI API error (${response.status})`
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
 * Agent-LLM text generation through the Vercel AI Gateway — the path behind
 * the canvas ✨ AI-edit on text nodes (characters, chapters, screens, prompts).
 */
async function callAgentLlmText(prompt: string): Promise<InlineGenerationResult> {
  const result = await generateText({
    model: DRAFT_MODEL,
    prompt,
  })
  const text = result.text?.trim()
  if (!text) throw new Error('No text returned from the agent LLM')
  return { text, mimeType: 'text/plain' }
}

/**
 * Generate inline (synchronously). The 'xai' provider returns images, the
 * 'agent_task' provider returns text; all other providers throw
 * InlineNotSupportedError.
 */
export async function generateInline(
  input: InlineGenerationInput,
): Promise<InlineGenerationResult> {
  if (input.providerKey === 'agent_task') {
    return callAgentLlmText(input.prompt)
  }

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
