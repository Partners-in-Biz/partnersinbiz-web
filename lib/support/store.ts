import { FieldValue, Timestamp, type Query } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { ContextReference } from '@/lib/context-references/types'
import type { ResourceRelationshipLinkSet } from '@/lib/client-documents/linkedValidation'
import {
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITIES,
  SUPPORT_STATUSES,
  type SupportAuthorRole,
  type SupportCategory,
  type SupportMessage,
  type SupportPriority,
  type SupportStatus,
  type SupportTicket,
} from './types'

export const SUPPORT_TICKETS_COLLECTION = 'support_tickets'
export const SUPPORT_MESSAGES_COLLECTION = 'support_ticket_messages'

const MAX_SUBJECT = 140
const MAX_BODY = 4_000

type RawDoc = Record<string, unknown>

function cleanText(value: unknown, max = MAX_BODY): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function isCategory(value: unknown): value is SupportCategory {
  return typeof value === 'string' && SUPPORT_CATEGORIES.includes(value as SupportCategory)
}

function isPriority(value: unknown): value is SupportPriority {
  return typeof value === 'string' && SUPPORT_PRIORITIES.includes(value as SupportPriority)
}

function isStatus(value: unknown): value is SupportStatus {
  return typeof value === 'string' && SUPPORT_STATUSES.includes(value as SupportStatus)
}

function millis(value: unknown): number {
  if (!value) return 0
  if (value instanceof Timestamp) return value.toMillis()
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  if (typeof value === 'object') {
    const row = value as { toMillis?: () => number; seconds?: number; _seconds?: number }
    if (typeof row.toMillis === 'function') return row.toMillis()
    const seconds = row.seconds ?? row._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return 0
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serializeSupportValue(value: any): any {
  if (value === null || value === undefined) return value
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (Array.isArray(value)) return value.map(serializeSupportValue)
  if (typeof value === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: Record<string, any> = {}
    for (const [key, item] of Object.entries(value)) out[key] = serializeSupportValue(item)
    return out
  }
  return value
}

function toTicket(id: string, data: RawDoc, orgName?: string): SupportTicket {
  return serializeSupportValue({
    id,
    orgName,
    orgId: String(data.orgId ?? ''),
    createdBy: String(data.createdBy ?? ''),
    requesterName: String(data.requesterName ?? 'Client'),
    requesterEmail: String(data.requesterEmail ?? ''),
    category: data.category ?? 'question',
    subject: data.subject ?? 'Support request',
    description: data.description ?? '',
    status: data.status ?? 'new',
    priority: data.priority ?? 'normal',
    sourceUrl: data.sourceUrl ?? '',
    sourcePath: data.sourcePath ?? '',
    companyId: data.companyId ?? null,
    contactId: data.contactId ?? null,
    clientOrgId: data.clientOrgId ?? null,
    projectId: data.projectId ?? null,
    dealId: data.dealId ?? null,
    companyIds: Array.isArray(data.companyIds) ? data.companyIds : [],
    contactIds: Array.isArray(data.contactIds) ? data.contactIds : [],
    clientOrgIds: Array.isArray(data.clientOrgIds) ? data.clientOrgIds : [],
    projectIds: Array.isArray(data.projectIds) ? data.projectIds : [],
    dealIds: Array.isArray(data.dealIds) ? data.dealIds : [],
    researchItemIds: Array.isArray(data.researchItemIds) ? data.researchItemIds : [],
    socialPostIds: Array.isArray(data.socialPostIds) ? data.socialPostIds : [],
    emailThreadIds: Array.isArray(data.emailThreadIds) ? data.emailThreadIds : [],
    contextRefs: Array.isArray(data.contextRefs) ? data.contextRefs : [],
    assignedToType: data.assignedToType ?? null,
    assigneeUserId: data.assigneeUserId ?? null,
    assigneeAgentId: data.assigneeAgentId ?? null,
    hermesStatus: data.hermesStatus ?? 'not_started',
    hermesSummary: data.hermesSummary ?? null,
    messageCount: typeof data.messageCount === 'number' ? data.messageCount : 0,
    lastMessagePreview: data.lastMessagePreview ?? '',
    lastMessageAt: data.lastMessageAt ?? null,
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
    resolvedAt: data.resolvedAt ?? null,
    deleted: data.deleted === true,
  }) as SupportTicket
}

function toMessage(id: string, data: RawDoc): SupportMessage {
  return serializeSupportValue({
    id,
    ticketId: data.ticketId ?? '',
    orgId: data.orgId ?? '',
    authorId: data.authorId ?? '',
    authorRole: data.authorRole ?? 'client',
    authorName: data.authorName ?? 'Client',
    body: data.body ?? '',
    attachments: Array.isArray(data.attachments) ? data.attachments : [],
    contextRefs: Array.isArray(data.contextRefs) ? data.contextRefs : [],
    createdAt: data.createdAt ?? null,
  }) as SupportMessage
}

export function validateSupportInput(body: Record<string, unknown>) {
  const category = isCategory(body.category) ? body.category : 'question'
  const priority = isPriority(body.priority) ? body.priority : category === 'urgent' ? 'urgent' : 'normal'
  const subject = cleanText(body.subject, MAX_SUBJECT)
  const description = cleanText(body.description)
  const sourceUrl = cleanText(body.sourceUrl, 500)
  const sourcePath = cleanText(body.sourcePath, 240)

  if (!subject) return { ok: false as const, error: 'Subject is required' }
  if (!description) return { ok: false as const, error: 'Description is required' }

  return { ok: true as const, value: { category, priority, subject, description, sourceUrl, sourcePath } }
}

export async function createSupportTicket(args: {
  orgId: string
  uid: string
  requesterName: string
  requesterEmail: string
  category: SupportCategory
  priority: SupportPriority
  subject: string
  description: string
  sourceUrl?: string
  sourcePath?: string
  contextRefs?: ContextReference[]
  relationshipLinks?: ResourceRelationshipLinkSet
}) {
  const ref = adminDb.collection(SUPPORT_TICKETS_COLLECTION).doc()
  const batch = adminDb.batch()

  const ticket = {
    orgId: args.orgId,
    createdBy: args.uid,
    requesterName: args.requesterName || 'Client',
    requesterEmail: args.requesterEmail || '',
    category: args.category,
    subject: args.subject,
    description: args.description,
    status: 'new' satisfies SupportStatus,
    priority: args.priority,
    sourceUrl: args.sourceUrl ?? '',
    sourcePath: args.sourcePath ?? '',
    ...(args.relationshipLinks ?? {}),
    contextRefs: args.contextRefs ?? [],
    assignedToType: null,
    assigneeUserId: null,
    assigneeAgentId: null,
    hermesStatus: 'not_started',
    hermesSummary: null,
    messageCount: 1,
    lastMessagePreview: args.description.slice(0, 180),
    lastMessageAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    deleted: false,
  }

  const messageRef = adminDb.collection(SUPPORT_MESSAGES_COLLECTION).doc()
  batch.set(ref, ticket)
  batch.set(messageRef, {
    ticketId: ref.id,
    orgId: args.orgId,
    authorId: args.uid,
    authorRole: 'client' satisfies SupportAuthorRole,
    authorName: args.requesterName || 'Client',
    body: args.description,
    attachments: [],
    contextRefs: args.contextRefs ?? [],
    createdAt: FieldValue.serverTimestamp(),
  })
  batch.set(adminDb.collection('notifications').doc(), {
    orgId: args.orgId,
    userId: null,
    agentId: null,
    type: 'support.ticket_created',
    title: `New support ticket: ${args.subject}`,
    body: args.description.slice(0, 240),
    link: `/admin/support?ticket=${ref.id}`,
    status: 'unread',
    priority: args.priority,
    createdAt: FieldValue.serverTimestamp(),
  })

  await batch.commit()
  return ref.id
}

export async function listPortalSupportTickets(orgId: string, uid: string) {
  const snap = await adminDb
    .collection(SUPPORT_TICKETS_COLLECTION)
    .where('orgId', '==', orgId)
    .where('createdBy', '==', uid)
    .get()

  return snap.docs
    .map((doc) => toTicket(doc.id, doc.data()))
    .filter((ticket) => ticket.deleted !== true)
    .sort((a, b) => millis(b.updatedAt) - millis(a.updatedAt))
}

export async function listAdminSupportTickets(allowedOrgIds?: string[]) {
  let query: Query = adminDb.collection(SUPPORT_TICKETS_COLLECTION)
  if (allowedOrgIds?.length) query = query.where('orgId', 'in', allowedOrgIds.slice(0, 30))
  const snap = await query.get()
  const tickets = snap.docs
    .map((doc) => ({ id: doc.id, data: doc.data() }))
    .filter((row) => row.data.deleted !== true)

  const orgIds = Array.from(new Set(tickets.map((row) => String(row.data.orgId ?? '')).filter(Boolean)))
  const orgNames = new Map<string, string>()
  await Promise.all(orgIds.map(async (orgId) => {
    const org = await adminDb.collection('organizations').doc(orgId).get()
    orgNames.set(orgId, org.exists ? String(org.data()?.name ?? orgId) : orgId)
  }))

  return tickets
    .map((row) => toTicket(row.id, row.data, orgNames.get(String(row.data.orgId ?? ''))))
    .sort((a, b) => millis(b.updatedAt) - millis(a.updatedAt))
}

export async function getSupportTicket(id: string) {
  const snap = await adminDb.collection(SUPPORT_TICKETS_COLLECTION).doc(id).get()
  if (!snap.exists || snap.data()?.deleted === true) return null
  return toTicket(snap.id, snap.data() ?? {})
}

export async function listSupportMessages(ticketId: string) {
  const snap = await adminDb
    .collection(SUPPORT_MESSAGES_COLLECTION)
    .where('ticketId', '==', ticketId)
    .get()

  return snap.docs
    .map((doc) => toMessage(doc.id, doc.data()))
    .sort((a, b) => millis(a.createdAt) - millis(b.createdAt))
}

export async function addSupportMessage(args: {
  ticketId: string
  orgId: string
  authorId: string
  authorRole: SupportAuthorRole
  authorName: string
  body: string
  contextRefs?: ContextReference[]
}) {
  const body = cleanText(args.body)
  if (!body) return { ok: false as const, error: 'Message body is required' }

  const batch = adminDb.batch()
  const messageRef = adminDb.collection(SUPPORT_MESSAGES_COLLECTION).doc()
  batch.set(messageRef, {
    ticketId: args.ticketId,
    orgId: args.orgId,
    authorId: args.authorId,
    authorRole: args.authorRole,
    authorName: args.authorName || (args.authorRole === 'client' ? 'Client' : 'Partners in Biz'),
    body,
    attachments: [],
    contextRefs: args.contextRefs ?? [],
    createdAt: FieldValue.serverTimestamp(),
  })

  const ticketRef = adminDb.collection(SUPPORT_TICKETS_COLLECTION).doc(args.ticketId)
  batch.update(ticketRef, {
    status: args.authorRole === 'client' ? 'waiting_on_us' : 'waiting_on_client',
    messageCount: FieldValue.increment(1),
    lastMessagePreview: body.slice(0, 180),
    lastMessageAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  await batch.commit()
  return { ok: true as const, id: messageRef.id }
}

export function validateSupportPatch(body: Record<string, unknown>) {
  const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }

  if ('status' in body) {
    if (!isStatus(body.status)) return { ok: false as const, error: 'Invalid status' }
    updates.status = body.status
    updates.resolvedAt = body.status === 'resolved' ? FieldValue.serverTimestamp() : null
  }
  if ('priority' in body) {
    if (!isPriority(body.priority)) return { ok: false as const, error: 'Invalid priority' }
    updates.priority = body.priority
  }
  if ('assigneeAgentId' in body) {
    updates.assigneeAgentId = cleanText(body.assigneeAgentId, 80) || null
    updates.assignedToType = updates.assigneeAgentId ? 'agent' : null
  }
  if ('assigneeUserId' in body) {
    updates.assigneeUserId = cleanText(body.assigneeUserId, 120) || null
    updates.assignedToType = updates.assigneeUserId ? 'user' : updates.assignedToType ?? null
  }
  if ('hermesSummary' in body) {
    updates.hermesSummary = cleanText(body.hermesSummary, 2_000) || null
    updates.hermesStatus = updates.hermesSummary ? 'suggested' : 'not_started'
  }

  return { ok: true as const, value: updates }
}
