// lib/reports/snapshot.ts
//
// KPI snapshot service. Given an orgId + period, queries the metrics fact
// table and (optionally) PiB-internal collections (invoices) and returns
// a fully-computed `ReportKpis` + per-property breakdown + daily series.
//
// This is the ONLY place that turns metric rows into KPI numbers. Both the
// portal dashboard and the report generator consume it.

import { adminDb } from '@/lib/firebase/admin'
import { dailySeries, lastValue, sumZar, sumValue } from '@/lib/metrics/query'
import type {
  ReportKpis,
  ReportPeriod,
  ReportSeries,
} from './types'

interface InternalProperty {
  id: string
  name: string
  type: string
}

async function listProperties(orgId: string): Promise<InternalProperty[]> {
  const snap = await adminDb
    .collection('properties')
    .where('orgId', '==', orgId)
    .where('deleted', '==', false)
    .get()
  return snap.docs.map((d) => {
    const data = d.data() as { name: string; type: string }
    return { id: d.id, name: data.name, type: data.type }
  })
}

async function sumInvoicedRevenue(orgId: string, period: ReportPeriod, paidOnly: boolean) {
  const start = new Date(period.start + 'T00:00:00Z')
  const end = new Date(period.end + 'T23:59:59Z')
  const ref = adminDb.collection('invoices').where('orgId', '==', orgId)
  const snap = await ref.get()
  let total = 0
  for (const doc of snap.docs) {
    const data = doc.data() as { totalZar?: number; total?: number; status?: string; createdAt?: { toDate(): Date }; paidAt?: { toDate(): Date } }
    const refDate = paidOnly ? data.paidAt?.toDate?.() : data.createdAt?.toDate?.()
    if (!refDate) continue
    if (refDate < start || refDate > end) continue
    if (paidOnly && data.status !== 'paid') continue
    total += data.totalZar ?? data.total ?? 0
  }
  return total
}

async function sumOutstanding(orgId: string) {
  const snap = await adminDb
    .collection('invoices')
    .where('orgId', '==', orgId)
    .where('status', 'in', ['sent', 'overdue', 'viewed'])
    .get()
  let total = 0
  for (const doc of snap.docs) {
    const data = doc.data() as { totalZar?: number; total?: number }
    total += data.totalZar ?? data.total ?? 0
  }
  return total
}

interface SnapshotInput {
  orgId: string
  period: ReportPeriod
  previousPeriod: ReportPeriod
  propertyId?: string
}

interface SnapshotResult {
  kpis: ReportKpis
  perProperty: Array<{ propertyId: string; name: string; type: string; kpis: Partial<ReportKpis> }>
  series: ReportSeries[]
}

interface ProductAnalyticsKpis {
  sessions: number
  pageviews: number
  users: number
  conversions: number
}

function pct(curr: number, prev: number): number | null {
  if (prev === 0) return null
  return ((curr - prev) / prev) * 100
}

function isPageviewEvent(event: unknown): boolean {
  return event === '$pageview' || event === 'page_view' || event === 'pageview'
}

function isConversionEvent(data: Record<string, unknown>): boolean {
  if ((data.properties as { conversion?: unknown } | undefined)?.conversion === true) return true
  const event = typeof data.event === 'string' ? data.event.toLowerCase() : ''
  return [
    'conversion',
    'lead_submitted',
    'form_submitted',
    'signup',
    'signup_completed',
    'purchase',
    'checkout_completed',
  ].includes(event)
}

async function productAnalyticsForScope(
  orgId: string,
  period: ReportPeriod,
  propertyId?: string,
): Promise<ProductAnalyticsKpis> {
  const start = new Date(period.start + 'T00:00:00Z')
  const end = new Date(period.end + 'T23:59:59Z')

  let sessionsQuery: FirebaseFirestore.Query = adminDb
    .collection('product_sessions')
    .where('orgId', '==', orgId)
    .where('startedAt', '>=', start)
    .where('startedAt', '<=', end)

  let eventsQuery: FirebaseFirestore.Query = adminDb
    .collection('product_events')
    .where('orgId', '==', orgId)
    .where('serverTime', '>=', start)
    .where('serverTime', '<=', end)

  if (propertyId) {
    sessionsQuery = sessionsQuery.where('propertyId', '==', propertyId)
    eventsQuery = eventsQuery.where('propertyId', '==', propertyId)
  }

  const [sessionsSnap, eventsSnap] = await Promise.all([
    sessionsQuery.get().catch(() => ({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] })),
    eventsQuery.get().catch(() => ({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] })),
  ])

  const users = new Set<string>()
  let pageviews = 0
  let conversions = 0

  for (const doc of eventsSnap.docs) {
    const data = doc.data() as Record<string, unknown>
    if (typeof data.distinctId === 'string' && data.distinctId) users.add(data.distinctId)
    if (isPageviewEvent(data.event)) pageviews++
    if (isConversionEvent(data)) conversions++
  }

  for (const doc of sessionsSnap.docs) {
    const data = doc.data() as { distinctId?: unknown }
    if (typeof data.distinctId === 'string' && data.distinctId) users.add(data.distinctId)
  }

  return {
    sessions: sessionsSnap.docs.length,
    pageviews,
    users: users.size,
    conversions,
  }
}

async function snapshotForScope(orgId: string, period: ReportPeriod, propertyId?: string): Promise<Partial<ReportKpis>> {
  const base = { orgId, propertyId, from: period.start, to: period.end }

  // Money flows (sums)
  const [adRev, iapRev, subRev, adSpend] = await Promise.all([
    sumZar({ ...base, metric: 'ad_revenue' }),
    sumZar({ ...base, metric: 'iap_revenue' }),
    sumZar({ ...base, metric: 'subscription_revenue' }),
    sumZar({ ...base, metric: 'ad_spend' }),
  ])

  // Counts (sums)
  const [
    impressions, clicks, installs, uninstalls,
    sessions, pageviews, users, conversions,
    newSubs, trialsStarted, trialsConverted, churn,
  ] = await Promise.all([
    sumValue({ ...base, metric: 'impressions' }),
    sumValue({ ...base, metric: 'clicks' }),
    sumValue({ ...base, metric: 'installs' }),
    sumValue({ ...base, metric: 'uninstalls' }),
    sumValue({ ...base, metric: 'sessions' }),
    sumValue({ ...base, metric: 'pageviews' }),
    sumValue({ ...base, metric: 'users' }),
    sumValue({ ...base, metric: 'conversions' }),
    sumValue({ ...base, metric: 'new_subs' }),
    sumValue({ ...base, metric: 'trials_started' }),
    sumValue({ ...base, metric: 'trials_converted' }),
    sumValue({ ...base, metric: 'churn' }),
  ])

  // Stock metrics (last value in period)
  const [mrr, arr, activeSubs, roas] = await Promise.all([
    lastValue({ ...base, metric: 'mrr' }),
    lastValue({ ...base, metric: 'arr' }),
    lastValue({ ...base, metric: 'active_subs' }),
    lastValue({ ...base, metric: 'roas' }),
  ])

  const firstPartyAnalytics = await productAnalyticsForScope(orgId, period, propertyId)

  return {
    mrr: mrr ?? 0,
    arr: arr ?? 0,
    active_subs: activeSubs ?? 0,
    new_subs: newSubs,
    trials_started: trialsStarted,
    trials_converted: trialsConverted,
    churn,
    subscription_revenue: subRev,
    ad_revenue: adRev,
    iap_revenue: iapRev,
    impressions,
    clicks,
    installs,
    uninstalls,
    sessions: sessions || firstPartyAnalytics.sessions,
    pageviews: pageviews || firstPartyAnalytics.pageviews,
    users: users || firstPartyAnalytics.users,
    conversions: conversions || firstPartyAnalytics.conversions,
    ad_spend: adSpend,
    roas,
  }
}

export async function snapshotKpis(input: SnapshotInput): Promise<SnapshotResult> {
  const { orgId, period, previousPeriod, propertyId } = input

  const [
    invoicedAll,
    invoicedPaid,
    outstanding,
    scopeKpis,
    prevScopeKpis,
    properties,
  ] = await Promise.all([
    sumInvoicedRevenue(orgId, period, false),
    sumInvoicedRevenue(orgId, period, true),
    sumOutstanding(orgId),
    snapshotForScope(orgId, period, propertyId),
    snapshotForScope(orgId, previousPeriod, propertyId),
    propertyId ? Promise.resolve([]) : listProperties(orgId),
  ])

  const total =
    (scopeKpis.subscription_revenue ?? 0) +
    (scopeKpis.ad_revenue ?? 0) +
    (scopeKpis.iap_revenue ?? 0) +
    invoicedPaid
  const prevTotal =
    (prevScopeKpis.subscription_revenue ?? 0) +
    (prevScopeKpis.ad_revenue ?? 0) +
    (prevScopeKpis.iap_revenue ?? 0)

  const kpis: ReportKpis = {
    invoiced_revenue: invoicedAll,
    invoiced_revenue_paid: invoicedPaid,
    outstanding,

    mrr: scopeKpis.mrr ?? 0,
    arr: scopeKpis.arr ?? 0,
    active_subs: scopeKpis.active_subs ?? 0,
    new_subs: scopeKpis.new_subs ?? 0,
    trials_started: scopeKpis.trials_started ?? 0,
    trials_converted: scopeKpis.trials_converted ?? 0,
    churn: scopeKpis.churn ?? 0,
    subscription_revenue: scopeKpis.subscription_revenue ?? 0,

    ad_revenue: scopeKpis.ad_revenue ?? 0,
    impressions: scopeKpis.impressions ?? 0,
    clicks: scopeKpis.clicks ?? 0,

    installs: scopeKpis.installs ?? 0,
    uninstalls: scopeKpis.uninstalls ?? 0,
    iap_revenue: scopeKpis.iap_revenue ?? 0,

    sessions: scopeKpis.sessions ?? 0,
    pageviews: scopeKpis.pageviews ?? 0,
    users: scopeKpis.users ?? 0,
    conversions: scopeKpis.conversions ?? 0,

    ad_spend: scopeKpis.ad_spend ?? 0,
    roas: scopeKpis.roas ?? null,

    total_revenue: total,

    deltas: {
      total_revenue: pct(total, prevTotal),
      mrr: pct(scopeKpis.mrr ?? 0, prevScopeKpis.mrr ?? 0),
      active_subs: pct(scopeKpis.active_subs ?? 0, prevScopeKpis.active_subs ?? 0),
      sessions: pct(scopeKpis.sessions ?? 0, prevScopeKpis.sessions ?? 0),
      ad_revenue: pct(scopeKpis.ad_revenue ?? 0, prevScopeKpis.ad_revenue ?? 0),
      iap_revenue: pct(scopeKpis.iap_revenue ?? 0, prevScopeKpis.iap_revenue ?? 0),
      installs: pct(scopeKpis.installs ?? 0, prevScopeKpis.installs ?? 0),
    },
  }

  // Per-property breakdown (org-wide reports only).
  const perProperty: SnapshotResult['perProperty'] = []
  if (!propertyId) {
    for (const prop of properties) {
      const pk = await snapshotForScope(orgId, period, prop.id)
      perProperty.push({ propertyId: prop.id, name: prop.name, type: prop.type, kpis: pk })
    }
  }

  // Daily series for the headline metrics — used for sparklines.
  const series: ReportSeries[] = []
  const headline: Array<keyof ReportKpis> = ['ad_revenue', 'iap_revenue', 'subscription_revenue', 'sessions', 'installs']
  for (const k of headline) {
    const points = await dailySeries({
      orgId,
      propertyId,
      from: period.start,
      to: period.end,
      metric: k as never, // we know these are real MetricKind values
    } as never)
    if (points.length > 0) {
      series.push({
        metric: String(k),
        series: points.map((p) => ({ date: p.date, value: p.valueZar ?? p.value })),
      })
    }
  }

  return { kpis, perProperty, series }
}

/** Convenience helper — given a "monthly" period, compute the prior month. */
export function priorPeriod(period: ReportPeriod): ReportPeriod {
  const start = new Date(period.start + 'T00:00:00Z')
  const end = new Date(period.end + 'T23:59:59Z')
  const days = Math.round((end.getTime() - start.getTime()) / (24 * 3600 * 1000)) + 1
  const prevEnd = new Date(start)
  prevEnd.setUTCDate(prevEnd.getUTCDate() - 1)
  const prevStart = new Date(prevEnd)
  prevStart.setUTCDate(prevStart.getUTCDate() - days + 1)
  return {
    start: prevStart.toISOString().slice(0, 10),
    end: prevEnd.toISOString().slice(0, 10),
    tz: period.tz,
  }
}

/** Convenience helper — given a "monthly" YYYY-MM, expand to {start, end}. */
export function monthPeriod(yyyyMm: string, tz: string): ReportPeriod {
  const [y, m] = yyyyMm.split('-').map((s) => parseInt(s, 10))
  const start = `${yyyyMm}-01`
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const end = `${yyyyMm}-${String(lastDay).padStart(2, '0')}`
  return { start, end, tz }
}

/** Convenience helper — last completed month, in a given tz. */
export function lastCompletedMonth(tz: string, today = new Date()): ReportPeriod {
  const y = today.getUTCFullYear()
  const m = today.getUTCMonth() + 1 // 1..12
  const lastMonth = m === 1 ? 12 : m - 1
  const lastYear = m === 1 ? y - 1 : y
  return monthPeriod(`${lastYear}-${String(lastMonth).padStart(2, '0')}`, tz)
}
