/**
 * Source adapter for agent outputs.
 *
 * Generates briefing items when agents complete work and produce output.
 */

import { buildAgentOutputReviewCard } from '@/lib/agent-output-review-card'
import type { BriefingSourceAdapter, BriefingPriority } from '../types'
import { normalizeActor, hashSourceDocument, extractMultiFieldExcerpt, normalizeTimestamp, extractOrgId, extractTaskId, generateSourceUrl } from '../utils'

/**
 * Agent output Firestore document shape (typically embedded in task documents).
 */
interface AgentOutputDocument extends Record<string, unknown> {
  summary: string
  artifacts?: Array<{ type: string; ref: string; label?: string }>
  completedAt?: unknown
  // Context fields (from parent task)
  orgId?: string
  projectId?: string
  taskId?: string
  assigneeAgentId?: string
  reviewerAgentId?: string
  reviewStatus?: string
  status?: string
  columnId?: string
  createdAt?: unknown
  updatedAt?: unknown
  createdBy?: string
  blockedReason?: string | null
}

/**
 * Adapter for agent output briefing items.
 */
export const agentOutputAdapter: BriefingSourceAdapter<AgentOutputDocument> = {
  sourceType: 'agent-output',
  collectionPath: 'projects/{projectId}/tasks/{taskId}',

  /**
   * Generate deterministic hash for the agent output.
   * Uses summary, artifacts, completedAt, and taskId.
   */
  hashSource(doc: AgentOutputDocument, docId: string): string {
    return hashSourceDocument(doc, docId, ['summary', 'artifacts', 'completedAt', 'taskId', 'assigneeAgentId', 'reviewStatus'])
  },

  /**
   * Determine if this agent output should generate a briefing item.
   */
  shouldGenerate(doc: AgentOutputDocument, _docId: string): boolean {
    // Must have a summary
    if (!doc.summary || doc.summary.trim().length === 0) {
      return false
    }

    // Must have a completedAt timestamp (means work is done)
    if (!doc.completedAt) {
      return false
    }

    // Must be assigned to an agent
    if (!doc.assigneeAgentId) {
      return false
    }

    // Skip if blocked with no meaningful output
    if (doc.columnId === 'blocked' && doc.blockedReason && doc.summary.includes('Watcher error')) {
      return false // These are system errors, handled elsewhere
    }

    return true
  },

  /**
   * Extract priority based on agent output and task state.
   */
  extractPriority(doc: AgentOutputDocument, _docId: string): BriefingPriority {
    // Blocked agent work is critical
    if (doc.columnId === 'blocked' || doc.status === 'blocked') {
      return 'critical'
    }

    // Agent work awaiting review
    if (doc.reviewStatus === 'pending' && doc.columnId === 'review') {
      return 'review'
    }

    // Changes requested after review
    if (doc.reviewStatus === 'changes-requested') {
      return 'needs-peet'
    }

    // Completed and approved work
    if (doc.reviewStatus === 'approved' || doc.columnId === 'done') {
      return 'fyi'
    }

    // Just completed but not yet reviewed
    if (doc.completedAt && doc.columnId === 'review') {
      return 'review'
    }

    // Default to FYI
    return 'fyi'
  },

  /**
   * Extract actor information (the agent that produced the output).
   */
  extractActor(doc: AgentOutputDocument, _docId: string) {
    const agentId = typeof doc.assigneeAgentId === 'string' ? doc.assigneeAgentId : 'unknown'
    const agentName = agentId.charAt(0).toUpperCase() + agentId.slice(1)

    return {
      id: `agent:${agentId}`,
      name: agentName,
      role: 'ai' as const,
      type: 'agent' as const,
    }
  },

  /**
   * Extract context metadata.
   */
  extractContext(doc: AgentOutputDocument, _docId: string) {
    const orgId = extractOrgId(doc) ?? ''
    const projectId = typeof doc.projectId === 'string' ? doc.projectId : null
    const taskId = extractTaskId(doc, _docId) ?? null
    const taskTitle = null // Would need to fetch from parent task

    return {
      orgId,
      projectId,
      taskId,
      taskTitle,
    }
  },

  /**
   * Extract title for the briefing card.
   */
  extractTitle(doc: AgentOutputDocument, _docId: string): string {
    const agent = this.extractActor(doc, _docId)
    const agentName = agent.name

    if (doc.columnId === 'blocked') {
      return `${agentName} blocked`
    }

    if (doc.reviewStatus === 'pending') {
      return `${agentName} completed work - review required`
    }

    if (doc.reviewStatus === 'changes-requested') {
      return `${agentName} needs changes`
    }

    if (doc.reviewStatus === 'approved') {
      return `${agentName} work approved`
    }

    return `${agentName} completed work`
  },

  /**
   * Extract summary for the briefing card.
   */
  extractSummary(doc: AgentOutputDocument, _docId: string): string {
    const parts: string[] = []

    // Use the agent summary
    if (doc.summary) {
      const excerpt = extractMultiFieldExcerpt(doc, ['summary'], { maxLength: 200 })
      if (excerpt) parts.push(excerpt)
    }

    // Add artifact count if present
    if (Array.isArray(doc.artifacts) && doc.artifacts.length > 0) {
      parts.push(`Produced ${doc.artifacts.length} artifact${doc.artifacts.length > 1 ? 's' : ''}`)
    }

    return parts.join('. ') || 'No details provided.'
  },

  /**
   * Extract safe excerpt from the agent output.
   */
  extractExcerpt(doc: AgentOutputDocument, _docId: string, maxLength = 300): string | null {
    // Prefer summary over artifacts
    const excerpt = extractMultiFieldExcerpt(doc, ['summary'], { maxLength })
    return excerpt
  },

  /**
   * Extract timestamp when the agent completed work.
   */
  extractOccurredAt(doc: AgentOutputDocument, _docId: string): Date | null {
    // Prefer completedAt, then updatedAt, then createdAt
    return normalizeTimestamp(doc.completedAt) ?? normalizeTimestamp(doc.updatedAt) ?? normalizeTimestamp(doc.createdAt)
  },

  /**
   * Extract metadata specific to agent outputs.
   */
  extractMetadata(doc: AgentOutputDocument, _docId: string): Record<string, unknown> | null {
    const reviewCard = buildAgentOutputReviewCard(doc)

    return {
      assigneeAgentId: doc.assigneeAgentId,
      reviewerAgentId: doc.reviewerAgentId,
      reviewStatus: doc.reviewStatus,
      columnId: doc.columnId,
      status: doc.status,
      artifactCount: Array.isArray(doc.artifacts) ? doc.artifacts.length : 0,
      artifactTypes: Array.isArray(doc.artifacts) ? [...new Set(doc.artifacts.map(a => a.type))] : [],
      blockedReason: doc.blockedReason,
      agentOutputReviewCard: reviewCard,
      softwareBuildEvidence: reviewCard.evidence.length ? reviewCard.evidence : undefined,
    }
  },

  /**
   * Convert agent output document to briefing source item.
   */
  toItem(doc: AgentOutputDocument, docId: string) {
    const orgId = extractOrgId(doc) ?? ''
    const projectId = typeof doc.projectId === 'string' ? doc.projectId : ''
    const taskId = extractTaskId(doc, docId) ?? docId
    const priority = this.extractPriority(doc, docId)
    const actor = this.extractActor(doc, docId)
    const context = this.extractContext(doc, docId)
    const title = this.extractTitle(doc, docId)
    const summary = this.extractSummary(doc, docId)
    const excerpt = this.extractExcerpt(doc, docId)
    const occurredAt = this.extractOccurredAt(doc, docId) ?? new Date()
    const metadata = this.extractMetadata?.(doc, docId)
    const sourceHash = this.hashSource(doc, docId)

    return {
      orgId,
      source: {
        type: this.sourceType,
        id: docId,
        collectionPath: this.collectionPath.replace('{projectId}', projectId).replace('{taskId}', taskId),
        url: generateSourceUrl('task', taskId, { projectId }),
      },
      priority,
      status: 'active',
      title,
      summary,
      excerpt,
      actor,
      context,
      occurredAt,
      sourceHash,
      metadata,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    }
  },
}