import type { CreativeCanvasProviderKey } from '../types'
import type { ConnectionCredentials } from './crypto'

interface ValidationTarget {
  url: string
  headers: (creds: ConnectionCredentials) => Record<string, string>
}

const TARGETS: Partial<Record<CreativeCanvasProviderKey, ValidationTarget>> = {
  xai: { url: 'https://api.x.ai/v1/models', headers: (c) => ({ Authorization: `Bearer ${c.apiKey}` }) },
  google: { url: 'https://generativelanguage.googleapis.com/v1beta/openai/models', headers: (c) => ({ Authorization: `Bearer ${c.apiKey}` }) },
  recraft: { url: 'https://external.api.recraft.ai/v1/styles', headers: (c) => ({ Authorization: `Bearer ${c.apiKey}` }) },
  // fal model discovery lives on api.fal.ai — fal.run/{owner}/{app} is the
  // invocation scheme and 404s for any non-app path regardless of key validity.
  fal: { url: 'https://api.fal.ai/v1/models', headers: (c) => ({ Authorization: `Key ${c.apiKey}` }) },
}

export async function validateProviderCredentials(
  provider: CreativeCanvasProviderKey,
  credentials: ConnectionCredentials,
): Promise<{ ok: boolean; error?: string }> {
  if (provider === 'higgsfield') {
    // Higgsfield Cloud has no verified cheap list endpoint — accept the key
    // shape; the first real run surfaces auth errors on the run itself.
    return credentials.apiKey && credentials.apiSecret
      ? { ok: true }
      : { ok: false, error: 'Higgsfield needs both API key and secret' }
  }
  const target = TARGETS[provider]
  if (!target) return { ok: false, error: 'Provider does not support connections' }
  if (!credentials.apiKey?.trim()) return { ok: false, error: 'API key is required' }
  try {
    const response = await fetch(target.url, { headers: target.headers(credentials) })
    return response.ok
      ? { ok: true }
      : { ok: false, error: `Provider rejected the key (${response.status})` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Validation request failed' }
  }
}
