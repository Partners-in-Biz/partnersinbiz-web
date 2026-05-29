/**
 * Source adapter for approvals and client documents.
 *
 * Generates briefing items for:
 * - Approval gate status changes
 * - Client document submissions
 * - Client document approvals/rejections
 */

import type { BriefingSourceAdapter, BriefingPriority } from '../types'
import { normalizeActor, hashSourceDocument, extractMultiFieldExcerpt, normalizeTimestamp, extractOrgId, generateSourceUrl } from '../utils'

/**
 * Approval gate document shape.
 */
interface ApprovalGateDocument extends Record<string, unknown> {
  id: string
  orgId: string
  projectId?: string
  taskId?: string
  status?: string
  type?: string
  requestedBy?: string
  approvedBy?: string
  rejectedBy?: string
  comments?: string | null
  createdAt?: unknown
  updatedAt?: unknown
  approvalTaskId?: string
}

/**
 * Client document document shape.
 */
interface ClientDocumentDocument extends Record<string, unknown> {
  id: string
  orgId: string
  clientId?: string
  title: string
  type: string
  status: string
  content: string
  createdAt?: unknown
  updatedAt?: unknown
  createdBy?: string
  updatedBy?: string
  requiresApproval?: boolean
  approvalStatus?: string
  approvedBy?: string
  rejectedBy?: string
  approvalComments?: string | null
  version?: number
  parentDocumentId?: string
  sourceDocumentId?: string
  sourceSpecVersion?: string
}

/**
 * Adapter for approval gate briefing items.
 */
export const approvalAdapter: BriefingSourceAdapter<ApprovalGateDocument> = {
  sourceType: 'approval',
  collectionPath: 'approvals',

  hashSource(doc: ApprovalGateDocument, docId: string): string {
    return hashSourceDocument(doc, docId, ['status', 'taskId', 'projectId', 'updatedAt'])
  },

  shouldGenerate(doc: ApprovalGateDocument, _docId: string): boolean {
    // Only generate for approval gates with a task reference
    if (!doc.taskId) return false
    return true
  },

  extractPriority(doc: ApprovalGateDocument, _docId: string): BriefingPriority {
    // Pending approvals need Peet's attention
    if (doc.status === 'pending') {
      return 'needs-peet'
    }

    // Rejected approvals are critical
    if (doc.status === 'rejected' || doc.status === 'denied') {
      return 'needs-peet'
    }

    // Approved approvals are FYI
    if (doc.status === 'approved' || doc.status === 'accepted') {
      return 'fyi'
    }

    // Default
    return 'fyi'
  },

  extractActor(doc: ApprovalGateDocument, _docId: string) {
    // If approved, use approver; otherwise use requester
    const actorId = doc.approvedBy || doc.rejectedBy || doc.requestedBy || 'system'
    const userName = actorId.includes('@') ? actorId.split('@')[0] : actorId
    const role = actorId === 'system' ? 'system' : 'admin'

    return {
      id: actorId,
      name: userName,
      role: role as 'admin' | 'system',
      type: actorId === 'system' ? 'system' : 'user',
    }
  },

  extractContext(doc: ApprovalGateDocument, _docId: string) {
    const orgId = extractOrgId(doc) ?? ''
    const projectId = typeof doc.projectId === 'string' ? doc.projectId : null
    const taskId = typeof doc.taskId === 'string' ? doc.taskId : null

    return {
      orgId,
      projectId,
      taskId,
    }
  },

  extractTitle(doc: ApprovalGateDocument, _docId: string): string {
    const status = doc.status?.toLowerCase() || 'unknown'

    if (status === 'pending') {
      return 'Approval pending'
    }

    if (status === 'approved' || status === 'accepted') {
      return 'Approval approved'
    }

    if (status === 'rejected' || status === 'denied') {
      return 'Approval rejected'
    }

    return `Approval ${status}`
  },

  extractSummary(doc: ApprovalGateDocument, _docId: string): string {
    const parts: string[] = []

    parts.push(`Status: ${doc.status || 'pending'}`)

    if (doc.approvedBy) {
      parts.push(`Approved by: ${doc.approvedBy}`)
    }

    if (doc.rejectedBy) {
      parts.push(`Rejected by: ${doc.rejectedBy}`)
    }

    if (doc.comments) {
      const excerpt = extractMultiFieldExcerpt(doc, ['comments'], { maxLength: 150 })
      if (excerpt) parts.push(`Comments: ${excerpt}`)
    }

    return parts.join('. ') || 'No details.'
  },

  extractExcerpt(doc: ApprovalGateDocument, _docId: string, maxLength = 300): string | null {
    return extractMultiFieldExcerpt(doc, ['comments'], { maxLength })
  },

  extractOccurredAt(doc: ApprovalGateDocument, _docId: string): Date | null {
    return normalizeTimestamp(doc.updatedAt) ?? normalizeTimestamp(doc.createdAt)
  },

  extractMetadata(doc: ApprovalGateDocument, _docId: string): Record<string, unknown> | null {
    return {
      approvalType: doc.type,
      requestedBy: doc.requestedBy,
      approvedBy: doc.approvedBy,
      rejectedBy: doc.rejectedBy,
      approvalTaskId: doc.approvalTaskId,
    }
  },

  toItem(doc: ApprovalGateDocument, docId: string) {
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
        url: context.projectId && context.taskId
          ? `https://partnersinbiz.online/admin/projects/${context.projectId}?taskId=${context.taskId}`
          : '/admin',
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
 * Adapter for client document briefing items.
 */
export const clientDocumentAdapter: BriefingSourceAdapter<ClientDocumentDocument> = {
  sourceType: 'client-document',
  collectionPath: 'client-documents',

  hashSource(doc: ClientDocumentDocument, docId: string): string {
    return hashSourceDocument(doc, docId, ['title', 'type', 'status', 'approvalStatus', 'version', 'updatedAt'])
  },

  shouldGenerate(doc: ClientDocumentDocument, _docId: string): boolean {
    // Only generate documents that require approval or have changed status
    if (doc.requiresApproval) return true
    if (doc.status !== 'draft') return true
    return false
  },

  extractPriority(doc: ClientDocumentDocument, _docId: string): BriefingPriority {
    // Pending approvals need Peet's attention
    if (doc.requiresApproval && (!doc.approvalStatus || doc.approvalStatus === 'pending')) {
      return 'needs-peet'
    }

    // Rejected documents are critical
    if (doc.approvalStatus === 'rejected' || doc.approvalStatus === 'denied') {
      return 'needs-peet'
    }

    // Published/approved documents are FYI
    if (doc.status === 'published' || doc.approvalStatus === 'approved') {
      return 'fyi'
    }

    // In review documents
    if (doc.status === 'in-review') {
      return 'review'
    }

    // Default
    return 'fyi'
  },

  extractActor(doc: ClientDocumentDocument, _docId: string) {
    // If approved/rejected, use that actor; otherwise use creator
    const actorId = doc.updatedBy || doc.createdBy || 'unknown'
    const userName = actorId.includes('@') ? actorId.split('@')[0] : actorId
    const role = 'admin'

    return {
      id: actorId,
      name: userName,
      role,
      type: 'user',
    }
  },

  extractContext(doc: ClientDocumentDocument, _docId: string) {
    const orgId = extractOrgId(doc) ?? ''
    const clientId = typeof doc.clientId === 'string' ? doc.clientId : null
    const documentId = _docId
    const documentTitle = doc.title

    return {
      orgId,
      clientId,
      documentId,
      documentTitle,
    }
  },

  extractTitle(doc: ClientDocumentDocument, _docId: string): string {
    const status = doc.status?.toLowerCase() || 'unknown'
    const approvalStatus = doc.approvalStatus?.toLowerCase()

    if (doc.requiresApproval && (!approvalStatus || approvalStatus === 'pending')) {
      return `Document pending approval: ${doc.title}`
    }

    if (approvalStatus === 'rejected' || approvalStatus === 'denied') {
      return `Document rejected: ${doc.title}`
    }

    if (status === 'published') {
      return `Document published: ${doc.title}`
    }

    if (status === 'in-review') {
      return `Document in review: ${doc.title}`
    }

    return `Document: ${doc.title}`
  },

  extractSummary(doc: ClientDocumentDocument, _docId: string): string {
    const parts: string[] = []

    parts.push(`Type: ${doc.type}`)
    parts.push(`Status: ${doc.status}`)

    if (doc.requiresApproval && doc.approvalStatus) {
      parts.push(`Approval: ${doc.approvalStatus}`)
    }

    if (doc.version) {
      parts.push(`Version: ${doc.version}`)
    }

    if (doc.approvalComments) {
      const excerpt = extractMultiFieldExcerpt(doc, ['approvalComments'], { maxLength: 100 })
      if (excerpt) parts.push(`Notes: ${excerpt}`)
    }

    return parts.join('. ') || 'No details.'
  },

  extractExcerpt(doc: ClientDocumentDocument, _docId: string, maxLength = 300): string | null {
    return extractMultiFieldExcerpt(doc, ['content', 'approvalComments'], { maxLength })
  },

  extractOccurredAt(doc: ClientDocumentDocument, _docId: string): Date | null {
    return normalizeTimestamp(doc.updatedAt) ?? normalizeTimestamp(doc.createdAt)
  },

  extractMetadata(doc: ClientDocumentDocument, _docId: string): Record<string, unknown> | null {
    return {
      documentType: doc.type,
      status: doc.status,
      approvalStatus: doc.approvalStatus,
      requiresApproval: doc.requiresApproval,
      version: doc.version,
      parentDocumentId: doc.parentDocumentId,
      sourceDocumentId: doc.sourceDocumentId,
      sourceSpecVersion: doc.sourceSpecVersion,
    }
  },

  toItem(doc: ClientDocumentDocument, docId: string) {
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
        url: generateSourceUrl(this.sourceType, docId, { clientId: context.clientId }),
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