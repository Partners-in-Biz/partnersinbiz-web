import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { SalesReplyClassification } from './reply-classification'

export type ReplySlaFilter = 'due' | 'missed'
export type ReplyQueueFilters = {
  classification?: SalesReplyClassification
  sla?: ReplySlaFilter
  ownerUserId?: string
  queueId?: string
  cursor: string | null
  limit: number
}

export type ReplyQueueItem = {
  id: string
  inboundId: string
  contactId: string
  ownerUserId: string | null
  queueId: string | null
  salespersonUid: string | null
  campaignId: string
  programId: string
  sequenceId: string
  broadcastId: string
  subject: string
  bodyText: string
  fromEmail: string
  receivedAt: number | null
  classification: SalesReplyClassification
  modelClassification: SalesReplyClassification
  confidence: number | null
  corrected: boolean
  correctedBy: string | null
  slaDueAt: number | null
  slaState: 'due' | 'missed' | 'completed'
}

function text(value: unknown): string { return typeof value === 'string' ? value.trim() : '' }
function millis(value: unknown): number | null {
  if (!value || typeof value !== 'object') return typeof value === 'number' && Number.isFinite(value) ? value : null
  const timestamp = value as { toMillis?: () => number; _seconds?: number }
  if (typeof timestamp.toMillis === 'function') return timestamp.toMillis()
  return typeof timestamp._seconds === 'number' ? timestamp._seconds * 1000 : null
}

export function normalizeReplyQueueItem(id: string, data: Record<string, unknown>, now = Date.now()): ReplyQueueItem {
  const model = (data.classification ?? data.salesClassification ?? {}) as Record<string, unknown>
  const correction = (data.classificationCorrection ?? {}) as Record<string, unknown>
  const modelClassification = (text(model.classification) || 'neutral') as SalesReplyClassification
  const classification = (text(correction.classification) || modelClassification) as SalesReplyClassification
  const startedAt = millis(data.receivedAt) ?? millis(data.createdAt)
  const slaMinutes = Math.max(1, Math.min(10_080, Math.floor(Number(data.slaMinutes) || 60)))
  const slaDueAt = startedAt === null ? null : startedAt + slaMinutes * 60_000
  const completed = Boolean(data.completedAt || data.closedAt || data.resolvedAt)
  return {
    id, inboundId: text(data.inboundId), contactId: text(data.contactId),
    ownerUserId: text(data.ownerUserId) || null, queueId: text(data.queueId) || null,
    salespersonUid: text(data.salespersonUid) || null,
    campaignId: text(data.campaignId), programId: text(data.programId), sequenceId: text(data.sequenceId), broadcastId: text(data.broadcastId),
    subject: text(data.subject), bodyText: typeof data.bodyText === 'string' ? data.bodyText : '', fromEmail: text(data.fromEmail),
    receivedAt: startedAt, classification, modelClassification,
    confidence: Number.isFinite(Number(model.confidence)) ? Number(model.confidence) : null,
    corrected: Boolean(text(correction.classification)), correctedBy: text(correction.correctedBy) || null,
    slaDueAt, slaState: completed ? 'completed' : slaDueAt !== null && now > slaDueAt ? 'missed' : 'due',
  }
}

export async function listReplyQueue(orgId: string, filters: ReplyQueueFilters) {
  const snapshot = await adminDb.collection('email_reply_routes').where('orgId', '==', orgId).limit(500).get()
  let items = snapshot.docs
    .map((doc) => normalizeReplyQueueItem(doc.id, doc.data()))
    .sort((a, b) => (b.receivedAt ?? 0) - (a.receivedAt ?? 0) || a.id.localeCompare(b.id))
  if (filters.classification) items = items.filter((item) => item.classification === filters.classification)
  if (filters.sla) items = items.filter((item) => item.slaState === filters.sla)
  if (filters.ownerUserId) items = items.filter((item) => item.ownerUserId === filters.ownerUserId)
  if (filters.queueId) items = items.filter((item) => item.queueId === filters.queueId)
  if (filters.cursor) {
    const cursorIndex = items.findIndex((item) => item.id === filters.cursor)
    items = cursorIndex < 0 ? [] : items.slice(cursorIndex + 1)
  }
  const page = items.slice(0, filters.limit)
  return { items: page, nextCursor: items.length > filters.limit ? page.at(-1)?.id ?? null : null }
}

export async function correctReplyClassification(
  orgId: string, id: string, classification: SalesReplyClassification, actorUid: string, reason: string,
) {
  const ref = adminDb.collection('email_reply_routes').doc(id)
  return adminDb.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref)
    if (!snapshot.exists || snapshot.data()?.orgId !== orgId) return null
    const previous = normalizeReplyQueueItem(snapshot.id, snapshot.data() ?? {})
    const correction = { classification, correctedBy: actorUid, reason: text(reason) || null, correctedAt: FieldValue.serverTimestamp() }
    tx.update(ref, { classificationCorrection: correction, updatedAt: FieldValue.serverTimestamp() })
    tx.create(adminDb.collection('email_reply_classification_audit').doc(), {
      orgId, replyRouteId: id, inboundId: previous.inboundId || null, previousClassification: previous.classification,
      modelClassification: previous.modelClassification, classification, reason: correction.reason,
      actorUid, createdAt: FieldValue.serverTimestamp(),
    })
    if (previous.inboundId) {
      tx.set(adminDb.collection('inbound_emails').doc(previous.inboundId), { classificationCorrection: correction }, { merge: true })
    }
    return { ...previous, classification, corrected: true, correctedBy: actorUid }
  })
}
