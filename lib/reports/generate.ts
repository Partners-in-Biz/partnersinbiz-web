// lib/reports/generate.ts
//
// Orchestrates report generation: snapshot → AI summary → persist → return.

import crypto from 'crypto'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { snapshotKpis, priorPeriod } from './snapshot'
import { generateSummary } from './summary'
import {
  REPORTS_COLLECTION,
  type Report,
  type ReportPeriod,
  type ReportType,
} from './types'

interface GenerateInput {
  orgId: string
  type: ReportType
  period: ReportPeriod
  generatedBy: 'cron' | 'admin' | 'agent'
  createdBy: string
  /** Optional scope to a single property. */
  propertyId?: string
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

export async function generateReport(input: GenerateInput): Promise<Report> {
  const previousPeriod = priorPeriod(input.period)
  const [snapshot, brand] = await Promise.all([
    snapshotKpis({
      orgId: input.orgId,
      period: input.period,
      previousPeriod,
      propertyId: input.propertyId,
    }),
    loadOrgBranding(input.orgId),
  ])

  const summary = await generateSummary({
    brandName: brand.orgName,
    period: input.period,
    previousPeriod,
    kpis: snapshot.kpis,
  })

  const scopeKey = input.propertyId ? `_${input.propertyId}` : ''
  const id = `${input.orgId}${scopeKey}_${input.period.start}_${input.period.end}_${input.type}`
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 1500)
  const publicToken = crypto.randomBytes(24).toString('base64url')

  const report: Omit<Report, 'createdAt' | 'updatedAt'> & { createdAt: unknown; updatedAt: unknown } = {
    id,
    orgId: input.orgId,
    ...(input.propertyId ? { propertyId: input.propertyId } : {}),
    type: input.type,
    period: input.period,
    previousPeriod,
    status: 'rendered',
    kpis: snapshot.kpis,
    properties: snapshot.perProperty,
    series: snapshot.series,
    exec_summary: summary.exec_summary,
    highlights: summary.highlights,
    publicToken,
    sentTo: [],
    sentAt: null,
    viewedAt: null,
    brand,
    generatedBy: input.generatedBy,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: input.createdBy,
    updatedAt: FieldValue.serverTimestamp(),
  }

  await adminDb.collection(REPORTS_COLLECTION).doc(id).set(report)
  return report as unknown as Report
}

export async function getReport(id: string): Promise<Report | null> {
  const doc = await adminDb.collection(REPORTS_COLLECTION).doc(id).get()
  if (!doc.exists) return null
  return { ...(doc.data() as Report), id: doc.id }
}

export async function getReportByPublicToken(token: string): Promise<Report | null> {
  const snap = await adminDb
    .collection(REPORTS_COLLECTION)
    .where('publicToken', '==', token)
    .limit(1)
    .get()
  if (snap.empty) return null
  const doc = snap.docs[0]
  return { ...(doc.data() as Report), id: doc.id }
}

export async function markReportViewed(id: string): Promise<void> {
  await adminDb.collection(REPORTS_COLLECTION).doc(id).update({
    viewedAt: FieldValue.serverTimestamp(),
  })
}

export async function patchReport(
  id: string,
  patch: Partial<Pick<Report, 'exec_summary' | 'highlights' | 'status'>>,
): Promise<void> {
  await adminDb.collection(REPORTS_COLLECTION).doc(id).update({
    ...patch,
    updatedAt: FieldValue.serverTimestamp(),
  })
}

export async function listReports(orgId: string, limit = 24): Promise<Report[]> {
  const snap = await adminDb
    .collection(REPORTS_COLLECTION)
    .where('orgId', '==', orgId)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get()
  return snap.docs.map((d) => ({ ...(d.data() as Report), id: d.id }))
}
