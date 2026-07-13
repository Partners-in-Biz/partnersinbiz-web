import { createHash } from 'node:crypto'
import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { SalesReplyClassification } from './reply-classification'

export type ReplySlaFilter = 'due' | 'missed'
export type ReplyQueueFilters = { classification?: SalesReplyClassification; sla?: ReplySlaFilter; ownerUserId?: string; queueId?: string; cursor: string | null; limit: number }
export type ReplyQueueDocument = { id: string; data: Record<string, unknown> }
export type ReplyQueuePage = { docs: ReplyQueueDocument[]; nextCursor: string | null }
export type ReplyQueueDependencies = { queryPage(orgId: string, cursor: string | null, pageSize: number): Promise<ReplyQueuePage> }
export type ReplyQueueItem = {
  id: string; inboundId: string; contactId: string; ownerUserId: string | null; queueId: string | null; salespersonUid: string | null
  campaignId: string; programId: string; sequenceId: string; broadcastId: string; subject: string; bodyText: string; fromEmail: string
  receivedAt: number | null; classification: SalesReplyClassification; modelClassification: SalesReplyClassification; confidence: number | null
  corrected: boolean; correctedBy: string | null; slaDueAt: number | null; slaState: 'due' | 'missed' | 'completed'
  escalationState: 'not_due' | 'escalation_due' | 'completed'; escalationPath: string[]
}

function text(value: unknown): string { return typeof value === 'string' ? value.trim() : '' }
function millis(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (!value || typeof value !== 'object') return null
  const timestamp = value as { toMillis?: () => number; _seconds?: number }
  if (typeof timestamp.toMillis === 'function') return timestamp.toMillis()
  return typeof timestamp._seconds === 'number' ? timestamp._seconds * 1000 : null
}
function publicCursor(item: Pick<ReplyQueueItem, 'id' | 'receivedAt'>): string {
  return Buffer.from(JSON.stringify({ receivedAt: item.receivedAt ?? 0, id: item.id })).toString('base64url')
}
function matches(item: ReplyQueueItem, filters: ReplyQueueFilters) {
  return (!filters.classification || item.classification === filters.classification)
    && (!filters.sla || item.slaState === filters.sla)
    && (!filters.ownerUserId || item.ownerUserId === filters.ownerUserId)
    && (!filters.queueId || item.queueId === filters.queueId)
}

export function normalizeReplyQueueItem(id: string, data: Record<string, unknown>, now = Date.now()): ReplyQueueItem {
  const model = (data.classification ?? data.salesClassification ?? {}) as Record<string, unknown>
  const correction = (data.classificationCorrection ?? {}) as Record<string, unknown>
  const modelClassification = (text(model.classification) || 'neutral') as SalesReplyClassification
  const classification = (text(correction.classification) || modelClassification) as SalesReplyClassification
  const receivedAt = millis(data.receivedAt)
  const slaDueAt = millis(data.slaDueAt)
  const completed = Boolean(data.completedAt || data.closedAt || data.resolvedAt)
  const confidenceValue = Number(model.confidence)
  const confidence = Number.isFinite(confidenceValue) ? Math.max(0, Math.min(1, confidenceValue)) : null
  const ownerUserId = text(data.ownerUserId) || null
  const queueId = text(data.queueId) || null
  const escalationPath = Array.isArray(data.escalationPath) ? data.escalationPath.map(text).filter(Boolean) : [ownerUserId ? `user:${ownerUserId}` : '', queueId ? `queue:${queueId}` : '', 'organisation_fallback'].filter(Boolean)
  const slaState = completed ? 'completed' : slaDueAt !== null && now > slaDueAt ? 'missed' : 'due'
  return {
    id, inboundId: text(data.inboundId), contactId: text(data.contactId), ownerUserId, queueId,
    salespersonUid: text(data.salespersonUid) || null, campaignId: text(data.campaignId), programId: text(data.programId),
    sequenceId: text(data.sequenceId), broadcastId: text(data.broadcastId), subject: text(data.subject),
    bodyText: typeof data.bodyText === 'string' ? data.bodyText : '', fromEmail: text(data.fromEmail), receivedAt,
    classification, modelClassification, confidence, corrected: Boolean(text(correction.classification)), correctedBy: text(correction.correctedBy) || null,
    slaDueAt, slaState, escalationState: completed ? 'completed' : slaState === 'missed' ? 'escalation_due' : 'not_due', escalationPath,
  }
}

export async function listReplyQueue(orgId: string, filters: ReplyQueueFilters, dependencies: ReplyQueueDependencies = firestoreReplyQueueDependencies) {
  const items: ReplyQueueItem[] = []
  let datastoreCursor = filters.cursor
  let hasMore = false
  do {
    const page = await dependencies.queryPage(orgId, datastoreCursor, 100)
    for (const doc of page.docs) {
      const item = normalizeReplyQueueItem(doc.id, doc.data)
      if (matches(item, filters)) items.push(item)
      if (items.length >= filters.limit) break
    }
    datastoreCursor = page.nextCursor
    hasMore = Boolean(page.nextCursor)
    if (items.length >= filters.limit || !datastoreCursor) break
  } while (true)
  return { items, nextCursor: items.length === filters.limit && (hasMore || items.length > 0) ? publicCursor(items[items.length - 1]) : null }
}

function decodeCursor(cursor: string | null): { receivedAt: number; id: string } | null {
  if (!cursor) return null
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as Record<string, unknown>
    return Number.isFinite(Number(parsed.receivedAt)) && text(parsed.id) ? { receivedAt: Number(parsed.receivedAt), id: text(parsed.id) } : null
  } catch { return null }
}

export const firestoreReplyQueueDependencies: ReplyQueueDependencies = {
  async queryPage(orgId, cursor, pageSize) {
    let query = adminDb.collection('email_reply_routes').where('orgId', '==', orgId)
      .orderBy('receivedAt', 'desc').orderBy(FieldPath.documentId(), 'desc').limit(pageSize)
    const decoded = decodeCursor(cursor)
    if (cursor && !decoded) return { docs: [], nextCursor: null }
    if (decoded) query = query.startAfter(Timestamp.fromMillis(decoded.receivedAt), decoded.id)
    const snapshot = await query.get()
    const docs = snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }))
    const last = docs.at(-1)
    return { docs, nextCursor: docs.length === pageSize && last ? publicCursor(normalizeReplyQueueItem(last.id, last.data)) : null }
  },
}

export async function correctReplyClassification(orgId: string, id: string, classification: SalesReplyClassification, actorUid: string, reason: string, idempotencyKey: string) {
  const routeRef = adminDb.collection('email_reply_routes').doc(id)
  const auditId = `correction_${createHash('sha256').update(`${orgId}:${id}:${idempotencyKey}`).digest('hex')}`
  return adminDb.runTransaction(async (tx) => {
    const routeSnapshot = await tx.get(routeRef)
    if (!routeSnapshot.exists || routeSnapshot.data()?.orgId !== orgId) return null
    const previous = normalizeReplyQueueItem(routeSnapshot.id, routeSnapshot.data() ?? {})
    const inboundRef = previous.inboundId ? adminDb.collection('inbound_emails').doc(previous.inboundId) : null
    const auditRef = adminDb.collection('email_reply_classification_audit').doc(auditId)
    const [inboundSnapshot, auditSnapshot] = await Promise.all([
      inboundRef ? tx.get(inboundRef) : Promise.resolve(null), tx.get(auditRef),
    ])
    if (inboundSnapshot && (!inboundSnapshot.exists || inboundSnapshot.data()?.orgId !== orgId)) {
      throw new Error('Inbound reply does not belong to route organisation')
    }
    if (auditSnapshot.exists) return { ...previous, classification, corrected: true, correctedBy: actorUid }
    const correction = { classification, correctedBy: actorUid, reason: text(reason) || null, idempotencyKey, correctedAt: FieldValue.serverTimestamp() }
    tx.update(routeRef, { classificationCorrection: correction, effectiveClassification: classification, updatedAt: FieldValue.serverTimestamp() })
    tx.create(auditRef, { orgId, replyRouteId: id, inboundId: previous.inboundId || null, previousClassification: previous.classification, modelClassification: previous.modelClassification, classification, reason: correction.reason, actorUid, idempotencyKey, createdAt: FieldValue.serverTimestamp() })
    if (inboundRef) tx.set(inboundRef, { classificationCorrection: correction, effectiveClassification: classification }, { merge: true })
    return { ...previous, classification, corrected: true, correctedBy: actorUid }
  })
}
