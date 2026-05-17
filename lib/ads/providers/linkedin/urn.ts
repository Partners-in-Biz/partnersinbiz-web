// lib/ads/providers/linkedin/urn.ts
// LinkedIn URN parse/build helpers for Phase 2 Campaign Group + Campaign + Creative CRUD.
// LinkedIn URNs follow: urn:li:{namespace}:{id}

// ─── Types ────────────────────────────────────────────────────────────────────

export type LinkedinUrnNamespace =
  | 'sponsoredAccount'
  | 'sponsoredCampaignGroup'
  | 'sponsoredCampaign'
  | 'sponsoredCreative'
  | 'organization'
  | 'person'
  | 'dmpSegment'

export interface ParsedLinkedinUrn {
  namespace: LinkedinUrnNamespace
  id: string
}

// Valid namespaces set for fast lookup
const VALID_NAMESPACES = new Set<LinkedinUrnNamespace>([
  'sponsoredAccount',
  'sponsoredCampaignGroup',
  'sponsoredCampaign',
  'sponsoredCreative',
  'organization',
  'person',
  'dmpSegment',
])

// LinkedIn occasionally uses hyphens in segment URNs; allow alphanumeric + hyphen + underscore
const URN_ID_PATTERN = /^[A-Za-z0-9_-]+$/

// ─── Compose ──────────────────────────────────────────────────────────────────

/** Compose a LinkedIn URN: composeUrn('sponsoredCampaign', '12345') → 'urn:li:sponsoredCampaign:12345' */
export function composeUrn(namespace: LinkedinUrnNamespace, id: string): string {
  if (!id || !URN_ID_PATTERN.test(id)) {
    throw new Error(`Invalid LinkedIn URN id: "${id}"`)
  }
  return `urn:li:${namespace}:${id}`
}

// ─── Parse ────────────────────────────────────────────────────────────────────

/** Parse a LinkedIn URN; throws if format is invalid or namespace is not recognised */
export function parseUrn(urn: string): ParsedLinkedinUrn {
  if (!urn || typeof urn !== 'string') {
    throw new Error(`Invalid LinkedIn URN: "${urn}"`)
  }
  const parts = urn.split(':')
  // Expected: ['urn', 'li', namespace, id]
  if (parts.length < 4 || parts[0] !== 'urn' || parts[1] !== 'li') {
    throw new Error(`Invalid LinkedIn URN format: "${urn}"`)
  }
  const namespace = parts[2]
  // Rejoin in case id contains colons (unlikely for Phase 2 numerics, but defensive)
  const id = parts.slice(3).join(':')
  if (!id || !URN_ID_PATTERN.test(id)) {
    throw new Error(`Invalid LinkedIn URN id segment: "${urn}"`)
  }
  if (!VALID_NAMESPACES.has(namespace as LinkedinUrnNamespace)) {
    throw new Error(`Unrecognised LinkedIn URN namespace: "${namespace}"`)
  }
  return { namespace: namespace as LinkedinUrnNamespace, id }
}

/** Safe parse — returns null on invalid input (no throw) */
export function tryParseUrn(urn: string): ParsedLinkedinUrn | null {
  try {
    return parseUrn(urn)
  } catch {
    return null
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract the numeric id portion (e.g. '12345' from 'urn:li:sponsoredAccount:12345') */
export function urnId(urn: string): string {
  return parseUrn(urn).id
}

/** Type guard: does this URN match the given namespace? */
export function isUrnOf(urn: string, namespace: LinkedinUrnNamespace): boolean {
  const parsed = tryParseUrn(urn)
  return parsed !== null && parsed.namespace === namespace
}
