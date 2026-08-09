import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { MemberRef } from '@/lib/orgMembers/memberRef'
import { recordCrmAuditEvent } from '@/lib/crm/audit'
import type {
  BusinessRelationship,
  SharedBusinessCapability,
} from '@/lib/business-relationships/types'
import { cleanString } from './identity'
import { loadLiveBilateralLink } from './link-evidence'

/**
 * Phase 2 — per-record sharing across an accepted partner link.
 *
 * Phase 1 established the link and negotiated capability/field policy at the
 * relationship level. This module lets an org share ONE specific record (a
 * deal, project, invoice, quote, or client document) with the org on the other
 * side of that link.
 *
 * SANCTIONED CROSS-ORG READ (second location, by design).
 * `lib/companies/command-center.ts` carries a comment declaring itself the only
 * place allowed to read across org boundaries. That module aggregates
 * counts/statuses for a linked company. This module is the other sanctioned
 * location, with a deliberately narrower contract:
 *   - it reads exactly ONE record, named by an explicit share row
 *   - the share must be `active` and the caller must be its `partnerOrgId`
 *   - the record is returned through a per-type field whitelist, never raw
 * Any cross-org read outside these two modules is still a spec violation.
 */

export const PARTNER_SHARE_COLLECTION = 'partner_record_shares'

export type PartnerShareResourceType =
  | 'deal'
  | 'project'
  | 'invoice'
  | 'quote'
  | 'client_document'

export type PartnerSharePermission = 'view' | 'comment'
export type PartnerShareStatus = 'active' | 'revoked'

export const PARTNER_SHARE_RESOURCE_TYPES: PartnerShareResourceType[] = [
  'deal', 'project', 'invoice', 'quote', 'client_document',
]

const RESOURCE_COLLECTION: Record<PartnerShareResourceType, string> = {
  deal: 'deals',
  project: 'projects',
  invoice: 'invoices',
  quote: 'quotes',
  client_document: 'client_documents',
}

/** A record may only be shared when the link already shares that capability. */
const RESOURCE_CAPABILITY: Record<PartnerShareResourceType, SharedBusinessCapability> = {
  deal: 'crm',
  project: 'projects',
  invoice: 'invoices',
  quote: 'invoices',
  client_document: 'documents',
}

/** Per-type read whitelist. Never return the raw cross-org document. */
const RESOURCE_FIELDS: Record<PartnerShareResourceType, string[]> = {
  deal: ['title', 'value', 'currency', 'stageId', 'probability', 'expectedCloseDate', 'companyName'],
  project: ['name', 'description', 'brief', 'status', 'targetDate', 'startDate'],
  invoice: ['invoiceNumber', 'status', 'issueDate', 'dueDate', 'lineItems', 'subtotal',
    'taxRate', 'taxAmount', 'total', 'currency', 'notes'],
  quote: ['quoteNumber', 'status', 'issueDate', 'expiryDate', 'lineItems', 'subtotal',
    'taxRate', 'taxAmount', 'total', 'currency', 'notes'],
  client_document: ['title', 'status', 'documentType', 'summary', 'latestPublishedVersionId'],
}

const TITLE_FIELDS: Record<PartnerShareResourceType, string[]> = {
  deal: ['title'],
  project: ['name'],
  invoice: ['invoiceNumber'],
  quote: ['quoteNumber'],
  client_document: ['title'],
}

/** Secondary line shown in the record picker, per type. */
const SUBTITLE_FIELDS: Record<PartnerShareResourceType, string[]> = {
  deal: ['companyName', 'stageId'],
  project: ['status', 'description'],
  invoice: ['status', 'total'],
  quote: ['status', 'total'],
  client_document: ['documentType', 'status'],
}

/** The single field each type is ordered/prefix-searched on. */
const PRIMARY_TITLE_FIELD: Record<PartnerShareResourceType, string> = {
  deal: 'title',
  project: 'name',
  invoice: 'invoiceNumber',
  quote: 'quoteNumber',
  client_document: 'title',
}

/** Bound on the substring pass. Ordered by title, so it is a stable window. */
const SUBSTRING_SCAN_CAP = 500

export interface ShareableRecord {
  id: string
  title: string
  subtitle?: string
  alreadyShared?: boolean
}

export interface ShareableRecordsResult {
  records: ShareableRecord[]
  /**
   * True when the substring pass filled its window, so matches may exist
   * beyond it. The picker surfaces this rather than silently truncating.
   */
  truncated: boolean
}

/**
 * Searchable list of records this org could share.
 *
 * Two passes, merged:
 *  1. a server-side PREFIX range query on the type's title field — scales to
 *     any corpus size, so "Web" finds "Website Redesign" however many projects
 *     the org has;
 *  2. a bounded window (SUBSTRING_SCAN_CAP, ordered by the same field so it
 *     reuses one index) filtered in memory for mid-string matches, so
 *     "redesign" still finds "Website Redesign".
 *
 * Pass 2 is what can miss things on a very large corpus; when its window fills
 * we return `truncated: true` instead of pretending the list is complete.
 */
export async function listShareableRecords(input: {
  orgId: string
  resourceType: PartnerShareResourceType
  query?: string
  partnerOrgId?: string
  limit?: number
}): Promise<ShareableRecordsResult> {
  const collection = RESOURCE_COLLECTION[input.resourceType]
  const titleField = PRIMARY_TITLE_FIELD[input.resourceType]
  const q = cleanString(input.query)
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100)

  // Records already shared with this partner, so the picker can disable them.
  const shared = new Set<string>()
  if (input.partnerOrgId) {
    const shareSnap = await adminDb
      .collection(PARTNER_SHARE_COLLECTION)
      .where('ownerOrgId', '==', input.orgId)
      .where('partnerOrgId', '==', input.partnerOrgId)
      .limit(1000)
      .get()
    for (const doc of shareSnap.docs) {
      const row = doc.data() ?? {}
      if (row.status === 'active' && row.resourceType === input.resourceType) {
        shared.add(cleanString(row.resourceId))
      }
    }
  }

  const base = adminDb.collection(collection).where('orgId', '==', input.orgId)
  const collected = new Map<string, FirebaseFirestore.DocumentSnapshot>()
  let truncated = false

  if (q) {
    // Pass 1 — prefix range. \uf8ff is the standard high-codepoint sentinel.
    const prefixSnap = await base
      .orderBy(titleField)
      .startAt(q)
      .endAt(`${q}\uf8ff`)
      .limit(limit * 2)
      .get()
    for (const doc of prefixSnap.docs) collected.set(doc.id, doc)
  }

  // Pass 2 — bounded window for substring (and the unfiltered browse case).
  const windowSnap = await base
    .orderBy(titleField)
    .limit(q ? SUBSTRING_SCAN_CAP : limit * 4)
    .get()
  if (q && windowSnap.size === SUBSTRING_SCAN_CAP) truncated = true
  for (const doc of windowSnap.docs) collected.set(doc.id, doc)

  const needle = q.toLowerCase()
  const out: ShareableRecord[] = []
  for (const doc of collected.values()) {
    const data = doc.data() ?? {}
    if (data.deleted === true) continue
    const title = TITLE_FIELDS[input.resourceType]
      .map((f) => cleanString(data[f]))
      .find(Boolean) || doc.id
    const subtitle = SUBTITLE_FIELDS[input.resourceType]
      .map((f) => cleanString(data[f]))
      .filter(Boolean)
      .join(' · ')
    if (needle && !title.toLowerCase().includes(needle) && !subtitle.toLowerCase().includes(needle)) continue
    out.push({ id: doc.id, title, subtitle: subtitle || undefined, alreadyShared: shared.has(doc.id) })
  }

  const records = out
    .sort((a, b) => Number(a.alreadyShared) - Number(b.alreadyShared) || a.title.localeCompare(b.title))
    .slice(0, limit)

  return { records, truncated }
}

export interface PartnerRecordShare {
  id: string
  partnerLinkId: string
  relationshipId: string
  ownerOrgId: string
  partnerOrgId: string
  resourceType: PartnerShareResourceType
  resourceId: string
  resourceTitle?: string
  permission: PartnerSharePermission
  status: PartnerShareStatus
  sharedByRef?: MemberRef
  createdAt?: unknown
  updatedAt?: unknown
  revokedAt?: unknown
}

function stripUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined))
}

function toShare(id: string, data: Record<string, unknown>): PartnerRecordShare {
  return { id, ...(data as Omit<PartnerRecordShare, 'id'>) }
}

function timeValue(value: unknown): number {
  if (!value) return 0
  if (typeof value === 'object') {
    const ts = value as { toMillis?: () => number; seconds?: number; _seconds?: number }
    if (typeof ts.toMillis === 'function') return ts.toMillis()
    const seconds = ts.seconds ?? ts._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return 0
}

export function isPartnerShareResourceType(value: unknown): value is PartnerShareResourceType {
  return typeof value === 'string' && (PARTNER_SHARE_RESOURCE_TYPES as string[]).includes(value)
}

/**
 * Loads the caller's own side of an accepted partner link and proves the
 * counterpart row is live too (accepted bilateral Partner Link evidence).
 * A unilateral relationship row grants no resource access.
 */
async function loadActiveLink(
  relationshipId: string,
  ownerOrgId: string,
): Promise<BusinessRelationship> {
  const { link } = await loadLiveBilateralLink(relationshipId, ownerOrgId)
  return link
}

export interface SharePartnerRecordInput {
  ownerOrgId: string
  relationshipId: string
  resourceType: PartnerShareResourceType
  resourceId: string
  permission?: PartnerSharePermission
  actor: MemberRef
}

/**
 * Share one record with the partner org. Idempotent: re-sharing the same
 * record returns the existing active row (upgrading its permission if needed).
 */
export async function sharePartnerRecord(
  input: SharePartnerRecordInput,
): Promise<PartnerRecordShare> {
  const link = await loadActiveLink(input.relationshipId, input.ownerOrgId)
  const partnerOrgId = cleanString(link.targetOrgId)

  const capability = RESOURCE_CAPABILITY[input.resourceType]
  if (!link.sharedCapabilities?.includes(capability)) {
    throw new Error(`This partner link does not share "${capability}". Enable it before sharing this record.`)
  }

  // The record must exist and belong to the sharing org.
  const collection = RESOURCE_COLLECTION[input.resourceType]
  const recordSnap = await adminDb.collection(collection).doc(input.resourceId).get()
  if (!recordSnap.exists) throw new Error('Record not found')
  const recordData = recordSnap.data() ?? {}
  if (recordData.orgId !== input.ownerOrgId || recordData.deleted === true) {
    throw new Error('Record not found')
  }

  const title = TITLE_FIELDS[input.resourceType]
    .map((f) => cleanString(recordData[f]))
    .find(Boolean)

  const permission: PartnerSharePermission = input.permission === 'comment' ? 'comment' : 'view'
  const now = FieldValue.serverTimestamp()

  const existingSnap = await adminDb
    .collection(PARTNER_SHARE_COLLECTION)
    .where('ownerOrgId', '==', input.ownerOrgId)
    .where('resourceType', '==', input.resourceType)
    .where('resourceId', '==', input.resourceId)
    .limit(10)
    .get()

  const existing = existingSnap.docs
    .map((d) => toShare(d.id, d.data() ?? {}))
    .find((s) => s.partnerOrgId === partnerOrgId && s.status === 'active')

  if (existing) {
    if (existing.permission !== permission || existing.resourceTitle !== title) {
      await adminDb.collection(PARTNER_SHARE_COLLECTION).doc(existing.id).set(stripUndefined({
        permission,
        resourceTitle: title,
        updatedAt: now,
      }), { merge: true })
    }
    return { ...existing, permission, resourceTitle: title }
  }

  const doc = stripUndefined({
    partnerLinkId: link.partnerLinkId,
    relationshipId: input.relationshipId,
    ownerOrgId: input.ownerOrgId,
    partnerOrgId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    resourceTitle: title,
    permission,
    status: 'active',
    sharedByRef: input.actor,
    createdAt: now,
    updatedAt: now,
  })

  const ref = await adminDb.collection(PARTNER_SHARE_COLLECTION).add(doc)

  const notification = {
    type: 'partner_share.granted',
    title: 'A partner shared a record with you',
    body: `${title ? `"${title}"` : `A ${input.resourceType.replace('_', ' ')}`} was shared with your workspace.`,
    targetOrgIds: [partnerOrgId],
  }
  await recordCrmAuditEvent({
    orgId: input.ownerOrgId,
    eventType: 'partner_share.granted',
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    relationshipId: input.relationshipId,
    actorRef: input.actor,
    metadata: { partnerOrgId, permission, shareId: ref.id },
    notification,
  })

  const snap = await ref.get()
  return toShare(ref.id, snap.data() ?? {})
}

/**
 * System-granted share, used when the platform itself creates a record that
 * the partner is already a party to — currently the invoice drafted from a
 * confirmed cross-org order.
 *
 * Deliberately skips the capability gate that `sharePartnerRecord` enforces:
 * that gate asks "may this org browse our invoices in general", which is a
 * different question from "may the buyer see the invoice for the order they
 * just placed". Every other check (active link, ownership, whitelisted read)
 * still applies on the way back out.
 */
export async function grantSystemShare(input: {
  relationshipId: string
  partnerLinkId: string
  ownerOrgId: string
  partnerOrgId: string
  resourceType: PartnerShareResourceType
  resourceId: string
  resourceTitle?: string
  actor: MemberRef
}): Promise<PartnerRecordShare | null> {
  const existing = await adminDb
    .collection(PARTNER_SHARE_COLLECTION)
    .where('ownerOrgId', '==', input.ownerOrgId)
    .where('resourceType', '==', input.resourceType)
    .where('resourceId', '==', input.resourceId)
    .limit(10)
    .get()

  const live = existing.docs
    .map((d) => toShare(d.id, d.data() ?? {}))
    .find((s) => s.partnerOrgId === input.partnerOrgId && s.status === 'active')
  if (live) return live

  const now = FieldValue.serverTimestamp()
  const ref = await adminDb.collection(PARTNER_SHARE_COLLECTION).add(stripUndefined({
    partnerLinkId: input.partnerLinkId,
    relationshipId: input.relationshipId,
    ownerOrgId: input.ownerOrgId,
    partnerOrgId: input.partnerOrgId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    resourceTitle: input.resourceTitle,
    permission: 'view',
    status: 'active',
    systemGranted: true,
    sharedByRef: input.actor,
    createdAt: now,
    updatedAt: now,
  }))
  const snap = await ref.get()
  return toShare(ref.id, snap.data() ?? {})
}

export async function revokePartnerShare(input: {
  shareId: string
  actingOrgId: string
  actor: MemberRef
}): Promise<PartnerRecordShare> {
  const ref = adminDb.collection(PARTNER_SHARE_COLLECTION).doc(input.shareId)
  const snap = await ref.get()
  if (!snap.exists) throw new Error('Share not found')
  const share = toShare(snap.id, snap.data() ?? {})
  // Only the org that owns the record may revoke it.
  if (share.ownerOrgId !== input.actingOrgId) throw new Error('Share not found')

  await ref.set({
    status: 'revoked',
    revokedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  await recordCrmAuditEvent({
    orgId: share.ownerOrgId,
    eventType: 'partner_share.revoked',
    resourceType: share.resourceType,
    resourceId: share.resourceId,
    relationshipId: share.relationshipId,
    actorRef: input.actor,
    metadata: { partnerOrgId: share.partnerOrgId, shareId: share.id },
    notification: {
      type: 'partner_share.revoked',
      title: 'A partner stopped sharing a record',
      body: `${share.resourceTitle ? `"${share.resourceTitle}"` : 'A record'} is no longer shared with your workspace.`,
      targetOrgIds: [share.partnerOrgId],
    },
  })

  return { ...share, status: 'revoked' }
}

/** Records this org has shared OUT to partners. */
export async function listOutgoingShares(
  ownerOrgId: string,
  params: { relationshipId?: string; includeRevoked?: boolean } = {},
): Promise<PartnerRecordShare[]> {
  const snap = await adminDb
    .collection(PARTNER_SHARE_COLLECTION)
    .where('ownerOrgId', '==', ownerOrgId)
    .limit(1000)
    .get()

  return snap.docs
    .map((d) => toShare(d.id, d.data() ?? {}))
    .filter((s) => (params.includeRevoked ? true : s.status === 'active'))
    .filter((s) => (params.relationshipId ? s.relationshipId === params.relationshipId : true))
    .sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt))
}

/** Records partners have shared IN to this org. */
export async function listIncomingShares(partnerOrgId: string): Promise<PartnerRecordShare[]> {
  const snap = await adminDb
    .collection(PARTNER_SHARE_COLLECTION)
    .where('partnerOrgId', '==', partnerOrgId)
    .where('status', '==', 'active')
    .limit(1000)
    .get()

  return snap.docs
    .map((d) => toShare(d.id, d.data() ?? {}))
    .sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt))
}

export interface SharedRecordView {
  share: PartnerRecordShare
  ownerOrgName: string
  record: Record<string, unknown>
  /** Which side of the share the caller is on. */
  viewerRole: ShareViewerRole
  /** Owner always; partner only when permission === 'comment'. */
  canComment: boolean
}

/**
 * THE cross-org read. Returns a whitelisted projection of one shared record.
 *
 * Both sides may read: the receiving org (that's the cross-org part) and the
 * owning org (so it has a surface for the shared-record conversation). Refuses
 * unless the share is active and the underlying partner link is still active.
 */
export async function loadSharedRecord(input: {
  shareId: string
  viewerOrgId: string
}): Promise<SharedRecordView> {
  // resolveShareAccess enforces membership of one side, active share, live link.
  const { share, role } = await resolveShareAccess(input)

  const recordSnap = await adminDb
    .collection(RESOURCE_COLLECTION[share.resourceType])
    .doc(share.resourceId)
    .get()
  if (!recordSnap.exists) throw new Error('Shared record no longer exists')
  const raw = recordSnap.data() ?? {}
  if (raw.orgId !== share.ownerOrgId || raw.deleted === true) {
    throw new Error('Shared record no longer exists')
  }

  const record: Record<string, unknown> = { id: recordSnap.id }
  for (const field of RESOURCE_FIELDS[share.resourceType]) {
    if (raw[field] !== undefined) record[field] = raw[field]
  }

  const ownerOrgSnap = await adminDb.collection('organizations').doc(share.ownerOrgId).get()
  const ownerOrgName = cleanString((ownerOrgSnap.data() ?? {}).name) || share.ownerOrgId

  return {
    share,
    ownerOrgName,
    record,
    viewerRole: role,
    canComment: role === 'owner' || share.permission === 'comment',
  }
}

export const PARTNER_SHARE_COMMENT_COLLECTION = 'partner_share_comments'

export interface PartnerShareComment {
  id: string
  shareId: string
  partnerLinkId: string
  ownerOrgId: string
  partnerOrgId: string
  /** Which side wrote it — lets the UI label "them" vs "you" without leaking uids. */
  authorOrgId: string
  authorRef?: MemberRef
  body: string
  createdAt?: unknown
  deleted?: boolean
}

export type ShareViewerRole = 'owner' | 'partner'

/**
 * Both sides of a share may read it; only the receiving side is gated on
 * `permission`. Returns which side the caller is so callers can branch.
 */
async function resolveShareAccess(input: {
  shareId: string
  viewerOrgId: string
}): Promise<{ share: PartnerRecordShare; role: ShareViewerRole }> {
  const snap = await adminDb.collection(PARTNER_SHARE_COLLECTION).doc(input.shareId).get()
  if (!snap.exists) throw new Error('Shared record not found')
  const share = toShare(snap.id, snap.data() ?? {})

  const isOwner = share.ownerOrgId === input.viewerOrgId
  const isPartner = share.partnerOrgId === input.viewerOrgId
  if (!isOwner && !isPartner) throw new Error('Shared record not found')
  if (share.status !== 'active') throw new Error('This record is no longer shared')

  const linkSnap = await adminDb
    .collection('businessRelationships')
    .where('partnerLinkId', '==', share.partnerLinkId)
    .limit(10)
    .get()
  const stillLinked = linkSnap.docs.some((d) => {
    const row = d.data() as BusinessRelationship
    return row.status === 'active' && row.deleted !== true
  })
  if (!stillLinked) throw new Error('This partner link is no longer active')

  return { share, role: isOwner ? 'owner' : 'partner' }
}

export async function listShareComments(input: {
  shareId: string
  viewerOrgId: string
}): Promise<{ comments: PartnerShareComment[]; role: ShareViewerRole; canComment: boolean }> {
  const { share, role } = await resolveShareAccess(input)

  const snap = await adminDb
    .collection(PARTNER_SHARE_COMMENT_COLLECTION)
    .where('shareId', '==', input.shareId)
    .limit(500)
    .get()

  const comments = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<PartnerShareComment, 'id'>) }))
    .filter((c) => c.deleted !== true)
    .sort((a, b) => timeValue(a.createdAt) - timeValue(b.createdAt))

  // The owner can always comment on their own record; the partner needs the
  // 'comment' permission — this is what makes that field mean something.
  const canComment = role === 'owner' || share.permission === 'comment'
  return { comments, role, canComment }
}

export async function addShareComment(input: {
  shareId: string
  viewerOrgId: string
  body: string
  actor: MemberRef
}): Promise<PartnerShareComment> {
  const { share, role } = await resolveShareAccess(input)
  const body = input.body.trim()
  if (!body) throw new Error('Comment cannot be empty')
  if (body.length > 5000) throw new Error('Comment is too long (max 5000 characters)')

  if (role === 'partner' && share.permission !== 'comment') {
    throw new Error('This record was shared with you as view-only')
  }

  const now = FieldValue.serverTimestamp()
  const doc = stripUndefined({
    shareId: input.shareId,
    partnerLinkId: share.partnerLinkId,
    ownerOrgId: share.ownerOrgId,
    partnerOrgId: share.partnerOrgId,
    authorOrgId: input.viewerOrgId,
    authorRef: input.actor,
    body,
    createdAt: now,
    deleted: false,
  })

  const ref = await adminDb.collection(PARTNER_SHARE_COMMENT_COLLECTION).add(doc)

  // Notify the other side only.
  const recipientOrgId = role === 'owner' ? share.partnerOrgId : share.ownerOrgId

  // Email as well as the in-app notification — a partner in another workspace
  // will not be watching this org's bell. Non-fatal: never fail the comment.
  void notifyShareCommentByEmail({
    recipientOrgId,
    authorOrgId: input.viewerOrgId,
    authorName: input.actor.displayName,
    share,
    body,
  }).catch((err) => console.error('[partner-share-comment-email-error]', err))

  await recordCrmAuditEvent({
    orgId: input.viewerOrgId,
    eventType: 'partner_share.commented',
    resourceType: share.resourceType,
    resourceId: share.resourceId,
    relationshipId: share.relationshipId,
    actorRef: input.actor,
    metadata: { shareId: share.id, commentId: ref.id },
    notification: {
      type: 'partner_share.commented',
      title: 'New comment on a shared record',
      body: `${input.actor.displayName} commented on ${share.resourceTitle ? `"${share.resourceTitle}"` : 'a shared record'}.`,
      targetOrgIds: [recipientOrgId],
    },
  })

  const saved = await ref.get()
  return { id: ref.id, ...(saved.data() as Omit<PartnerShareComment, 'id'>) }
}

/** Org-level contact address, used for cross-workspace notifications. */
async function orgNotificationEmail(orgId: string): Promise<{ email: string; name: string } | null> {
  const snap = await adminDb.collection('organizations').doc(orgId).get()
  if (!snap.exists) return null
  const data = snap.data() ?? {}
  const settings = (data.settings ?? {}) as Record<string, unknown>
  const email = cleanString(settings.notificationEmail).toLowerCase()
    || cleanString(data.billingEmail).toLowerCase()
  if (!email || !email.includes('@')) return null
  return { email, name: cleanString(data.name) || orgId }
}

async function notifyShareCommentByEmail(input: {
  recipientOrgId: string
  authorOrgId: string
  authorName: string
  share: PartnerRecordShare
  body: string
}): Promise<void> {
  const recipient = await orgNotificationEmail(input.recipientOrgId)
  if (!recipient) return
  const author = await orgNotificationEmail(input.authorOrgId)

  const { partnerShareCommentEmail } = await import('@/lib/email/templates/partner-invite')
  const { sendEmail } = await import('@/lib/email/send')

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://partnersinbiz.online'
  const { subject, html } = partnerShareCommentEmail({
    authorName: input.authorName,
    authorOrgName: author?.name ?? 'a partner',
    recordTitle: input.share.resourceTitle || input.share.resourceId,
    recordType: input.share.resourceType,
    body: input.body,
    viewUrl: `${baseUrl}/portal/partners/shared/${input.share.id}`,
  })

  await sendEmail({ to: recipient.email, subject, html })
}

export async function deleteShareComment(input: {
  commentId: string
  viewerOrgId: string
}): Promise<void> {
  const ref = adminDb.collection(PARTNER_SHARE_COMMENT_COLLECTION).doc(input.commentId)
  const snap = await ref.get()
  if (!snap.exists) throw new Error('Comment not found')
  const comment = snap.data() as PartnerShareComment
  // Only the org that wrote it may remove it.
  if (comment.authorOrgId !== input.viewerOrgId) throw new Error('Comment not found')
  await ref.set({ deleted: true, deletedAt: FieldValue.serverTimestamp() }, { merge: true })
}

/** Change an existing share between view-only and comment. Owner only. */
export async function setSharePermission(input: {
  shareId: string
  ownerOrgId: string
  permission: PartnerSharePermission
  actor: MemberRef
}): Promise<PartnerRecordShare> {
  const ref = adminDb.collection(PARTNER_SHARE_COLLECTION).doc(input.shareId)
  const snap = await ref.get()
  if (!snap.exists) throw new Error('Share not found')
  const share = toShare(snap.id, snap.data() ?? {})
  if (share.ownerOrgId !== input.ownerOrgId) throw new Error('Share not found')

  await ref.set({
    permission: input.permission,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  await recordCrmAuditEvent({
    orgId: share.ownerOrgId,
    eventType: 'partner_share.permission_changed',
    resourceType: share.resourceType,
    resourceId: share.resourceId,
    relationshipId: share.relationshipId,
    actorRef: input.actor,
    metadata: { shareId: share.id, permission: input.permission },
    notification: {
      type: 'partner_share.permission_changed',
      title: 'Sharing permission changed',
      body: input.permission === 'comment'
        ? `You can now comment on ${share.resourceTitle ? `"${share.resourceTitle}"` : 'a shared record'}.`
        : `${share.resourceTitle ? `"${share.resourceTitle}"` : 'A shared record'} is now view-only.`,
      targetOrgIds: [share.partnerOrgId],
    },
  })

  return { ...share, permission: input.permission }
}

/** Revoke every share riding on a partner link — called when the link is severed. */
export async function revokeSharesForPartnerLink(input: {
  partnerLinkId: string
  actor: MemberRef
}): Promise<string[]> {
  if (!input.partnerLinkId) return []
  const snap = await adminDb
    .collection(PARTNER_SHARE_COLLECTION)
    .where('partnerLinkId', '==', input.partnerLinkId)
    .limit(1000)
    .get()

  const now = Timestamp.now()
  const revoked: string[] = []
  for (const doc of snap.docs) {
    if ((doc.data() ?? {}).status !== 'active') continue
    await doc.ref.set({ status: 'revoked', revokedAt: now, updatedAt: now }, { merge: true })
    revoked.push(doc.id)
  }
  return revoked
}
