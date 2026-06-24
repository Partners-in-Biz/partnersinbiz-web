// app/api/v1/admin/analytics/scrolledbrain/data.ts
//
// Data loader for the Scrolledbrain analytics admin view (US-313).
// Adds period-compare, an ingestion error log, and env-sync status on top of
// the existing read-only top-pages view.

import type { ApiUser } from '@/lib/api/types'
import { restrictedAdminOrgIds, canAccessOrg } from '@/lib/api/platformAdmin'
import { adminDb } from '@/lib/firebase/admin'

const EVENT_SCAN_LIMIT = 1500
const DEADLETTER_LIMIT = 60

export type Period = '7d' | '30d' | '90d'

const PERIOD_DAYS: Record<Period, number> = { '7d': 7, '30d': 30, '90d': 90 }

export function normalisePeriod(value: string | null | undefined): Period {
  return value === '7d' || value === '30d' || value === '90d' ? value : '30d'
}

function toMs(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  if (typeof value === 'object') {
    const v = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof v.toMillis === 'function') return v.toMillis()
    if (typeof v.toDate === 'function') return v.toDate().getTime()
    if (typeof v.seconds === 'number') return v.seconds * 1000
    if (typeof v._seconds === 'number') return v._seconds * 1000
  }
  return null
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function isoToDate(ms: number | null): string {
  if (ms == null) return ''
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16)
}

export interface ScrolledbrainPeriodStats {
  events: number
  sessions: number
  topPages: Array<{ page: string; views: number }>
}

export interface ScrolledbrainErrorRow {
  id: string
  event: string
  reason: string
  error: string
  failedAt: string
  retriedAt: string
}

export interface ScrolledbrainResult {
  found: boolean
  property: {
    id: string
    name: string
    domain: string
    orgId: string
    status: string
    ingestKeyPresent: boolean
    ingestKeyRotatedAt: string
  } | null
  period: Period
  current: ScrolledbrainPeriodStats
  previous: ScrolledbrainPeriodStats
  comparison: {
    eventsDeltaPct: number | null
    sessionsDeltaPct: number | null
    currentWindow: { fromIso: string; toIso: string }
    previousWindow: { fromIso: string; toIso: string }
  }
  errors: ScrolledbrainErrorRow[]
  envSync: {
    propertyId: string
    domain: string
    ingestEndpoint: string
    sdkSnippet: string
    vercelAnalyticsEnvPresent: boolean
    checks: Array<{ key: string; label: string; ok: boolean; detail: string }>
  } | null
  scope: 'all' | 'restricted'
}

function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null // null = "new" (no baseline)
  return Math.round(((current - previous) / previous) * 1000) / 10
}

async function findScrolledbrainProperty(
  user: ApiUser,
): Promise<{ id: string; data: Record<string, unknown> } | null> {
  const restricted = restrictedAdminOrgIds(user)
  let docs: Array<{ id: string; data: Record<string, unknown> }> = []
  if (restricted.length > 0) {
    const perOrg = await Promise.all(
      restricted.map((orgId) =>
        adminDb.collection('properties').where('orgId', '==', orgId).limit(80).get().catch(() => null),
      ),
    )
    docs = perOrg.flatMap((snap) =>
      (snap?.docs ?? []).map((d) => ({ id: d.id, data: (d.data() ?? {}) as Record<string, unknown> })),
    )
  } else {
    const snap = await adminDb.collection('properties').limit(200).get().catch(() => null)
    docs = (snap?.docs ?? []).map((d) => ({ id: d.id, data: (d.data() ?? {}) as Record<string, unknown> }))
  }
  return docs.find((d) => str(d.data.domain).includes('scrolledbrain')) ?? null
}

function summarise(
  events: Array<{ pageUrl: string; sessionId: string; ms: number | null }>,
  fromMs: number,
  toMs: number,
): ScrolledbrainPeriodStats {
  const inWindow = events.filter((e) => e.ms != null && e.ms >= fromMs && e.ms < toMs)
  const sessions = new Set(inWindow.map((e) => e.sessionId).filter(Boolean))
  const pageCounts = new Map<string, number>()
  for (const e of inWindow) {
    const page = e.pageUrl || '/'
    pageCounts.set(page, (pageCounts.get(page) ?? 0) + 1)
  }
  const topPages = Array.from(pageCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([page, views]) => ({ page, views }))
  return { events: inWindow.length, sessions: sessions.size, topPages }
}

export async function loadScrolledbrain(user: ApiUser, period: Period): Promise<ScrolledbrainResult> {
  const scope = restrictedAdminOrgIds(user).length > 0 ? 'restricted' : 'all'
  const property = await findScrolledbrainProperty(user)

  const base: ScrolledbrainResult = {
    found: false,
    property: null,
    period,
    current: { events: 0, sessions: 0, topPages: [] },
    previous: { events: 0, sessions: 0, topPages: [] },
    comparison: {
      eventsDeltaPct: null,
      sessionsDeltaPct: null,
      currentWindow: { fromIso: '', toIso: '' },
      previousWindow: { fromIso: '', toIso: '' },
    },
    errors: [],
    envSync: null,
    scope,
  }

  if (!property) return base

  const propertyId = property.id
  const domain = str(property.data.domain)

  // Pull events for this property and the dead-letter (error) records.
  const [eventsSnap, deadSnap] = await Promise.all([
    adminDb
      .collection('product_events')
      .where('propertyId', '==', propertyId)
      .limit(EVENT_SCAN_LIMIT)
      .get()
      .catch(() => null),
    adminDb
      .collection('product_events_deadletter')
      .where('propertyId', '==', propertyId)
      .limit(DEADLETTER_LIMIT)
      .get()
      .catch(() => null),
  ])

  const events = (eventsSnap?.docs ?? []).map((d) => {
    const data = d.data() ?? {}
    const props = (data.properties as Record<string, unknown> | undefined) ?? {}
    return {
      pageUrl: str(data.pageUrl, str(props.path, '/')),
      sessionId: str(data.sessionId),
      ms: toMs(data.serverTime) ?? toMs(data.timestamp),
    }
  })

  const now = Date.now()
  const periodMs = PERIOD_DAYS[period] * 24 * 60 * 60 * 1000
  const currentFrom = now - periodMs
  const previousFrom = now - periodMs * 2

  const current = summarise(events, currentFrom, now)
  const previous = summarise(events, previousFrom, currentFrom)

  const errors: ScrolledbrainErrorRow[] = (deadSnap?.docs ?? []).map((d) => {
    const data = d.data() ?? {}
    return {
      id: d.id,
      event: str(data.event, 'unknown'),
      reason: str(data.reason),
      error: str(data.error),
      failedAt: isoToDate(toMs(data.failedAt)),
      retriedAt: isoToDate(toMs(data.retriedAt)),
    }
  })

  const ingestKeyPresent = typeof property.data.ingestKey === 'string' && property.data.ingestKey.length > 0
  const ingestKeyRotatedAt = isoToDate(toMs(property.data.ingestKeyRotatedAt))

  const vercelAnalyticsEnvPresent = Boolean(
    process.env.NEXT_PUBLIC_PIB_ANALYTICS_PROPERTY_ID || process.env.PIB_ANALYTICS_PROPERTY_ID,
  )

  return {
    found: true,
    property: {
      id: propertyId,
      name: str(property.data.name, propertyId),
      domain,
      orgId: str(property.data.orgId),
      status: str(property.data.status, 'draft'),
      ingestKeyPresent,
      ingestKeyRotatedAt,
    },
    period,
    current,
    previous,
    comparison: {
      eventsDeltaPct: pctDelta(current.events, previous.events),
      sessionsDeltaPct: pctDelta(current.sessions, previous.sessions),
      currentWindow: { fromIso: isoToDate(currentFrom), toIso: isoToDate(now) },
      previousWindow: { fromIso: isoToDate(previousFrom), toIso: isoToDate(currentFrom) },
    },
    errors,
    envSync: {
      propertyId,
      domain,
      ingestEndpoint: 'https://partnersinbiz.online/api/v1/analytics/ingest',
      sdkSnippet: `import { init } from '@partnersinbiz/analytics-js'\ninit({ propertyId: '${propertyId}', ingestKey: '<INGEST_KEY>' })`,
      vercelAnalyticsEnvPresent,
      checks: [
        {
          key: 'ingest-key',
          label: 'Ingest key configured',
          ok: ingestKeyPresent,
          detail: ingestKeyPresent ? `Last rotated ${ingestKeyRotatedAt || 'unknown'}` : 'No ingest key set on this property.',
        },
        {
          key: 'domain',
          label: 'Domain set',
          ok: Boolean(domain),
          detail: domain || 'No domain configured.',
        },
        {
          key: 'status',
          label: 'Property live',
          ok: str(property.data.status) === 'live' || str(property.data.status) === 'active',
          detail: `status=${str(property.data.status, 'draft')}`,
        },
        {
          key: 'env',
          label: 'Platform analytics env present',
          ok: vercelAnalyticsEnvPresent,
          detail: vercelAnalyticsEnvPresent
            ? 'PIB analytics property env var detected.'
            : 'Set NEXT_PUBLIC_PIB_ANALYTICS_PROPERTY_ID in Vercel.',
        },
      ],
    },
    scope,
  }
}

export async function rotateScrolledbrainIngestKey(
  user: ApiUser,
  propertyId: string,
): Promise<{ ok: true; ingestKey: string } | { ok: false; reason: 'not_found' | 'forbidden' }> {
  const ref = adminDb.collection('properties').doc(propertyId)
  const snap = await ref.get().catch(() => null)
  if (!snap || !snap.exists || snap.data()?.deleted) return { ok: false, reason: 'not_found' }
  if (!canAccessOrg(user, snap.data()?.orgId)) return { ok: false, reason: 'forbidden' }

  const { generateIngestKey } = await import('@/lib/properties/ingest-key')
  const { FieldValue } = await import('firebase-admin/firestore')
  const ingestKey = generateIngestKey()
  await ref.update({ ingestKey, ingestKeyRotatedAt: FieldValue.serverTimestamp() })
  return { ok: true, ingestKey }
}
