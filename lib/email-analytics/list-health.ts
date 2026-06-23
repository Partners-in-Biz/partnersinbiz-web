// lib/email-analytics/list-health.ts
//
// List-health report (US-113). Scores an org's contact list and breaks it into
// buckets, then offers one-click cleaning (suppress inactive) with a durable
// cleaning history.
//
// Buckets are derived from REAL contact + email signals:
//   • active90d      — engaged (open/click) in the last 90 days
//   • inactive180d   — last engaged 180+ days ago (or sent-to but never since)
//   • neverOpened    — sent at least one email, never opened/clicked
//   • invalidFormat  — email missing or syntactically invalid
//   • unsubscribed   — contact.unsubscribedAt set (excluded from "cleanable")
//   • bounced        — contact.bouncedAt set
// Engagement timestamps come from the `emails` collection (openedAt/clickedAt),
// the same source lib/email-analytics/aggregate.ts uses (contacts carry no
// openedAt field of their own).

import { Timestamp, FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { Contact } from '@/lib/crm/types'
import type { Email } from '@/lib/email/types'
import { addSuppression } from '@/lib/email/suppressions'

const DAY_MS = 24 * 60 * 60 * 1000
const ACTIVE_WINDOW_DAYS = 90
const INACTIVE_WINDOW_DAYS = 180
const ENGAGEMENT_LOOKBACK_DAYS = 365
const MAX_CONTACTS = 20_000
const MAX_EMAILS = 50_000
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const CLEANING_HISTORY_COLLECTION = 'list_cleaning_history'

export type HealthBucket =
  | 'active90d'
  | 'inactive180d'
  | 'neverOpened'
  | 'invalidFormat'
  | 'unsubscribed'
  | 'bounced'

export interface ListHealthBreakdown {
  total: number
  active90d: number
  inactive180d: number
  neverOpened: number
  invalidFormat: number
  unsubscribed: number
  bounced: number
}

export interface SuggestedAction {
  code: string
  label: string
  description: string
  bucket: HealthBucket | null
  affected: number
}

export interface CleaningHistoryEntry {
  id: string
  orgId: string
  action: string
  bucket: HealthBucket | null
  affectedCount: number
  performedBy: string
  performedAt: string | null
  note?: string
}

export interface ListHealthReport {
  orgId: string
  healthScore: number // 0-100
  breakdown: ListHealthBreakdown
  suggestedActions: SuggestedAction[]
  cleaningHistory: CleaningHistoryEntry[]
}

function tsToMs(ts: Timestamp | null | undefined): number | null {
  if (!ts) return null
  try {
    return ts.toMillis()
  } catch {
    return null
  }
}

interface EngagementAgg {
  sent: number
  lastEngagedMs: number | null
}

/**
 * Classify a single contact into a bucket, given its email engagement.
 * Priority: invalid > unsubscribed > bounced > active > neverOpened > inactive.
 */
function classifyContact(
  contact: Contact,
  agg: EngagementAgg | undefined,
  now: number,
): HealthBucket {
  const email = (contact.email ?? '').trim()
  if (!email || !EMAIL_RE.test(email)) return 'invalidFormat'
  if (contact.unsubscribedAt) return 'unsubscribed'
  if (contact.bouncedAt) return 'bounced'

  const lastEngagedMs = agg?.lastEngagedMs ?? null
  const sent = agg?.sent ?? 0

  if (lastEngagedMs !== null) {
    const daysSince = (now - lastEngagedMs) / DAY_MS
    if (daysSince <= ACTIVE_WINDOW_DAYS) return 'active90d'
    if (daysSince >= INACTIVE_WINDOW_DAYS) return 'inactive180d'
    // Between 90 and 180 days — cooling, but we don't have a dedicated bucket;
    // treat as inactive-leaning only past 180d, otherwise leave as active.
    return 'active90d'
  }

  // Never engaged.
  if (sent > 0) return 'neverOpened'
  // Sent nothing, never engaged — treat brand-new/un-mailed as inactive only
  // if old enough; otherwise neverOpened is misleading, so bucket by age.
  const createdMs = tsToMs(contact.createdAt)
  if (createdMs !== null && now - createdMs >= INACTIVE_WINDOW_DAYS * DAY_MS) {
    return 'inactive180d'
  }
  return 'neverOpened'
}

/**
 * Build per-contact engagement aggregates from the `emails` collection over the
 * engagement lookback window.
 */
async function fetchEngagement(orgId: string): Promise<Map<string, EngagementAgg>> {
  const from = new Date(Date.now() - ENGAGEMENT_LOOKBACK_DAYS * DAY_MS)
  const map = new Map<string, EngagementAgg>()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let snap: any
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    snap = await (adminDb.collection('emails') as any)
      .where('orgId', '==', orgId)
      .where('sentAt', '>=', Timestamp.fromDate(from))
      .limit(MAX_EMAILS)
      .get()
  } catch {
    // Missing composite index — fall back to a tenant-only read.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    snap = await (adminDb.collection('emails') as any)
      .where('orgId', '==', orgId)
      .limit(MAX_EMAILS)
      .get()
  }

  for (const doc of snap.docs) {
    const e = doc.data() as Email
    if (e.deleted === true) continue
    if (!e.contactId) continue
    const slot = map.get(e.contactId) ?? { sent: 0, lastEngagedMs: null }
    slot.sent += 1
    const engagedMs = tsToMs(e.openedAt) ?? tsToMs(e.clickedAt)
    if (engagedMs !== null) {
      slot.lastEngagedMs = Math.max(slot.lastEngagedMs ?? 0, engagedMs)
    }
    map.set(e.contactId, slot)
  }
  return map
}

async function fetchContacts(orgId: string): Promise<Contact[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap: any = await (adminDb.collection('contacts') as any)
    .where('orgId', '==', orgId)
    .limit(MAX_CONTACTS)
    .get()
  return snap.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d: any) => ({ id: d.id, ...d.data() }) as Contact)
    .filter((c: Contact) => c.deleted !== true)
}

/**
 * Health score (0-100): share of the list that is deliverable + not-decayed.
 * Penalises invalid, unsubscribed, bounced, and inactive contacts.
 */
function computeHealthScore(b: ListHealthBreakdown): number {
  if (b.total === 0) return 100
  const good = b.active90d + b.neverOpened * 0.6 // never-opened are unproven, not bad
  const score = (good / b.total) * 100
  return Math.round(Math.max(0, Math.min(100, score)))
}

function buildSuggestedActions(b: ListHealthBreakdown): SuggestedAction[] {
  const actions: SuggestedAction[] = []
  if (b.inactive180d > 0) {
    actions.push({
      code: 'suppress-inactive',
      label: `Suppress ${b.inactive180d} inactive contacts`,
      description: 'Contacts with no opens or clicks in 180+ days drag down deliverability. Suppress them to protect sender reputation.',
      bucket: 'inactive180d',
      affected: b.inactive180d,
    })
  }
  if (b.invalidFormat > 0) {
    actions.push({
      code: 'remove-invalid',
      label: `Fix or remove ${b.invalidFormat} invalid addresses`,
      description: 'These addresses are missing or malformed and will hard-bounce. Correct or remove them before your next send.',
      bucket: 'invalidFormat',
      affected: b.invalidFormat,
    })
  }
  if (b.bounced > 0) {
    actions.push({
      code: 'review-bounced',
      label: `Review ${b.bounced} bounced contacts`,
      description: 'Already-bounced contacts are suppressed automatically; review for re-permissioning or removal.',
      bucket: 'bounced',
      affected: b.bounced,
    })
  }
  if (b.neverOpened > 0) {
    actions.push({
      code: 're-engage-never-opened',
      label: `Re-engage ${b.neverOpened} never-opened contacts`,
      description: 'Send a focused win-back before they decay into inactive. Strong subject line, single clear CTA.',
      bucket: 'neverOpened',
      affected: b.neverOpened,
    })
  }
  if (actions.length === 0) {
    actions.push({
      code: 'maintain',
      label: 'List is healthy',
      description: 'No cleaning needed right now. Re-check after your next campaign.',
      bucket: null,
      affected: 0,
    })
  }
  return actions
}

async function fetchCleaningHistory(orgId: string, limit = 25): Promise<CleaningHistoryEntry[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let snap: any
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    snap = await (adminDb.collection(CLEANING_HISTORY_COLLECTION) as any)
      .where('orgId', '==', orgId)
      .orderBy('performedAt', 'desc')
      .limit(limit)
      .get()
  } catch {
    // Missing composite index — fall back to unordered read + in-memory sort.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    snap = await (adminDb.collection(CLEANING_HISTORY_COLLECTION) as any)
      .where('orgId', '==', orgId)
      .limit(limit)
      .get()
  }
  const rows: CleaningHistoryEntry[] = snap.docs.map((d: { id: string; data: () => Record<string, unknown> }) => {
    const data = d.data()
    const performedAt = data.performedAt as Timestamp | null | undefined
    return {
      id: d.id,
      orgId: (data.orgId as string) ?? orgId,
      action: (data.action as string) ?? '',
      bucket: (data.bucket as HealthBucket | null) ?? null,
      affectedCount: (data.affectedCount as number) ?? 0,
      performedBy: (data.performedBy as string) ?? 'system',
      performedAt: performedAt ? new Date(tsToMs(performedAt) ?? Date.now()).toISOString() : null,
      note: (data.note as string) ?? undefined,
    }
  })
  return rows.sort((a, b) => (b.performedAt ?? '').localeCompare(a.performedAt ?? ''))
}

/**
 * Compute the full list-health report (breakdown + actions + history).
 */
export async function getListHealthReport(orgId: string): Promise<ListHealthReport> {
  const [contacts, engagement, cleaningHistory] = await Promise.all([
    fetchContacts(orgId),
    fetchEngagement(orgId),
    fetchCleaningHistory(orgId),
  ])

  const now = Date.now()
  const breakdown: ListHealthBreakdown = {
    total: contacts.length,
    active90d: 0,
    inactive180d: 0,
    neverOpened: 0,
    invalidFormat: 0,
    unsubscribed: 0,
    bounced: 0,
  }
  for (const c of contacts) {
    const bucket = classifyContact(c, engagement.get(c.id), now)
    breakdown[bucket] += 1
  }

  return {
    orgId,
    healthScore: computeHealthScore(breakdown),
    breakdown,
    suggestedActions: buildSuggestedActions(breakdown),
    cleaningHistory,
  }
}

/**
 * Return the contacts that currently fall into the inactive-180d bucket.
 */
async function getInactiveContacts(orgId: string): Promise<Contact[]> {
  const [contacts, engagement] = await Promise.all([fetchContacts(orgId), fetchEngagement(orgId)])
  const now = Date.now()
  return contacts.filter((c) => classifyContact(c, engagement.get(c.id), now) === 'inactive180d')
}

export interface SuppressInactiveResult {
  suppressed: number
  flagged: number
  historyId: string
}

/**
 * One-click clean: suppress all inactive-180d contacts. Adds each to the
 * suppression list (reason 'list-cleanup', permanent) AND flags the contact
 * doc with a `listCleanedAt` marker, then records a cleaning-history entry.
 */
export async function suppressInactiveContacts(
  orgId: string,
  performedBy: string,
): Promise<SuppressInactiveResult> {
  const inactive = await getInactiveContacts(orgId)

  let suppressed = 0
  let flagged = 0
  for (const c of inactive) {
    const email = (c.email ?? '').trim()
    if (email && EMAIL_RE.test(email)) {
      try {
        await addSuppression({
          orgId,
          email,
          reason: 'list-cleanup',
          source: 'admin',
          scope: 'permanent',
          expiresAt: null,
          details: {},
          createdBy: performedBy,
        })
        suppressed += 1
      } catch {
        // Skip un-suppressable addresses (already covered by belt-and-braces).
      }
    }
    try {
      await adminDb.collection('contacts').doc(c.id).update({
        listCleanedAt: FieldValue.serverTimestamp(),
        listCleanedReason: 'inactive-180d',
        updatedAt: FieldValue.serverTimestamp(),
      })
      flagged += 1
    } catch {
      // Non-fatal.
    }
  }

  const historyRef = await adminDb.collection(CLEANING_HISTORY_COLLECTION).add({
    orgId,
    action: 'suppress-inactive',
    bucket: 'inactive180d',
    affectedCount: suppressed,
    performedBy: performedBy || 'system',
    performedAt: FieldValue.serverTimestamp(),
    note: `Suppressed ${suppressed} inactive contacts (180+ days no engagement); flagged ${flagged}.`,
  })

  return { suppressed, flagged, historyId: historyRef.id }
}
