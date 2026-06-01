/**
 * Source adapter for comments.
 *
 * Generates briefing items for:
 * - User comments on tasks, documents, conversations
 * - Agent comments from review/work
 */

import type { BriefingSourceAdapter, BriefingPriority } from '../types'
import { hashSourceDocument, extractMultiFieldExcerpt, normalizeTimestamp, extractOrgId } from '../utils'

/**
 * Comment Firestore document shape.
 */
interface CommentDocument extends Record<string, unknown> {
  id: string
  text: string
  userId: string
  userName?: string | null
  userRole?: 'admin' | 'client' | 'ai' | 'system'
  createdAt?: unknown
  updatedAt?: unknown
  agentPickedUp?: boolean
  agentPickedUpAt?: unknown
  // Context fields (depends on parent collection)
  orgId?: string
  projectId?: string
  taskId?: string
  documentId?: string
  conversationId?: string
  type?: string
}

/**
 * Adapter for comment briefing items.
 */
export const commentAdapter: BriefingSourceAdapter<CommentDocument> = {
  sourceType: 'comment',
  collectionPath: '{parentCollection}/{parentId}/comments',

  /**
   * Generate deterministic hash for the comment.
   * Uses text, userId, createdAt.
   */
  hashSource(doc: CommentDocument, docId: string): string {
    return hashSourceDocument(doc, docId, ['text', 'userId', 'userName', 'userRole', 'createdAt'])
  },

  /**
   * Determine if this comment should generate a briefing item.
   * Skip system-generated comments and comments already picked up by agents.
   */
  shouldGenerate(doc: CommentDocument): boolean {
    // Skip if already picked up by an agent
    if (doc.agentPickedUp === true) return false

    // Skip very short comments (likely noise)
    if (doc.text.trim().length < 5) return false

    // Skip system role comments (unless from agents)
    if (doc.userRole === 'system' && !doc.userId.startsWith('agent:')) {
      return false
    }

    return true
  },

  /**
   * Extract priority based on comment content and context.
   */
  extractPriority(doc: CommentDocument): BriefingPriority {
    const text = doc.text.toLowerCase()
    const hasResolvedSignal = /\b(unblocked|unblock(ed|s|ing)? by|resolved|clears? the|closed|moved to done|marked done)\b/.test(text)
    const hasStillBlockedSignal = /\b(still|remains?|not|cannot|can't|isn't|is not|fully)\s+\w{0,24}\s*blocked\b/.test(text) || /\bblocked\b/.test(text)
    const hasBlockerSignal = /\b(blocker|blocked)\b/.test(text) && (!hasResolvedSignal || hasStillBlockedSignal)

    // Agent resolution comments should not keep completed work in the blocked lane.
    if (doc.userId.startsWith('agent:') && hasResolvedSignal && !hasStillBlockedSignal) {
      return 'progress'
    }

    // Urgent keywords
    if (text.includes('urgent') || text.includes('emergency') || text.includes('critical') || hasBlockerSignal) {
      return 'critical'
    }

    // Request keywords
    if (text.includes('review please') || text.includes('please review') || text.includes('needs review')) {
      return 'review'
    }

    // Blocked/error keywords
    if (hasBlockerSignal || text.includes('error') || text.includes('failed') || text.includes('broken')) {
      return 'critical'
    }

    // Agent comments are progress updates
    if (doc.userId.startsWith('agent:')) {
      return 'progress'
    }

    // Client comments might need attention
    if (doc.userRole === 'client') {
      return 'needs-peet'
    }

    // Default to FYI
    return 'fyi'
  },

  /**
   * Extract actor information.
   */
  extractActor(doc: CommentDocument, docId: string) {
    void docId
    const userId = typeof doc.userId === 'string' ? doc.userId : 'unknown'
    const userName = typeof doc.userName === 'string' ? doc.userName : null
    const userRole = (doc.userRole === 'admin' || doc.userRole === 'client' || doc.userRole === 'ai' || doc.userRole === 'system') ? doc.userRole : 'admin'

    // Determine actor type
    let actorType: 'user' | 'agent' | 'system' = 'user'
    if (userId.startsWith('agent:')) {
      actorType = 'agent'
    } else if (userRole === 'system') {
      actorType = 'system'
    }

    return {
      id: userId,
      name: userName,
      role: userRole,
      type: actorType,
    }
  },

  /**
   * Extract context metadata.
   */
  extractContext(doc: CommentDocument) {
    const orgId = extractOrgId(doc) ?? ''
    const projectId = typeof doc.projectId === 'string' ? doc.projectId : null
    const taskId = typeof doc.taskId === 'string' ? doc.taskId : null
    const documentId = typeof doc.documentId === 'string' ? doc.documentId : null
    const conversationId = typeof doc.conversationId === 'string' ? doc.conversationId : null

    return {
      orgId,
      projectId,
      taskId,
      documentId,
      conversationId,
    }
  },

  /**
   * Extract title for the briefing card.
   */
  extractTitle(doc: CommentDocument, docId: string): string {
    const actor = this.extractActor(doc, docId)
    const actorName = actor.name || actor.id
    const actorType = actor.type

    if (actorType === 'agent') {
      return `${actorName} commented`
    }

    if (actor.role === 'client') {
      return `Client comment from ${actorName}`
    }

    if (actor.role === 'admin') {
      return `Comment from ${actorName}`
    }

    return 'New comment'
  },

  /**
   * Extract summary for the briefing card.
   */
  extractSummary(doc: CommentDocument): string {
    // Use the comment text itself as summary, truncated
    return extractMultiFieldExcerpt(doc, ['text'], { maxLength: 200 }) ?? 'No comment text.'
  },

  /**
   * Extract safe excerpt from the comment.
   */
  extractExcerpt(doc: CommentDocument, docId: string, maxLength = 300): string | null {
    void docId
    return extractMultiFieldExcerpt(doc, ['text'], { maxLength })
  },

  /**
   * Extract timestamp when the comment was created.
   */
  extractOccurredAt(doc: CommentDocument): Date | null {
    return normalizeTimestamp(doc.createdAt) ?? normalizeTimestamp(doc.updatedAt)
  },

  /**
   * Extract metadata specific to comments.
   */
  extractMetadata(doc: CommentDocument): Record<string, unknown> | null {
    return {
      commentType: doc.type,
      agentPickedUp: doc.agentPickedUp,
      userRole: doc.userRole,
      parentType: doc.taskId ? 'task' : doc.documentId ? 'document' : doc.conversationId ? 'conversation' : 'unknown',
    }
  },

  /**
   * Convert comment document to briefing source item.
   */
  toItem(doc: CommentDocument, docId: string) {
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

    // Determine URL based on context
    let url = '/admin'
    let collectionPath = this.collectionPath

    if (context.taskId && context.projectId) {
      url = `https://partnersinbiz.online/admin/projects/${context.projectId}?taskId=${context.taskId}`
      collectionPath = `projects/${context.projectId}/tasks/${context.taskId}/comments`
    } else if (context.documentId) {
      url = `https://partnersinbiz.online/admin/documents/${context.documentId}`
      collectionPath = `client-documents/${context.documentId}/comments`
    } else if (context.conversationId) {
      url = `/admin/communications?convId=${encodeURIComponent(context.conversationId)}`
      collectionPath = `conversations/${context.conversationId}/comments`
    }

    return {
      orgId,
      source: {
        type: this.sourceType,
        id: docId,
        collectionPath,
        url,
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
