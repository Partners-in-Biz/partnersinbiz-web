import { adminDb } from '@/lib/firebase/admin'
import { API_RATE_LIMIT_DEFAULTS, detectRuntimeRateLimitProfileId, type RuntimeRateLimitProfileId } from '@/lib/rateLimitProfiles'

export interface RateLimitInput {
  key: string         // e.g. 'code:1.2.3.4' or 'magic_link:a@b.com'
  limit: number       // max requests in window
  windowMs: number    // window length
  profileId?: string
  orgId?: string | null
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: Date
  effectiveLimit?: number
  policySource?: 'input' | 'rate_limit_config' | 'rate_limit_overrides' | 'rate_limit_overrides_disabled'
  profileId?: string | null
}

type RateLimitPolicy = {
  limit: number
  windowMs: number
  profileId: string | null
  source: RateLimitResult['policySource']
  disabled: boolean
}

type ApiConfigEntry = {
  id?: unknown
  limit?: unknown
  windowMs?: unknown
}

type OrgOverride = {
  disabled: boolean
  expiresAt: number | null
  limit: number | null
}

const DEFAULT_PROFILE_MAP = new Map(API_RATE_LIMIT_DEFAULTS.map((profile) => [profile.id, profile]))
const POLICY_CACHE_TTL_MS = 30_000

let apiPolicyCache:
  | {
    fetchedAt: number
    entries: Map<string, { limit: number; windowMs: number }>
  }
  | null = null

const orgOverrideCache = new Map<string, { fetchedAt: number; value: OrgOverride | null }>()

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isRuntimeProfileId(value: unknown): value is RuntimeRateLimitProfileId {
  return typeof value === 'string' && DEFAULT_PROFILE_MAP.has(value as RuntimeRateLimitProfileId)
}

function toMillis(value: unknown): number | null {
  if (typeof value === 'number') return value
  if (value instanceof Date) return value.getTime()
  if (value && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    try {
      return (value as { toMillis: () => number }).toMillis()
    } catch {
      return null
    }
  }
  return null
}

async function loadConfiguredApiPolicies(): Promise<Map<string, { limit: number; windowMs: number }>> {
  const now = Date.now()
  if (apiPolicyCache && now - apiPolicyCache.fetchedAt < POLICY_CACHE_TTL_MS) {
    return apiPolicyCache.entries
  }

  const entries = new Map<string, { limit: number; windowMs: number }>()
  for (const profile of API_RATE_LIMIT_DEFAULTS) {
    entries.set(profile.id, { limit: profile.limit, windowMs: profile.windowMs })
  }

  try {
    const snap = await adminDb.collection('rate_limit_config').doc('api').get()
    if (snap.exists) {
      const data = snap.data() as { entries?: ApiConfigEntry[] } | undefined
      for (const rawEntry of Array.isArray(data?.entries) ? data.entries : []) {
        if (!isRuntimeProfileId(rawEntry.id)) continue
        const profileId = rawEntry.id
        const current = entries.get(profileId) ?? DEFAULT_PROFILE_MAP.get(profileId)!
        entries.set(profileId, {
          limit: isPositiveNumber(rawEntry.limit) ? rawEntry.limit : current.limit,
          windowMs: isPositiveNumber(rawEntry.windowMs) ? rawEntry.windowMs : current.windowMs,
        })
      }
    }
  } catch (error) {
    console.warn('[rateLimit] failed to load rate_limit_config/api, using defaults', error)
  }

  apiPolicyCache = {
    fetchedAt: now,
    entries,
  }
  return entries
}

async function loadOrgOverride(orgId: string): Promise<OrgOverride | null> {
  const now = Date.now()
  const cached = orgOverrideCache.get(orgId)
  if (cached && now - cached.fetchedAt < POLICY_CACHE_TTL_MS) {
    return cached.value
  }

  let value: OrgOverride | null = null
  try {
    const snap = await adminDb.collection('rate_limit_overrides').doc(orgId).get()
    if (snap.exists) {
      const data = snap.data() as { disabled?: unknown; expiresAt?: unknown; limit?: unknown } | undefined
      value = {
        disabled: data?.disabled === true,
        expiresAt: toMillis(data?.expiresAt),
        limit: isPositiveNumber(data?.limit) ? data!.limit : null,
      }
    }
  } catch (error) {
    console.warn(`[rateLimit] failed to load rate_limit_overrides/${orgId}`, error)
  }

  orgOverrideCache.set(orgId, { fetchedAt: now, value })
  return value
}

export async function resolveRateLimitPolicy(input: RateLimitInput): Promise<RateLimitPolicy> {
  const profileId = input.profileId ?? detectRuntimeRateLimitProfileId(input.key)
  let limit = input.limit
  let windowMs = input.windowMs
  let source: RateLimitPolicy['source'] = 'input'

  if (profileId) {
    const configuredPolicies = await loadConfiguredApiPolicies()
    const configured = configuredPolicies.get(profileId)
    if (configured) {
      limit = configured.limit
      windowMs = configured.windowMs
      source = 'rate_limit_config'
    }
  }

  const orgId = typeof input.orgId === 'string' && input.orgId.trim() ? input.orgId.trim() : null
  if (orgId) {
    const override = await loadOrgOverride(orgId)
    const isActive = override && (override.expiresAt === null || override.expiresAt > Date.now())
    if (override && isActive) {
      if (override.disabled) {
        return {
          limit,
          windowMs,
          profileId,
          source: 'rate_limit_overrides_disabled',
          disabled: true,
        }
      }
      if (isPositiveNumber(override.limit)) {
        limit = override.limit
        source = 'rate_limit_overrides'
      }
    }
  }

  return {
    limit,
    windowMs,
    profileId,
    source,
    disabled: false,
  }
}

export async function checkAndIncrementRateLimit(input: RateLimitInput): Promise<RateLimitResult> {
  const policy = await resolveRateLimitPolicy(input)
  if (policy.disabled) {
    return {
      allowed: true,
      remaining: Number.MAX_SAFE_INTEGER,
      resetAt: new Date(Date.now() + policy.windowMs),
      effectiveLimit: policy.limit,
      profileId: policy.profileId,
      policySource: policy.source,
    }
  }

  const ref = adminDb.collection('rate_limits').doc(input.key)
  return adminDb.runTransaction(async tx => {
    const snap = await tx.get(ref)
    const now = Date.now()

    if (!snap.exists) {
      const resetAt = now + policy.windowMs
      tx.set(ref, { count: 1, resetAt })
      return {
        allowed: true,
        remaining: policy.limit - 1,
        resetAt: new Date(resetAt),
        effectiveLimit: policy.limit,
        profileId: policy.profileId,
        policySource: policy.source,
      }
    }

    const data = snap.data() as { count: number; resetAt: number }
    if (data.resetAt < now) {
      const resetAt = now + policy.windowMs
      tx.set(ref, { count: 1, resetAt })
      return {
        allowed: true,
        remaining: policy.limit - 1,
        resetAt: new Date(resetAt),
        effectiveLimit: policy.limit,
        profileId: policy.profileId,
        policySource: policy.source,
      }
    }

    if (data.count >= policy.limit) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(data.resetAt),
        effectiveLimit: policy.limit,
        profileId: policy.profileId,
        policySource: policy.source,
      }
    }

    tx.update(ref, { count: data.count + 1 })
    return {
      allowed: true,
      remaining: policy.limit - data.count - 1,
      resetAt: new Date(data.resetAt),
      effectiveLimit: policy.limit,
      profileId: policy.profileId,
      policySource: policy.source,
    }
  })
}

export function __resetRateLimitPolicyCacheForTests(): void {
  apiPolicyCache = null
  orgOverrideCache.clear()
}
