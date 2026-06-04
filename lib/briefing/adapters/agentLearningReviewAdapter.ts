/**
 * Source adapter for weekly Agent Learning Review briefing items.
 *
 * These cards surface proposed skill/wiki/task learning follow-ups for human review.
 * They intentionally do not perform automatic skill or wiki rewrites.
 */

import type { BriefingPriority, BriefingSourceAdapter } from '../types'
import {
  extractMultiFieldExcerpt,
  extractOrgId,
  extractProjectId,
  extractSafeExcerpt,
  generateSourceUrl,
  hashSourceDocument,
  normalizeActor,
  normalizeTimestamp,
} from '../utils'

const LEARNING_REVIEW_GUARD = 'No automatic skill or wiki rewrites. Proposed changes must be reviewed before any durable knowledge is changed.'

type LinkLike = string | { label?: unknown; title?: unknown; href?: unknown; url?: unknown; id?: unknown; path?: unknown; type?: unknown }

interface AgentLearningReviewTask extends Record<string, unknown> {
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
  approvalStatus?: string | null
  requiresApproval?: boolean | null
  blockedReason?: string | null
  createdAt?: unknown
  updatedAt?: unknown
  completedAt?: unknown
  createdBy?: string
  updatedBy?: string
  agentInput?: Record<string, unknown> | null
  agentOutput?: Record<string, unknown> | null
}

function compactString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function agentLearningReviewData(doc: AgentLearningReviewTask): Record<string, unknown> | null {
  const metadata = doc.metadata && typeof doc.metadata === 'object' && !Array.isArray(doc.metadata) ? doc.metadata as Record<string, unknown> : null
  const inputContext = doc.agentInput?.context && typeof doc.agentInput.context === 'object' && !Array.isArray(doc.agentInput.context)
    ? doc.agentInput.context as Record<string, unknown>
    : null
  const outputLearning = doc.agentOutput?.learningReview && typeof doc.agentOutput.learningReview === 'object' && !Array.isArray(doc.agentOutput.learningReview)
    ? doc.agentOutput.learningReview as Record<string, unknown>
    : null
  const metadataLearning = metadata?.agentLearningReview && typeof metadata.agentLearningReview === 'object' && !Array.isArray(metadata.agentLearningReview)
    ? metadata.agentLearningReview as Record<string, unknown>
    : null

  return outputLearning ?? metadataLearning ?? inputContext ?? metadata
}

function hasLearningMarker(doc: AgentLearningReviewTask): boolean {
  const data = agentLearningReviewData(doc)
  const markers = [
    compactString(doc.title),
    compactString(doc.description),
    compactString(doc.assigneeAgentId),
    compactString(doc.agentInput?.requiredCapability),
    compactString(doc.agentInput?.context && typeof doc.agentInput.context === 'object' ? (doc.agentInput.context as Record<string, unknown>).requiredCapability : null),
    compactString(data?.type),
    compactString(data?.category),
  ].filter((value): value is string => Boolean(value)).join(' ').toLowerCase()

  if (/agent learning review|weekly agent learning|skill hygiene|skill review|skill rewrite|learning review/.test(markers)) return true
  if (data?.agentLearningReview === true || data?.learningReview === true) return true
  if (Array.isArray(data?.skillLinks) || Array.isArray(data?.wikiLinks) || Array.isArray(data?.taskLinks)) return true
  if (Array.isArray(data?.recommendedSkillChanges) || Array.isArray(data?.proposedSkillChanges) || Array.isArray(data?.learningItems)) return true
  return false
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

function normalizeTextList(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return values.flatMap((entry) => {
    if (typeof entry === 'string') {
      const value = entry.trim()
      return value ? [value] : []
    }
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const record = entry as Record<string, unknown>
      const label = compactString(record.title) ?? compactString(record.summary) ?? compactString(record.label) ?? compactString(record.change)
      return label ? [label] : []
    }
    return []
  }).slice(0, 10)
}

function reviewStatusCopy(doc: AgentLearningReviewTask): string {
  if (doc.reviewStatus === 'pending') return 'pending review'
  if (doc.reviewStatus) return doc.reviewStatus.replace(/-/g, ' ')
  if (doc.agentStatus) return doc.agentStatus.replace(/-/g, ' ')
  return 'ready for review'
}

export const agentLearningReviewAdapter: BriefingSourceAdapter<AgentLearningReviewTask> = {
  sourceType: 'agent-learning-review',
  collectionPath: 'projects/{projectId}/tasks',

  hashSource(doc, docId) {
    return hashSourceDocument(doc, docId, [
      'orgId',
      'projectId',
      'title',
      'updatedAt',
      'agentStatus',
      'reviewStatus',
      'agentInput',
      'agentOutput',
      'metadata',
    ])
  },

  shouldGenerate(doc) {
    if (doc.deleted === true) return false
    if (doc.columnId === 'backlog') return false
    return hasLearningMarker(doc)
  },

  extractPriority(doc): BriefingPriority {
    if (doc.agentStatus === 'blocked') return 'critical'
    if (doc.agentStatus === 'awaiting-input') return 'needs-peet'
    if (doc.requiresApproval === true && (!doc.approvalStatus || doc.approvalStatus === 'pending')) return 'needs-peet'
    if (doc.agentStatus === 'done' && doc.reviewStatus === 'pending') return 'review'
    if (doc.reviewStatus === 'changes-requested') return 'needs-peet'
    if (doc.priority === 'urgent') return 'client-risk'
    if (doc.agentStatus === 'in-progress' || doc.agentStatus === 'pending') return 'progress'
    return 'fyi'
  },

  extractActor(doc) {
    if (doc.assigneeAgentId) {
      const name = `${doc.assigneeAgentId.charAt(0).toUpperCase()}${doc.assigneeAgentId.slice(1)}`
      return { id: `agent:${doc.assigneeAgentId}`, name, role: 'ai' as const, type: 'agent' as const }
    }
    return normalizeActor(doc)
  },

  extractContext(doc, docId) {
    return {
      orgId: extractOrgId(doc) ?? '',
      projectId: extractProjectId(doc) ?? '',
      taskId: compactString(doc.taskId) ?? docId,
      taskTitle: doc.title ?? null,
    }
  },

  extractTitle(doc) {
    const title = compactString(doc.title) ?? 'Weekly Agent Learning Review'
    if (/agent learning review|weekly agent learning/i.test(title)) return title
    return `Agent Learning Review: ${title}`
  },

  extractSummary(doc) {
    const data = agentLearningReviewData(doc)
    const proposedChanges = normalizeTextList(data?.recommendedSkillChanges ?? data?.proposedSkillChanges ?? data?.learningItems)
    const linkCount = normalizeLinks(data?.skillLinks, 'skill').length + normalizeLinks(data?.wikiLinks, 'wiki').length + normalizeLinks(data?.taskLinks, 'task').length
    const parts = [
      `Weekly Agent Learning Review is ${reviewStatusCopy(doc)}.`,
      proposedChanges.length ? `${proposedChanges.length} proposed learning item${proposedChanges.length === 1 ? '' : 's'} need review.` : null,
      linkCount ? `${linkCount} skill/wiki/task link${linkCount === 1 ? '' : 's'} attached.` : null,
      LEARNING_REVIEW_GUARD,
    ]
    return parts.filter((value): value is string => Boolean(value)).join(' ')
  },

  extractExcerpt(doc) {
    return extractMultiFieldExcerpt(doc, ['agentOutput.summary', 'description', 'title'], { maxLength: 220 }) ?? extractSafeExcerpt(this.extractSummary(doc, doc.id), { maxLength: 220 })
  },

  extractOccurredAt(doc): Date {
    return normalizeTimestamp(doc.updatedAt) ?? normalizeTimestamp(doc.completedAt) ?? normalizeTimestamp(doc.createdAt) ?? new Date()
  },

  extractMetadata(doc) {
    const data = agentLearningReviewData(doc)
    return {
      agentLearningReview: {
        reviewGate: 'proposals-only',
        automationGuard: LEARNING_REVIEW_GUARD,
        skillLinks: normalizeLinks(data?.skillLinks, 'skill'),
        wikiLinks: normalizeLinks(data?.wikiLinks, 'wiki'),
        taskLinks: normalizeLinks(data?.taskLinks, 'task'),
        proposedChanges: normalizeTextList(data?.recommendedSkillChanges ?? data?.proposedSkillChanges ?? data?.learningItems),
        sourceDocumentId: compactString(data?.sourceDocumentId) ?? compactString(doc.agentInput?.context && typeof doc.agentInput.context === 'object' ? (doc.agentInput.context as Record<string, unknown>).sourceDocumentId : null) ?? null,
        approvalGateTaskId: compactString(data?.approvalGateTaskId) ?? compactString(doc.agentInput?.context && typeof doc.agentInput.context === 'object' ? (doc.agentInput.context as Record<string, unknown>).approvalGateTaskId : null) ?? null,
      },
    }
  },

  toItem(doc, docId) {
    const context = this.extractContext(doc, docId)
    const sourceId = context.taskId ?? docId
    const occurredAt = normalizeTimestamp(doc.updatedAt) ?? normalizeTimestamp(doc.completedAt) ?? normalizeTimestamp(doc.createdAt) ?? new Date()
    return {
      id: `agent-learning-review:${sourceId}`,
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
