/**
 * Source adapter for proactive Business Insight Review briefing items.
 *
 * These cards surface evidence-backed commercial, operational, and data-quality
 * gaps for internal review. They intentionally do not perform external sends,
 * publishing, spend, finance, secret/config, or destructive actions.
 */

import type { BriefingPriority, BriefingSourceAdapter } from '../types'
import {
  extractMultiFieldExcerpt,
  extractOrgId,
  extractProjectId,
  extractSafeExcerpt,
  generateSourceUrl,
  hashSourceDocument,
  normalizeTimestamp,
} from '../utils'

const BUSINESS_INSIGHT_GUARD = 'No external send, publish, spend, finance, secret/config, production, or destructive action is allowed from this review card.'

type LinkLike = string | { label?: unknown; title?: unknown; href?: unknown; url?: unknown; id?: unknown; path?: unknown; type?: unknown }

interface BusinessInsightReviewTask extends Record<string, unknown> {
  id: string
  orgId?: string
  projectId?: string
  taskId?: string
  title?: string
  description?: string | null
  columnId?: string | null
  status?: string | null
  deleted?: boolean
  priority?: string | null
  assigneeAgentId?: string | null
  agentStatus?: string | null
  reviewStatus?: string | null
  createdAt?: unknown
  updatedAt?: unknown
  completedAt?: unknown
  metadata?: Record<string, unknown> | null
  agentInput?: Record<string, unknown> | null
  agentOutput?: Record<string, unknown> | null
}

function compactString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function businessInsightData(doc: BusinessInsightReviewTask): Record<string, unknown> | null {
  const metadataInsight = objectValue(doc.metadata)?.businessInsightReview
  const outputInsight = objectValue(doc.agentOutput)?.businessInsightReview
  const inputContext = objectValue(doc.agentInput?.context)
  const inputInsight = inputContext?.businessInsightReview
  return objectValue(metadataInsight) ?? objectValue(outputInsight) ?? objectValue(inputInsight)
}

function hasBusinessInsightMarker(doc: BusinessInsightReviewTask): boolean {
  const data = businessInsightData(doc)
  if (data?.type === 'business-insight-review') return true
  if (data?.businessInsightReview === true) return true
  if (compactString(data?.lane) && compactString(data?.insightKind) && compactString(data?.summary)) return true
  const markers = [
    compactString(doc.title),
    compactString(doc.description),
    compactString(data?.category),
  ].filter((value): value is string => Boolean(value)).join(' ').toLowerCase()
  return /business insight review|business-insight-review|growth insight|commercial insight/.test(markers)
}

function normalizeLinks(values: unknown, fallbackType: string): Array<{ label: string; href: string; type: string }> {
  if (!Array.isArray(values)) return []
  return values.flatMap((entry: LinkLike) => {
    if (typeof entry === 'string') {
      const value = entry.trim()
      return value ? [{ label: value, href: value, type: fallbackType }] : []
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const href = compactString(entry.href) ?? compactString(entry.url) ?? compactString(entry.path) ?? compactString(entry.id)
    const label = compactString(entry.label) ?? compactString(entry.title) ?? href
    if (!href || !label) return []
    return [{ label, href, type: compactString(entry.type) ?? fallbackType }]
  }).slice(0, 12)
}

function normalizeEvidence(values: unknown): Array<{ label: string; value?: string; href?: string; type?: string }> {
  if (!Array.isArray(values)) return []
  return values.flatMap((entry) => {
    if (typeof entry === 'string') {
      const value = entry.trim()
      return value ? [{ label: value }] : []
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const record = entry as Record<string, unknown>
    const label = compactString(record.label) ?? compactString(record.title) ?? compactString(record.metric) ?? compactString(record.name)
    if (!label) return []
    const value = compactString(record.value) ?? compactString(record.summary)
    const href = compactString(record.href) ?? compactString(record.url) ?? compactString(record.path) ?? undefined
    const type = compactString(record.type) ?? compactString(record.kind) ?? undefined
    return [{ label, value: value ?? undefined, href, type }]
  }).slice(0, 12)
}

function scoreTotal(data: Record<string, unknown> | null): number {
  const score = objectValue(data?.score)
  const total = score?.total
  if (typeof total === 'number' && Number.isFinite(total)) return total
  return 0
}

function recommendation(data: Record<string, unknown> | null): Record<string, unknown> {
  return objectValue(data?.recommendation) ?? {}
}

function businessImpact(data: Record<string, unknown> | null): Record<string, unknown> {
  return objectValue(data?.businessImpact) ?? {}
}

export const businessInsightReviewAdapter: BriefingSourceAdapter<BusinessInsightReviewTask> = {
  sourceType: 'business-insight-review',
  collectionPath: 'projects/{projectId}/tasks',

  hashSource(doc, docId) {
    return hashSourceDocument(doc, docId, [
      'orgId',
      'projectId',
      'title',
      'updatedAt',
      'agentStatus',
      'reviewStatus',
      'metadata',
      'agentOutput',
    ])
  },

  shouldGenerate(doc) {
    if (doc.deleted === true) return false
    if (doc.columnId === 'backlog') return false
    return hasBusinessInsightMarker(doc)
  },

  extractPriority(doc): BriefingPriority {
    const data = businessInsightData(doc)
    if (doc.agentStatus === 'blocked') return 'critical'
    if (doc.reviewStatus === 'pending' || recommendation(data).approvalGate === 'human-review') return 'needs-peet'
    if (scoreTotal(data) >= 75 || data?.insightKind === 'risk' || data?.insightKind === 'performance-drop') return 'client-risk'
    if (doc.agentStatus === 'in-progress' || doc.agentStatus === 'pending') return 'progress'
    if (doc.reviewStatus === 'approved') return 'fyi'
    return 'review'
  },

  extractActor(doc) {
    const agentId = compactString(doc.assigneeAgentId) ?? 'pip'
    const name = `${agentId.charAt(0).toUpperCase()}${agentId.slice(1)}`
    return { id: `agent:${agentId}`, name, role: 'ai' as const, type: 'agent' as const }
  },

  extractContext(doc, docId) {
    return {
      orgId: extractOrgId(doc) ?? compactString(businessInsightData(doc)?.orgId) ?? '',
      projectId: extractProjectId(doc) ?? '',
      taskId: compactString(doc.taskId) ?? docId,
      taskTitle: doc.title ?? null,
      requiredCapability: 'business-insight-review',
      riskLevel: 'high',
      reviewerAgentId: compactString(doc.reviewerAgentId) ?? 'nora',
    }
  },

  extractTitle(doc) {
    const data = businessInsightData(doc)
    const summary = compactString(data?.summary) ?? compactString(doc.title) ?? 'Business insight needs review'
    if (/^business insight:/i.test(summary)) return summary
    return `Business Insight: ${summary}`
  },

  extractSummary(doc) {
    const data = businessInsightData(doc)
    const impactLabel = compactString(businessImpact(data).estimateLabel)
    const nextAction = compactString(recommendation(data).nextAction)
    const lane = compactString(data?.lane)
    const score = scoreTotal(data)
    const parts = [
      lane ? `${lane.toUpperCase()} insight.` : null,
      impactLabel,
      score ? `Score ${score}.` : null,
      nextAction,
      BUSINESS_INSIGHT_GUARD,
    ]
    return parts.filter((value): value is string => Boolean(value)).join(' ')
  },

  extractExcerpt(doc) {
    const data = businessInsightData(doc)
    return extractSafeExcerpt(compactString(data?.summary), { maxLength: 220 })
      ?? extractMultiFieldExcerpt(doc, ['description', 'title'], { maxLength: 220 })
      ?? extractSafeExcerpt(this.extractSummary(doc, doc.id), { maxLength: 220 })
  },

  extractOccurredAt(doc): Date {
    return normalizeTimestamp(doc.updatedAt) ?? normalizeTimestamp(doc.completedAt) ?? normalizeTimestamp(doc.createdAt) ?? new Date()
  },

  extractMetadata(doc) {
    const data = businessInsightData(doc)
    const sourceLinks = normalizeLinks(data?.sourceLinks, 'source')
    const evidence = normalizeEvidence(data?.evidence)
    const rec = recommendation(data)

    return {
      businessInsightReview: {
        reviewGate: 'internal-proposals-only',
        automationGuard: BUSINESS_INSIGHT_GUARD,
        lane: compactString(data?.lane),
        insightKind: compactString(data?.insightKind),
        businessImpact: businessImpact(data),
        sourceWindow: objectValue(data?.sourceWindow),
        sourceLinks,
        evidence,
        recommendation: {
          nextAction: compactString(rec.nextAction),
          ownerAgentId: compactString(rec.ownerAgentId),
          ownerRole: compactString(rec.ownerRole),
          createsTask: rec.createsTask === true,
          approvalGate: compactString(rec.approvalGate),
        },
        score: objectValue(data?.score),
        suppressionKey: compactString(data?.suppressionKey),
        reviewStatus: compactString(data?.reviewStatus) ?? compactString(doc.reviewStatus),
      },
      softwareBuildEvidence: evidence.map((entry) => ({
        label: entry.label,
        value: entry.value,
        href: entry.href,
        kind: entry.type ?? 'evidence',
      })),
    }
  },

  toItem(doc, docId) {
    const context = this.extractContext(doc, docId)
    const sourceId = context.taskId ?? docId
    const occurredAt = this.extractOccurredAt(doc, docId) ?? new Date()
    return {
      id: `business-insight-review:${sourceId}`,
      orgId: context.orgId,
      source: {
        type: this.sourceType,
        id: sourceId,
        collectionPath: this.collectionPath,
        url: generateSourceUrl('task', sourceId, { projectId: context.projectId }),
      },
      priority: this.extractPriority(doc, docId),
      status: 'active',
      title: this.extractTitle(doc, docId),
      summary: this.extractSummary(doc, docId),
      excerpt: this.extractExcerpt(doc, docId),
      actor: this.extractActor(doc, docId),
      context,
      occurredAt,
      sourceHash: this.hashSource(doc, docId),
      metadata: this.extractMetadata?.(doc, docId),
    }
  },
}
