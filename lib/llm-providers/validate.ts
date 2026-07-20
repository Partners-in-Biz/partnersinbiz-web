import type { LlmProviderKey } from './providers'
import type { LlmConnectionCredentials } from './crypto'

const TARGETS: Partial<Record<LlmProviderKey, { url: string; auth: (c: LlmConnectionCredentials) => Record<string, string> }>> = {
  xai: {
    url: 'https://api.x.ai/v1/models',
    auth: (c) => ({ Authorization: `Bearer ${c.apiKey}` }),
  },
  'openai-api': {
    url: 'https://api.openai.com/v1/models',
    auth: (c) => ({ Authorization: `Bearer ${c.apiKey}` }),
  },
  anthropic: {
    url: 'https://api.anthropic.com/v1/models',
    auth: (c) => ({ 'x-api-key': c.apiKey!, 'anthropic-version': '2023-06-01' }),
  },
  gemini: {
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/models',
    auth: (c) => ({ Authorization: `Bearer ${c.apiKey}` }),
  },
  openrouter: {
    url: 'https://openrouter.ai/api/v1/models',
    auth: (c) => ({ Authorization: `Bearer ${c.apiKey}` }),
  },
  copilot: {
    url: 'https://api.githubcopilot.com/models',
    auth: (c) => ({
      Authorization: `Bearer ${c.apiKey}`,
      'Editor-Version': 'Hermes/1.0',
      'Copilot-Integration-Id': 'vscode-chat',
    }),
  },
}

export async function validateLlmCredentials(
  provider: LlmProviderKey,
  credentials: LlmConnectionCredentials,
): Promise<{ ok: boolean; error?: string; models?: string[] }> {
  if (credentials.access_token) {
    return { ok: true }
  }
  const target = TARGETS[provider]
  if (!target) {
    if (provider === 'xai-oauth' || provider === 'openai-codex' || provider === 'nous') {
      return { ok: false, error: 'This provider requires OAuth sign-in, not an API key.' }
    }
    return { ok: false, error: 'Provider does not support API-key validation' }
  }
  if (!credentials.apiKey?.trim()) return { ok: false, error: 'API key is required' }
  try {
    const response = await fetch(target.url, {
      headers: { Accept: 'application/json', ...target.auth(credentials) },
    })
    if (!response.ok) {
      return { ok: false, error: `Provider rejected the key (${response.status})` }
    }
    const payload = await response.json().catch(() => null) as { data?: Array<{ id?: string }> } | null
    const models = Array.isArray(payload?.data)
      ? payload!.data!.map((m) => m.id).filter((id): id is string => Boolean(id)).slice(0, 40)
      : undefined
    return { ok: true, ...(models ? { models } : {}) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Validation request failed' }
  }
}
