// lib/email-analytics/attribution.ts
//
// Revenue attribution: when a contact clicks an email link and later
// converts (deal won / order paid), attribute that revenue back to the
// originating email/broadcast/campaign/sequence.
//
// Stored in collection `email_attributions`, doc id = `${orgId}_${conversionId}`
// for idempotency — calling `recordAttribution` twice for the same conversion
// is a no-op.

import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { Email } from '@/lib/email/types'
import type { Broadcast } from '@/lib/broadcasts/types'
import type { Campaign } from '@/lib/campaigns/types'
import type { Sequence } from '@/lib/sequences/types'
import type { DateRange } from './aggregate'

function ignoreBestEffortFailure() {
  return undefined
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface AttributedConversion {
  conversionId: string // deal id, order id, etc.
  conversionType: 'deal' | 'order' | 'subscription'
  amount: number // ZAR cents (or org currency minor units)
  currency: string
  contactId: string
  attributedTo: {
    source: 'broadcast' | 'campaign' | 'sequence' | 'one-off'
    sourceId: string // broadcast/campaign/sequence id ("" for one-off)
    emailId: string // emails doc id
    clickedLinkUrl?: string
    clickedAt: string // ISO
  }
  conversionAt: string // ISO
  attributionWindowDays: number
}

export interface RecordAttributionInput {
  orgId: string
  contactId: string
  conversionId: string
  conversionType: AttributedConversion['conversionType']
  amount: number
  currency: string
  conversionAt: Date
  attributionWindowDays?: number
}

export interface BroadcastRevenueRollup {
  totalRevenue: number
  conversionCount: number
  conversionsByDay: Array<{ date: string; revenue: number; count: number }>
}

export interface RevenueOverview {
  totalRevenue: number
  totalConversions: number
  topPerformingEmails: Array<{
    emailId: string
    subject: string
    revenue: number
    conversions: number
  }>
  topPerformingSources: Array<{
    source: string
    sourceId: string
    name: string
    revenue: number
  }>
  revenueByDay: Array<{ date: string; revenue: number; conversions: number }>
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000

function attributionDocId(orgId: string, conversionId: string): string {
  // Slashes are not allowed in Firestore doc IDs.
  return `${orgId}_${conversionId}`.replace(/\//g, '_')
}

function tsToMs(ts: Timestamp | null | undefined): number | null {
  if (!ts) return null
  try {
    return ts.toMillis()
  } catch {
    return null
  }
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function classifySource(e: Email): {
  source: AttributedConversion['attributedTo']['source']
  sourceId: string
} {
  if (e.broadcastId) return { source: 'broadcast', sourceId: e.broadcastId }
  if (e.campaignId) return { source: 'campaign', sourceId: e.campaignId }
  if (e.sequenceId) return { source: 'sequence', sourceId: e.sequenceId }
  return { source: 'one-off', sourceId: '' }
}

/**
 * Find the most recent click by `contactId` within `windowDays` before
 * `conversionAt`. Returns null when no eligible click exists.
 */
async function findMostRecentClick(
  orgId: string,
  contactId: string,
  conversionAt: Date,
  windowDays: number,
): Promise<Email | null> {
  const fromMs = conversionAt.getTime() - windowDays * DAY_MS
  const fromTs = Timestamp.fromDate(new Date(fromMs))
  const toTs = Timestamp.fromDate(conversionAt)

  // Prefer the indexed query that filters by clickedAt directly.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const snap: any = await (adminDb.collection('emails') as any)
      .where('orgId', '==', orgId)
      .where('contactId', '==', contactId)
      .where('clickedAt', '>=', fromTs)
      .where('clickedAt', '<=', toTs)
      .orderBy('clickedAt', 'desc')
      .limit(1)
      .get()
    if (!snap.empty) {
      const doc = snap.docs[0]
      const data = doc.data() as Email
      if (data.deleted !== true) {
        return { ...data, id: doc.id }
      }
    }
  } catch { ignoreBestEffortFailure() }

  // Fallback: pull recent emails for this contact + filter in-memory.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap: any = await (adminDb.collection('emails') as any)
    .where('orgId', '==', orgId)
    .where('contactId', '==', contactId)
    .limit(500)
    .get()
  let best: Email | null = null
  let bestMs = 0
  for (const doc of snap.docs) {
    const e = { id: doc.id, ...doc.data() } as Email
    if (e.deleted === true) continue
    const cms = tsToMs(e.clickedAt)
    if (cms === null) continue
    if (cms < fromMs) continue
    if (cms > conversionAt.getTime()) continue
    if (cms > bestMs) {
      bestMs = cms
      best = e
    }
  }
  return best
}

// ── recordAttribution ───────────────────────────────────────────────────────

/**
 * Records a conversion against the most recent email click by this contact.
 *
 * Idempotent — calling twice for the same (orgId, conversionId) returns the
 * existing record without rewriting.
 *
 * Returns null when no eligible click exists in the attribution window.
 */
export async function recordAttribution(
  input: RecordAttributionInput,
): Promise<AttributedConversion | null> {
  const windowDays = Math.max(1, Math.min(365, input.attributionWindowDays ?? 30))
  const docId = attributionDocId(input.orgId, input.conversionId)
  const ref = adminDb.collection('email_attributions').doc(docId)

  // Idempotency check.
  const existingSnap = await ref.get()
  if (existingSnap.exists) {
    const d = existingSnap.data() ?? {}
    return {
      conversionId: input.conversionId,
      conversionType: (d.conversionType as AttributedConversion['conversionType']) ?? input.conversionType,
      amount: typeof d.amount === 'number' ? d.amount : input.amount,
      currency: typeof d.currency === 'string' ? d.currency : input.currency,
      contactId: input.contactId,
      attributedTo: {
        source: (d.source as AttributedConversion['attributedTo']['source']) ?? 'one-off',
        sourceId: typeof d.sourceId === 'string' ? d.sourceId : '',
        emailId: typeof d.emailId === 'string' ? d.emailId : '',
        clickedLinkUrl: typeof d.clickedLinkUrl === 'string' ? d.clickedLinkUrl : undefined,
        clickedAt:
          d.clickedAt instanceof Timestamp
            ? d.clickedAt.toDate().toISOString()
            : typeof d.clickedAt === 'string'
              ? d.clickedAt
              : input.conversionAt.toISOString(),
      },
      conversionAt:
        d.conversionAt instanceof Timestamp
          ? d.conversionAt.toDate().toISOString()
          : typeof d.conversionAt === 'string'
            ? d.conversionAt
            : input.conversionAt.toISOString(),
      attributionWindowDays:
        typeof d.attributionWindowDays === 'number' ? d.attributionWindowDays : windowDays,
    }
  }

  const click = await findMostRecentClick(
    input.orgId,
    input.contactId,
    input.conversionAt,
    windowDays,
  )
  if (!click) return null

  const { source, sourceId } = classifySource(click)
  const clickedAtMs = tsToMs(click.clickedAt) ?? input.conversionAt.getTime()

  const record: AttributedConversion = {
    conversionId: input.conversionId,
    conversionType: input.conversionType,
    amount: input.amount,
    currency: input.currency,
    contactId: input.contactId,
    attributedTo: {
      source,
      sourceId,
      emailId: click.id,
      clickedAt: new Date(clickedAtMs).toISOString(),
    },
    conversionAt: input.conversionAt.toISOString(),
    attributionWindowDays: windowDays,
  }

  await ref.set({
    orgId: input.orgId,
    conversionId: input.conversionId,
    conversionType: input.conversionType,
    amount: input.amount,
    currency: input.currency,
    contactId: input.contactId,
    source,
    sourceId,
    emailId: click.id,
    clickedAt: Timestamp.fromDate(new Date(clickedAtMs)),
    conversionAt: Timestamp.fromDate(input.conversionAt),
    attributionWindowDays: windowDays,
    createdAt: FieldValue.serverTimestamp(),
  })

  return record
}

// ── getAttributedRevenue ────────────────────────────────────────────────────

export async function getAttributedRevenue(
  orgId: string,
  source: 'broadcast' | 'campaign' | 'sequence',
  sourceId: string,
): Promise<BroadcastRevenueRollup> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap: any = await (adminDb.collection('email_attributions') as any)
    .where('orgId', '==', orgId)
    .where('source', '==', source)
    .where('sourceId', '==', sourceId)
    .get()

  let totalRevenue = 0
  let conversionCount = 0
  const byDay = new Map<string, { revenue: number; count: number }>()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const doc of snap.docs) {
    const d = doc.data()
    const amount = typeof d.amount === 'number' ? d.amount : 0
    const convMs = tsToMs(d.conversionAt)
    totalRevenue += amount
    conversionCount += 1
    if (convMs !== null) {
      const key = isoDay(convMs)
      const slot = byDay.get(key) ?? { revenue: 0, count: 0 }
      slot.revenue += amount
      slot.count += 1
      byDay.set(key, slot)
    }
  }

  const conversionsByDay = Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, revenue: v.revenue, count: v.count }))

  return { totalRevenue, conversionCount, conversionsByDay }
}

// ── getRevenueOverview ──────────────────────────────────────────────────────

export async function getRevenueOverview(
  orgId: string,
  range: DateRange,
): Promise<RevenueOverview> {
  const fromTs = Timestamp.fromDate(range.from)
  const toTs = Timestamp.fromDate(range.to)

  // Pull attributions in window.
  let snap: FirebaseFirestore.QuerySnapshot
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    snap = (await (adminDb.collection('email_attributions') as any)
      .where('orgId', '==', orgId)
      .where('conversionAt', '>=', fromTs)
      .where('conversionAt', '<', toTs)
      .get()) as FirebaseFirestore.QuerySnapshot
  } catch {
    // Missing composite index — fall back to scan + in-memory filter.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fallback: any = await (adminDb.collection('email_attributions') as any)
      .where('orgId', '==', orgId)
      .limit(20_000)
      .get()
    const fromMs = range.from.getTime()
    const toMs = range.to.getTime()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docs = fallback.docs.filter((d: any) => {
      const c = d.data()?.conversionAt
      const ms = c?.toMillis?.() ?? null
      return ms !== null && ms >= fromMs && ms < toMs
    })
    // Re-shape to mimic QuerySnapshot.docs interface needed below.
    snap = { docs } as unknown as FirebaseFirestore.QuerySnapshot
  }

  let totalRevenue = 0
  let totalConversions = 0
  const perEmail = new Map<string, { revenue: number; conversions: number }>()
  const perSource = new Map<string, { source: string; sourceId: string; revenue: number }>()
  const byDay = new Map<string, { revenue: number; conversions: number }>()

  for (const doc of snap.docs) {
    const d = doc.data()
    const amount = typeof d.amount === 'number' ? d.amount : 0
    const emailId: string = typeof d.emailId === 'string' ? d.emailId : ''
    const source: string = typeof d.source === 'string' ? d.source : 'one-off'
    const sourceId: string = typeof d.sourceId === 'string' ? d.sourceId : ''
    totalRevenue += amount
    totalConversions += 1

    if (emailId) {
      const e = perEmail.get(emailId) ?? { revenue: 0, conversions: 0 }
      e.revenue += amount
      e.conversions += 1
      perEmail.set(emailId, e)
    }

    if (sourceId) {
      const key = `${source}|${sourceId}`
      const s = perSource.get(key) ?? { source, sourceId, revenue: 0 }
      s.revenue += amount
      perSource.set(key, s)
    }

    const convMs = tsToMs(d.conversionAt as Timestamp | null)
    if (convMs !== null) {
      const k = isoDay(convMs)
      const slot = byDay.get(k) ?? { revenue: 0, conversions: 0 }
      slot.revenue += amount
      slot.conversions += 1
      byDay.set(k, slot)
    }
  }

  // Resolve email subjects for top-5 emails.
  const topEmailEntries = Array.from(perEmail.entries())
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 5)
  const topPerformingEmails: RevenueOverview['topPerformingEmails'] = []
  for (const [emailId, agg] of topEmailEntries) {
    let subject = ''
    try {
      const eSnap = await adminDb.collection('emails').doc(emailId).get()
      const data = eSnap.data() as Partial<Email> | undefined
      subject = data?.subject ?? ''
    } catch { ignoreBestEffortFailure() }
    topPerformingEmails.push({
      emailId,
      subject,
      revenue: agg.revenue,
      conversions: agg.conversions,
    })
  }

  // Resolve source names for top-5 sources.
  const topSourceEntries = Array.from(perSource.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)
  const topPerformingSources: RevenueOverview['topPerformingSources'] = []
  for (const s of topSourceEntries) {
    let name = s.sourceId
    try {
      const coll =
        s.source === 'broadcast'
          ? 'broadcasts'
          : s.source === 'campaign'
            ? 'campaigns'
            : s.source === 'sequence'
              ? 'sequences'
              : ''
      if (coll) {
        const dSnap = await adminDb.collection(coll).doc(s.sourceId).get()
        const data = dSnap.data() as
          | Partial<Broadcast & Campaign & Sequence>
          | undefined
        name = data?.name ?? s.sourceId
      }
    } catch { ignoreBestEffortFailure() }
    topPerformingSources.push({
      source: s.source,
      sourceId: s.sourceId,
      name,
      revenue: s.revenue,
    })
  }

  const revenueByDay = Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, revenue: v.revenue, conversions: v.conversions }))

  return {
    totalRevenue,
    totalConversions,
    topPerformingEmails,
    topPerformingSources,
    revenueByDay,
  }
}
