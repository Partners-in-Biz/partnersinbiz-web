import { crmRecordAssignedToUid, type AssignableCrmRecord, type CrmAssignmentMaps } from '@/lib/crm/assignment-access'
import type { BriefingSourceType } from './types'

/**
 * Universal per-user visibility for the Briefings feed.
 *
 * Briefings is a personal action queue: every card must be linked to the
 * viewer (created by them, assigned to them, owned/shared with them, or
 * addressed to them as the org operator). Nothing is org-wide for everyone
 * any more — the same rule applies to admin/owner viewers, not just members.
 *
 * Sources that are already inherently personal (CRM via briefingCrmLinkedToUser,
 * notifications by userId, calendar by assignment, mailbox by uid) and
 * operator-only ops surfaces (agent-run, booking, expense, seo-task, enquiry,
 * form-submission, workspace-broker-job) keep their existing, narrower gates.
 */

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function includesUid(value: unknown, uid: string): boolean {
  if (typeof value === 'string') {
    const v = clean(value)
    return v === uid || v === `user:${uid}` || v === `agent:${uid}`
  }
  if (Array.isArray(value)) {
    return value.some((item) => includesUid(item, uid))
  }
  if (value && typeof value === 'object') {
    const ref = value as { uid?: unknown }
    return includesUid(ref.uid, uid)
  }
  return false
}

/**
 * True when the source record itself links to the viewer: they created it,
 * own it, are assigned to it, are explicitly shared on it, are its recipient,
 * or its ref fields point at them. Reuses the CRM assignment matcher so every
 * assignment vocabulary (assignedTo/owner/accountManager/linkedUserId/memberUid
 * plus allowedUserIds/assignedUserIds/sharedWithUserIds and refs) counts.
 */
export function recordLinkedToUser(doc: Record<string, unknown> | null | undefined, uid: string): boolean {
  if (!doc || !uid) return false
  if (crmRecordAssignedToUid(doc as AssignableCrmRecord, uid)) return true

  // Comment/notification recipient.
  if (includesUid(doc.userId, uid)) return true

  // Task human assignee fields.
  if (includesUid(doc.assigneeId, uid)) return true
  if (includesUid(doc.assigneeIds, uid)) return true

  // Approval gate participants.
  if (includesUid(doc.requestedBy, uid)) return true
  if (includesUid(doc.approvedBy, uid)) return true
  if (includesUid(doc.rejectedBy, uid)) return true

  // Snapshot/report generators.
  if (includesUid(doc.generatedBy, uid)) return true

  return false
}

/** True when the record is linked to the viewer via a linked CRM company/contact. */
export function recordLinkedViaCrm(
  doc: Record<string, unknown> | null | undefined,
  uid: string,
  maps: CrmAssignmentMaps = {},
): boolean {
  if (!doc || !uid) return false
  const record = doc as AssignableCrmRecord

  const companyIds = new Set<string>()
  for (const value of [record.companyId, record.sourceCompanyId, record.targetCompanyId]) {
    const id = clean(value)
    if (id) companyIds.add(id)
  }
  if (Array.isArray(record.companyLinks)) {
    for (const link of record.companyLinks) {
      if (!link || typeof link !== 'object') continue
      const id = clean((link as { companyId?: unknown }).companyId)
      if (id) companyIds.add(id)
    }
  }
  for (const id of companyIds) {
    if (crmRecordAssignedToUid(maps.companies?.get(id), uid)) return true
  }

  const contactIds = new Set<string>()
  for (const value of [record.contactId, record.sourceContactId, record.targetContactId]) {
    const id = clean(value)
    if (id) contactIds.add(id)
  }
  for (const id of contactIds) {
    const contact = maps.contacts?.get(id)
    if (!contact) continue
    if (crmRecordAssignedToUid(contact, uid)) return true
    for (const value of [contact.companyId, contact.sourceCompanyId, contact.targetCompanyId]) {
      const companyId = clean(value)
      if (companyId && crmRecordAssignedToUid(maps.companies?.get(companyId), uid)) return true
    }
  }

  return false
}

/**
 * Every org a record is addressed to. Quotes/invoices/orders raised by one org
 * for another carry `recipientOrgId` / `targetOrgId`, and the receiving org's
 * operator is the one who has to decide or pay — so operator checks must look
 * at all of them, not only `orgId`.
 */
export function recordAddressedOrgIds(doc: Record<string, unknown> | null | undefined): string[] {
  if (!doc) return []
  const ids = new Set<string>()
  for (const value of [doc.orgId, doc.sourceOrgId, doc.recipientOrgId, doc.targetOrgId]) {
    const id = clean(value)
    if (id) ids.add(id)
  }
  return [...ids]
}

/**
 * Sources that are addressed to the org operator rather than owned by one
 * person. These are the action-queue cards (approval gates, needs-peet task
 * states, documents awaiting sign-off, social posts in review lanes). They
 * appear only for operator viewers (org owner/admin or platform admin/ai),
 * never for a plain member, and never org-wide.
 */
export function recordOperatorAddressed(sourceType: BriefingSourceType, doc: Record<string, unknown> | null | undefined): boolean {
  if (!doc) return false

  if (sourceType === 'approval') {
    const status = clean(doc.status).toLowerCase()
    return status === 'pending' || status === 'rejected' || status === 'denied'
  }

  if (sourceType === 'client-document') {
    if (doc.requiresApproval === true) return true
    const approvalStatus = clean(doc.approvalStatus).toLowerCase()
    if (approvalStatus === 'pending' || approvalStatus === 'rejected' || approvalStatus === 'denied') return true
    return clean(doc.status).toLowerCase() === 'in-review'
  }

  if (sourceType === 'task') {
    const agentStatus = clean(doc.agentStatus).toLowerCase()
    if (agentStatus === 'blocked' || agentStatus === 'awaiting-input') return true
    if (doc.requiresApproval === true) return true
    if (clean(doc.reviewStatus).toLowerCase() === 'changes-requested') return true
    // Agent work that completed and is sitting in the review lane is the
    // operator's action queue (matches the task adapter 'review' priority).
    if (agentStatus === 'done' && clean(doc.reviewStatus).toLowerCase() === 'pending' && clean(doc.columnId).toLowerCase() === 'review') return true
    return false
  }

  if (sourceType === 'social-post') {
    const status = clean(doc.status).toLowerCase()
    return status === 'qa_review' || status === 'client_review' || status === 'pending_approval'
  }

  if (sourceType === 'support-ticket') {
    const status = clean(doc.status).toLowerCase()
    return status !== 'closed' && status !== 'resolved'
  }

  if (sourceType === 'social-inbox') {
    const status = clean(doc.status).toLowerCase()
    return status !== 'archived' && status !== 'resolved'
  }

  if (sourceType === 'ad-campaign') {
    const status = clean(doc.status).toLowerCase()
    // The adapter only emits `PENDING_REVIEW` + `reviewState: 'awaiting'`; keep
    // the legacy spellings so older documents stay addressed too.
    if (status === 'pending_review') return clean(doc.reviewState).toLowerCase() !== 'resolved'
    return status === 'pending' || status === 'pending_approval' || status === 'needs_review' || status === 'rejected'
  }

  if (sourceType === 'campaign') {
    const status = clean(doc.status).toLowerCase()
    return status === 'draft' || status === 'pending' || status === 'pending_approval' || status === 'needs_review'
  }

  if (sourceType === 'broadcast') {
    const status = clean(doc.status).toLowerCase()
    // `draft` is the adapter's "ready to send" needs-peet card, so it is operator work too.
    return status === 'draft' || status === 'pending' || status === 'pending_approval' || status === 'paused' || status === 'failed' || status === 'sending' || status === 'scheduled'
  }

  if (sourceType === 'report') {
    const status = clean(doc.status).toLowerCase()
    return status === 'failed' || status === 'draft' || status === 'rendering'
  }

  if (sourceType === 'invoice') {
    const status = clean(doc.status).toLowerCase()
    return status === 'overdue' || status === 'payment_pending_verification' || status === 'draft' ||
      status === 'partially_paid' || status === 'sent' || status === 'viewed'
  }

  if (sourceType === 'quote') {
    const status = clean(doc.status).toLowerCase()
    return status === 'sent' || status === 'draft' || (status === 'accepted' && !clean(doc.convertedInvoiceId))
  }

  if (sourceType === 'order') {
    const status = clean(doc.status).toLowerCase()
    return status === 'draft' || status === 'confirmed' || status === 'in_progress' || clean(doc.approvalState).toLowerCase() === 'pending_approval'
  }

  if (sourceType === 'inventory-item') {
    const status = clean(doc.status).toLowerCase()
    return status === 'low_stock' || status === 'out_of_stock'
  }

  if (sourceType === 'shipment') {
    const status = clean(doc.status).toLowerCase()
    return status === 'failed' || status === 'pending' || status === 'ready' || status === 'in_transit'
  }

  if (sourceType === 'seo-content') {
    const status = clean(doc.status).toLowerCase()
    return status === 'review' || status === 'pending' || status === 'needs_review'
  }

  return false
}
