import { createHash } from 'crypto'
import { AUDIENCE_SCHEMA_VERSION, type AudienceClause, type AudienceDefinition } from './audience-types'

const MAX_CLAUSES = 50
const MAX_VALUES = 5000

function cleanStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') continue
    const clean = item.trim()
    if (!clean || seen.has(clean)) continue
    seen.add(clean)
    out.push(clean)
    if (out.length >= MAX_VALUES) break
  }
  return out
}

function cleanRuleGroup(value: unknown, depth = 0): AudienceClause | null {
  if (!value || typeof value !== 'object' || depth > 6) return null
  const source = value as Record<string, unknown>
  if (!Array.isArray(source.rules) || source.rules.length === 0) return null
  // The authoritative CRM sanitizer runs again at resolution time. Keeping the
  // untrusted payload JSON-only here prevents prototypes/functions from being stored.
  const json = JSON.parse(JSON.stringify(source)) as Record<string, unknown>
  return {
    type: 'rules',
    ruleGroup: json as unknown as Extract<AudienceClause, { type: 'rules' }>['ruleGroup'],
  }
}

function sanitizeClause(value: unknown): AudienceClause | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  switch (source.type) {
    case 'all_contacts':
      return { type: 'all_contacts' }
    case 'segment': {
      const segmentId = typeof source.segmentId === 'string' ? source.segmentId.trim() : ''
      return segmentId ? { type: 'segment', segmentId } : null
    }
    case 'contacts': {
      const contactIds = cleanStrings(source.contactIds)
      return contactIds.length ? { type: 'contacts', contactIds } : null
    }
    case 'tags': {
      const tags = cleanStrings(source.tags)
      return tags.length ? { type: 'tags', tags } : null
    }
    case 'rules':
      return cleanRuleGroup(source.ruleGroup)
    default:
      return null
  }
}

export function sanitizeAudienceDefinition(value: unknown): AudienceDefinition {
  if (!value || typeof value !== 'object') throw new Error('Audience definition is required')
  const source = value as Record<string, unknown>
  const include = (Array.isArray(source.include) ? source.include : [])
    .slice(0, MAX_CLAUSES)
    .map(sanitizeClause)
    .filter((item): item is AudienceClause => item !== null)
  if (include.length === 0) throw new Error('Audience include clause is required')

  const exclude = (Array.isArray(source.exclude) ? source.exclude : [])
    .slice(0, MAX_CLAUSES)
    .map(sanitizeClause)
    .filter((item): item is AudienceClause => item !== null)
  const topicId =
    typeof source.topicId === 'string' && source.topicId.trim()
      ? source.topicId.trim().toLowerCase()
      : 'newsletter'
  const rawHoldout = typeof source.holdoutPercent === 'number' ? source.holdoutPercent : 0
  const holdoutPercent = Math.max(0, Math.min(100, Number.isFinite(rawHoldout) ? rawHoldout : 0))
  const name = typeof source.name === 'string' && source.name.trim() ? source.name.trim() : undefined

  return {
    schemaVersion: AUDIENCE_SCHEMA_VERSION,
    ...(name ? { name } : {}),
    include,
    ...(exclude.length ? { exclude } : {}),
    topicId,
    holdoutPercent,
  }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stable(item)]),
  )
}

export function hashAudienceDefinition(definition: AudienceDefinition): string {
  return createHash('sha256').update(JSON.stringify(stable(definition))).digest('hex')
}

export function computeMembershipDelta(
  previousContactIds: string[],
  nextContactIds: string[],
): { added: number; removed: number; unchanged: number } {
  const previous = new Set(previousContactIds)
  const next = new Set(nextContactIds)
  let unchanged = 0
  let added = 0
  let removed = 0
  for (const id of next) {
    if (previous.has(id)) unchanged += 1
    else added += 1
  }
  for (const id of previous) if (!next.has(id)) removed += 1
  return { added, removed, unchanged }
}
