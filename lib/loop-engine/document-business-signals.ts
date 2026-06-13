import { adminDb } from '@/lib/firebase/admin'
import type { BusinessInsightSignal } from './review-evaluator'

type DocumentDoc = {
  id: string
  data: () => Record<string, unknown>
}

type SourceLink = {
  type: string
  id?: string
  href?: string
  label: string
}

type EvidenceItem = {
  label: string
  value?: string | number
  href?: string
}

export type DocumentBusinessMetric =
  | 'client_documents_waiting_for_review'
  | 'client_documents_changes_requested'
  | 'client_documents_blocking_publish_assumptions'

export type DocumentBusinessMetricSnapshot = {
  metric: DocumentBusinessMetric
  value: number
  capturedAt: string
  source: 'document-business-signals'
  sourceLinks: SourceLink[]
  evidence: EvidenceItem[]
}

export type CollectDocumentBusinessInsightSignalsInput = {
  orgId: string
  existingSuppressionKeys?: string[]
  limit?: number
  now?: Date
}

export type CollectDocumentBusinessInsightSignalsResult = {
  documentsScanned: number
  metrics: DocumentBusinessMetricSnapshot[]
  signals: BusinessInsightSignal[]
}

export type RefreshDocumentBusinessInsightMetricInput = {
  orgId: string
  metric: string | null
  limit?: number
  now?: Date
}

type DocumentRow = Record<string, unknown> & { id: string }

const STALE_CLIENT_REVIEW_DAYS = 7

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function boundedLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 100
  return Math.max(1, Math.min(250, Math.floor(value)))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function recordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Record<string, unknown> => isRecord(item))
}

function normalizeDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? new Date(parsed) : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value)
  if (typeof value === 'object') {
    const timestamp = value as { toDate?: () => Date; toMillis?: () => number; seconds?: number; _seconds?: number }
    if (typeof timestamp.toDate === 'function') {
      try {
        return timestamp.toDate()
      } catch {
        return null
      }
    }
    if (typeof timestamp.toMillis === 'function') {
      try {
        return new Date(timestamp.toMillis())
      } catch {
        return null
      }
    }
    const seconds = timestamp.seconds ?? timestamp._seconds
    if (typeof seconds === 'number') return new Date(seconds * 1000)
  }
  return null
}

function daysSince(value: unknown, now: Date): number | null {
  const date = normalizeDate(value)
  if (!date) return null
  return Math.floor((now.getTime() - date.getTime()) / 86_400_000)
}

function documentAge(document: DocumentRow, now: Date): number | null {
  return daysSince(document.updatedAt ?? document.createdAt, now)
}

function status(document: DocumentRow): string | null {
  return cleanString(document.status)
}

function isClosedDocument(document: DocumentRow): boolean {
  const value = status(document)
  return document.deleted === true || value === 'approved' || value === 'accepted' || value === 'archived'
}

function isStaleClientReview(document: DocumentRow, now: Date): boolean {
  if (isClosedDocument(document) || status(document) !== 'client_review') return false
  const age = documentAge(document, now)
  return age === null || age >= STALE_CLIENT_REVIEW_DAYS
}

function isChangesRequested(document: DocumentRow): boolean {
  return !isClosedDocument(document) && status(document) === 'changes_requested'
}

function blockingAssumptions(document: DocumentRow): Record<string, unknown>[] {
  if (isClosedDocument(document)) return []
  return recordArray(document.assumptions).filter((assumption) => (
    cleanString(assumption.severity) === 'blocks_publish' && cleanString(assumption.status) !== 'resolved'
  ))
}

function documentLabel(document: DocumentRow): string {
  return cleanString(document.title) ?? document.id
}

function sourceLinkForDocument(document: DocumentRow): SourceLink {
  const orgId = cleanString(document.orgId)
  const orgSuffix = orgId ? `?orgId=${encodeURIComponent(orgId)}` : ''
  return {
    type: 'client-document',
    id: document.id,
    href: `/portal/documents/${encodeURIComponent(document.id)}${orgSuffix}`,
    label: documentLabel(document),
  }
}

async function listDocuments(orgId: string, limit: number): Promise<DocumentRow[]> {
  const snap = await adminDb.collection('client_documents')
    .where('orgId', '==', orgId)
    .limit(limit)
    .get() as { docs: DocumentDoc[] }
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as DocumentRow)
    .filter((row) => row.deleted !== true)
}

function waitingForReviewMetric(documents: DocumentRow[], now: Date): DocumentBusinessMetricSnapshot {
  const candidates = documents
    .filter((document) => isStaleClientReview(document, now))
    .sort((a, b) => (documentAge(b, now) ?? 0) - (documentAge(a, now) ?? 0))
  const oldestAge = candidates
    .map((document) => documentAge(document, now))
    .filter((age): age is number => age !== null)
    .sort((a, b) => b - a)[0] ?? 0

  return {
    metric: 'client_documents_waiting_for_review',
    value: candidates.length,
    capturedAt: now.toISOString(),
    source: 'document-business-signals',
    sourceLinks: candidates.slice(0, 5).map(sourceLinkForDocument),
    evidence: [
      { label: 'Client-review documents older than 7 days', value: candidates.length },
      { label: 'Oldest client review age days', value: oldestAge },
    ],
  }
}

function changesRequestedMetric(documents: DocumentRow[], now: Date): DocumentBusinessMetricSnapshot {
  const candidates = documents
    .filter(isChangesRequested)
    .sort((a, b) => (documentAge(b, now) ?? 0) - (documentAge(a, now) ?? 0))
  const oldestAge = candidates
    .map((document) => documentAge(document, now))
    .filter((age): age is number => age !== null)
    .sort((a, b) => b - a)[0] ?? 0

  return {
    metric: 'client_documents_changes_requested',
    value: candidates.length,
    capturedAt: now.toISOString(),
    source: 'document-business-signals',
    sourceLinks: candidates.slice(0, 5).map(sourceLinkForDocument),
    evidence: [
      { label: 'Documents with requested changes', value: candidates.length },
      { label: 'Oldest requested-change age days', value: oldestAge },
    ],
  }
}

function blockingAssumptionsMetric(documents: DocumentRow[], now: Date): DocumentBusinessMetricSnapshot {
  const candidates = documents
    .filter((document) => blockingAssumptions(document).length > 0)
    .sort((a, b) => blockingAssumptions(b).length - blockingAssumptions(a).length)
  const blockerCount = candidates.reduce((sum, document) => sum + blockingAssumptions(document).length, 0)

  return {
    metric: 'client_documents_blocking_publish_assumptions',
    value: candidates.length,
    capturedAt: now.toISOString(),
    source: 'document-business-signals',
    sourceLinks: candidates.slice(0, 5).map(sourceLinkForDocument),
    evidence: [
      { label: 'Documents blocked by open publish assumptions', value: candidates.length },
      { label: 'Open blocks-publish assumptions', value: blockerCount },
    ],
  }
}

function documentSignal(input: {
  orgId: string
  metric: DocumentBusinessMetricSnapshot
  existingSuppressionKeys: Set<string>
}): BusinessInsightSignal | null {
  if (input.metric.value <= 0) return null

  const configs: Record<DocumentBusinessMetric, {
    suppressionKey: string
    insightKind: BusinessInsightSignal['insightKind']
    summary: string
    impactEstimate: string
    impact: number
    urgency: number
    confidence: number
    actionability: number
    risk: number
    nextAction: string
  }> = {
    client_documents_waiting_for_review: {
      suppressionKey: `documents:waiting-for-review:${input.orgId}`,
      insightKind: 'stale-work',
      summary: `${input.metric.value} client document${input.metric.value === 1 ? ' is' : 's are'} waiting for review`,
      impactEstimate: 'Client-facing delivery risk from documents sitting in review without clear follow-through',
      impact: Math.min(90, 66 + input.metric.value * 8),
      urgency: 78,
      confidence: 82,
      actionability: 84,
      risk: 22,
      nextAction: 'Review the stale client documents, confirm owner and next follow-up, and create internal unblock work. Do not send, publish, or change client-visible access without the document approval gate.',
    },
    client_documents_changes_requested: {
      suppressionKey: `documents:changes-requested:${input.orgId}`,
      insightKind: 'follow-up-gap',
      summary: `${input.metric.value} client document${input.metric.value === 1 ? ' has' : 's have'} requested changes`,
      impactEstimate: 'Delivery and relationship risk from client-requested changes without a visible internal next step',
      impact: Math.min(88, 64 + input.metric.value * 8),
      urgency: 84,
      confidence: 84,
      actionability: 86,
      risk: 24,
      nextAction: 'Review requested changes, assign an internal owner, and create the smallest approved revision task before updating or republishing the document.',
    },
    client_documents_blocking_publish_assumptions: {
      suppressionKey: `documents:blocking-publish-assumptions:${input.orgId}`,
      insightKind: 'risk',
      summary: `${input.metric.value} client document${input.metric.value === 1 ? ' has' : 's have'} publish-blocking assumptions`,
      impactEstimate: 'Client-visible quality risk from documents that cannot be safely published or approved until assumptions are resolved',
      impact: Math.min(94, 72 + input.metric.value * 8),
      urgency: 88,
      confidence: 86,
      actionability: 82,
      risk: 30,
      nextAction: 'Resolve or explicitly approve each blocks-publish assumption before publishing, sending, or using the document as implementation authority.',
    },
  }

  const config = configs[input.metric.metric]
  return {
    id: `${input.metric.metric.replace(/_/g, '-')}-${input.orgId}`,
    lane: 'documents',
    insightKind: config.insightKind,
    summary: config.summary,
    impactEstimate: config.impactEstimate,
    metric: input.metric.metric,
    value: input.metric.value,
    impact: config.impact,
    urgency: config.urgency,
    confidence: config.confidence,
    actionability: config.actionability,
    risk: config.risk,
    ownerAgentId: 'docs',
    ownerRole: 'documents',
    approvalGate: 'client-visible',
    nextAction: config.nextAction,
    suppressionKey: config.suppressionKey,
    sourceLinks: input.metric.sourceLinks,
    evidence: input.metric.evidence,
    blocksActiveCommercialLoop: true,
    hasNewSourceItem: !input.existingSuppressionKeys.has(config.suppressionKey),
  }
}

export async function collectDocumentBusinessInsightSignals(
  input: CollectDocumentBusinessInsightSignalsInput,
): Promise<CollectDocumentBusinessInsightSignalsResult> {
  const limit = boundedLimit(input.limit)
  const now = input.now ?? new Date()
  const existingSuppressionKeys = new Set(input.existingSuppressionKeys ?? [])
  const documents = await listDocuments(input.orgId, limit)
  const metrics = [
    waitingForReviewMetric(documents, now),
    changesRequestedMetric(documents, now),
    blockingAssumptionsMetric(documents, now),
  ]
  const signals = metrics
    .map((metric) => documentSignal({ orgId: input.orgId, metric, existingSuppressionKeys }))
    .filter((signal): signal is BusinessInsightSignal => Boolean(signal))

  return {
    documentsScanned: documents.length,
    metrics,
    signals,
  }
}

export async function refreshDocumentBusinessInsightMetric(
  input: RefreshDocumentBusinessInsightMetricInput,
): Promise<DocumentBusinessMetricSnapshot | null> {
  const metric = cleanString(input.metric)
  if (
    metric !== 'client_documents_waiting_for_review' &&
    metric !== 'client_documents_changes_requested' &&
    metric !== 'client_documents_blocking_publish_assumptions'
  ) {
    return null
  }

  const collection = await collectDocumentBusinessInsightSignals({
    orgId: input.orgId,
    limit: input.limit,
    now: input.now,
  })
  return collection.metrics.find((snapshot) => snapshot.metric === metric) ?? null
}
