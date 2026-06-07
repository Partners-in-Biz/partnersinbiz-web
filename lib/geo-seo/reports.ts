import { FieldValue } from 'firebase-admin/firestore'

import type { ApiUser } from '@/lib/api/types'
import type { ClientDocumentLinkSet, DocumentAssumption, DocumentBlock } from '@/lib/client-documents/types'
import { adminDb } from '@/lib/firebase/admin'

export const GEO_AUDITS_COLLECTION = 'geo_audits'
export const GEO_REPORTS_COLLECTION = 'geo_reports'
export const GEO_WORKSPACES_COLLECTION = 'geo_workspaces'
export const CLIENT_DOCUMENTS_COLLECTION = 'client_documents'

type GeoFindingInput = {
  id?: string
  severity?: string
  category?: string
  title?: string
  summary?: string
  recommendation?: string
  evidenceRowIds?: string[]
}

type GeoAuditRecord = {
  id?: string
  orgId?: string
  workspaceId?: string
  siteName?: string
  siteUrl?: string
  projectId?: string
  clientOrgId?: string
  recipientOrgId?: string
  companyId?: string
  sourceCompanyId?: string
  compositeScore?: number
  categoryScores?: Record<string, number>
  findings?: GeoFindingInput[]
  findingIds?: string[]
  evidenceIds?: string[]
  evidenceRowIds?: string[]
  assumptions?: Array<Partial<DocumentAssumption> & { text?: string }>
  sourceDocumentId?: string
  sourceSpecVersion?: string
  approvalGateTaskId?: string
  deleted?: boolean
}

export type GeoReportCreateInput = {
  auditId: string
  orgId: string
  sourceDocumentId?: string
  sourceSpecVersion?: string
  sourceDocumentSectionId?: string
  approvalGateTaskId?: string
  reportType?: 'internal_audit' | 'client_report' | 'monthly_delta' | 'proposal' | 'pdf_export'
  title?: string
  assumptions?: Array<{ text: string; severity?: DocumentAssumption['severity']; blockId?: string }>
  user: ApiUser
}

function actorType(user: ApiUser) {
  return user.role === 'ai' ? 'agent' : 'user'
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map((value) => value.trim())))
}

function normalizeAssumptions(
  assumptions: GeoReportCreateInput['assumptions'] | GeoAuditRecord['assumptions'],
  user: ApiUser,
): DocumentAssumption[] {
  const createdAt = new Date().toISOString()
  const normalized: DocumentAssumption[] = []
  ;(assumptions ?? []).forEach((assumption, index) => {
    const text = cleanString(assumption?.text)
    if (!text) return
    const severity = assumption?.severity
    normalized.push({
      id: cleanString((assumption as { id?: string }).id) ?? `geo-assumption-${index + 1}`,
      text,
      severity: severity === 'info' || severity === 'blocks_publish' || severity === 'needs_review' ? severity : 'needs_review',
      status: (assumption as DocumentAssumption).status === 'resolved' ? 'resolved' : 'open',
      ...(cleanString(assumption?.blockId) ? { blockId: cleanString(assumption?.blockId) } : {}),
      createdBy: cleanString((assumption as DocumentAssumption).createdBy) ?? user.uid,
      createdAt: (assumption as DocumentAssumption).createdAt ?? createdAt,
    })
  })
  return normalized
}

function reportBlocks(input: { audit: GeoAuditRecord; reportId: string; assumptions: DocumentAssumption[]; evidenceRowIds: string[] }): DocumentBlock[] {
  const { audit, reportId, assumptions, evidenceRowIds } = input
  const findings = Array.isArray(audit.findings) ? audit.findings : []
  const score = typeof audit.compositeScore === 'number' ? String(audit.compositeScore) : 'Not scored'

  return [
    {
      id: 'geo-report-hero',
      type: 'hero',
      title: 'GEO SEO Report',
      content: `${audit.siteName ?? audit.siteUrl ?? 'GEO workspace'} — internal draft report`,
      required: true,
      visibility: 'client-visible',
      display: { motion: 'reveal' },
    },
    {
      id: 'geo-report-summary',
      type: 'summary',
      title: 'Internal draft summary',
      content: `This report was generated as an internal draft from GEO audit ${audit.id ?? 'unknown'} for workspace ${audit.workspaceId ?? 'unknown'}. It is not client-visible until explicit approval is recorded.`,
      required: true,
      visibility: 'client-visible',
      display: { motion: 'reveal' },
    },
    {
      id: 'geo-score',
      type: 'metrics',
      title: 'GEO score snapshot',
      content: {
        items: [
          { label: 'Composite GEO score', value: score, target: '100', description: 'AI-search visibility readiness score' },
          ...Object.entries(audit.categoryScores ?? {}).map(([label, value]) => ({
            label,
            value: String(value),
            target: '100',
            description: 'Category readiness',
          })),
        ],
      },
      required: true,
      visibility: 'client-visible',
      display: { motion: 'counter' },
    },
    {
      id: 'geo-findings',
      type: 'table',
      title: 'Findings and recommendations',
      content: {
        headers: ['Severity', 'Category', 'Finding', 'Recommendation', 'Evidence'],
        rows: findings.map((finding) => [
          finding.severity ?? 'info',
          finding.category ?? 'general',
          finding.title ?? finding.summary ?? 'Untitled finding',
          finding.recommendation ?? 'Recommendation to be confirmed',
          (finding.evidenceRowIds ?? []).join(', ') || '—',
        ]),
      },
      required: true,
      visibility: 'client-visible',
      display: { motion: 'reveal' },
    },
    {
      id: 'geo-assumptions',
      type: 'risk',
      title: 'Assumptions and publish gates',
      content: [
        ...assumptions.map((assumption) => `${assumption.severity}: ${assumption.text}`),
        'Publishing, public sharing, edit-share enablement, client portal visibility, or client/prospect messaging requires explicit approval evidence.',
      ],
      required: true,
      visibility: 'client-visible',
      display: { motion: 'reveal' },
    },
    {
      id: 'geo-evidence',
      type: 'rich_text',
      title: 'Evidence ledger',
      content: [`GEO report id: ${reportId}`, `Audit id: ${audit.id ?? 'unknown'}`, `Workspace id: ${audit.workspaceId ?? 'unknown'}`, `Evidence rows: ${evidenceRowIds.join(', ') || 'none recorded'}`].join('\n'),
      required: true,
      visibility: 'internal-only',
      display: { motion: 'none' },
    },
  ]
}

export async function createGeoAuditReportDraft(input: GeoReportCreateInput) {
  const auditRef = adminDb.collection(GEO_AUDITS_COLLECTION).doc(input.auditId)
  const auditSnap = await auditRef.get()
  if (!auditSnap.exists || auditSnap.data()?.deleted === true) {
    return { ok: false as const, status: 404, error: 'GEO audit not found' }
  }

  const audit = { id: auditSnap.id, ...auditSnap.data() } as GeoAuditRecord
  if (audit.orgId !== input.orgId) {
    return { ok: false as const, status: 404, error: 'GEO audit not found' }
  }

  const documentRef = adminDb.collection(CLIENT_DOCUMENTS_COLLECTION).doc()
  const versionRef = documentRef.collection('versions').doc()
  const reportRef = adminDb.collection(GEO_REPORTS_COLLECTION).doc()
  const now = FieldValue.serverTimestamp()
  const userActorType = actorType(input.user)
  const evidenceRowIds = uniqueStrings([...(audit.evidenceRowIds ?? []), ...(audit.findings ?? []).flatMap((finding) => finding.evidenceRowIds ?? [])])
  const evidenceIds = uniqueStrings(audit.evidenceIds ?? [])
  const assumptions = normalizeAssumptions(input.assumptions?.length ? input.assumptions : audit.assumptions, input.user)
  const sourceDocumentId = cleanString(input.sourceDocumentId) ?? audit.sourceDocumentId
  const sourceSpecVersion = cleanString(input.sourceSpecVersion) ?? audit.sourceSpecVersion
  const approvalGateTaskId = cleanString(input.approvalGateTaskId) ?? audit.approvalGateTaskId
  const linked: ClientDocumentLinkSet & Record<string, unknown> = {
    ...(audit.projectId ? { projectId: audit.projectId, projectIds: [audit.projectId] } : {}),
    ...(audit.clientOrgId ? { clientOrgId: audit.clientOrgId, clientOrgIds: [audit.clientOrgId] } : {}),
    ...(audit.companyId ? { companyId: audit.companyId, companyIds: [audit.companyId] } : {}),
    ...(audit.workspaceId ? { geoWorkspaceId: audit.workspaceId } : {}),
    geoAuditId: input.auditId,
    geoReportId: reportRef.id,
    ...(sourceDocumentId ? { sourceDocumentId } : {}),
    ...(sourceSpecVersion ? { sourceSpecVersion } : {}),
    ...(cleanString(input.sourceDocumentSectionId) ? { sourceDocumentSectionId: cleanString(input.sourceDocumentSectionId) } : {}),
    ...(approvalGateTaskId ? { approvalGateTaskId } : {}),
    ...(audit.sourceCompanyId ? { sourceCompanyId: audit.sourceCompanyId } : {}),
    ...(evidenceIds.length ? { evidenceIds } : {}),
    ...(evidenceRowIds.length ? { evidenceRowIds } : {}),
  }
  const title = cleanString(input.title) ?? `${audit.siteName ?? audit.siteUrl ?? 'GEO SEO'} — GEO SEO Report`
  const blocks = reportBlocks({ audit, reportId: reportRef.id, assumptions, evidenceRowIds })
  const batch = adminDb.batch()

  batch.set(documentRef, {
    orgId: input.orgId,
    title,
    type: input.reportType === 'proposal' ? 'geo_seo_strategy' : 'monthly_report',
    templateId: input.reportType === 'proposal' ? 'geo-seo-strategy-v1' : 'monthly-report-v1',
    status: 'internal_draft',
    linked,
    currentVersionId: versionRef.id,
    approvalMode: 'operational',
    clientPermissions: { canComment: true, canSuggest: true, canDirectEdit: false, canApprove: true },
    assumptions,
    shareEnabled: false,
    createdAt: now,
    createdBy: input.user.uid,
    createdByType: userActorType,
    updatedAt: now,
    updatedBy: input.user.uid,
    updatedByType: userActorType,
    deleted: false,
  })
  batch.set(versionRef, {
    documentId: documentRef.id,
    versionNumber: Date.now(),
    status: 'draft',
    blocks,
    theme: {
      brandName: audit.siteName ?? 'Partners in Biz',
      palette: { bg: '#0A0A0B', text: '#F7F4EE', accent: '#F5A623', muted: '#A3A3A3' },
      typography: { heading: 'Instrument Serif', body: 'Geist' },
    },
    createdAt: now,
    createdBy: input.user.uid,
    createdByType: userActorType,
    changeSummary: 'Generated internal GEO SEO report draft',
  })
  batch.set(reportRef, {
    orgId: input.orgId,
    workspaceId: audit.workspaceId,
    auditId: input.auditId,
    clientOrgId: audit.clientOrgId,
    recipientOrgId: audit.recipientOrgId,
    companyId: audit.companyId,
    sourceCompanyId: audit.sourceCompanyId,
    projectId: audit.projectId,
    documentId: documentRef.id,
    documentVersionId: versionRef.id,
    reportType: input.reportType ?? 'client_report',
    status: 'internal_draft',
    visibility: 'internal',
    approvalGateTaskId,
    sourceDocumentId,
    sourceSpecVersion,
    sourceDocumentSectionId: cleanString(input.sourceDocumentSectionId),
    evidenceIds,
    evidenceRowIds,
    findingIds: audit.findingIds ?? (audit.findings ?? []).map((finding) => finding.id).filter(Boolean),
    assumptions,
    createdAt: now,
    createdBy: input.user.uid,
    createdByType: userActorType,
    updatedAt: now,
    updatedBy: input.user.uid,
    updatedByType: userActorType,
    deleted: false,
  })
  batch.update(auditRef, {
    generatedReportId: reportRef.id,
    generatedReportDocId: documentRef.id,
    generatedReportVersionId: versionRef.id,
    updatedAt: now,
    updatedBy: input.user.uid,
    updatedByType: userActorType,
  })
  await batch.commit()

  return {
    ok: true as const,
    value: {
      reportId: reportRef.id,
      documentId: documentRef.id,
      documentVersionId: versionRef.id,
      status: 'internal_draft',
      visibility: 'internal',
      approvalRequiredForClientVisibleActions: true,
    },
  }
}

export async function publishGeoReport(input: { reportId: string; orgId: string; approvalEvidenceId?: string; approvedBy?: string; user: ApiUser }) {
  const reportRef = adminDb.collection(GEO_REPORTS_COLLECTION).doc(input.reportId)
  const now = FieldValue.serverTimestamp()
  return adminDb.runTransaction(async (transaction) => {
    const reportSnap = await transaction.get(reportRef)
    if (!reportSnap.exists || reportSnap.data()?.deleted === true || reportSnap.data()?.orgId !== input.orgId) {
      return { ok: false as const, status: 404, error: 'GEO report not found' }
    }
    const report = reportSnap.data() as { documentId?: string; documentVersionId?: string }
    const approvalEvidenceId = cleanString(input.approvalEvidenceId)
    if (!approvalEvidenceId) {
      return {
        ok: false as const,
        status: 403,
        error: 'Explicit approval evidence is required before publishing or making a GEO report client-visible',
        approvalRequired: true,
      }
    }
    if (!report.documentId || !report.documentVersionId) {
      return { ok: false as const, status: 400, error: 'GEO report is missing document links' }
    }

    transaction.update(reportRef, {
      status: 'client_review',
      visibility: 'client_visible',
      approvalEvidenceId,
      approvedBy: cleanString(input.approvedBy) ?? input.user.uid,
      approvedAt: now,
      updatedAt: now,
      updatedBy: input.user.uid,
      updatedByType: actorType(input.user),
    })
    transaction.update(adminDb.collection(CLIENT_DOCUMENTS_COLLECTION).doc(report.documentId), {
      status: 'client_review',
      latestPublishedVersionId: report.documentVersionId,
      shareEnabled: true,
      updatedAt: now,
      updatedBy: input.user.uid,
      updatedByType: actorType(input.user),
    })
    transaction.update(adminDb.collection(CLIENT_DOCUMENTS_COLLECTION).doc(report.documentId).collection('versions').doc(report.documentVersionId), {
      status: 'published',
    })

    return {
      ok: true as const,
      value: {
        reportId: input.reportId,
        documentId: report.documentId,
        documentVersionId: report.documentVersionId,
        status: 'client_review',
        visibility: 'client_visible',
      },
    }
  })
}
