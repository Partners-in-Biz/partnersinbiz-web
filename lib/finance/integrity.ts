import { createHash } from 'crypto'
import type { FinanceScope } from './types'

export const CANONICAL_PAYLOAD_VERSION = 1 as const
export const HASH_ALGORITHM_VERSION = 'sha256-v1' as const

function canonicalize(value: unknown, path = '$'): unknown {
  if (value === null) return null
  const kind = typeof value
  if (kind === 'undefined') throw new TypeError(`Canonical payload contains undefined at ${path}`)
  if (kind === 'number') {
    if (!Number.isSafeInteger(value as number) || Object.is(value, -0)) {
      throw new TypeError(`Canonical payload contains an unsupported number at ${path}`)
    }
    return value
  }
  if (kind === 'string' || kind === 'boolean') return value
  if (kind !== 'object') throw new TypeError(`Canonical payload contains unsupported ${kind} at ${path}`)
  if (Array.isArray(value)) return value.map((item, index) => canonicalize(item, `${path}[${index}]`))
  const prototype = Object.getPrototypeOf(value)
  const constructorName = prototype?.constructor?.name
  if (prototype !== null && (Object.prototype.toString.call(value) !== '[object Object]' || constructorName !== 'Object')) {
    throw new TypeError(`Canonical payload contains a non-plain object at ${path}`)
  }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonicalize(item, `${path}.${key}`)]))
}

export function canonicalPayload(value: unknown): string {
  return JSON.stringify({ canonicalPayloadVersion: CANONICAL_PAYLOAD_VERSION, payload: canonicalize(value) })
}

export function canonicalDigest(value: unknown): string {
  return createHash('sha256').update(canonicalPayload(value)).digest('hex')
}

function segment(kind: string, value: string): string {
  return `${kind}${Buffer.byteLength(value, 'utf8')}:${value}`
}

export function canonicalScopeIdentity(scope: FinanceScope): string {
  const parts = [segment('o', scope.orgId), segment('e', scope.legalEntityId)]
  parts.push(scope.bookId === undefined ? 'b-' : segment('b', scope.bookId))
  return `finance-scope-v1|${parts.join('|')}`
}

export function financeScopeKey(scope: FinanceScope): string {
  return `v1_${canonicalDigest(canonicalScopeIdentity(scope))}`
}

export function scopedStorageId(scope: FinanceScope, logicalId: string): string {
  return `v1_${canonicalDigest({ logicalId, scope: canonicalScopeIdentity(scope) })}`
}

export function scopedClaimId(claimType: string, scope: FinanceScope, normalizedKey: unknown): string {
  return `v1_${canonicalDigest({ claimType, scope: canonicalScopeIdentity(scope), normalizedKey })}`
}

interface AuditEventLike extends FinanceScope {
  id: string
  schemaVersion: number
  aggregateType: string
  aggregateId: string
  aggregateVersion: number
  aggregateDigest: string
  sequence: number
  previousEventId?: string
  previousEventHash?: string
  canonicalPayloadVersion: number
  hashAlgorithmVersion: string
  eventHash: string
}
interface AuditHeadLike extends FinanceScope {
  eventId: string
  eventHash: string
  sequence: number
  canonicalPayloadVersion: number
  hashAlgorithmVersion: string
}
interface JournalLike extends FinanceScope {
  id: string
  schemaVersion: number
  version: number
  contentHash: string
  lineDigest: string
  lines: unknown[]
}

function without<T extends Record<string, unknown>>(value: T, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)))
}

/** Throws on any broken link, unsupported version, scope mismatch, or aggregate/line digest mismatch. */
export function verifyFinanceAuditChain(input: {
  scope: Required<FinanceScope>
  events: readonly AuditEventLike[]
  head: AuditHeadLike
  journals: readonly JournalLike[]
}): void {
  const { scope } = input
  if (input.head.orgId !== scope.orgId || input.head.legalEntityId !== scope.legalEntityId || input.head.bookId !== scope.bookId ||
      input.head.canonicalPayloadVersion !== CANONICAL_PAYLOAD_VERSION || input.head.hashAlgorithmVersion !== HASH_ALGORITHM_VERSION) {
    throw new Error('Audit head scope or canonical version is invalid')
  }
  const events = [...input.events].sort((left, right) => left.sequence - right.sequence)
  if (events.length === 0) throw new Error('Audit chain is empty')
  if (!Array.isArray(input.journals)) throw new Error('Audit verification requires complete journals and lines coverage')
  const journalIds = new Set<string>()
  for (const journal of input.journals) {
    if (journalIds.has(journal.id)) throw new Error('Duplicate journal aggregate supplied to audit verification')
    journalIds.add(journal.id)
    if (journal.orgId !== scope.orgId || journal.legalEntityId !== scope.legalEntityId || journal.bookId !== scope.bookId ||
        journal.schemaVersion !== 1 || !Array.isArray(journal.lines) || canonicalDigest(journal.lines) !== journal.lineDigest ||
        canonicalDigest(without(journal as unknown as Record<string, unknown>, ['contentHash'])) !== journal.contentHash) {
      throw new Error('Journal aggregate/content or line digest is invalid')
    }
    if (!events.some((event) => event.aggregateType === 'journal_entry' && event.aggregateId === journal.id &&
      event.aggregateVersion === journal.version && event.aggregateDigest === journal.contentHash)) {
      throw new Error('Orphan journal has no corresponding audit event')
    }
  }
  let previous: AuditEventLike | undefined
  for (const event of events) {
    if (event.orgId !== scope.orgId || event.legalEntityId !== scope.legalEntityId || event.bookId !== scope.bookId ||
        event.schemaVersion !== 1 || event.canonicalPayloadVersion !== CANONICAL_PAYLOAD_VERSION ||
        event.hashAlgorithmVersion !== HASH_ALGORITHM_VERSION) throw new Error('Audit event scope or version is invalid')
    if (event.sequence !== (previous ? previous.sequence + 1 : 0) ||
        event.previousEventId !== previous?.id || event.previousEventHash !== previous?.eventHash) {
      throw new Error('Audit sequence or previous link is invalid')
    }
    if (canonicalDigest(without(event as unknown as Record<string, unknown>, ['eventHash'])) !== event.eventHash) {
      throw new Error('Audit event hash is invalid')
    }
    if (event.aggregateType === 'journal_entry') {
      const journal = input.journals.find((candidate) => candidate.id === event.aggregateId)
      if (!journal || journal.orgId !== scope.orgId || journal.legalEntityId !== scope.legalEntityId ||
          journal.bookId !== scope.bookId || journal.schemaVersion !== 1 || journal.version !== event.aggregateVersion) {
        throw new Error('Audit journal aggregate is missing or out of scope')
      }
      if (canonicalDigest(journal.lines) !== journal.lineDigest) throw new Error('Journal line digest is invalid')
      if (canonicalDigest(without(journal as unknown as Record<string, unknown>, ['contentHash'])) !== journal.contentHash ||
          event.aggregateDigest !== journal.contentHash) throw new Error('Journal aggregate/content digest is invalid')
    }
    previous = event
  }
  const last = events.at(-1)!
  if (input.head.sequence !== last.sequence || input.head.eventId !== last.id || input.head.eventHash !== last.eventHash) {
    throw new Error('Audit head does not match chain tip')
  }
}
