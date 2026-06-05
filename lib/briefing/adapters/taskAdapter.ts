/**
 * Source adapter for Projects/Kanban tasks.
 *
 * Generates briefing items for:
 * - Task creation
 * - Task completion by agents
 * - Task movement between columns
 * - Agent status changes
 */

import type { BriefingSourceAdapter, BriefingPriority } from '../types'
import { getSoftwareBuildEvidenceRows } from '@/lib/software-build-evidence'
import { normalizeActor, hashSourceDocument, extractSafeExcerpt, extractMultiFieldExcerpt, normalizeTimestamp, extractOrgId, extractProjectId, extractTaskId, generateSourceUrl, comparePriority, priorityRequiresAction } from '../utils'

/**
 * Project/Task Firestore document shape.
 */
interface TaskDocument extends Record<string, unknown> {
  id: string
  orgId: string
  projectId: string
  columnId: string
  title: string
  description?: string | null
  priority?: string
  assigneeAgentId?: string | null
  agentStatus?: string | null
  agentInput?: { spec?: string }
  agentOutput?: { summary?: string }
  createdAt?: unknown
  updatedAt?: unknown
  completedAt?: unknown
  createdBy?: string
  updatedBy?: string
  requiresApproval?: boolean
  approvalStatus?: string
  reviewStatus?: string
  dependsOn?: string[]
  assigneeId?: string | null
  assigneeIds?: string[]
  blockedReason?: string | null
  status?: string
  deleted?: boolean
}

/**
 * Adapter for task briefing items.
 */
export const taskAdapter: BriefingSourceAdapter<TaskDocument> = {
  sourceType: 'task',
  collectionPath: 'projects/{projectId}/tasks',

  /**
   * Generate a deterministic hash for the task.
   * Uses orgId, projectId, task title, agentStatus, columnId, and updatedAt.
   */
  hashSource(doc: TaskDocument, docId: string): string {
    return hashSourceDocument(doc, docId, [
      'orgId',
      'projectId',
      'title',
      'agentStatus',
      'columnId',
      'updatedAt',
      'agentOutput',
      'assigneeAgentId',
      'reviewStatus',
      'approvalStatus',
    ])
  },

  /**
   * Determine if this task should generate a briefing item.
   * Skip deleted tasks and tasks in "backlog" column (too noisy).
   */
  shouldGenerate(doc: TaskDocument, _docId: string): boolean {
    if (doc.deleted === true) return false
    if (doc.columnId === 'backlog') return false
    return true
  },

  /**
   * Extract priority based on task state.
   */
  extractPriority(doc: TaskDocument, _docId: string): BriefingPriority {
    // Blocked tasks are critical
    if (doc.agentStatus === 'blocked') {
      return 'critical'
    }

    // Awaiting-input tasks need attention
    if (doc.agentStatus === 'awaiting-input') {
      return 'needs-peet'
    }

    // Tasks with pending approval gate need attention
    if (doc.requiresApproval === true && (!doc.approvalStatus || doc.approvalStatus === 'pending')) {
      return 'needs-peet'
    }

    // Completed agent work pending review
    if (doc.agentStatus === 'done' && doc.reviewStatus === 'pending' && doc.columnId === 'review') {
      return 'review'
    }

    // Changes requested after review
    if (doc.reviewStatus === 'changes-requested') {
      return 'needs-peet'
    }

    // High-priority urgent tasks
    if (doc.priority === 'urgent') {
      return 'client-risk'
    }

    // In-progress agent work
    if (doc.agentStatus === 'in-progress' || doc.columnId === 'in_progress') {
      return 'progress'
    }

    // Pending agent work
    if (doc.agentStatus === 'pending' || doc.columnId === 'todo') {
      return 'progress'
    }

    // Done/approved tasks are FYI
    if (doc.agentStatus === 'done' || doc.columnId === 'done') {
      return 'fyi'
    }

    // Default to FYI
    return 'fyi'
  },

  /**
   * Extract actor information.
   */
  extractActor(doc: TaskDocument, _docId: string) {
    // If agent-assigned, the agent is the primary actor
    if (doc.assigneeAgentId) {
      const agentId = doc.assigneeAgentId
      const agentName = agentId.charAt(0).toUpperCase() + agentId.slice(1)
      return {
        id: `agent:${agentId}`,
        name: agentName,
        role: 'ai' as const,
        type: 'agent' as const,
      }
    }

    // Otherwise, use the creator/updater
    return normalizeActor(doc)
  },

  /**
   * Extract context metadata.
   */
  extractContext(doc: TaskDocument, _docId: string) {
    const orgId = extractOrgId(doc) ?? ''
    const projectId = extractProjectId(doc) ?? ''
    const taskId = _docId

    return {
      orgId,
      projectId,
      taskId,
      taskTitle: doc.title,
    }
  },

  /**
   * Extract title for the briefing card.
   */
  extractTitle(doc: TaskDocument, _docId: string): string {
    const agentId = doc.assigneeAgentId

    if (doc.agentStatus === 'blocked') {
      return `Blocked: ${doc.title}`
    }

    if (doc.agentStatus === 'awaiting-input') {
      return `Awaiting Input: ${doc.title}`
    }

    if (doc.requiresApproval === true && (!doc.approvalStatus || doc.approvalStatus === 'pending')) {
      return `Approval Pending: ${doc.title}`
    }

    if (doc.agentStatus === 'done' && doc.reviewStatus === 'pending') {
      return `Review Required: ${doc.title}`
    }

    if (doc.reviewStatus === 'changes-requested') {
      return `Changes Requested: ${doc.title}`
    }

    if (doc.agentStatus === 'in-progress') {
      return `In Progress: ${agentId ? `${agentId.charAt(0).toUpperCase() + agentId.slice(1)}: ` : ''}${doc.title}`
    }

    if (doc.agentStatus === 'done') {
      return `Completed: ${doc.title}`
    }

    return doc.title
  },

  /**
   * Extract summary for the briefing card.
   */
  extractSummary(doc: TaskDocument, _docId: string): string {
    const agentId = doc.assigneeAgentId
    const parts: string[] = []

    // Agent status
    if (agentId && doc.agentStatus) {
      parts.push(`${agentId.charAt(0).toUpperCase() + agentId.slice(1)} is ${doc.agentStatus.replace(/-/g, ' ')}`)
    }

    // Review status
    if (doc.reviewStatus && doc.reviewStatus !== 'pending') {
      parts.push(`Review: ${doc.reviewStatus.replace(/-/g, ' ')}`)
    }

    // Approval status
    if (doc.requiresApproval && doc.approvalStatus) {
      parts.push(`Approval: ${doc.approvalStatus}`)
    }

    // Blocked reason
    if (doc.blockedReason) {
      parts.push(`Reason: ${doc.blockedReason}`)
    }

    // Agent output summary
    if (doc.agentOutput?.summary) {
      parts.push(`Result: ${doc.agentOutput.summary.substring(0, 150)}${doc.agentOutput.summary.length > 150 ? '...' : ''}`)
    }

    // Task description
    if (doc.description) {
      parts.push(extractSafeExcerpt(doc.description, { maxLength: 100 }) ?? '')
    }

    return parts.join('. ') || 'No additional details.'
  },

  /**
   * Extract safe excerpt from the task.
   */
  extractExcerpt(doc: TaskDocument, _docId: string, maxLength = 300): string | null {
    // Prefer agent output summary, then description, then title
    const fields: (keyof TaskDocument)[] = ['agentOutput.summary', 'description', 'title']
    const excerpt = extractMultiFieldExcerpt(doc, fields as string[], { maxLength })
    return excerpt
  },

  /**
   * Extract timestamp when the event occurred.
   */
  extractOccurredAt(doc: TaskDocument, _docId: string): Date | null {
    // Prefer updatedAt, then createdAt, then current time
    const timestamp = normalizeTimestamp(doc.updatedAt) ?? normalizeTimestamp(doc.createdAt) ?? normalizeTimestamp(doc.completedAt)
    return timestamp
  },

  /**
   * Extract metadata specific to tasks.
   */
  extractMetadata(doc: TaskDocument, _docId: string): Record<string, unknown> | null {
    const softwareBuildEvidence = getSoftwareBuildEvidenceRows(doc)

    return {
      columnId: doc.columnId,
      agentStatus: doc.agentStatus,
      reviewStatus: doc.reviewStatus,
      approvalStatus: doc.approvalStatus,
      requiresApproval: doc.requiresApproval,
      priority: doc.priority,
      assigneeAgentId: doc.assigneeAgentId,
      assigneeId: doc.assigneeId,
      hasDependencies: Array.isArray(doc.dependsOn) && doc.dependsOn.length > 0,
      softwareBuildEvidence: softwareBuildEvidence.length ? softwareBuildEvidence : undefined,
    }
  },

  /**
   * Convert task document to briefing source item.
   */
  toItem(doc: TaskDocument, docId: string) {
    const orgId = extractOrgId(doc) ?? ''
    const projectId = extractProjectId(doc) ?? ''
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
        collectionPath: this.collectionPath.replace('{projectId}', projectId),
        url: generateSourceUrl(this.sourceType, docId, { projectId }),
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

/**
 * Project Firestore document shape.
 */
interface ProjectDocument extends Record<string, unknown> {
  id: string
  orgId: string
  name: string
  description?: string | null
  status?: string
  createdAt?: unknown
  updatedAt?: unknown
  createdBy?: string
  clientOrgId?: string | null
  clientId?: string | null
}

/**
 * Adapter for project briefing items (less frequent, usually FYI).
 */
export const projectAdapter: BriefingSourceAdapter<ProjectDocument> = {
  sourceType: 'project',
  collectionPath: 'projects',

  hashSource(doc: ProjectDocument, docId: string): string {
    return hashSourceDocument(doc, docId, ['orgId', 'name', 'status', 'updatedAt'])
  },

  shouldGenerate(doc: ProjectDocument, _docId: string): boolean {
    // Only generate for active projects
    return doc.status === 'active'
  },

  extractPriority(doc: ProjectDocument, _docId: string): BriefingPriority {
    // Projects are always FYI-level in briefing
    return 'fyi'
  },

  extractActor(doc: ProjectDocument, _docId: string) {
    return normalizeActor(doc)
  },

  extractContext(doc: ProjectDocument, _docId: string) {
    const orgId = extractOrgId(doc) ?? ''
    const projectId = _docId
    const clientOrgId = typeof doc.clientOrgId === 'string' ? doc.clientOrgId : null
    const clientId = typeof doc.clientId === 'string' ? doc.clientId : null

    return {
      orgId,
      projectId,
      projectName: doc.name,
      clientId: clientOrgId ?? clientId,
      clientName: null, // Would need a separate lookup
    }
  },

  extractTitle(doc: ProjectDocument, _docId: string): string {
    return `Project: ${doc.name}`
  },

  extractSummary(doc: ProjectDocument, _docId: string): string {
    const parts: string[] = []

    if (doc.status) {
      parts.push(`Status: ${doc.status}`)
    }

    if (doc.description) {
      parts.push(extractSafeExcerpt(doc.description, { maxLength: 150 }) ?? '')
    }

    return parts.join('. ') || 'No description available.'
  },

  extractExcerpt(doc: ProjectDocument, _docId: string, maxLength = 300): string | null {
    return extractSafeExcerpt(doc.description, { maxLength })
  },

  extractOccurredAt(doc: ProjectDocument, _docId: string): Date | null {
    return normalizeTimestamp(doc.updatedAt) ?? normalizeTimestamp(doc.createdAt)
  },

  extractMetadata(doc: ProjectDocument, _docId: string): Record<string, unknown> | null {
    return {
      status: doc.status,
      clientOrgId: doc.clientOrgId,
      clientId: doc.clientId,
    }
  },

  toItem(doc: ProjectDocument, docId: string) {
    const orgId = extractOrgId(doc) ?? ''
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
        collectionPath: this.collectionPath,
        url: generateSourceUrl(this.sourceType, docId),
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
