import { adminDb } from '@/lib/firebase/admin'
import type { GeoSeoWorkspaceRecord } from '@/components/geo-seo/GeoSeoWorkspace'

type FirestoreTimestampLike = { toDate?: () => Date; toMillis?: () => number }

function timestampToIso(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    const timestamp = value as FirestoreTimestampLike
    if (typeof timestamp.toDate === 'function') return timestamp.toDate().toISOString()
    if (typeof timestamp.toMillis === 'function') return new Date(timestamp.toMillis()).toISOString()
  }
  return null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function mapGeoSeoWorkspace(id: string, data: Record<string, unknown>): GeoSeoWorkspaceRecord {
  return {
    id,
    siteName: stringValue(data.siteName),
    siteUrl: stringValue(data.siteUrl),
    status: stringValue(data.status),
    mode: stringValue(data.mode),
    currentGeoScore: numberValue(data.currentGeoScore),
    previousGeoScore: numberValue(data.previousGeoScore),
    lastAuditAt: timestampToIso(data.lastAuditAt),
    nextAuditAt: timestampToIso(data.nextAuditAt),
    linkedSeoSprintId: stringValue(data.linkedSeoSprintId),
    auditState: stringValue(data.auditState) || stringValue(data.latestAuditStatus),
    reportState: stringValue(data.reportState) || stringValue(data.latestReportStatus),
  }
}

export async function loadGeoSeoWorkspaces(orgId?: string | null): Promise<GeoSeoWorkspaceRecord[]> {
  let query: FirebaseFirestore.Query = adminDb.collection('geo_workspaces')
  if (orgId) query = query.where('orgId', '==', orgId)
  const snap = await query.get()
  return snap.docs
    .map((doc) => mapGeoSeoWorkspace(doc.id, doc.data()))
    .sort((a, b) => (b.lastAuditAt || '').localeCompare(a.lastAuditAt || ''))
}
