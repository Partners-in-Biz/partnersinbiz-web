export const API_RATE_LIMIT_DEFAULTS = [
  {
    id: 'analytics_ingest',
    label: 'Analytics ingest (per ingest key)',
    limit: 100,
    windowMs: 60_000,
    source: 'lib/analytics/ingest-rate-limit.ts',
    keyPrefix: 'analytics_ingest:',
  },
  {
    id: 'fx_rates',
    label: 'FX rates (per IP)',
    limit: 120,
    windowMs: 60 * 60 * 1000,
    source: 'app/api/v1/fx/rates/route.ts',
    keyPrefix: 'fx_rates:',
  },
  {
    id: 'firebase_config',
    label: 'Firebase config (per IP)',
    limit: 120,
    windowMs: 60 * 60 * 1000,
    source: 'app/api/v1/firebase-config/route.ts',
    keyPrefix: 'firebase_config:',
  },
  {
    id: 'url_audit',
    label: 'URL audit tool (per IP)',
    limit: 12,
    windowMs: 60 * 60 * 1000,
    source: 'app/api/v1/tools/url-audit/route.ts',
    keyPrefix: 'public_tool_url_audit:',
  },
  {
    id: 'magic_link_send',
    label: 'Magic-link send (per email)',
    limit: 3,
    windowMs: 15 * 60 * 1000,
    source: 'app/api/v1/auth/magic-link/send/route.ts',
    keyPrefix: 'magic_link:',
  },
  {
    id: 'magic_link_send_ip',
    label: 'Magic-link send (per IP)',
    limit: 10,
    windowMs: 15 * 60 * 1000,
    source: 'app/api/v1/auth/magic-link/send/route.ts',
    keyPrefix: 'magic_link_ip:',
  },
] as const

export type RuntimeRateLimitProfile = (typeof API_RATE_LIMIT_DEFAULTS)[number]
export type RuntimeRateLimitProfileId = RuntimeRateLimitProfile['id']

const PROFILE_BY_ID = new Map<string, RuntimeRateLimitProfile>(API_RATE_LIMIT_DEFAULTS.map((profile) => [profile.id, profile]))

export function getRuntimeRateLimitProfile(profileId: string): RuntimeRateLimitProfile | null {
  return PROFILE_BY_ID.get(profileId) ?? null
}

export function detectRuntimeRateLimitProfileId(key: string): RuntimeRateLimitProfileId | null {
  for (const profile of API_RATE_LIMIT_DEFAULTS) {
    if (key.startsWith(profile.keyPrefix)) return profile.id
  }
  return null
}
