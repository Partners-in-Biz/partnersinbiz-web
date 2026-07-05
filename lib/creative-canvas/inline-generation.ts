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
  /** BYOK credentials resolved by the caller; absent = platform env fallback where allowed. */
  credentials?: Record<string, string>
}

export interface InlineGenerationResult {
  url?: string
  mimeType: string
  /** Set for text generations (agent_task provider) instead of `url`. */
  text?: string
}

/** Default xAI image model for callers that leave `model` empty (social route parity). */
const XAI_DEFAULT_IMAGE_MODEL = 'grok-imagine-image-quality'

/**
 * Sync image providers exposing an OpenAI-compatible `/images/generations`
 * endpoint. `envKey` is the platform-paid fallback API key (xai only).
 */
const OPENAI_COMPAT: Record<string, { baseUrl: string; envKey?: string }> = {
  xai: { baseUrl: 'https://api.x.ai/v1', envKey: 'XAI_API_KEY' },
  google: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  recraft: { baseUrl: 'https://external.api.recraft.ai/v1' },
}

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
 * Single internal network call to an OpenAI-compatible image endpoint
 * (xAI / Google Gemini / Recraft). Isolated so tests can mock global.fetch.
 */
async function callCompatImage(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  aspectRatio?: string,
): Promise<InlineGenerationResult> {
  const response = await fetch(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt,
      ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
    }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => null)
    const msg = safeProviderMessage(errorData) ?? `Provider API error (${response.status})`
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
    throw new Error('No image returned from the provider')
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
 * Generate inline (synchronously). The 'agent_task' provider returns text; the
 * OpenAI-compatible image providers (xai/google/recraft) return images; all
 * other providers throw InlineNotSupportedError.
 */
export async function generateInline(
  input: InlineGenerationInput,
): Promise<InlineGenerationResult> {
  if (input.providerKey === 'agent_task') {
    return callAgentLlmText(input.prompt)
  }

  const compat = OPENAI_COMPAT[input.providerKey]
  if (!compat) {
    throw new InlineNotSupportedError(
      `Provider "${input.providerKey}" does not support inline generation`,
    )
  }

  const apiKey = input.credentials?.apiKey
    ?? (compat.envKey ? process.env[compat.envKey] : undefined)
  if (!apiKey) {
    throw new Error('connection_required')
  }

  const model = input.providerKey === 'xai'
    ? (input.model || XAI_DEFAULT_IMAGE_MODEL)
    : input.model

  return callCompatImage(compat.baseUrl, apiKey, model, input.prompt, input.aspectRatio)
}
