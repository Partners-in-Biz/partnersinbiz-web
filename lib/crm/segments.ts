// lib/crm/segments.ts
import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { MemberRef } from '@/lib/orgMembers/memberRef'
import type {
  Contact,
  ContactSource,
  ContactStage,
  ContactType,
} from './types'

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Behavioral segmentation — filter contacts based on their email engagement.
 *
 * Rules combine with AND (every rule must be satisfied). Within a single
 * rule, the `op` decides whether the contact must match the scope (`has-*`)
 * or must NOT match it (`has-not-*`).
 */
export type BehavioralOp =
  | 'has-opened'
  | 'has-not-opened'
  | 'has-clicked'
  | 'has-not-clicked'
  | 'has-received'
  | 'has-not-received'
  | 'has-replied'
  | 'has-not-replied'

export type BehavioralScope =
  | 'any-email'
  | 'broadcast'
  | 'campaign'
  | 'sequence'
  | 'sequence-step'
  | 'topic'
  | 'link-url'

export interface BehavioralRule {
  op: BehavioralOp
  scope: BehavioralScope
  /**
   * Scope identifier:
   *   - broadcast / campaign / sequence → the resource doc id
   *   - topic                           → the topicId string
   *   - link-url                        → URL substring to match against
   *                                       shortened_links.originalUrl
   *   - sequence-step                   → the sequence id (step number lives
   *                                       in scopeStepNumber)
   *   - any-email                       → unused
   */
  scopeId?: string
  /** for scope = 'sequence-step' */
  scopeStepNumber?: number
  /** "in the last N days" — applies to openedAt / clickedAt / sentAt / receivedAt */
  withinDays?: number
  /** "NOT in the last N days" — dormant filter */
  notWithinDays?: number
}

export interface EngagementScoreRule {
  /** min score (0..100) — inclusive */
  min?: number
  /** max score (0..100) — inclusive */
  max?: number
  /** last open OR click within N days */
  lastEngagedWithinDays?: number
  /** dormant filter: no open AND no click for N days */
  notEngagedWithinDays?: number
}

export interface SegmentFilters {
  tags?: string[]                 // OR within array (array-contains-any)
  capturedFromIds?: string[]      // OR within array
  stage?: ContactStage
  type?: ContactType
  source?: ContactSource
  createdAfter?: Timestamp | null
  /** AND across rules. Optional. */
  behavioral?: BehavioralRule[]
  /** Optional engagement score gate. */
  engagement?: EngagementScoreRule
}

export interface Segment {
  id: string
  orgId: string
  name: string
  description: string
  filters: SegmentFilters
  createdAt: Timestamp | null
  updatedAt: Timestamp | null
  createdBy?: string
  createdByRef?: MemberRef
  updatedBy?: string
  updatedByRef?: MemberRef
  deleted?: boolean
}

export type SegmentInput = Omit<Segment, 'id' | 'createdAt' | 'updatedAt'>

// ── Filter sanitizer (shared by API routes) ─────────────────────────────────

const VALID_BEHAVIORAL_OPS: ReadonlySet<BehavioralOp> = new Set([
  'has-opened',
  'has-not-opened',
  'has-clicked',
  'has-not-clicked',
  'has-received',
  'has-not-received',
  'has-replied',
  'has-not-replied',
])
const VALID_BEHAVIORAL_SCOPES: ReadonlySet<BehavioralScope> = new Set([
  'any-email',
  'broadcast',
  'campaign',
  'sequence',
  'sequence-step',
  'topic',
  'link-url',
])

function sanitizeBehavioralRule(input: unknown): BehavioralRule | null {
  if (!input || typeof input !== 'object') return null
  const r = input as Record<string, unknown>
  if (typeof r.op !== 'string' || !VALID_BEHAVIORAL_OPS.has(r.op as BehavioralOp)) return null
  if (typeof r.scope !== 'string' || !VALID_BEHAVIORAL_SCOPES.has(r.scope as BehavioralScope)) {
    return null
  }
  const rule: BehavioralRule = {
    op: r.op as BehavioralOp,
    scope: r.scope as BehavioralScope,
  }
  if (typeof r.scopeId === 'string' && r.scopeId.trim()) rule.scopeId = r.scopeId.trim()
  if (typeof r.scopeStepNumber === 'number' && Number.isFinite(r.scopeStepNumber)) {
    rule.scopeStepNumber = Math.trunc(r.scopeStepNumber)
  }
  if (typeof r.withinDays === 'number' && r.withinDays > 0) {
    rule.withinDays = Math.min(3650, Math.trunc(r.withinDays))
  }
  if (typeof r.notWithinDays === 'number' && r.notWithinDays > 0) {
    rule.notWithinDays = Math.min(3650, Math.trunc(r.notWithinDays))
  }
  return rule
}

function sanitizeEngagementRule(input: unknown): EngagementScoreRule | null {
  if (!input || typeof input !== 'object') return null
  const r = input as Record<string, unknown>
  const out: EngagementScoreRule = {}
  if (typeof r.min === 'number' && Number.isFinite(r.min)) {
    out.min = Math.max(0, Math.min(100, Math.round(r.min)))
  }
  if (typeof r.max === 'number' && Number.isFinite(r.max)) {
    out.max = Math.max(0, Math.min(100, Math.round(r.max)))
  }
  if (typeof r.lastEngagedWithinDays === 'number' && r.lastEngagedWithinDays > 0) {
    out.lastEngagedWithinDays = Math.min(3650, Math.trunc(r.lastEngagedWithinDays))
  }
  if (typeof r.notEngagedWithinDays === 'number' && r.notEngagedWithinDays > 0) {
    out.notEngagedWithinDays = Math.min(3650, Math.trunc(r.notEngagedWithinDays))
  }
  if (Object.keys(out).length === 0) return null
  return out
}

/**
 * Sanitize raw filter input from API requests. Strips unknown fields,
 * type-checks, and clamps numeric values. Always safe to call on
 * untrusted JSON input.
 */
export function sanitizeSegmentFilters(input: unknown): SegmentFilters {
  const f = (input ?? {}) as Record<string, unknown>
  const filters: SegmentFilters = {}
  if (Array.isArray(f.tags)) {
    filters.tags = f.tags.filter((t): t is string => typeof t === 'string' && !!t)
  }
  if (Array.isArray(f.capturedFromIds)) {
    filters.capturedFromIds = f.capturedFromIds.filter(
      (t): t is string => typeof t === 'string' && !!t,
    )
  }
  if (typeof f.stage === 'string') filters.stage = f.stage as SegmentFilters['stage']
  if (typeof f.type === 'string') filters.type = f.type as SegmentFilters['type']
  if (typeof f.source === 'string') filters.source = f.source as SegmentFilters['source']
  if (f.createdAfter != null) {
    filters.createdAfter = f.createdAfter as SegmentFilters['createdAfter']
  }
  if (Array.isArray(f.behavioral)) {
    const rules: BehavioralRule[] = []
    for (const raw of f.behavioral) {
      const rule = sanitizeBehavioralRule(raw)
      if (rule) rules.push(rule)
      if (rules.length >= 10) break
    }
    if (rules.length > 0) filters.behavioral = rules
  }
  if (f.engagement != null) {
    const engagement = sanitizeEngagementRule(f.engagement)
    if (engagement) filters.engagement = engagement
  }
  return filters
}

// ── Resolver ─────────────────────────────────────────────────────────────────

const MAX_RESULTS = 5000
const ARRAY_CONTAINS_ANY_LIMIT = 10
const BEHAVIORAL_QUERY_CAP = 10_000
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Resolve the contacts that match a segment's filters within a single org.
 *
 * Security: orgId is ALWAYS the first where() clause — segments must never
 * leak across organisations even if filter shape is malformed.
 *
 * Firestore restrictions force some filtering in-memory:
 * - Only one `array-contains-any` per query → tags use it; capturedFromIds use `in`
 *   when possible, otherwise fall back to in-memory filtering after fetch.
 * - unsubscribed / bounced / deleted contacts are always excluded in-memory so
 *   we never need composite indexes for those != null checks.
 *
 * Behavioral / engagement rules run AFTER the contact pre-filter and combine
 * with AND.
 */
export async function resolveSegmentContacts(
  orgId: string,
  filters: SegmentFilters,
): Promise<Contact[]> {
  if (!orgId) return []

  const tags = (filters.tags ?? []).filter((t) => typeof t === 'string' && t)
  if (tags.length > ARRAY_CONTAINS_ANY_LIMIT) return []

  const capturedFromIds = (filters.capturedFromIds ?? []).filter(
    (id) => typeof id === 'string' && id,
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = adminDb.collection('contacts').where('orgId', '==', orgId)

  if (tags.length > 0) {
    query = query.where('tags', 'array-contains-any', tags)
  }

  // Firestore allows one `in` filter per query. If tags already used
  // array-contains-any AND we have multiple capturedFromIds we cannot add `in`
  // alongside it, so we filter capturedFromIds in-memory in that case.
  let inMemoryCapturedFromIds: string[] | null = null
  if (capturedFromIds.length === 1) {
    query = query.where('capturedFromId', '==', capturedFromIds[0])
  } else if (capturedFromIds.length > 1) {
    if (tags.length === 0) {
      query = query.where('capturedFromId', 'in', capturedFromIds.slice(0, 10))
      // If more than 10, we still need to in-memory filter the result.
      if (capturedFromIds.length > 10) {
        inMemoryCapturedFromIds = capturedFromIds
      }
    } else {
      inMemoryCapturedFromIds = capturedFromIds
    }
  }

  if (filters.stage) {
    query = query.where('stage', '==', filters.stage)
  }
  if (filters.type) {
    query = query.where('type', '==', filters.type)
  }
  if (filters.source) {
    query = query.where('source', '==', filters.source)
  }
  if (filters.createdAfter) {
    query = query.where('createdAt', '>=', filters.createdAfter)
  }

  const snapshot = await query.limit(MAX_RESULTS).get()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let contacts: Contact[] = snapshot.docs.map((doc: any) => ({
    id: doc.id,
    ...doc.data(),
  }))

  contacts = contacts.filter((c) => {
    if (c.deleted === true) return false
    if (c.unsubscribedAt != null) return false
    if (c.bouncedAt != null) return false
    if (inMemoryCapturedFromIds && !inMemoryCapturedFromIds.includes(c.capturedFromId)) {
      return false
    }
    return true
  })

  // ── Behavioral rules ──────────────────────────────────────────────────────
  const behavioralRules = Array.isArray(filters.behavioral)
    ? filters.behavioral.filter((r) => r && typeof r.op === 'string' && typeof r.scope === 'string')
    : []

  if (behavioralRules.length > 0 && contacts.length > 0) {
    const candidateIds = contacts.map((c) => c.id)
    const matchedIds = await applyBehavioralRules(orgId, candidateIds, behavioralRules)
    const allowed = new Set(matchedIds)
    contacts = contacts.filter((c) => allowed.has(c.id))
  }

  // ── Engagement score rule ─────────────────────────────────────────────────
  if (filters.engagement && contacts.length > 0) {
    contacts = await applyEngagementRule(orgId, contacts, filters.engagement)
  }

  return contacts
}

// ── Behavioral rule engine ───────────────────────────────────────────────────

/**
 * For each rule, compute the set of contactIds that satisfy it (or don't, for
 * `has-not-*`), then intersect / subtract from the running candidate set.
 *
 * Rules combine with AND.
 */
export async function applyBehavioralRules(
  orgId: string,
  candidateContactIds: string[],
  rules: BehavioralRule[],
): Promise<string[]> {
  let surviving = new Set(candidateContactIds)
  for (const rule of rules) {
    if (surviving.size === 0) return []
    const matchingIds = await contactsMatchingRule(orgId, rule)
    if (matchingIds === null) {
      // Rule could not be evaluated (e.g. unsupported scope) — skip rule
      // rather than failing the whole segment.
      continue
    }
    const isNegated =
      rule.op === 'has-not-opened' ||
      rule.op === 'has-not-clicked' ||
      rule.op === 'has-not-received' ||
      rule.op === 'has-not-replied'

    const matchSet = new Set(matchingIds)
    if (isNegated) {
      // Subtract: keep candidates that are NOT in the match set
      surviving = new Set([...surviving].filter((id) => !matchSet.has(id)))
    } else {
      // Intersect
      surviving = new Set([...surviving].filter((id) => matchSet.has(id)))
    }
  }
  return [...surviving]
}

/**
 * Resolve the set of contactIds for a single rule. Returns the POSITIVE set —
 * i.e. contacts that have actually opened/clicked/received/replied per the
 * scope. The caller decides whether to intersect (has-*) or subtract (has-not-*).
 *
 * Returns null if the rule cannot be evaluated.
 */
async function contactsMatchingRule(
  orgId: string,
  rule: BehavioralRule,
): Promise<string[] | null> {
  // Reply rules are the only ones that hit a different collection.
  if (rule.op === 'has-replied' || rule.op === 'has-not-replied') {
    return await contactsWithReplies(orgId, rule)
  }

  // For received / opened / clicked we query the `emails` collection.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = adminDb.collection('emails').where('orgId', '==', orgId)

  // Status field: `openedAt`, `clickedAt`, `sentAt` are the signals.
  const isOpen = rule.op === 'has-opened' || rule.op === 'has-not-opened'
  const isClick = rule.op === 'has-clicked' || rule.op === 'has-not-clicked'
  const isReceive = rule.op === 'has-received' || rule.op === 'has-not-received'

  const dateField = isClick ? 'clickedAt' : isOpen ? 'openedAt' : 'sentAt'

  // Apply scope filters. `link-url` is special — it uses shortened_links and
  // doesn't filter the `emails` query.
  switch (rule.scope) {
    case 'broadcast':
      if (!rule.scopeId) return []
      query = query.where('broadcastId', '==', rule.scopeId)
      break
    case 'campaign':
      if (!rule.scopeId) return []
      query = query.where('campaignId', '==', rule.scopeId)
      break
    case 'sequence':
      if (!rule.scopeId) return []
      query = query.where('sequenceId', '==', rule.scopeId)
      break
    case 'sequence-step':
      if (!rule.scopeId || typeof rule.scopeStepNumber !== 'number') return []
      query = query
        .where('sequenceId', '==', rule.scopeId)
        .where('sequenceStep', '==', rule.scopeStepNumber)
      break
    case 'topic':
      if (!rule.scopeId) return []
      // emails docs carry `topicId` from lib/broadcasts/send.ts; older docs
      // without the field simply won't match (acceptable).
      query = query.where('topicId', '==', rule.scopeId)
      break
    case 'link-url':
      // Cannot filter the emails collection by link URL directly. We route
      // to a different resolver that walks shortened_links → contactIds via
      // recorded clicks.
      if (!rule.scopeId) return []
      if (isReceive) {
        // "received this URL" doesn't make sense — fall through.
        return []
      }
      return await contactsWhoClickedLinkUrl(orgId, rule.scopeId, rule.withinDays, rule.notWithinDays)
    case 'any-email':
    default:
      // No scope filter — match all emails for the org.
      break
  }

  // Date filters. We only apply ONE inequality on the chosen dateField to keep
  // composite-index requirements minimal.
  if (typeof rule.withinDays === 'number' && rule.withinDays > 0) {
    const cutoff = Timestamp.fromMillis(Date.now() - rule.withinDays * DAY_MS)
    query = query.where(dateField, '>=', cutoff)
  } else {
    // For has-opened / has-clicked we still need to require the field is
    // present. Firestore can't filter on `!= null` without an inequality, so
    // we use `>` epoch instead. We skip this for has-received (sentAt is always set).
    if (isOpen || isClick) {
      query = query.where(dateField, '>', Timestamp.fromMillis(0))
    }
  }

  // Cap result set to prevent runaway memory.
  query = query.limit(BEHAVIORAL_QUERY_CAP)

  let docs: FirebaseFirestore.QueryDocumentSnapshot[]
  try {
    const snap = await query.get()
    docs = snap.docs
  } catch (err) {
    // Missing composite index — log and treat as no matches so the rule fails
    // closed (no false positives).
    console.warn('[segments.behavioral] query failed (likely missing index):', err)
    return []
  }

  if (docs.length >= BEHAVIORAL_QUERY_CAP) {
    console.warn(
      `[segments.behavioral] rule hit ${BEHAVIORAL_QUERY_CAP}-row cap (orgId=${orgId}, scope=${rule.scope}). Results may be truncated.`,
    )
  }

  // notWithinDays is applied in-memory after the query because Firestore
  // can't combine "<" and ">=" on the same field with other where clauses
  // without painful index gymnastics.
  const notCutoff =
    typeof rule.notWithinDays === 'number' && rule.notWithinDays > 0
      ? Date.now() - rule.notWithinDays * DAY_MS
      : null

  const ids = new Set<string>()
  for (const doc of docs) {
    const data = doc.data() as Record<string, unknown>
    if (data.deleted === true) continue
    const contactId = typeof data.contactId === 'string' ? data.contactId : ''
    if (!contactId) continue

    // For openedAt / clickedAt we already guaranteed presence via the inequality
    // above. For sentAt (received), presence is guaranteed by document existence.
    if (notCutoff !== null) {
      const ts = data[dateField]
      const ms =
        ts && typeof (ts as Timestamp).toMillis === 'function'
          ? (ts as Timestamp).toMillis()
          : null
      if (ms === null) continue
      // "NOT within the last N days" → keep only events older than the cutoff
      if (ms >= notCutoff) continue
    }
    ids.add(contactId)
  }
  return [...ids]
}

/**
 * Resolve contactIds who replied (or didn't) per the rule's scope.
 * Uses the `inbound_emails` collection where intent = 'reply'.
 */
async function contactsWithReplies(
  orgId: string,
  rule: BehavioralRule,
): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = adminDb
    .collection('inbound_emails')
    .where('orgId', '==', orgId)
    .where('intent', '==', 'reply')

  switch (rule.scope) {
    case 'broadcast':
      if (rule.scopeId) query = query.where('broadcastId', '==', rule.scopeId)
      break
    case 'campaign':
      if (rule.scopeId) query = query.where('campaignId', '==', rule.scopeId)
      break
    case 'sequence':
      if (rule.scopeId) query = query.where('sequenceId', '==', rule.scopeId)
      break
    case 'sequence-step':
    case 'topic':
    case 'link-url':
      // Not supported for reply rules. Treat as no scope filter.
      break
    case 'any-email':
    default:
      break
  }

  if (typeof rule.withinDays === 'number' && rule.withinDays > 0) {
    const cutoff = Timestamp.fromMillis(Date.now() - rule.withinDays * DAY_MS)
    query = query.where('receivedAt', '>=', cutoff)
  }

  query = query.limit(BEHAVIORAL_QUERY_CAP)

  let docs: FirebaseFirestore.QueryDocumentSnapshot[]
  try {
    const snap = await query.get()
    docs = snap.docs
  } catch (err) {
    console.warn('[segments.behavioral] reply query failed:', err)
    return []
  }

  const notCutoff =
    typeof rule.notWithinDays === 'number' && rule.notWithinDays > 0
      ? Date.now() - rule.notWithinDays * DAY_MS
      : null

  const ids = new Set<string>()
  for (const doc of docs) {
    const data = doc.data() as Record<string, unknown>
    if (data.deleted === true) continue
    const contactId = typeof data.contactId === 'string' ? data.contactId : ''
    if (!contactId) continue
    if (notCutoff !== null) {
      const ts = data.receivedAt
      const ms =
        ts && typeof (ts as Timestamp).toMillis === 'function'
          ? (ts as Timestamp).toMillis()
          : null
      if (ms === null) continue
      if (ms >= notCutoff) continue
    }
    ids.add(contactId)
  }
  return [...ids]
}

/**
 * Find contacts who clicked a shortened link whose originalUrl contains
 * `urlSubstring`. Walks shortened_links → link_clicks → contactIds.
 *
 * Falls back to empty if neither collection exists.
 */
async function contactsWhoClickedLinkUrl(
  orgId: string,
  urlSubstring: string,
  withinDays?: number,
  notWithinDays?: number,
): Promise<string[]> {
  if (!urlSubstring) return []
  const needle = urlSubstring.toLowerCase()

  let linkIds: string[] = []
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const linksSnap: any = await adminDb
      .collection('shortened_links')
      .where('orgId', '==', orgId)
      .limit(BEHAVIORAL_QUERY_CAP)
      .get()
    linkIds = linksSnap.docs
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((d: any) => {
        const url = (d.data().originalUrl ?? '').toString().toLowerCase()
        return url.includes(needle)
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((d: any) => d.id)
  } catch {
    // The top-level link_clicks rows carry targetUrl, so a missing/failed
    // shortened_links lookup should not force a silent false negative.
    linkIds = []
  }

  const ids = new Set<string>()
  const matchingLinkIds = new Set(linkIds)
  const cutoffMs =
    typeof withinDays === 'number' && withinDays > 0
      ? Date.now() - withinDays * DAY_MS
      : null
  const notCutoffMs =
    typeof notWithinDays === 'number' && notWithinDays > 0
      ? Date.now() - notWithinDays * DAY_MS
      : null

  try {
    // Scan org click events once and match either the denormalized targetUrl or
    // a shortened-link id found above. This keeps preview accurate for new
    // link_clicks rows and older rows that only carried shortenedLinkId/linkId.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clicksSnap: any = await adminDb
      .collection('link_clicks')
      .where('orgId', '==', orgId)
      .limit(BEHAVIORAL_QUERY_CAP)
      .get()
    for (const doc of clicksSnap.docs) {
      const data = doc.data() as Record<string, unknown>
      const cid = typeof data.contactId === 'string' ? data.contactId : ''
      if (!cid) continue
      const targetUrl = typeof data.targetUrl === 'string' ? data.targetUrl.toLowerCase() : ''
      const shortenedLinkId =
        typeof data.shortenedLinkId === 'string'
          ? data.shortenedLinkId
          : typeof data.linkId === 'string'
            ? data.linkId
            : ''
      if (!targetUrl.includes(needle) && !matchingLinkIds.has(shortenedLinkId)) continue
      const ts = data.clickedAt ?? data.createdAt
      const ms =
        ts && typeof (ts as Timestamp).toMillis === 'function'
          ? (ts as Timestamp).toMillis()
          : null
      if (cutoffMs !== null && (ms === null || ms < cutoffMs)) continue
      if (notCutoffMs !== null && (ms === null || ms >= notCutoffMs)) continue
      ids.add(cid)
    }
  } catch {
    // link_clicks collection may not exist — return whatever we matched so far.
  }
  return [...ids]
}

// ── Engagement-score rule ────────────────────────────────────────────────────

/**
 * Apply an engagement score filter using the same formula as
 * lib/email-analytics/aggregate.ts > getContactEngagement().
 *
 * We pull the email history (180-day window) for the entire org once, then
 * compute scores per-candidate in-memory.
 */
async function applyEngagementRule(
  orgId: string,
  candidates: Contact[],
  rule: EngagementScoreRule,
): Promise<Contact[]> {
  const candidateIds = new Set(candidates.map((c) => c.id))
  const since = Timestamp.fromMillis(Date.now() - 180 * DAY_MS)

  // Pull recent emails to compute per-contact stats. Use sentAt index.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let snap: any
  try {
    snap = await adminDb
      .collection('emails')
      .where('orgId', '==', orgId)
      .where('sentAt', '>=', since)
      .limit(50_000)
      .get()
  } catch (err) {
    console.warn('[segments.engagement] query failed:', err)
    return candidates // fail-open rather than fail-closed for the score rule
  }

  type Agg = {
    sent: number
    opened: number
    clicked: number
    bounced: number
    lastEngagedMs: number | null
  }
  const perContact = new Map<string, Agg>()
  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>
    if (data.deleted === true) continue
    const contactId = typeof data.contactId === 'string' ? data.contactId : ''
    if (!contactId || !candidateIds.has(contactId)) continue
    const slot = perContact.get(contactId) ?? {
      sent: 0,
      opened: 0,
      clicked: 0,
      bounced: 0,
      lastEngagedMs: null,
    }
    slot.sent += 1
    const status = data.status as string | undefined
    const openedAt = data.openedAt as Timestamp | null | undefined
    const clickedAt = data.clickedAt as Timestamp | null | undefined
    const bouncedAt = data.bouncedAt as Timestamp | null | undefined
    const isOpen = !!openedAt || status === 'opened' || status === 'clicked'
    const isClick = !!clickedAt || status === 'clicked'
    if (isOpen) {
      slot.opened += 1
      const ms = openedAt?.toMillis?.() ?? clickedAt?.toMillis?.() ?? null
      if (ms !== null) slot.lastEngagedMs = Math.max(slot.lastEngagedMs ?? 0, ms)
    }
    if (isClick) {
      slot.clicked += 1
      const ms = clickedAt?.toMillis?.() ?? null
      if (ms !== null) slot.lastEngagedMs = Math.max(slot.lastEngagedMs ?? 0, ms)
    }
    if (bouncedAt) slot.bounced += 1
    perContact.set(contactId, slot)
  }

  const now = Date.now()
  const min = typeof rule.min === 'number' ? rule.min : null
  const max = typeof rule.max === 'number' ? rule.max : null
  const lastEngagedWithinMs =
    typeof rule.lastEngagedWithinDays === 'number' && rule.lastEngagedWithinDays > 0
      ? now - rule.lastEngagedWithinDays * DAY_MS
      : null
  const notEngagedWithinMs =
    typeof rule.notEngagedWithinDays === 'number' && rule.notEngagedWithinDays > 0
      ? now - rule.notEngagedWithinDays * DAY_MS
      : null

  return candidates.filter((c) => {
    const agg = perContact.get(c.id) ?? {
      sent: 0,
      opened: 0,
      clicked: 0,
      bounced: 0,
      lastEngagedMs: null,
    }
    const daysSinceLastEngaged =
      agg.lastEngagedMs !== null ? (now - agg.lastEngagedMs) / DAY_MS : 9999
    const rawScore =
      agg.opened * 5 + agg.clicked * 15 - agg.bounced * 30 - daysSinceLastEngaged * 0.5
    const score = Math.max(0, Math.min(100, Math.round(rawScore)))

    if (min !== null && score < min) return false
    if (max !== null && score > max) return false
    if (lastEngagedWithinMs !== null) {
      if (agg.lastEngagedMs === null || agg.lastEngagedMs < lastEngagedWithinMs) return false
    }
    if (notEngagedWithinMs !== null) {
      if (agg.lastEngagedMs !== null && agg.lastEngagedMs >= notEngagedWithinMs) return false
    }
    return true
  })
}
