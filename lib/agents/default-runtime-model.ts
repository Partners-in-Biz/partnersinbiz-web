/**
 * System-wide Auto model defaults for Partners in Biz agents.
 * Chat "Auto" follows each Hermes profile's primary model; keep these in sync
 * with live profile config on Mac + VPS.
 */

export const SYSTEM_DEFAULT_PRIMARY_PROVIDER = 'xai-oauth'
export const SYSTEM_DEFAULT_PRIMARY_MODEL = 'grok-4.6'
export const SYSTEM_DEFAULT_PRIMARY_BASE_URL = 'https://api.x.ai/v1'

export const SYSTEM_DEFAULT_FALLBACK_PROVIDER = 'nous'
export const SYSTEM_DEFAULT_FALLBACK_MODEL = 'deepseek/deepseek-v4-flash'

/** Registry / seed label shown in admin when Auto uses the system default. */
export const SYSTEM_DEFAULT_REGISTRY_MODEL = `${SYSTEM_DEFAULT_PRIMARY_PROVIDER}/${SYSTEM_DEFAULT_PRIMARY_MODEL}`

export const SYSTEM_DEFAULT_FALLBACKS = [
  {
    provider: SYSTEM_DEFAULT_FALLBACK_PROVIDER,
    model: SYSTEM_DEFAULT_FALLBACK_MODEL,
  },
] as const
