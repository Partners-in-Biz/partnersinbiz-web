import { createHash } from 'node:crypto'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { ClassifiedSalesReply } from './reply-classification'

export type ReplyResolutionSource = 'sender_snapshot' | 'fallback_user' | 'fallback_queue' | 'unassigned'

export interface ReplyOutboundSnapshot {
  orgId: string
  contactId?: string
  senderOwnerUid?: string | null
  replyFallbackUserId?: string | null
  replyFallbackQueueId?: string | null
  campaignId?: string
  sequenceId?: string
  broadcastId?: string
  programId?: string
  variantId?: string
  stopOnReply?: boolean
}

export interface ReplyRoutingInput {
  inboundId: string
  inboundOrgId: string
  outboundEmailId: string
  outbound: ReplyOutboundSnapshot
  subject: string
  bodyText: string
  fromEmail: string
  receivedAt: unknown
  salesClassification?: ClassifiedSalesReply
}

export interface ReplyMember {
  uid: string
  active: boolean
}

export interface ReplyContact {
  id: string
  orgId: string
  name?: string
  email?: string
  companyId?: string
}

export interface ReplyFallback {
  userId: string | null
  queueId: string | null
  slaMinutes: number
}

export interface ReplyRouteRecord {
  idempotencyKey: string
  orgId: string
  inboundId: string
  outboundEmailId: string
  contactId: string
  ownerUserId: string | null
  queueId: string | null
  resolutionSource: ReplyResolutionSource
  fallbackReason: string | null
  campaignId: string
  sequenceId: string
  broadcastId: string
  programId: string
  variantId: string
  salespersonUid: string | null
  stopOnReply: boolean
  subject: string
  bodyText: string
  fromEmail: string
  receivedAt: unknown
  slaMinutes: number
}

export interface PersistedReplyRoute extends ReplyRouteRecord {
  created: boolean
}

export interface ReplyRoutingDependencies {
  getMember(orgId: string, uid: string): Promise<ReplyMember | null>
  getContact(orgId: string, contactId: string): Promise<ReplyContact | null>
  getFallback(orgId: string): Promise<ReplyFallback>
  persist(record: ReplyRouteRecord): Promise<PersistedReplyRoute>
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function recordId(prefix: string, value: string): string {
  return `${prefix}_${createHash('sha256').update(value).digest('hex')}`
}

async function activeMember(deps: ReplyRoutingDependencies, orgId: string, uid: string): Promise<boolean> {
  if (!uid) return false
  const member = await deps.getMember(orgId, uid)
  return Boolean(member?.active && member.uid === uid)
}

export async function routeReplyToSales(
  input: ReplyRoutingInput,
  dependencies: ReplyRoutingDependencies = firestoreReplyRoutingDependencies,
): Promise<PersistedReplyRoute> {
  const orgId = clean(input.outbound.orgId)
  if (!orgId) throw new Error('Outbound message has no organisation lineage')
  if (clean(input.inboundOrgId) && clean(input.inboundOrgId) !== orgId) {
    throw new Error('Inbound/outbound organisation mismatch')
  }

  const contactId = clean(input.outbound.contactId)
  if (contactId) {
    const contact = await dependencies.getContact(orgId, contactId)
    if (!contact || contact.orgId !== orgId) throw new Error('Contact does not belong to outbound organisation')
  }

  const snapshotOwner = clean(input.outbound.senderOwnerUid)
  let ownerUserId: string | null = null
  let queueId: string | null = null
  let resolutionSource: ReplyResolutionSource = 'unassigned'
  let fallbackReason: string | null = null
  let slaMinutes = 60

  if (snapshotOwner && await activeMember(dependencies, orgId, snapshotOwner)) {
    ownerUserId = snapshotOwner
    resolutionSource = 'sender_snapshot'
  } else {
    fallbackReason = snapshotOwner ? 'snapshotted_owner_inactive' : 'snapshotted_owner_missing'
    const configured = await dependencies.getFallback(orgId)
    slaMinutes = configured.slaMinutes
    const explicitUser = clean(input.outbound.replyFallbackUserId) || clean(configured.userId)
    const explicitQueue = clean(input.outbound.replyFallbackQueueId) || clean(configured.queueId)
    if (explicitUser && await activeMember(dependencies, orgId, explicitUser)) {
      ownerUserId = explicitUser
      queueId = explicitQueue || null
      resolutionSource = 'fallback_user'
    } else if (explicitQueue) {
      queueId = explicitQueue
      resolutionSource = 'fallback_queue'
      if (explicitUser) fallbackReason = 'fallback_user_inactive'
    }
  }

  return dependencies.persist({
    idempotencyKey: `${orgId}:${clean(input.inboundId)}`,
    orgId,
    inboundId: clean(input.inboundId),
    outboundEmailId: clean(input.outboundEmailId),
    contactId,
    ownerUserId,
    queueId,
    resolutionSource,
    fallbackReason,
    campaignId: clean(input.outbound.campaignId),
    sequenceId: clean(input.outbound.sequenceId),
    broadcastId: clean(input.outbound.broadcastId),
    programId: clean(input.outbound.programId),
    variantId: clean(input.outbound.variantId),
    salespersonUid: snapshotOwner || ownerUserId,
    stopOnReply: input.outbound.stopOnReply !== false,
    subject: clean(input.subject),
    bodyText: typeof input.bodyText === 'string' ? input.bodyText : '',
    fromEmail: clean(input.fromEmail).toLowerCase(),
    receivedAt: input.receivedAt,
    slaMinutes: Math.max(1, Math.min(10_080, Math.floor(slaMinutes || 60))),
    ...(input.salesClassification ? { classification: input.salesClassification } : {}),
  })
}

export const firestoreReplyRoutingDependencies: ReplyRoutingDependencies = {
  async getMember(orgId, uid) {
    const snap = await adminDb.collection('orgMembers').doc(`${orgId}_${uid}`).get()
    if (!snap.exists) return null
    const data = snap.data() ?? {}
    const active = !data.disabled && !data.deletedAt && (!data.status || ['active', 'enabled'].includes(data.status))
    return { uid: clean(data.uid) || uid, active }
  },

  async getContact(orgId, contactId) {
    const snap = await adminDb.collection('contacts').doc(contactId).get()
    if (!snap.exists) return null
    const data = snap.data() ?? {}
    if (data.orgId !== orgId || data.deleted) return null
    return { id: snap.id, orgId: data.orgId, name: clean(data.name), email: clean(data.email), companyId: clean(data.companyId) }
  },

  async getFallback(orgId) {
    const snap = await adminDb.collection('organizations').doc(orgId).get()
    const settings = (snap.data()?.settings ?? {}) as Record<string, unknown>
    return {
      userId: clean(settings.replyFallbackUserId) || null,
      queueId: clean(settings.replyFallbackQueueId) || null,
      slaMinutes: Number(settings.replySlaMinutes) || 60,
    }
  },

  async persist(record) {
    const routeId = recordId('reply', record.idempotencyKey)
    const routeRef = adminDb.collection('email_reply_routes').doc(routeId)
    const conversationRef = adminDb.collection('communication_conversations').doc(recordId('email_reply', `${record.orgId}:${record.outboundEmailId || record.inboundId}`))
    const messageRef = adminDb.collection('communication_messages').doc(recordId('inbound', record.idempotencyKey))
    const activityRef = adminDb.collection('activities').doc(recordId('email_reply', record.idempotencyKey))
    const attributionRef = adminDb.collection('crm_attributions').doc(recordId('email_reply', record.idempotencyKey))
    const taskRef = adminDb.collection('tasks').doc(recordId('email_reply', record.idempotencyKey))
    const notificationRef = adminDb.collection('notifications').doc(recordId('email_reply', record.idempotencyKey))
    const inboundRef = adminDb.collection('inbound_emails').doc(record.inboundId)
    const now = FieldValue.serverTimestamp()
    const dueAt = Timestamp.fromMillis(Date.now() + record.slaMinutes * 60_000)

    const enrollmentDocs: Array<{ ref: FirebaseFirestore.DocumentReference }> = []
    if (record.stopOnReply && record.sequenceId && record.contactId) {
      const snap = await adminDb.collection('sequence_enrollments')
        .where('orgId', '==', record.orgId)
        .where('contactId', '==', record.contactId)
        .where('sequenceId', '==', record.sequenceId)
        .where('status', '==', 'active')
        .get()
      enrollmentDocs.push(...snap.docs)
    }

    return adminDb.runTransaction(async (tx) => {
      const existing = await tx.get(routeRef)
      if (existing.exists) return { ...(existing.data() as ReplyRouteRecord), created: false }

      tx.create(routeRef, { ...record, conversationId: conversationRef.id, createdAt: now, updatedAt: now })
      tx.set(conversationRef, {
        orgId: record.orgId,
        channel: 'email',
        status: 'open',
        priority: 'high',
        contactId: record.contactId || null,
        contactSnapshot: { id: record.contactId || undefined, email: record.fromEmail },
        queueId: record.queueId,
        assigneeAgentId: null,
        assigneeUserId: record.ownerUserId,
        labels: ['campaign-reply', 'sales-follow-up'],
        campaignId: record.campaignId || null,
        campaignReplySource: record.outboundEmailId,
        subject: record.subject,
        lastMessagePreview: record.bodyText.slice(0, 160),
        lastInboundMessageAt: record.receivedAt || now,
        lastMessageAt: record.receivedAt || now,
        snoozedUntil: null,
        createdAt: now,
        updatedAt: now,
        deleted: false,
      }, { merge: true })
      tx.create(messageRef, {
        orgId: record.orgId,
        conversationId: conversationRef.id,
        channel: 'email',
        direction: 'inbound',
        body: record.bodyText,
        subject: record.subject,
        status: 'received',
        campaignId: record.campaignId || null,
        contactId: record.contactId || null,
        provider: { id: 'resend', externalMessageId: record.inboundId },
        createdBy: 'system:email-reply',
        createdByType: 'system',
        createdAt: record.receivedAt || now,
        deleted: false,
      })
      tx.create(activityRef, {
        orgId: record.orgId,
        contactId: record.contactId,
        type: 'email_replied',
        summary: `Reply: ${record.subject || '(no subject)'}`,
        metadata: {
          inboundEmailId: record.inboundId,
          replyToEmailId: record.outboundEmailId,
          conversationId: conversationRef.id,
          campaignId: record.campaignId,
          sequenceId: record.sequenceId,
          broadcastId: record.broadcastId,
          programId: record.programId,
          variantId: record.variantId,
          salespersonUid: record.salespersonUid,
        },
        createdBy: 'system:email-reply',
        createdAt: now,
      })
      tx.create(attributionRef, {
        orgId: record.orgId,
        event: 'reply',
        inboundEmailId: record.inboundId,
        emailId: record.outboundEmailId,
        contactId: record.contactId,
        campaignId: record.campaignId,
        sequenceId: record.sequenceId,
        broadcastId: record.broadcastId,
        programId: record.programId,
        variantId: record.variantId,
        salespersonUid: record.salespersonUid,
        occurredAt: record.receivedAt || now,
        createdAt: now,
      })
      tx.create(taskRef, {
        orgId: record.orgId,
        title: `Follow up on email reply: ${record.subject || '(no subject)'}`,
        status: 'pending',
        priority: 'high',
        assignedTo: record.ownerUserId ? { type: 'user', id: record.ownerUserId } : null,
        queueId: record.queueId,
        contactId: record.contactId || null,
        dueAt,
        source: 'email_reply',
        sourceId: record.inboundId,
        createdAt: now,
        updatedAt: now,
        deleted: false,
      })
      tx.create(notificationRef, {
        orgId: record.orgId,
        userId: record.ownerUserId,
        queueId: record.queueId,
        type: 'email_reply',
        message: `Reply received: ${record.subject || '(no subject)'}`,
        contactId: record.contactId || null,
        conversationId: conversationRef.id,
        read: false,
        createdAt: now,
      })
      tx.set(inboundRef, {
        orgId: record.orgId,
        contactId: record.contactId,
        replyRouteId: routeId,
        conversationId: conversationRef.id,
        assignedTo: record.ownerUserId,
        queueId: record.queueId,
        campaignId: record.campaignId,
        sequenceId: record.sequenceId,
        broadcastId: record.broadcastId,
        programId: record.programId,
        variantId: record.variantId,
        processed: true,
        processedAt: now,
      }, { merge: true })
      if (record.contactId) {
        tx.update(adminDb.collection('contacts').doc(record.contactId), {
          lastRepliedAt: now,
          repliesCount: FieldValue.increment(1),
          updatedAt: now,
        })
      }
      for (const enrollment of enrollmentDocs) {
        tx.update(enrollment.ref, { status: 'paused', exitReason: 'replied', pausedAt: now, updatedAt: now })
      }
      return { ...record, created: true }
    })
  },
}
