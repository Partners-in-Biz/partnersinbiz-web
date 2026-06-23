// lib/analytics/query.ts
//
// Shared server-side aggregation helpers over the REAL ingested data
// (product_sessions / product_events). Every analytics dashboard API
// builds on these so numbers are derived consistently from stored data.

import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { AnalyticsSegment, DeviceType } from './types'

const SESSIONS = 'product_sessions'
const EVENTS = 'product_events'

/** Hard caps so a single dashboard request can never run away. */
const MAX_SESSIONS = 20000
const MAX_EVENTS = 30000

export interface DateRange {
  from: Date
  to: Date
}

/** Parse from/to query params, defaulting to the last 30 days. */
export function parseRange(fromStr: string | null, toStr: string | null): DateRange {
  const to = toStr ? new Date(toStr) : new Date()
  const from = fromStr ? new Date(fromStr) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)
  return { from, to }
}

export function rangeIsValid(r: DateRange): boolean {
  return !isNaN(r.from.getTime()) && !isNaN(r.to.getTime()) && r.from <= r.to
}

// ---------------------------------------------------------------------------
// Firestore timestamp coercion (docs serialise differently in transit)
// ---------------------------------------------------------------------------

export function tsToMillis(value: unknown): number {
  if (!value) return 0
  const v = value as { toMillis?: () => number; toDate?: () => Date; _seconds?: number; seconds?: number }
  if (typeof v.toMillis === 'function') return v.toMillis()
  if (typeof v.toDate === 'function') return v.toDate().getTime()
  const s = v._seconds ?? v.seconds
  return typeof s === 'number' ? s * 1000 : 0
}

// ---------------------------------------------------------------------------
// Raw row shapes (normalised for in-memory work)
// ---------------------------------------------------------------------------

export interface SessionRow {
  id: string
  distinctId: string
  userId: string | null
  startedAt: number
  lastActivityAt: number
  eventCount: number
  pageCount: number
  referrer: string | null
  landingUrl: string | null
  country: string | null
  device: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  utmContent: string | null
}

export interface EventRow {
  id: string
  event: string
  distinctId: string
  sessionId: string
  userId: string | null
  pageUrl: string | null
  referrer: string | null
  country: string | null
  device: string | null
  properties: Record<string, unknown>
  timestamp: number
}

function normSession(id: string, d: FirebaseFirestore.DocumentData): SessionRow {
  return {
    id,
    distinctId: d.distinctId ?? '',
    userId: d.userId ?? null,
    startedAt: tsToMillis(d.startedAt),
    lastActivityAt: tsToMillis(d.lastActivityAt),
    eventCount: d.eventCount ?? 0,
    pageCount: d.pageCount ?? 0,
    referrer: d.referrer ?? null,
    landingUrl: d.landingUrl ?? null,
    country: d.country ?? null,
    device: d.device ?? null,
    utmSource: d.utmSource ?? null,
    utmMedium: d.utmMedium ?? null,
    utmCampaign: d.utmCampaign ?? null,
    utmContent: d.utmContent ?? null,
  }
}

function normEvent(id: string, d: FirebaseFirestore.DocumentData): EventRow {
  return {
    id,
    event: d.event ?? '',
    distinctId: d.distinctId ?? '',
    sessionId: d.sessionId ?? '',
    userId: d.userId ?? null,
    pageUrl: d.pageUrl ?? null,
    referrer: d.referrer ?? null,
    country: d.country ?? null,
    device: d.device ?? null,
    properties: (d.properties ?? {}) as Record<string, unknown>,
    timestamp: tsToMillis(d.serverTime) || tsToMillis(d.timestamp),
  }
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

export async function fetchSessions(propertyId: string, range: DateRange): Promise<SessionRow[]> {
  const snap = await adminDb.collection(SESSIONS)
    .where('propertyId', '==', propertyId)
    .where('startedAt', '>=', Timestamp.fromDate(range.from))
    .where('startedAt', '<=', Timestamp.fromDate(range.to))
    .orderBy('startedAt', 'desc')
    .limit(MAX_SESSIONS)
    .get()
  return snap.docs.map(d => normSession(d.id, d.data()))
}

export async function fetchEvents(
  propertyId: string,
  range: DateRange,
  eventName?: string,
): Promise<EventRow[]> {
  let q = adminDb.collection(EVENTS)
    .where('propertyId', '==', propertyId) as FirebaseFirestore.Query
  if (eventName) q = q.where('event', '==', eventName)
  q = q.where('serverTime', '>=', Timestamp.fromDate(range.from))
    .where('serverTime', '<=', Timestamp.fromDate(range.to))
    .orderBy('serverTime', 'asc')
    .limit(MAX_EVENTS)
  const snap = await q.get()
  return snap.docs.map(d => normEvent(d.id, d.data()))
}

// ---------------------------------------------------------------------------
// Segment filtering (US-133 / US-143)
// ---------------------------------------------------------------------------

/**
 * Build the set of "returning" distinctIds: any distinctId whose FIRST session
 * (within the property's full history) started before this row's session.
 * To stay O(n) and avoid a second query, we mark new-vs-returning purely on the
 * sessions in-window: the earliest session per distinctId is "new", the rest
 * are "returning". This is the standard web-analytics approximation.
 */
export function classifyVisitors(sessions: SessionRow[]): Map<string, 'new' | 'returning'> {
  const firstSeen = new Map<string, number>()
  for (const s of sessions) {
    const prev = firstSeen.get(s.distinctId)
    if (prev === undefined || s.startedAt < prev) firstSeen.set(s.distinctId, s.startedAt)
  }
  const result = new Map<string, 'new' | 'returning'>()
  // count sessions per distinctId so a distinctId with >1 session is "returning"
  const counts = new Map<string, number>()
  for (const s of sessions) counts.set(s.distinctId, (counts.get(s.distinctId) ?? 0) + 1)
  for (const [did, c] of counts) result.set(did, c > 1 ? 'returning' : 'new')
  return result
}

/** Resolve a CRM dynamic segment to the set of userIds it contains. */
export async function resolveCrmSegmentUserIds(
  crmSegmentId: string,
  orgId: string,
): Promise<Set<string>> {
  const ids = new Set<string>()
  try {
    // Dynamic segments store resolved contact ids; contacts may carry an
    // analyticsDistinctId / userId. We map via the contacts collection.
    const segSnap = await adminDb.collection('crm_segments').doc(crmSegmentId).get()
    if (!segSnap.exists || segSnap.data()?.orgId !== orgId) return ids
    const membersSnap = await adminDb.collection('crm_contacts')
      .where('orgId', '==', orgId)
      .where('segmentIds', 'array-contains', crmSegmentId)
      .limit(5000)
      .get()
    for (const d of membersSnap.docs) {
      const data = d.data()
      const uid = data.analyticsUserId ?? data.userId ?? d.id
      if (uid) ids.add(String(uid))
    }
  } catch {
    // CRM segment resolution is best-effort; an empty set means "no match"
  }
  return ids
}

/**
 * Filter sessions by a segment. Returns the filtered list. visitorType is
 * resolved against the supplied classification map (computed from the unfiltered
 * window so "new/returning" is stable).
 */
export async function applySegmentToSessions(
  sessions: SessionRow[],
  segment: AnalyticsSegment | null,
  orgId: string,
): Promise<SessionRow[]> {
  if (!segment) return sessions
  let rows = sessions
  if (segment.device) rows = rows.filter(s => s.device === segment.device)
  if (segment.source) rows = rows.filter(s => (s.utmSource ?? '(direct)') === segment.source)
  if (segment.country) rows = rows.filter(s => s.country === segment.country)
  if (segment.visitorType && segment.visitorType !== 'all') {
    const classes = classifyVisitors(sessions)
    rows = rows.filter(s => classes.get(s.distinctId) === segment.visitorType)
  }
  if (segment.crmSegmentId) {
    const uids = await resolveCrmSegmentUserIds(segment.crmSegmentId, orgId)
    rows = rows.filter(s => s.userId && uids.has(String(s.userId)))
  }
  return rows
}

/** Parse a segment from URLSearchParams. */
export function parseSegment(searchParams: URLSearchParams): AnalyticsSegment | null {
  const visitorType = searchParams.get('visitorType') as AnalyticsSegment['visitorType'] | null
  const device = searchParams.get('device') as DeviceType | null
  const source = searchParams.get('source')
  const country = searchParams.get('country')
  const crmSegmentId = searchParams.get('crmSegmentId')
  if (!visitorType && !device && !source && !country && !crmSegmentId) return null
  return {
    visitorType: visitorType ?? 'all',
    device: device ?? null,
    source: source ?? null,
    country: country ?? null,
    crmSegmentId: crmSegmentId ?? null,
  }
}

// ---------------------------------------------------------------------------
// Common aggregations
// ---------------------------------------------------------------------------

export function sessionDurationSec(s: SessionRow): number {
  return Math.max(0, Math.round((s.lastActivityAt - s.startedAt) / 1000))
}

/** A "bounce" is a single-page (or single-event) session. */
export function isBounce(s: SessionRow): boolean {
  return s.eventCount <= 1 || s.pageCount <= 1
}

/** Group a list into counts by a key extractor, sorted desc. */
export function countBy<T>(items: T[], key: (t: T) => string | null): Array<{ label: string; count: number }> {
  const m = new Map<string, number>()
  for (const it of items) {
    const k = key(it) || '(none)'
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
}

/** Bucket timestamps into day labels (YYYY-MM-DD) across the range. */
export function dailyBuckets(range: DateRange): string[] {
  const out: string[] = []
  const d = new Date(range.from)
  d.setUTCHours(0, 0, 0, 0)
  const end = new Date(range.to)
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

export function dayLabel(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** Classify traffic source from utm/referrer into a channel bucket. */
export function channelOf(s: { utmSource: string | null; utmMedium: string | null; referrer: string | null }): string {
  if (s.utmMedium) {
    const m = s.utmMedium.toLowerCase()
    if (m.includes('cpc') || m.includes('paid') || m.includes('ppc')) return 'Paid'
    if (m.includes('email')) return 'Email'
    if (m.includes('social')) return 'Social'
    if (m.includes('organic')) return 'Organic Search'
    if (m.includes('referral')) return 'Referral'
  }
  if (s.utmSource) return s.utmSource
  if (!s.referrer) return 'Direct'
  try {
    const host = new URL(s.referrer).hostname.replace(/^www\./, '')
    if (/google|bing|duckduckgo|yahoo|ecosia/.test(host)) return 'Organic Search'
    if (/facebook|instagram|twitter|x\.com|linkedin|t\.co|tiktok|reddit|pinterest/.test(host)) return 'Social'
    return 'Referral'
  } catch {
    return 'Referral'
  }
}
