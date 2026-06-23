// lib/reports/custom.ts
//
// Custom report builder (US-176). Takes a CustomReportSpec (sections + data
// sources) and produces a persisted Report. Snapshot-backed sections pull live
// KPIs from the metrics fact table via snapshotKpis(); manual sections use
// author-supplied values. The rendered Report carries the full spec in
// `report.custom` so ReportView can lay the sections out.

import crypto from 'crypto'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { snapshotKpis, priorPeriod } from './snapshot'
import {
  REPORTS_COLLECTION,
  type Report,
  type ReportKpis,
  type CustomReportSpec,
  type ReportMetricKey,
} from './types'

interface BuildInput {
  orgId: string
  spec: CustomReportSpec
  generatedBy: 'cron' | 'admin' | 'agent'
  createdBy: string
}

async function loadOrgBranding(orgId: string): Promise<Report['brand']> {
  const doc = await adminDb.collection('organizations').doc(orgId).get()
  const data = (doc.data() ?? {}) as {
    name?: string
    logoUrl?: string
    brandProfile?: { logoUrl?: string; primaryColor?: string }
  }
  return {
    orgName: data.name ?? 'Client',
    orgLogoUrl: data.brandProfile?.logoUrl ?? data.logoUrl ?? null,
    accent: data.brandProfile?.primaryColor ?? '#F5A623',
    bg: '#0A0A0B',
    text: '#EDEDED',
  }
}

/** Does any section need live snapshot data? */
function needsSnapshot(spec: CustomReportSpec): boolean {
  return spec.sections.some((s) => s.dataSource?.kind === 'snapshot')
}

export function emptyKpis(): ReportKpis {
  return {
    invoiced_revenue: 0,
    invoiced_revenue_paid: 0,
    outstanding: 0,
    mrr: 0,
    arr: 0,
    active_subs: 0,
    new_subs: 0,
    trials_started: 0,
    trials_converted: 0,
    churn: 0,
    subscription_revenue: 0,
    ad_revenue: 0,
    impressions: 0,
    clicks: 0,
    installs: 0,
    uninstalls: 0,
    iap_revenue: 0,
    sessions: 0,
    pageviews: 0,
    users: 0,
    conversions: 0,
    ad_spend: 0,
    roas: null,
    total_revenue: 0,
    deltas: {
      total_revenue: null,
      mrr: null,
      active_subs: null,
      sessions: null,
      ad_revenue: null,
      iap_revenue: null,
      installs: null,
    },
  }
}

export function metricValue(kpis: ReportKpis, key: ReportMetricKey): number {
  const v = (kpis as unknown as Record<string, unknown>)[key]
  return typeof v === 'number' ? v : 0
}

/**
 * Build a preview payload (KPIs + series) for the live preview without
 * persisting. Returns empty data when no snapshot sources are present.
 */
export async function previewCustomReport(input: {
  orgId: string
  spec: CustomReportSpec
}): Promise<{ kpis: ReportKpis; series: Report['series'] }> {
  if (!needsSnapshot(input.spec)) {
    return { kpis: emptyKpis(), series: [] }
  }
  const previousPeriod = priorPeriod(input.spec.period)
  const snapshot = await snapshotKpis({
    orgId: input.orgId,
    period: input.spec.period,
    previousPeriod,
    propertyId: input.spec.propertyId,
  })
  return { kpis: snapshot.kpis, series: snapshot.series }
}

export async function buildCustomReport(input: BuildInput): Promise<Report> {
  const { orgId, spec } = input
  const previousPeriod = priorPeriod(spec.period)

  const [snapshot, brand] = await Promise.all([
    needsSnapshot(spec)
      ? snapshotKpis({ orgId, period: spec.period, previousPeriod, propertyId: spec.propertyId })
      : Promise.resolve(null),
    loadOrgBranding(orgId),
  ])

  const kpis = snapshot?.kpis ?? emptyKpis()
  const series = snapshot?.series ?? []
  const properties = snapshot?.perProperty ?? []

  const id = `${orgId}_custom_${spec.period.start}_${spec.period.end}_${crypto
    .randomBytes(4)
    .toString('hex')}`
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 1500)
  const publicToken = crypto.randomBytes(24).toString('base64url')

  const report: Report = {
    id,
    orgId,
    ...(spec.propertyId ? { propertyId: spec.propertyId } : {}),
    type: 'ad_hoc',
    category: spec.category ?? 'custom',
    custom: spec,
    period: spec.period,
    previousPeriod,
    status: 'rendered',
    kpis,
    properties,
    series,
    // Exec summary / highlights aren't AI-generated for custom reports; the
    // sections carry the narrative. Keep them empty so ReportView skips them.
    exec_summary: '',
    highlights: [],
    publicToken,
    share: { enabled: true, expiresAt: null },
    sentTo: [],
    sentAt: null,
    viewedAt: null,
    openCount: 0,
    uniqueOpenCount: 0,
    lastOpenedAt: null,
    brand,
    generatedBy: input.generatedBy,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: input.createdBy,
    updatedAt: FieldValue.serverTimestamp(),
  } as unknown as Report

  await adminDb.collection(REPORTS_COLLECTION).doc(id).set(report)
  return report
}
