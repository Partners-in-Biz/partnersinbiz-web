/**
 * Write-back from a linked (viewer) org onto a serving org's company-scoped
 * record. Two verbs only: comment and approve. Both are gated by
 * decideSharedAction (grant actions + live PartnerLink) and write into the
 * serving org's book with the viewer org recorded as author, so the serving
 * org sees them in its normal comments / record views.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { SharedBusinessCapability } from '@/lib/business-relationships/types'
import { decideSharedAction, loadSharedRecord, type SharedRecordHandle } from './projection'

export const COMPANY_WORK_COMMENT_RESOURCE_TYPE = 'company_work'

export type ClientApprovalState = 'approved' | 'changes_requested'
export const CLIENT_APPROVAL_STATES: ClientApprovalState[] = ['approved', 'changes_requested']

export type ClientApproval = {
  state: ClientApprovalState
  byOrgId: string
  byUid: string
  note?: string
  module: SharedBusinessCapability
  at: unknown
}

export type SharedComment = {
  id: string
  body: string
  authorOrgId: string
  authorUid: string
  authorName?: string
  createdAt: unknown
  parentCommentId?: string | null
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export type WriteBackDenied = { ok: false; status: 403 | 404 | 400; reason: string }

async function authorize(input: {
  viewerUid: string
  viewerOrgId: string
  module: SharedBusinessCapability
  recordId: string
  action: 'comment' | 'approve'
}): Promise<{ ok: true; handle: SharedRecordHandle } | WriteBackDenied> {
  const handle = await loadSharedRecord({
    viewerOrgId: input.viewerOrgId,
    module: input.module,
    recordId: input.recordId,
  })
  if (!handle) return { ok: false, status: 404, reason: 'Shared record not found' }

  const decision = await decideSharedAction({
    viewerUid: input.viewerUid,
    viewerOrgId: input.viewerOrgId,
    module: input.module,
    resourceId: handle.companyId,
    action: input.action,
    grant: handle.grant,
  })
  if (!decision.allowed) return { ok: false, status: 403, reason: decision.reason }
  return { ok: true, handle }
}

export async function listSharedRecordComments(input: {
  viewerUid: string
  viewerOrgId: string
  module: SharedBusinessCapability
  recordId: string
  limit?: number
}): Promise<{ ok: true; comments: SharedComment[]; handle: SharedRecordHandle } | WriteBackDenied> {
  // Reading comments rides on the view action; the record load already
  // enforces grant + visibility.
  const handle = await loadSharedRecord({
    viewerOrgId: input.viewerOrgId,
    module: input.module,
    recordId: input.recordId,
  })
  if (!handle) return { ok: false, status: 404, reason: 'Shared record not found' }

  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500)
  const snap = await adminDb
    .collection('comments')
    .where('orgId', '==', handle.servingOrgId)
    .where('resourceType', '==', COMPANY_WORK_COMMENT_RESOURCE_TYPE)
    .where('resourceId', '==', input.recordId)
    .limit(limit)
    .get()

  const comments = snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as Record<string, unknown>)
    .filter((row) => row.deleted !== true)
    .map((row) => ({
      id: String(row.id),
      body: clean(row.body),
      authorOrgId: clean(row.authorOrgId) || handle.servingOrgId,
      authorUid: clean(row.createdBy) || clean(row.authorUid),
      authorName: clean(row.authorName) || undefined,
      createdAt: row.createdAt,
      parentCommentId: typeof row.parentCommentId === 'string' ? row.parentCommentId : null,
    }))
    .sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt))

  return { ok: true, comments, handle }
}

export async function addSharedRecordComment(input: {
  viewerUid: string
  viewerOrgId: string
  viewerName?: string
  module: SharedBusinessCapability
  recordId: string
  body: string
  parentCommentId?: string | null
}): Promise<{ ok: true; id: string } | WriteBackDenied> {
  const text = clean(input.body)
  if (!text) return { ok: false, status: 400, reason: 'body is required' }

  const auth = await authorize({ ...input, action: 'comment' })
  if (!auth.ok) return auth
  const { handle } = auth

  const ref = await adminDb.collection('comments').add({
    orgId: handle.servingOrgId,
    resourceType: COMPANY_WORK_COMMENT_RESOURCE_TYPE,
    resourceId: input.recordId,
    module: input.module,
    companyId: handle.companyId,
    partnerLinkId: handle.partnerLinkId,
    resourceGrantId: handle.grant.id,
    parentCommentId: input.parentCommentId ?? null,
    body: text,
    mentions: [],
    mentionIds: [],
    attachments: [],
    crossOrg: true,
    authorOrgId: input.viewerOrgId,
    authorUid: input.viewerUid,
    ...(input.viewerName ? { authorName: input.viewerName } : {}),
    createdBy: input.viewerUid,
    createdByType: 'partner_org',
    updatedBy: null,
    updatedByType: null,
    agentPickedUp: false,
    agentPickedUpAt: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    deleted: false,
  })

  await adminDb.collection(handle.collection).doc(input.recordId).set({
    clientCommentCount: FieldValue.increment(1),
    clientLastCommentAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  return { ok: true, id: ref.id }
}

export async function setSharedRecordApproval(input: {
  viewerUid: string
  viewerOrgId: string
  module: SharedBusinessCapability
  recordId: string
  state: ClientApprovalState
  note?: string
}): Promise<{ ok: true; approval: ClientApproval } | WriteBackDenied> {
  if (!CLIENT_APPROVAL_STATES.includes(input.state)) {
    return { ok: false, status: 400, reason: `state must be one of ${CLIENT_APPROVAL_STATES.join(', ')}` }
  }

  const auth = await authorize({ ...input, action: 'approve' })
  if (!auth.ok) return auth
  const { handle } = auth

  const note = clean(input.note)
  const approval: ClientApproval = {
    state: input.state,
    byOrgId: input.viewerOrgId,
    byUid: input.viewerUid,
    module: input.module,
    ...(note ? { note } : {}),
    at: FieldValue.serverTimestamp(),
  }

  // Only the clientApproval envelope is written — the serving org's own
  // approvalState / status fields stay under its control.
  await adminDb.collection(handle.collection).doc(input.recordId).set({
    clientApproval: approval,
    clientApprovalHistory: FieldValue.arrayUnion({
      ...approval,
      at: new Date().toISOString(),
    }),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  if (note) {
    await adminDb.collection('comments').add({
      orgId: handle.servingOrgId,
      resourceType: COMPANY_WORK_COMMENT_RESOURCE_TYPE,
      resourceId: input.recordId,
      module: input.module,
      companyId: handle.companyId,
      partnerLinkId: handle.partnerLinkId,
      resourceGrantId: handle.grant.id,
      parentCommentId: null,
      body: note,
      kind: input.state === 'approved' ? 'approval' : 'changes_requested',
      mentions: [],
      mentionIds: [],
      attachments: [],
      crossOrg: true,
      authorOrgId: input.viewerOrgId,
      authorUid: input.viewerUid,
      createdBy: input.viewerUid,
      createdByType: 'partner_org',
      updatedBy: null,
      updatedByType: null,
      agentPickedUp: false,
      agentPickedUpAt: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      deleted: false,
    })
  }

  return { ok: true, approval }
}

function toMillis(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Date.parse(value) || 0
  if (typeof value === 'object') {
    const ts = value as { toMillis?: () => number; seconds?: number; _seconds?: number }
    if (typeof ts.toMillis === 'function') {
      try { return ts.toMillis() } catch { return 0 }
    }
    const seconds = ts.seconds ?? ts._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return 0
}
