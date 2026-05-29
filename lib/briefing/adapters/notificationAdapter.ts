/**
 * Source adapter for notifications and activity.
 *
 * Generates briefing items for:
 * - User notifications
 * - Activity log entries
 * - System events
 */

import type { BriefingSourceAdapter, BriefingPriority } from '../types'
import { normalizeActor, hashSourceDocument, extractMultiFieldExcerpt, normalizeTimestamp, extractOrgId, generateSourceUrl } from '../utils'

/**
 * Notification document shape.
 */
interface NotificationDocument {
  id: string
  orgId: string
  userId: string
  agentId?: string | null
  type: string
  title: string
  body?: string | null
  link?: string | null
  data?: Record<string, unknown> | null
  status: 'unread' | 'read'
  priority?: string
  snoozedUntil?: unknown
  readAt?: unknown
  createdAt?: unknown
}

/**
 * Activity log document shape.
 */
interface ActivityDocument {
  id: string
  orgId: string
  actorId: string
  actorName?: string | null
  actorRole?: 'admin' | 'client' | 'ai' | 'system'
  type: string
  description: string
  entityId?: string | null
  entityType?: string | null
  entityTitle?: string | null
  createdAt?: unknown
  projectId?: string | null
}

/**
 * Adapter for notification briefing items.
 */
export const notificationAdapter: BriefingSourceAdapter<NotificationDocument> = {
  sourceType: 'notification',
  collectionPath: 'notifications',

  hashSource(doc: NotificationDocument, docId: string): string {
    return hashSourceDocument(doc, docId, ['type', 'title', 'body', 'status', 'createdAt'])
  },

  shouldGenerate(doc: NotificationDocument, _docId: string): boolean {
    // Skip snoozed notifications
    if (doc.snoozedUntil) {
      const snoozedUntil = normalizeTimestamp(doc.snoozedUntil)
      if (snoozedUntil && snoozedUntil > new Date()) {
        return false
      }
    }

    // Skip low-priority notifications
    if (doc.priority === 'low') {
      return false
    }

    return true
  },

  extractPriority(doc: NotificationDocument, _docId: string): BriefingPriority {
    const type = doc.type.toLowerCase()

    // Critical notification types
    if (type.includes('error') || type.includes('incident') || type.includes('alert') || doc.priority === 'urgent') {
      return 'critical'
    }

    // Agent task done notifications are review-level
    if (type.includes('task.agent_done') || type.includes('agent_done')) {
      return 'review'
    }

    // Client-facing notifications
    if (type.includes('client') || doc.priority === 'high') {
      return 'client-risk'
    }

    // Assignment notifications
    if (type.includes('task.assigned')) {
      return 'progress'
    }

    // Read notifications are FYI
    if (doc.status === 'read') {
      return 'fyi'
    }

    // Default unread notifications are FYI
    return 'fyi'
  },

  extractActor(doc: NotificationDocument, _docId: string) {
    // Use agent if specified
    if (doc.agentId) {
      const agentId = doc.agentId
      const agentName = agentId.charAt(0).toUpperCase() + agentId.slice(1)
      return {
        id: `agent:${agentId}`,
        name: agentName,
        role: 'ai' as const,
        type: 'agent' as const,
      }
    }

    // Otherwise it's a system notification
    return {
      id: 'system',
      name: 'System',
      role: 'system' as const,
      type: 'system' as const,
    }
  },

  extractContext(doc: NotificationDocument, _docId: string) {
    const orgId = extractOrgId(doc) ?? ''

    // Extract context from data if available
    const data = doc.data ?? {}
    const projectId = typeof data.projectId === 'string' ? data.projectId : null
    const taskId = typeof data.taskId === 'string' ? data.taskId : null

    return {
      orgId,
      projectId,
      taskId,
      userId: doc.userId,
    }
  },

  extractTitle(doc: NotificationDocument, _docId: string): string {
    return doc.title
  },

  extractSummary(doc: NotificationDocument, _docId: string): string {
    const parts: string[] = []

    parts.push(`Type: ${doc.type}`)

    if (doc.body) {
      const excerpt = extractMultiFieldExcerpt(doc, ['body'], { maxLength: 150 })
      if (excerpt) parts.push(excerpt)
    }

    if (doc.link) {
      parts.push(`View: ${doc.link}`)
    }

    return parts.join('. ') || 'No details.'
  },

  extractExcerpt(doc: NotificationDocument, _docId: string, maxLength = 300): string | null {
    return extractMultiFieldExcerpt(doc, ['body'], { maxLength })
  },

  extractOccurredAt(doc: NotificationDocument, _docId: string): Date | null {
    return normalizeTimestamp(doc.createdAt)
  },

  extractMetadata(doc: NotificationDocument, _docId: string): Record<string, unknown> | null {
    return {
      notificationType: doc.type,
      userId: doc.userId,
      agentId: doc.agentId,
      priority: doc.priority,
      status: doc.status,
      link: doc.link,
      hasData: doc.data !== null,
    }
  },

  toItem(doc: NotificationDocument, docId: string) {
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
        url: doc.link || '/admin/inbox',
      },
      priority,
      status: doc.status === 'unread' ? 'new' : 'acknowledged',
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
 * Adapter for activity log briefing items.
 */
export const activityAdapter: BriefingSourceAdapter<ActivityDocument> = {
  sourceType: 'activity',
  collectionPath: 'activity',

  hashSource(doc: ActivityDocument, docId: string): string {
    return hashSourceDocument(doc, docId, ['type', 'description', 'actorId', 'createdAt'])
  },

  shouldGenerate(doc: ActivityDocument, _docId: string): boolean {
    // Skip system/agent activity unless it's critical
    if (doc.actorRole === 'system' || doc.actorRole === 'ai') {
      const type = doc.type.toLowerCase()
      // Keep critical system activities
      if (!type.includes('error') && !type.includes('incident') && !type.includes('critical')) {
        return false
      }
    }

    // Skip generic activity logs (too noisy)
    if (doc.type === 'page_view' || doc.type === 'login' || doc.type === 'logout') {
      return false
    }

    return true
  },

  extractPriority(doc: ActivityDocument, _docId: string): BriefingPriority {
    const type = doc.type.toLowerCase()

    // Critical activity types
    if (type.includes('deleted') || type.includes('error') || type.includes('incident') || type.includes('critical')) {
      return 'critical'
    }

    // Risk activity types
    if (type.includes('failed') || type.includes('rejected') || type.includes('blocked')) {
      return 'client-risk'
    }

    // Client activity
    if (doc.actorRole === 'client') {
      return 'needs-peet'
    }

    // Admin activity
    if (doc.actorRole === 'admin') {
      return 'fyi'
    }

    // Default
    return 'fyi'
  },

  extractActor(doc: ActivityDocument, _docId: string) {
    const actorId = typeof doc.actorId === 'string' ? doc.actorId : 'system'
    const actorName = typeof doc.actorName === 'string' ? doc.actorName : null
    const actorRole = (doc.actorRole === 'admin' || doc.actorRole === 'client' || doc.actorRole === 'ai' || doc.actorRole === 'system') ? doc.actorRole : 'system'

    // Determine actor type
    let actorType: 'user' | 'agent' | 'system' = 'user'
    if (actorId.startsWith('agent:')) {
      actorType = 'agent'
    } else if (actorRole === 'system') {
      actorType = 'system'
    }

    return {
      id: actorId,
      name: actorName,
      role: actorRole,
      type: actorType,
    }
  },

  extractContext(doc: ActivityDocument, _docId: string) {
    const orgId = extractOrgId(doc) ?? ''
    const projectId = typeof doc.projectId === 'string' ? doc.projectId : null
    const entityId = typeof doc.entityId === 'string' ? doc.entityId : null
    const entityType = typeof doc.entityType === 'string' ? doc.entityType : null

    return {
      orgId,
      projectId,
      taskId: entityType === 'task' ? entityId : null,
      documentId: entityType === 'document' ? entityId : null,
      entityId,
      entityType,
      entityTitle: doc.entityTitle,
    }
  },

  extractTitle(doc: ActivityDocument, _docId: string): string {
    const actor = this.extractActor(doc, _docId)
    const actorName = actor.name || actor.id

    return `${actorName}: ${doc.description}`
  },

  extractSummary(doc: ActivityDocument, _docId: string): string {
    const parts: string[] = []

    parts.push(`Activity: ${doc.type}`)

    if (doc.entityType) {
      parts.push(`Entity: ${doc.entityType}`)
    }

    if (doc.entityTitle) {
      parts.push(doc.entityTitle)
    }

    return parts.join(' — ') || 'No details.'
  },

  extractExcerpt(_doc: ActivityDocument, _docId: string, _maxLength = 300): string | null {
    // Activity logs don't typically have long content
    return null
  },

  extractOccurredAt(doc: ActivityDocument, _docId: string): Date | null {
    return normalizeTimestamp(doc.createdAt)
  },

  extractMetadata(doc: ActivityDocument, _docId: string): Record<string, unknown> | null {
    return {
      activityType: doc.type,
      actorRole: doc.actorRole,
      entityType: doc.entityType,
      entityId: doc.entityId,
      entityTitle: doc.entityTitle,
    }
  },

  toItem(doc: ActivityDocument, docId: string) {
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
        url: '/admin/activity',
      },
      priority,
      status: 'acknowledged',
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