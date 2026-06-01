/**
 * Source adapter for client support tickets.
 *
 * Generates briefing items for open support requests so the control desk
 * can handle client support without switching inboxes.
 */

import type { BriefingPriority, BriefingSourceAdapter } from '../types'
import { extractMultiFieldExcerpt, hashSourceDocument, normalizeTimestamp, extractOrgId } from '../utils'

interface SupportTicketDocument extends Record<string, unknown> {
  orgId: string
  createdBy?: string | null
  requesterName?: string | null
  requesterEmail?: string | null
  category?: string | null
  subject?: string | null
  description?: string | null
  status?: string | null
  priority?: string | null
  sourceUrl?: string | null
  sourcePath?: string | null
  assignedToType?: string | null
  assigneeUserId?: string | null
  assigneeAgentId?: string | null
  hermesStatus?: string | null
  hermesSummary?: string | null
  messageCount?: number | null
  lastMessagePreview?: string | null
  lastMessageAt?: unknown
  createdAt?: unknown
  updatedAt?: unknown
  resolvedAt?: unknown
  deleted?: boolean
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export const supportTicketAdapter: BriefingSourceAdapter<SupportTicketDocument> = {
  sourceType: 'support-ticket',
  collectionPath: 'support_tickets',

  hashSource(doc: SupportTicketDocument, docId: string): string {
    return hashSourceDocument(doc, docId, ['subject', 'description', 'status', 'priority', 'lastMessagePreview', 'updatedAt'])
  },

  shouldGenerate(doc: SupportTicketDocument): boolean {
    if (doc.deleted === true) return false
    if (doc.status === 'resolved') return false
    return Boolean(clean(doc.subject) || clean(doc.description) || clean(doc.lastMessagePreview))
  },

  extractPriority(doc: SupportTicketDocument): BriefingPriority {
    if (doc.priority === 'urgent' || doc.category === 'urgent') return 'critical'
    if (doc.priority === 'high' || doc.status === 'waiting_on_us' || doc.status === 'new') return 'needs-peet'
    if (doc.status === 'waiting_on_client') return 'progress'
    return 'fyi'
  },

  extractActor(doc: SupportTicketDocument) {
    return {
      id: clean(doc.createdBy) ? `user:${clean(doc.createdBy)}` : 'client',
      name: clean(doc.requesterName) ?? clean(doc.requesterEmail) ?? 'Client',
      role: 'client' as const,
      type: 'user' as const,
    }
  },

  extractContext(doc: SupportTicketDocument, docId: string) {
    const orgId = extractOrgId(doc) ?? ''
    return {
      orgId,
      supportTicketId: docId,
      supportTicketSubject: clean(doc.subject) ?? 'Support request',
    }
  },

  extractTitle(doc: SupportTicketDocument): string {
    const subject = clean(doc.subject) ?? 'Support request'
    if (doc.priority === 'urgent' || doc.category === 'urgent') return `Urgent support: ${subject}`
    if (doc.status === 'waiting_on_us' || doc.status === 'new') return `Support needs reply: ${subject}`
    if (doc.status === 'waiting_on_client') return `Support waiting on client: ${subject}`
    return `Support ticket: ${subject}`
  },

  extractSummary(doc: SupportTicketDocument): string {
    const parts: string[] = []
    const preview = extractMultiFieldExcerpt(doc, ['lastMessagePreview', 'description', 'hermesSummary'], { maxLength: 180 })
    if (preview) parts.push(preview)
    if (doc.status) parts.push(`Status: ${doc.status}`)
    if (doc.priority) parts.push(`Priority: ${doc.priority}`)
    if (doc.messageCount) parts.push(`${doc.messageCount} message${doc.messageCount === 1 ? '' : 's'}`)
    return parts.join('. ') || 'Support ticket needs attention.'
  },

  extractExcerpt(doc: SupportTicketDocument, _docId: string, maxLength = 300): string | null {
    return extractMultiFieldExcerpt(doc, ['lastMessagePreview', 'description', 'hermesSummary'], { maxLength })
  },

  extractOccurredAt(doc: SupportTicketDocument): Date | null {
    return normalizeTimestamp(doc.lastMessageAt) ?? normalizeTimestamp(doc.updatedAt) ?? normalizeTimestamp(doc.createdAt)
  },

  extractMetadata(doc: SupportTicketDocument): Record<string, unknown> | null {
    return {
      supportStatus: doc.status,
      supportPriority: doc.priority,
      category: doc.category,
      sourceUrl: doc.sourceUrl,
      sourcePath: doc.sourcePath,
      assignedToType: doc.assignedToType,
      assigneeUserId: doc.assigneeUserId,
      assigneeAgentId: doc.assigneeAgentId,
      hermesStatus: doc.hermesStatus,
      messageCount: doc.messageCount,
    }
  },

  toItem(doc: SupportTicketDocument, docId: string) {
    const orgId = extractOrgId(doc) ?? ''
    const priority = this.extractPriority(doc, docId)
    const actor = this.extractActor(doc, docId)
    const context = this.extractContext(doc, docId)
    const title = this.extractTitle(doc, docId)
    const summary = this.extractSummary(doc, docId)
    const excerpt = this.extractExcerpt(doc, docId)
    const occurredAt = this.extractOccurredAt(doc, docId) ?? new Date()
    const sourceHash = this.hashSource(doc, docId)
    const metadata = this.extractMetadata?.(doc, docId)

    return {
      orgId,
      source: {
        type: this.sourceType,
        id: docId,
        collectionPath: this.collectionPath,
        url: `/admin/support?ticket=${encodeURIComponent(docId)}`,
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
