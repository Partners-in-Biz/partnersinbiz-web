/**
 * Shared helpers for the platform feature-flag control plane.
 *
 * Global flag definitions live in the `platform_feature_flags` collection,
 * one doc per flag, keyed by the flag key. Per-org overrides live inside each
 * organization doc's `featureFlags` map.
 */

export const FLAGS_COLLECTION = 'platform_feature_flags'

export const KEY_PATTERN = /^[a-z][a-z0-9_.-]{1,60}$/

export const FLAG_TYPES = ['boolean', 'string', 'number'] as const
export type FlagType = (typeof FLAG_TYPES)[number]

export function isFlagType(value: unknown): value is FlagType {
  return typeof value === 'string' && (FLAG_TYPES as readonly string[]).includes(value)
}

/**
 * Coerce a raw value to the declared flag type. Throws if it cannot be
 * represented as the requested type.
 */
export function coerceValue(type: FlagType, raw: unknown): boolean | string | number {
  if (type === 'boolean') {
    if (typeof raw === 'boolean') return raw
    if (raw === 'true' || raw === '1' || raw === 1) return true
    if (raw === 'false' || raw === '0' || raw === 0 || raw === '' || raw === null || raw === undefined) return false
    return Boolean(raw)
  }
  if (type === 'number') {
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(n)) throw new Error('defaultValue must be a finite number')
    return n
  }
  // string
  if (raw === null || raw === undefined) return ''
  return String(raw)
}

export interface FlagDef {
  key: string
  type: FlagType
  defaultValue: boolean | string | number
  description: string
  createdAt: string | null
  updatedAt: string | null
}

function tsToIso(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const seconds = (value as { _seconds?: number; seconds?: number })._seconds
    ?? (value as { seconds?: number }).seconds
  if (typeof seconds === 'number') return new Date(seconds * 1000).toISOString()
  const toDate = (value as { toDate?: () => Date }).toDate
  if (typeof toDate === 'function') {
    try { return toDate.call(value).toISOString() } catch { return null }
  }
  return null
}

export function toFlagDef(id: string, data: Record<string, unknown>): FlagDef {
  const type = isFlagType(data.type) ? data.type : 'boolean'
  let defaultValue: boolean | string | number
  try {
    defaultValue = coerceValue(type, data.defaultValue)
  } catch {
    defaultValue = type === 'boolean' ? false : type === 'number' ? 0 : ''
  }
  return {
    key: typeof data.key === 'string' ? data.key : id,
    type,
    defaultValue,
    description: typeof data.description === 'string' ? data.description : '',
    createdAt: tsToIso(data.createdAt),
    updatedAt: tsToIso(data.updatedAt),
  }
}
