/**
 * Turn raw Hermes / provider failure strings into operator-clear messages.
 * Especially important for subscription usage limits so SuperGrok is not
 * blamed when ChatGPT Codex prolite (or an API-key team) is exhausted.
 */

function extractJsonBlob(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  const candidate = text.slice(start)
  try {
    const parsed = JSON.parse(candidate) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    // Sometimes the payload is nested in Python-ish single quotes — best effort only.
    return null
  }
}

function planLabel(planType: string | undefined): string | null {
  if (!planType) return null
  const normalized = planType.trim().toLowerCase()
  if (normalized === 'prolite') return 'ChatGPT Codex Pro Lite (prolite)'
  if (normalized === 'pro') return 'ChatGPT Pro / Codex Pro'
  if (normalized === 'free') return 'free-tier plan'
  if (normalized === 'plus') return 'ChatGPT Plus'
  return `plan "${planType}"`
}

function detectProviderFamily(error: string): {
  family: 'openai-codex' | 'xai-oauth' | 'xai-api' | 'unknown'
  label: string
} {
  const lower = error.toLowerCase()
  if (
    lower.includes('chatgpt.com/backend-api/codex')
    || lower.includes('openai-codex')
    || lower.includes('provider=openai-codex')
    || lower.includes('base_url=https://chatgpt.com')
  ) {
    return { family: 'openai-codex', label: 'ChatGPT Codex (OpenAI subscription OAuth)' }
  }
  if (
    lower.includes('xai-oauth')
    || lower.includes('provider=xai-oauth')
    || (lower.includes('api.x.ai') && lower.includes('oauth'))
  ) {
    return { family: 'xai-oauth', label: 'xAI SuperGrok OAuth' }
  }
  if (
    lower.includes('xai_api_key')
    || lower.includes('provider=xai')
    || lower.includes('team b5fafefc')
    || (lower.includes('api.x.ai') && (lower.includes('permission-denied') || lower.includes('credits')))
  ) {
    return { family: 'xai-api', label: 'xAI API key (pay-per-token team)' }
  }
  return { family: 'unknown', label: 'the active LLM provider' }
}

function resetHint(error: string, payload: Record<string, unknown> | null): string | null {
  const resetsIn = payload?.resets_in_seconds
  if (typeof resetsIn === 'number' && Number.isFinite(resetsIn) && resetsIn > 0) {
    const hours = Math.max(1, Math.round(resetsIn / 3600))
    return `Quota resets in about ${hours} hour${hours === 1 ? '' : 's'}.`
  }
  const match = error.match(/resets_in_seconds['\"]?\s*[:=]\s*(\d+)/i)
  if (match) {
    const hours = Math.max(1, Math.round(Number(match[1]) / 3600))
    return `Quota resets in about ${hours} hour${hours === 1 ? '' : 's'}.`
  }
  return null
}

/**
 * Human-readable summary for task cards / Messages.
 * Keeps the original error as a trailing detail for debugging.
 */
export function formatHermesWatcherError(error: string, context?: {
  agentId?: string
  provider?: string | null
  model?: string | null
}): string {
  const raw = (error || '').trim() || 'Unknown Hermes error'
  const lower = raw.toLowerCase()
  const payload = extractJsonBlob(raw)
  const nestedError = payload && typeof payload.error === 'object' && payload.error
    ? payload.error as Record<string, unknown>
    : payload
  const planType = typeof nestedError?.plan_type === 'string'
    ? nestedError.plan_type
    : (typeof payload?.plan_type === 'string' ? payload.plan_type : undefined)
  const message = typeof nestedError?.message === 'string'
    ? nestedError.message
    : (typeof payload?.message === 'string' ? payload.message : undefined)

  const detected = detectProviderFamily(raw)
  const providerHint = context?.provider?.trim()
    ? context.provider.trim()
    : detected.family === 'unknown'
      ? null
      : detected.family
  const providerLabel = providerHint === 'openai-codex'
    ? 'ChatGPT Codex (OpenAI subscription OAuth)'
    : providerHint === 'xai-oauth'
      ? 'xAI SuperGrok OAuth'
      : providerHint === 'xai'
        ? 'xAI API key (pay-per-token team)'
        : detected.label

  const modelHint = context?.model?.trim() || null
  const agentHint = context?.agentId?.trim() || null
  const where = [
    agentHint ? `agent ${agentHint}` : null,
    providerLabel,
    modelHint ? `model ${modelHint}` : null,
  ].filter(Boolean).join(' · ')

  if (
    lower.includes('usage limit has been reached')
    || lower.includes('usage_limit_reached')
    || (lower.includes('429') && lower.includes('usage'))
  ) {
    const plan = planLabel(planType)
    const reset = resetHint(raw, nestedError ?? payload)
    const parts = [
      `Provider usage limit reached on ${where || 'the active LLM account'}.`,
      plan ? `This is the ${plan} quota — not necessarily SuperGrok.` : null,
      providerLabel.includes('Codex')
        ? 'If SuperGrok is your intended plan, switch the agent Auto model to xai-oauth / grok-4.6 (Chat Auto uses the Hermes primary, not registry history).'
        : null,
      providerLabel.includes('API key')
        ? 'Raise or top up the xAI API team spend limit in the xAI console, or use SuperGrok OAuth instead.'
        : null,
      reset,
      `Detail: ${message || raw}`.slice(0, 500),
    ].filter(Boolean)
    return parts.join(' ')
  }

  if (
    (lower.includes('missing refresh_token') || lower.includes('access_expired_no_refresh') || lower.includes('managed multi-device'))
    && lower.includes('xai')
  ) {
    return [
      `xAI SuperGrok OAuth on ${where || 'this runtime'} needs a fresh access token from Partners in Biz.`,
      'Multi-machine mode keeps the SuperGrok refresh token only in web Settings; runtimes receive access-only credentials.',
      'Fix: Settings → LLM providers → re-sync SuperGrok, or wait for the linked-computer credential reconcile to push a fresh access token. Do not copy refresh tokens between machines.',
      `Detail: ${raw}`.slice(0, 400),
    ].join(' ')
  }

  if (lower.includes('permission-denied') && (lower.includes('credits') || lower.includes('spending limit'))) {
    return [
      `xAI API key team has no remaining credits / hit its monthly spending limit (${where || 'xAI API'}).`,
      'This is separate from SuperGrok OAuth. Top up the API team in the xAI console or run agents on SuperGrok OAuth.',
      `Detail: ${raw}`.slice(0, 400),
    ].join(' ')
  }

  if (lower.includes('not live-ready')) {
    return [
      raw,
      'Fix: wait for credential sync, or open Settings → LLM providers and re-sync SuperGrok / Codex for this machine and agent.',
    ].join(' ')
  }

  if (lower.includes('offline or does not host this agent')) {
    return [
      raw,
      'Fix: ensure the PiB runtime and local Hermes fleet are running, and the linked computer lists this agent as available.',
    ].join(' ')
  }

  return raw
}
