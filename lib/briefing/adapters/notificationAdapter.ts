/**
 * Source adapter for notifications and activity.
 *
 * Generates briefing items for:
 * - User notifications
 * - Activity log entries
 * - System events
 */

import type { BriefingSourceAdapter, BriefingPriority } from '../types'
import { hashSourceDocument, extractMultiFieldExcerpt, normalizeTimestamp, extractOrgId } from '../utils'

/**
 * Notification document shape.
 */
interface NotificationDocument extends Record<string, unknown> {
  id: string
  orgId: string
  userId: string
  agentId?: string | null
  type: string
  title: string
  body?: string | null
  link?: string | null
  data?: Record<string, unknown> | null
  status: 'unread' | 'read' | 'archived' | 'snoozed'
  priority?: string
  snoozedUntil?: unknown
  readAt?: unknown
  createdAt?: unknown
}

/**
 * Activity log document shape.
 */
interface ActivityDocument extends Record<string, unknown> {
  id: string
  orgId: string
  actorId?: string | null
  actorName?: string | null
  actorRole?: 'admin' | 'client' | 'ai' | 'system'
  type: string
  description?: string | null
  summary?: string | null
  entityId?: string | null
  entityType?: string | null
  entityTitle?: string | null
  contactId?: string | null
  contactName?: string | null
  dealId?: string | null
  dealTitle?: string | null
  metadata?: Record<string, unknown> | null
  createdBy?: string | null
  createdByRef?: {
    uid?: string | null
    displayName?: string | null
    name?: string | null
    email?: string | null
    role?: 'admin' | 'client' | 'ai' | 'system' | string | null
  } | null
  createdAt?: unknown
  occurredAt?: unknown
  projectId?: string | null
}

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function looksLikeOpaqueId(value: string | null | undefined): boolean {
  if (!value) return false
  return /^[A-Za-z0-9_-]{16,}$/.test(value.trim()) || /^[a-z]+_[A-Za-z0-9_-]{8,}$/i.test(value.trim())
}

function cleanHumanName(value: unknown): string | null {
  const text = cleanString(value)
  if (!text || looksLikeOpaqueId(text)) return null
  return text
}

function activityText(doc: ActivityDocument): string {
  return cleanString(doc.summary) ?? cleanString(doc.description) ?? cleanString(doc.metadata?.nextAction) ?? cleanString(doc.metadata?.note) ?? 'Activity logged'
}

function activityFollowUpIntent(doc: ActivityDocument): string | null {
  const metadataIntent = cleanString(doc.metadata?.intent) ?? cleanString(doc.metadata?.followUpIntent)
  const text = `${doc.type} ${doc.summary ?? ''} ${doc.description ?? ''} ${metadataIntent ?? ''}`.toLowerCase()
  if (text.includes('follow')) return metadataIntent ?? 'follow_up'
  if (text.includes('next action') || text.includes('next_action')) return metadataIntent ?? 'next_action'
  return null
}

function isAgentNeedsInputNotification(doc: NotificationDocument): boolean {
  const type = doc.type.toLowerCase()
  const haystack = `${doc.title} ${doc.body ?? ''} ${cleanString(doc.data?.blockerReason) ?? ''}`.toLowerCase()
  return type.includes('agent_needs_input')
    || type.includes('agent_blocked')
    || type.includes('awaiting_input')
    || haystack.includes('needs peet')
    || haystack.includes('exact blocker')
}

function notificationBlockerReason(doc: NotificationDocument): string | null {
  return cleanString(doc.data?.blockerReason)
    ?? cleanString(doc.data?.blockingReason)
    ?? cleanString(doc.data?.reason)
    ?? cleanString(doc.body)
}

function safeContinuePath(doc: NotificationDocument): string | null {
  return cleanString(doc.data?.safeContinuePath)
    ?? cleanString(doc.data?.continuePath)
    ?? 'Open the linked task, add the missing approval/input evidence, then use the task drawer continue/unblock action.'
}

function actorRoleFromActivity(doc: ActivityDocument): 'admin' | 'client' | 'ai' | 'system' {
  if (doc.actorRole === 'admin' || doc.actorRole === 'client' || doc.actorRole === 'ai' || doc.actorRole === 'system') return doc.actorRole
  const refRole = doc.createdByRef?.role
  if (refRole === 'admin' || refRole === 'client' || refRole === 'ai' || refRole === 'system') return refRole
  return 'system'
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

  shouldGenerate(doc: NotificationDocument): boolean {
    // Skip snoozed notifications
    if (doc.status === 'archived') {
      return false
    }

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

  extractPriority(doc: NotificationDocument): BriefingPriority {
    const type = doc.type.toLowerCase()

    if (isAgentNeedsInputNotification(doc)) {
      return 'needs-peet'
    }

    // Agent task done notifications are review-level even when the original task was urgent.
    if (type.includes('task.agent_done') || type.includes('agent_done')) {
      return 'review'
    }

    // Completed client-document acceptance/approval is evidence, not a fresh risk or approval gate.
    // The document workflow has already recorded the client-visible decision, so keep it out of
    // action lanes unless another source creates an explicit follow-up task.
    if (type === 'client_document.approved' || type === 'client_document.accepted') {
      return 'fyi'
    }

    // Read notifications are FYI; a read client notification should not keep Risk/Action badges alive.
    if (doc.status === 'read') {
      return 'fyi'
    }

    // Critical notification types
    if (type.includes('error') || type.includes('incident') || type.includes('alert') || doc.priority === 'urgent') {
      return 'critical'
    }

    // Client-facing notifications
    if (type.includes('client') || doc.priority === 'high') {
      return 'client-risk'
    }

    // Assignment notifications
    if (type.includes('task.assigned')) {
      return 'progress'
    }

    // Default unread notifications are FYI
    return 'fyi'
  },

  extractActor(doc: NotificationDocument) {
    const actorName = cleanHumanName(doc.data?.actorName)
    if (actorName) {
      return {
        id: 'user',
        name: actorName,
        role: 'client' as const,
        type: 'user' as const,
      }
    }

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

  extractContext(doc: NotificationDocument) {
    const orgId = extractOrgId(doc) ?? ''

    // Extract context from data if available
    const data = doc.data ?? {}
    const projectId = typeof data.projectId === 'string' ? data.projectId : null
    const projectName = typeof data.projectName === 'string' ? data.projectName : null
    const taskId = typeof data.taskId === 'string' ? data.taskId : null
    const taskTitle = typeof data.taskTitle === 'string' ? data.taskTitle : null
    const documentId = typeof data.documentId === 'string' ? data.documentId : null
    const documentTitle = typeof data.documentTitle === 'string' ? data.documentTitle : null
    const quoteId = typeof data.quoteId === 'string' ? data.quoteId : null
    const quoteNumber = typeof data.quoteNumber === 'string' ? data.quoteNumber : null
    const companyName = typeof data.companyName === 'string' ? data.companyName : null

    return {
      orgId,
      projectId,
      projectName,
      taskId,
      taskTitle,
      documentId,
      documentTitle,
      quoteId,
      quoteNumber,
      companyName,
      userId: doc.userId,
    }
  },

  extractTitle(doc: NotificationDocument): string {
    if (isAgentNeedsInputNotification(doc)) {
      return doc.title.startsWith('Needs Peet:') ? doc.title : `Needs Peet: ${doc.title}`
    }
    return doc.title
  },

  extractSummary(doc: NotificationDocument): string {
    const type = doc.type.toLowerCase()
    const documentTitle = cleanString(doc.data?.documentTitle)
    const actorName = cleanHumanName(doc.data?.actorName)
    const quoteNumber = cleanString(doc.data?.quoteNumber)
    const companyName = cleanString(doc.data?.companyName)

    if ((type === 'client_document.approved' || type === 'client_document.accepted') && documentTitle) {
      const action = type === 'client_document.accepted' ? 'accepted' : 'approved'
      return actorName ? `${actorName} ${action} ${documentTitle}.` : `${documentTitle} was ${action}.`
    }

    if (type === 'quote.accepted' && quoteNumber) {
      return companyName ? `Quote ${quoteNumber} for ${companyName} was accepted.` : `Quote ${quoteNumber} was accepted.`
    }

    const parts: string[] = []

    parts.push(`Type: ${doc.type}`)

    if (doc.body) {
      const excerpt = extractMultiFieldExcerpt(doc, ['body'], { maxLength: 150 })
      if (excerpt) parts.push(excerpt)
    }

    return parts.join('. ') || 'No details.'
  },

  extractExcerpt(doc: NotificationDocument, docIdOrMaxLength: string | number = 300, maxLength = 300): string | null {
    const limit = typeof docIdOrMaxLength === 'number' ? docIdOrMaxLength : maxLength
    return extractMultiFieldExcerpt(doc, ['body'], { maxLength: limit })
  },

  extractOccurredAt(doc: NotificationDocument): Date | null {
    return normalizeTimestamp(doc.createdAt)
  },

  extractMetadata(doc: NotificationDocument): Record<string, unknown> | null {
    return {
      notificationType: doc.type,
      userId: doc.userId,
      agentId: doc.agentId,
      priority: doc.priority,
      status: doc.status,
      link: doc.link,
      hasData: doc.data !== null,
      ...(isAgentNeedsInputNotification(doc)
        ? {
            blockerReason: notificationBlockerReason(doc),
            safeContinuePath: safeContinuePath(doc),
          }
        : {}),
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
    return hashSourceDocument(doc, docId, ['type', 'summary', 'description', 'actorId', 'contactId', 'dealId', 'createdAt', 'occurredAt'])
  },

  shouldGenerate(doc: ActivityDocument): boolean {
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

  extractPriority(doc: ActivityDocument): BriefingPriority {
    const type = doc.type.toLowerCase()
    const followUpIntent = activityFollowUpIntent(doc)

    // Critical activity types
    if (type.includes('deleted') || type.includes('error') || type.includes('incident') || type.includes('critical')) {
      return 'critical'
    }

    // Risk activity types
    if (type.includes('failed') || type.includes('rejected') || type.includes('blocked')) {
      return 'client-risk'
    }

    if (followUpIntent) {
      return 'needs-peet'
    }

    // Client activity
    if (actorRoleFromActivity(doc) === 'client') {
      return 'needs-peet'
    }

    // Admin activity
    if (actorRoleFromActivity(doc) === 'admin') {
      return 'fyi'
    }

    // Default
    return 'fyi'
  },

  extractActor(doc: ActivityDocument) {
    const actorRole = actorRoleFromActivity(doc)
    const rawActorId = cleanString(doc.actorId) ?? cleanString(doc.createdByRef?.uid) ?? cleanString(doc.createdBy) ?? (actorRole === 'system' ? 'system' : 'unknown')
    const actorId = rawActorId === 'system' || rawActorId.startsWith('agent:') || rawActorId.startsWith('user:') ? rawActorId : `user:${rawActorId}`
    const actorName = cleanString(doc.actorName) ?? cleanString(doc.createdByRef?.displayName) ?? cleanString(doc.createdByRef?.name) ?? cleanString(doc.createdByRef?.email) ?? cleanString(doc.contactName)

    // Determine actor type
    let actorType: 'user' | 'agent' | 'system' = 'user'
    if (actorId.startsWith('agent:')) {
      actorType = 'agent'
    } else if (actorRole === 'system' && actorId === 'system') {
      actorType = 'system'
    }

    return {
      id: actorId,
      name: actorName,
      role: actorRole,
      type: actorType,
    }
  },

  extractContext(doc: ActivityDocument) {
    const orgId = extractOrgId(doc) ?? ''
    const projectId = typeof doc.projectId === 'string' ? doc.projectId : null
    const entityId = typeof doc.entityId === 'string' ? doc.entityId : null
    const entityType = typeof doc.entityType === 'string' ? doc.entityType : null
    const contactId = cleanString(doc.contactId)
    const dealId = cleanString(doc.dealId)

    return {
      orgId,
      projectId,
      taskId: entityType === 'task' ? entityId : null,
      documentId: entityType === 'document' ? entityId : null,
      contactId,
      contactName: cleanString(doc.contactName),
      dealId,
      dealTitle: cleanString(doc.dealTitle),
      entityId,
      entityType,
      entityTitle: doc.entityTitle,
    }
  },

  extractTitle(doc: ActivityDocument, docId: string): string {
    const actor = this.extractActor(doc, docId)
    const actorName = cleanString(doc.contactName) ?? actor.name ?? actor.id
    const followUpIntent = activityFollowUpIntent(doc)

    if (followUpIntent) {
      return `Follow up with ${actorName}`
    }

    return `${actorName}: ${activityText(doc)}`
  },

  extractSummary(doc: ActivityDocument): string {
    const parts: string[] = []

    parts.push(`Activity: ${doc.type}`)

    const text = activityText(doc)
    if (text) {
      parts.push(text)
    }

    const nextAction = cleanString(doc.metadata?.nextAction)
    if (nextAction) {
      parts.push(`Next action: ${nextAction}`)
    }

    if (doc.entityType) {
      parts.push(`Entity: ${doc.entityType}`)
    }

    if (doc.entityTitle) {
      parts.push(doc.entityTitle)
    }

    return parts.join(' — ') || 'No details.'
  },

  extractExcerpt(doc: ActivityDocument, docIdOrMaxLength: string | number = 300, maxLength = 300): string | null {
    const limit = typeof docIdOrMaxLength === 'number' ? docIdOrMaxLength : maxLength
    return extractMultiFieldExcerpt(doc, ['summary', 'description'], { maxLength: limit })
  },

  extractOccurredAt(doc: ActivityDocument): Date | null {
    return normalizeTimestamp(doc.occurredAt) ?? normalizeTimestamp(doc.createdAt)
  },

  extractMetadata(doc: ActivityDocument): Record<string, unknown> | null {
    const followUpIntent = activityFollowUpIntent(doc)
    return {
      activityType: doc.type,
      actorRole: actorRoleFromActivity(doc),
      entityType: doc.entityType,
      entityId: doc.entityId,
      entityTitle: doc.entityTitle,
      contactId: cleanString(doc.contactId),
      contactName: cleanString(doc.contactName),
      dealId: cleanString(doc.dealId),
      dealTitle: cleanString(doc.dealTitle),
      followUpIntent,
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
    const contactId = cleanString(doc.contactId)
    const dealId = cleanString(doc.dealId)
    const sourceUrl = contactId
      ? `/portal/contacts/${encodeURIComponent(contactId)}`
      : dealId ? `/portal/deals/${encodeURIComponent(dealId)}` : '/portal/crm'

    return {
      orgId,
      source: {
        type: this.sourceType,
        id: docId,
        collectionPath: this.collectionPath,
        url: sourceUrl,
      },
      priority,
      status: priority === 'fyi' ? 'acknowledged' : 'new',
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
