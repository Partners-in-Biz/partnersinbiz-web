/**
 * Source adapter for Projects/Kanban tasks.
 *
 * Generates briefing items for task lifecycle events (creation, assignment, completion).
 */

import type { BriefingSourceAdapter, BriefingPriority, BriefingActor, BriefingContext } from '../types'
import { normalizeActor, hashSourceDocument, extractMultiFieldExcerpt, normalizeTimestamp, extractOrgId, extractTaskId, generateSourceUrl } from '../utils'

interface TaskDocument extends Record<string, unknown> {
  id: string
  projectId: string
  orgId: string
  content: string
  status: string
  agentStatus?: string
  agentId?: string
  priority?: string
  assignedTo?: string
  parentTaskId?: string | null
  dependsOn?: string[]
  completedAt?: unknown
  dueAt?: unknown
  createdAt?: unknown
  updatedAt?: unknown
  createdBy?: string
  updatedBy?: string
  estimatedMinutes?: number | null
  actualMinutes?: number | null
  tags?: string[] | null
  sourceDocumentId?: string | null
  sourceSpecVersion?: string | null
  agentOutput?: unknown
  evidence?: unknown
  comments?: unknown
  briefings?: unknown
}

interface ProjectDocument extends Record<string, unknown> {
  id: string
  orgId: string
  name: string
  slug: string
  status: string
  createdAt?: unknown
  updatedAt?: unknown
  createdBy?: string
  updatedBy?: string
}

/**
 * Maps task priority to briefing priority.
 */
function mapTaskPriority(taskPriority?: string): BriefingPriority {
  switch (taskPriority?.toLowerCase()) {
    case 'urgent':
    case 'critical':
      return 'critical'
    case 'high':
      return 'needs-peet'
    case 'medium':
      return 'progress'
    case 'low':
      return 'fyi'
    default:
      return 'progress'
  }
}

/**
 * Maps task status to briefing priority.
 */
function mapTaskStatusPriority(taskStatus?: string): BriefingPriority {
  switch (taskStatus?.toLowerCase()) {
    case 'completed':
    case 'done':
      return 'review' // Completion is important but not urgent
    case 'in_progress':
    case 'active':
      return 'progress'
    case 'blocked':
    case 'cancelled':
      return 'needs-peet'
    case 'pending':
    case 'todo':
      return 'progress'
    default:
      return 'progress'
  }
}

/**
 * BriefingSourceAdapter implementation for Projects/Kanban tasks.
 */
export const kanbanAdapter: BriefingSourceAdapter<TaskDocument> = {
  sourceType: 'task',
  collectionPath: 'projects/{projectId}/tasks',

  /**
   * Generate deterministic hash for the task.
   */
  hashSource(doc: TaskDocument, docId: string): string {
    return hashSourceDocument(doc, docId, ['content', 'status', 'agentStatus', 'priority', 'updatedAt'])
  },

  /**
   * Determine if this task should generate a briefing item.
   */
  shouldGenerate(doc: TaskDocument, docId: string): boolean {
    // Skip archived/deleted tasks
    const status = doc.status?.toLowerCase()
    if (status === 'archived' || status === 'deleted') {
      return false
    }

    // Generate briefing for:
    // - Newly created tasks
    // - Status changes (moved between columns)
    // - Agent status changes (picked up, completed)
    // - Priority changes
    // - Assignment changes
    // - Completion
    return true
  },

  /**
   * Extract priority from the task.
   */
  extractPriority(doc: TaskDocument, docId: string): BriefingPriority {
    const taskPriority = mapTaskPriority(doc.priority)
    const statusPriority = mapTaskStatusPriority(doc.status)

    // Take the higher priority of task priority and status priority
    const priorityMap: Record<BriefingPriority, number> = {
      critical: 5,
      'needs-peet': 4,
      'client-risk': 3,
      review: 2,
      progress: 1,
      fyi: 0,
    }
    return priorityMap[taskPriority] > priorityMap[statusPriority]
      ? taskPriority
      : statusPriority
  },

  /**
   * Extract actor information from the task.
   */
  extractActor(doc: TaskDocument, docId: string): BriefingActor {
    const userId = doc.updatedBy || doc.createdBy || 'system'
    return normalizeActor({
      userId: typeof userId === 'string' ? userId : undefined,
      updatedBy: typeof doc.updatedBy === 'string' ? doc.updatedBy : undefined,
      createdBy: typeof doc.createdBy === 'string' ? doc.createdBy : undefined,
      assigneeAgentId: typeof doc.agentId === 'string' ? doc.agentId : undefined,
    })
  },

  /**
   * Extract context metadata from the task.
   */
  extractContext(doc: TaskDocument, docId: string) {
    return {
      orgId: extractOrgId(doc) ?? '',
      projectId: doc.projectId ?? '',
      taskId: doc.id,
      clientSlug: null,
      clientId: null,
    }
  },

  /**
   * Extract title from the task.
   */
  extractTitle(doc: TaskDocument, docId: string): string {
    const content = typeof doc.content === 'string' ? doc.content : 'Task'
    return content.slice(0, 100) + (content.length > 100 ? '...' : '')
  },

  /**
   * Extract summary from the task.
   */
  extractSummary(doc: TaskDocument, docId: string): string {
    const status = typeof doc.status === 'string' ? doc.status : 'unknown'
    const agentStatus = typeof doc.agentStatus === 'string' ? doc.agentStatus : ''
    const priority = typeof doc.priority === 'string' ? doc.priority : ''

    const parts: string[] = [`Status: ${status}`]
    if (agentStatus) parts.push(`Agent: ${agentStatus}`)
    if (priority) parts.push(`Priority: ${priority}`)

    return parts.join(' | ')
  },

  /**
   * Extract a safe excerpt from the task.
   */
  extractExcerpt(doc: TaskDocument, docId: string, maxLength = 280): string | null {
    return extractMultiFieldExcerpt(doc, ['content'], { maxLength })
  },

  /**
   * Extract the timestamp when the task event occurred.
   */
  extractOccurredAt(doc: TaskDocument, docId: string): Date | null {
    return normalizeTimestamp(doc.updatedAt || doc.createdAt)
  },

  /**
   * Extract additional metadata specific to tasks.
   */
  extractMetadata(doc: TaskDocument, docId: string): Record<string, unknown> | null {
    return {
      taskStatus: doc.status,
      agentStatus: doc.agentStatus,
      agentId: doc.agentId,
      taskPriority: doc.priority,
      assignedTo: doc.assignedTo,
      parentTaskId: doc.parentTaskId,
      dependencyCount: Array.isArray(doc.dependsOn) ? doc.dependsOn.length : 0,
      completedAt: normalizeTimestamp(doc.completedAt),
      dueAt: normalizeTimestamp(doc.dueAt),
      estimatedMinutes: doc.estimatedMinutes,
      actualMinutes: doc.actualMinutes,
      tags: Array.isArray(doc.tags) ? doc.tags : [],
      sourceDocumentId: doc.sourceDocumentId,
      sourceSpecVersion: doc.sourceSpecVersion,
      hasAgentOutput: !!doc.agentOutput,
      hasEvidence: !!doc.evidence,
      hasComments: !!doc.comments,
      hasBriefings: !!doc.briefings,
      sourceDocument: doc,
    }
  },

  /**
   * Convert the full task document to a briefing source item.
   */
  toItem(doc: TaskDocument, docId: string) {
    const priority = this.extractPriority(doc, docId)
    const actor = this.extractActor(doc, docId)
    const context = this.extractContext(doc, docId)
    const title = this.extractTitle(doc, docId)
    const summary = this.extractSummary(doc, docId)
    const excerpt = this.extractExcerpt(doc, docId)
    const occurredAt = this.extractOccurredAt(doc, docId) ?? new Date()
    const metadata = this.extractMetadata?.(doc, docId)
    const sourceHash = this.hashSource(doc, docId)

    // Determine URL based on context
    const url = context.projectId && context.taskId
      ? `https://partnersinbiz.online/admin/projects/${context.projectId}?taskId=${context.taskId}`
      : '/admin'

    return {
      sourceType: this.sourceType as const,
      sourceId: docId,
      sourceHash,
      context,
      actor,
      priority,
      title,
      summary,
      excerpt,
      occurredAt,
      url,
      metadata: metadata ?? {},
    }
  },
}