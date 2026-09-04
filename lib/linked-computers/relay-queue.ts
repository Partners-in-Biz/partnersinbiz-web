import crypto from 'node:crypto'
import { isValidAgentId, type AgentId } from '@/lib/agents/types'
import { getAgentRoom, listAgentRooms } from '@/lib/agent-rooms/store'
import type { AgentRoom } from '@/lib/agent-rooms/types'
import { adminDb } from '@/lib/firebase/admin'
import {
  decryptLinkedRunPayload,
  encryptLinkedRunPayload,
  LINKED_RELAY_CONTEXT,
  sanitizeLinkedResult,
  type EncryptedLinkedRunPayload,
} from '@/lib/linked-computers/run-queue'

export const LINKED_RELAY_ENVELOPES = 'linked_device_relay_envelopes'
export const LINKED_RELAY_QUEUES = 'linked_device_relay_queues'
export const RELAY_TTL_MS = 15 * 60 * 1000
export const RELAY_LEASE_MS = 90_000
export const RELAY_MAX_PAYLOAD_BYTES = 64 * 1024
export const RELAY_NOT_TEAMMATES = 'not_teammates'

const DEVICES = 'linked_devices'
const GRANTS = 'linked_device_grants'
const QUEUE_LIMIT = 500
const OUTBOX_ITEM_ID = /^[A-Za-z0-9._:-]{1,128}$/
const ENVELOPE_ID = /^[A-Za-z0-9_-]{1,128}$/
const PROFILE = /^[\x20-\x7E]{1,160}$/

export type RelayKind = 'dm' | 'room_turn'
export type RelayStatus = 'queued' | 'claimed' | 'delivered' | 'replied' | 'failed' | 'expired'
export type RelayReplyStatus = 'queued' | 'claimed' | 'delivered'
export type RelayClaimRole = 'inbound' | 'reply'

export interface RelayEndpoint {
  deviceId: string
  profile: string
  agentId: AgentId
}

export interface RelayPayload {
  text?: string
  [key: string]: unknown
}

export interface RelayReply {
  encryptedPayload: EncryptedLinkedRunPayload
  status: RelayReplyStatus
}

export interface RelayEnvelope {
  envelopeId: string
  idempotencyKey: string
  orgId: string
  roomId: string | null
  from: RelayEndpoint
  to: RelayEndpoint
  kind: RelayKind
  encryptedPayload: EncryptedLinkedRunPayload
  status: RelayStatus
  failureReason?: string
  attempt: number
  leaseToken?: string
  leaseExpiresAtMs?: number
  reply?: RelayReply
  createdAtMs: number
  updatedAtMs: number
  expiresAtMs: number
}

export interface PublicClaimedRelay {
  envelopeId: string
  orgId: string
  roomId: string | null
  from: RelayEndpoint
  to: RelayEndpoint
  kind: RelayKind
  role: RelayClaimRole
  payload: RelayPayload
  attempt: number
  leaseToken: string
}

export class RelayNotTeammatesError extends Error {
  readonly reason = RELAY_NOT_TEAMMATES
  readonly status = 403
  constructor(message = 'These agents are not in a shared room.') {
    super(message)
    this.name = 'RelayNotTeammatesError'
  }
}

export function isRelayNotTeammatesError(error: unknown): error is RelayNotTeammatesError {
  return error instanceof RelayNotTeammatesError
    || (error instanceof Error && (error as { reason?: string }).reason === RELAY_NOT_TEAMMATES)
}

interface RefLike { id: string; path?: string }
interface SnapshotLike { exists: boolean; data(): Record<string, unknown> | undefined }
interface TransactionLike {
  get(ref: RefLike): Promise<SnapshotLike>
  create(ref: RefLike, value: Record<string, unknown>): void
  set(ref: RefLike, value: Record<string, unknown>, options?: { merge?: boolean }): void
  update(ref: RefLike, value: Record<string, unknown>): void
}
interface QueryDocLike { id: string; data(): Record<string, unknown> }
interface QuerySnapshotLike { docs: QueryDocLike[] }
interface QueryLike {
  where(field: string, op: string, value: unknown): QueryLike
  get(): Promise<QuerySnapshotLike>
}
interface DocumentLike extends RefLike {
  get(): Promise<SnapshotLike>
}
interface CollectionLike extends QueryLike {
  doc(id: string): DocumentLike
}
export interface DbLike {
  collection(name: string): CollectionLike
  runTransaction<T>(fn: (tx: TransactionLike) => Promise<T>): Promise<T>
}

export interface RelayQueueOptions {
  db?: DbLike
  nowMs?: number
  leaseMs?: number
  ttlMs?: number
}

function dbOf(options: RelayQueueOptions): DbLike {
  return options.db ?? (adminDb as unknown as DbLike)
}

function nowOf(options: RelayQueueOptions): number {
  return options.nowMs ?? Date.now()
}

export function relayIdempotencyKey(fromDeviceId: string, outboxItemId: string): string {
  return `${fromDeviceId}:${outboxItemId}`
}

export function relayEnvelopeId(idempotencyKey: string): string {
  return crypto.createHash('sha256').update(`linked-relay:v1\n${idempotencyKey}`).digest('base64url')
}

function requireDeviceId(value: unknown, label: string): string {
  const deviceId = typeof value === 'string' ? value.trim() : ''
  if (!deviceId || deviceId.length > 128) throw new Error(`linked computers: invalid relay ${label}`)
  return deviceId
}

function requireProfile(value: unknown): string {
  const profile = typeof value === 'string' ? value.trim() : ''
  if (!PROFILE.test(profile)) throw new Error('linked computers: invalid relay profile')
  return profile
}

function requireAgentId(value: unknown): AgentId {
  const agentId = typeof value === 'string' ? value.trim() : ''
  if (!isValidAgentId(agentId)) throw new Error('linked computers: invalid relay agent')
  return agentId
}

function requireEndpoint(value: unknown, label: string): RelayEndpoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`linked computers: invalid relay ${label}`)
  }
  const row = value as Record<string, unknown>
  return {
    deviceId: requireDeviceId(row.deviceId, `${label} device`),
    profile: requireProfile(row.profile),
    agentId: requireAgentId(row.agentId),
  }
}

function requirePayload(value: unknown): RelayPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('linked computers: invalid relay payload')
  }
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (bytes > RELAY_MAX_PAYLOAD_BYTES) throw new Error('linked computers: relay payload too large')
  return value as RelayPayload
}

function redactRelayPayload(payload: RelayPayload): RelayPayload {
  const next: RelayPayload = { ...payload }
  for (const key of ['text', 'content', 'output', 'error']) {
    if (typeof next[key] === 'string') next[key] = sanitizeLinkedResult(next[key] as string)
  }
  return next
}

function asEnvelope(id: string, data: Record<string, unknown> | undefined): RelayEnvelope | null {
  if (!data) return null
  const from = data.from && typeof data.from === 'object' ? data.from as Record<string, unknown> : {}
  const to = data.to && typeof data.to === 'object' ? data.to as Record<string, unknown> : {}
  const reply = data.reply && typeof data.reply === 'object' && !Array.isArray(data.reply)
    ? data.reply as Record<string, unknown>
    : null
  return {
    envelopeId: String(data.envelopeId ?? id),
    idempotencyKey: String(data.idempotencyKey ?? ''),
    orgId: String(data.orgId ?? ''),
    roomId: typeof data.roomId === 'string' && data.roomId ? data.roomId : null,
    from: {
      deviceId: String(from.deviceId ?? ''),
      profile: String(from.profile ?? ''),
      agentId: String(from.agentId ?? ''),
    },
    to: {
      deviceId: String(to.deviceId ?? ''),
      profile: String(to.profile ?? ''),
      agentId: String(to.agentId ?? ''),
    },
    kind: data.kind === 'room_turn' ? 'room_turn' : 'dm',
    encryptedPayload: data.encryptedPayload as EncryptedLinkedRunPayload,
    status: (data.status as RelayStatus) || 'queued',
    ...(typeof data.failureReason === 'string' ? { failureReason: data.failureReason } : {}),
    attempt: Number(data.attempt ?? 0),
    ...(typeof data.leaseToken === 'string' ? { leaseToken: data.leaseToken } : {}),
    ...(Number.isFinite(Number(data.leaseExpiresAtMs)) ? { leaseExpiresAtMs: Number(data.leaseExpiresAtMs) } : {}),
    ...(reply && reply.encryptedPayload ? {
      reply: {
        encryptedPayload: reply.encryptedPayload as EncryptedLinkedRunPayload,
        status: reply.status === 'claimed' || reply.status === 'delivered' ? reply.status : 'queued',
      },
    } : {}),
    createdAtMs: Number(data.createdAtMs ?? 0),
    updatedAtMs: Number(data.updatedAtMs ?? 0),
    expiresAtMs: Number(data.expiresAtMs ?? 0),
  }
}

function toStored(envelope: RelayEnvelope): Record<string, unknown> {
  return { ...envelope }
}

function pendingIds(row: Record<string, unknown> | undefined): string[] {
  return Array.isArray(row?.pendingEnvelopeIds)
    ? (row!.pendingEnvelopeIds as unknown[]).filter((id): id is string => typeof id === 'string')
    : []
}

function grantDocId(orgId: string, deviceId: string): string {
  return `${orgId}_${deviceId}`
}

function isActiveGrant(row: Record<string, unknown> | undefined, orgId: string, deviceId: string): boolean {
  return Boolean(row && row.status === 'active' && row.orgId === orgId && row.deviceId === deviceId)
}

export function deviceReportsProfile(
  device: Record<string, unknown> | undefined,
  orgId: string,
  profile: string,
  agentId?: string,
): boolean {
  const available = Array.isArray(device?.availableAgents) ? device!.availableAgents : []
  return available.some((entry) => {
    if (!entry || typeof entry !== 'object') return false
    const row = entry as Record<string, unknown>
    if (row.profile !== profile) return false
    if (typeof row.orgId === 'string' && row.orgId && row.orgId !== orgId) return false
    if (agentId && typeof row.agentId === 'string' && row.agentId && row.agentId !== agentId) return false
    return true
  })
}

export function isRoomMember(room: AgentRoom, endpoint: Pick<RelayEndpoint, 'agentId' | 'deviceId'>): boolean {
  return room.members.some((member) => (
    member.agentId === endpoint.agentId
    && (member.deviceId == null || member.deviceId === endpoint.deviceId)
  ))
}

async function assertActiveGrant(
  db: DbLike,
  orgId: string,
  deviceId: string,
): Promise<void> {
  const snap = await db.collection(GRANTS).doc(grantDocId(orgId, deviceId)).get()
  if (!isActiveGrant(snap.data(), orgId, deviceId)) throw new RelayNotTeammatesError()
}

export async function assertRelayTeammates(input: {
  orgId: string
  roomId: string | null
  from: RelayEndpoint
  to: RelayEndpoint
}, options: RelayQueueOptions = {}): Promise<void> {
  const db = dbOf(options)
  const orgId = input.orgId.trim()
  if (!orgId) throw new RelayNotTeammatesError()
  await assertActiveGrant(db, orgId, input.from.deviceId)
  await assertActiveGrant(db, orgId, input.to.deviceId)
  const sender = await db.collection(DEVICES).doc(input.from.deviceId).get()
  if (!deviceReportsProfile(sender.data(), orgId, input.from.profile, input.from.agentId)) {
    throw new RelayNotTeammatesError()
  }
  if (input.roomId) {
    const room = await getAgentRoom(orgId, input.roomId, { db })
    if (!room || room.status !== 'active') throw new RelayNotTeammatesError()
    if (!isRoomMember(room, input.from) || !isRoomMember(room, input.to)) throw new RelayNotTeammatesError()
    return
  }
  const rooms = await listAgentRooms(orgId, { db })
  const shared = rooms.some((room) => (
    room.status === 'active' && isRoomMember(room, input.from) && isRoomMember(room, input.to)
  ))
  if (!shared) throw new RelayNotTeammatesError()
}

function publicClaimed(envelope: RelayEnvelope, payload: RelayPayload, role: RelayClaimRole): PublicClaimedRelay {
  return {
    envelopeId: envelope.envelopeId,
    orgId: envelope.orgId,
    roomId: envelope.roomId,
    from: envelope.from,
    to: envelope.to,
    kind: envelope.kind,
    role,
    payload,
    attempt: envelope.attempt,
    leaseToken: envelope.leaseToken!,
  }
}

function inboundClaimable(envelope: RelayEnvelope, deviceId: string, nowMs: number): boolean {
  if (envelope.to.deviceId !== deviceId) return false
  if (['delivered', 'replied', 'failed', 'expired'].includes(envelope.status)) return false
  if (envelope.status === 'queued') return true
  return envelope.status === 'claimed' && (envelope.leaseExpiresAtMs ?? 0) <= nowMs
}

function replyClaimable(envelope: RelayEnvelope, deviceId: string, nowMs: number): boolean {
  if (envelope.from.deviceId !== deviceId || !envelope.reply) return false
  if (envelope.reply.status === 'queued') return true
  return envelope.reply.status === 'claimed' && (envelope.leaseExpiresAtMs ?? 0) <= nowMs
}

function takeLease(envelope: RelayEnvelope, nowMs: number, leaseMs: number, status: RelayStatus): RelayEnvelope {
  return {
    ...envelope,
    status,
    attempt: envelope.attempt + 1,
    leaseToken: crypto.randomBytes(24).toString('base64url'),
    leaseExpiresAtMs: nowMs + leaseMs,
    updatedAtMs: nowMs,
  }
}

function requireLiveLease(envelope: RelayEnvelope, deviceId: string, leaseToken: string, nowMs: number): void {
  if (envelope.to.deviceId !== deviceId) throw new Error('linked computers: relay device mismatch')
  if (!['claimed', 'replied'].includes(envelope.status)) throw new Error('linked computers: relay not claimed')
  if (envelope.leaseToken !== leaseToken) throw new Error('linked computers: run lease mismatch')
  if ((envelope.leaseExpiresAtMs ?? 0) < nowMs) throw new Error('linked computers: run lease expired')
}

export async function enqueueRelayEnvelope(input: {
  fromDeviceId: string
  outboxItemId: string
  orgId: string
  roomId?: string | null
  from: Omit<RelayEndpoint, 'deviceId'> & { deviceId?: string }
  to: RelayEndpoint
  kind: RelayKind
  payload: unknown
}, options: RelayQueueOptions = {}): Promise<RelayEnvelope> {
  const fromDeviceId = requireDeviceId(input.fromDeviceId, 'from device')
  const outboxItemId = typeof input.outboxItemId === 'string' ? input.outboxItemId.trim() : ''
  if (!OUTBOX_ITEM_ID.test(outboxItemId)) throw new Error('linked computers: invalid relay outbox item')
  const orgId = typeof input.orgId === 'string' ? input.orgId.trim() : ''
  if (!orgId) throw new Error('linked computers: invalid relay org')
  const roomId = typeof input.roomId === 'string' && input.roomId.trim() ? input.roomId.trim() : null
  const kind = input.kind === 'room_turn' || input.kind === 'dm' ? input.kind : null
  if (!kind) throw new Error('linked computers: invalid relay kind')
  if (roomId && kind !== 'room_turn') throw new Error('linked computers: invalid relay kind')
  if (!roomId && kind !== 'dm') throw new Error('linked computers: invalid relay kind')
  const from = requireEndpoint({ ...input.from, deviceId: fromDeviceId }, 'from')
  const to = requireEndpoint(input.to, 'to')
  if (from.deviceId !== fromDeviceId) throw new Error('linked computers: tenant scope mismatch')
  const payload = redactRelayPayload(requirePayload(input.payload))
  await assertRelayTeammates({ orgId, roomId, from, to }, options)

  const nowMs = nowOf(options)
  const ttlMs = options.ttlMs ?? RELAY_TTL_MS
  const idempotencyKey = relayIdempotencyKey(fromDeviceId, outboxItemId)
  const envelopeId = relayEnvelopeId(idempotencyKey)
  const encryptedPayload = encryptLinkedRunPayload(payload, to.deviceId, envelopeId, LINKED_RELAY_CONTEXT)
  const envelope: RelayEnvelope = {
    envelopeId,
    idempotencyKey,
    orgId,
    roomId,
    from,
    to,
    kind,
    encryptedPayload,
    status: 'queued',
    attempt: 0,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    expiresAtMs: nowMs + ttlMs,
  }
  const db = dbOf(options)
  return db.runTransaction(async (tx) => {
    const ref = db.collection(LINKED_RELAY_ENVELOPES).doc(envelopeId)
    const queueRef = db.collection(LINKED_RELAY_QUEUES).doc(to.deviceId)
    const [existing, queue] = await Promise.all([tx.get(ref), tx.get(queueRef)])
    if (existing.exists) {
      const row = asEnvelope(envelopeId, existing.data())
      if (!row || row.from.deviceId !== fromDeviceId || row.idempotencyKey !== idempotencyKey) {
        throw new Error('linked computers: relay identity collision')
      }
      return row
    }
    const ids = pendingIds(queue.data())
    if (ids.length >= QUEUE_LIMIT) throw new Error('linked computers: device relay queue full')
    tx.create(ref, toStored(envelope))
    tx.set(queueRef, {
      deviceId: to.deviceId,
      pendingEnvelopeIds: [...ids, envelopeId],
      updatedAtMs: nowMs,
    }, { merge: true })
    return envelope
  })
}

export async function claimOldestRelayEnvelope(input: {
  deviceId: string
}, options: RelayQueueOptions = {}): Promise<PublicClaimedRelay | null> {
  const deviceId = requireDeviceId(input.deviceId, 'device')
  const nowMs = nowOf(options)
  const leaseMs = options.leaseMs ?? RELAY_LEASE_MS
  const db = dbOf(options)
  return db.runTransaction(async (tx) => {
    const queueRef = db.collection(LINKED_RELAY_QUEUES).doc(deviceId)
    const queue = await tx.get(queueRef)
    const ids = pendingIds(queue.data())
    let selected: RelayEnvelope | null = null
    let selectedRole: RelayClaimRole = 'inbound'
    const remaining: string[] = []
    for (const id of ids) {
      const ref = db.collection(LINKED_RELAY_ENVELOPES).doc(id)
      const snap = await tx.get(ref)
      if (!snap.exists) continue
      const current = asEnvelope(id, snap.data())
      if (!current) continue
      if (['delivered', 'failed', 'expired'].includes(current.status) && current.reply?.status !== 'queued' && current.reply?.status !== 'claimed') {
        continue
      }
      if (current.expiresAtMs <= nowMs && !['delivered', 'failed', 'expired'].includes(current.status)) {
        tx.update(ref, {
          status: 'expired',
          updatedAtMs: nowMs,
        })
        continue
      }
      if (!selected && inboundClaimable(current, deviceId, nowMs)) {
        selected = takeLease(current, nowMs, leaseMs, 'claimed')
        selectedRole = 'inbound'
        tx.update(ref, toStored(selected))
        remaining.push(id)
        continue
      }
      if (!selected && replyClaimable(current, deviceId, nowMs)) {
        selected = {
          ...current,
          updatedAtMs: nowMs,
          reply: { ...current.reply!, status: 'claimed' },
          leaseToken: crypto.randomBytes(24).toString('base64url'),
        }
        selectedRole = 'reply'
        tx.update(ref, {
          reply: selected.reply,
          updatedAtMs: nowMs,
        })
        remaining.push(id)
        continue
      }
      remaining.push(id)
    }
    const queueOrderChanged = remaining.length !== ids.length || remaining.some((id, index) => id !== ids[index])
    if (selected) {
      tx.set(queueRef, {
        deviceId,
        pendingEnvelopeIds: [selected.envelopeId, ...remaining.filter((id) => id !== selected!.envelopeId)],
        updatedAtMs: nowMs,
      }, { merge: true })
      const payload = selectedRole === 'reply'
        ? decryptLinkedRunPayload(selected.reply!.encryptedPayload, selected.from.deviceId, selected.envelopeId, LINKED_RELAY_CONTEXT) as unknown as RelayPayload
        : decryptLinkedRunPayload(selected.encryptedPayload, selected.to.deviceId, selected.envelopeId, LINKED_RELAY_CONTEXT) as unknown as RelayPayload
      return publicClaimed(selected, payload, selectedRole)
    }
    if (queueOrderChanged) {
      tx.set(queueRef, { pendingEnvelopeIds: remaining, updatedAtMs: nowMs }, { merge: true })
    }
    return null
  })
}

export async function replyRelayEnvelope(input: {
  deviceId: string
  envelopeId: string
  leaseToken: string
  payload: unknown
}, options: RelayQueueOptions = {}): Promise<RelayEnvelope> {
  const deviceId = requireDeviceId(input.deviceId, 'device')
  const envelopeId = typeof input.envelopeId === 'string' ? input.envelopeId.trim() : ''
  if (!ENVELOPE_ID.test(envelopeId)) throw new Error('linked computers: invalid relay envelope')
  const leaseToken = typeof input.leaseToken === 'string' ? input.leaseToken : ''
  const payload = redactRelayPayload(requirePayload(input.payload))
  const nowMs = nowOf(options)
  const db = dbOf(options)
  return db.runTransaction(async (tx) => {
    const ref = db.collection(LINKED_RELAY_ENVELOPES).doc(envelopeId)
    const snap = await tx.get(ref)
    const envelope = asEnvelope(envelopeId, snap.data())
    if (!snap.exists || !envelope) throw new Error('linked computers: relay not found')
    if (envelope.expiresAtMs <= nowMs) throw new Error('linked computers: run expired')
    requireLiveLease(envelope, deviceId, leaseToken, nowMs)
    if (envelope.reply && envelope.reply.status !== 'queued') return envelope
    const next: RelayEnvelope = {
      ...envelope,
      status: 'replied',
      updatedAtMs: nowMs,
      reply: {
        encryptedPayload: encryptLinkedRunPayload(payload, envelope.from.deviceId, envelope.envelopeId, LINKED_RELAY_CONTEXT),
        status: 'queued',
      },
    }
    const senderQueueRef = db.collection(LINKED_RELAY_QUEUES).doc(envelope.from.deviceId)
    const senderQueue = await tx.get(senderQueueRef)
    const ids = pendingIds(senderQueue.data()).filter((id) => id !== envelopeId)
    tx.update(ref, toStored(next))
    tx.set(senderQueueRef, {
      deviceId: envelope.from.deviceId,
      pendingEnvelopeIds: [...ids, envelopeId],
      updatedAtMs: nowMs,
    }, { merge: true })
    return next
  })
}

export async function completeRelayEnvelope(input: {
  deviceId: string
  envelopeId: string
  leaseToken: string
  outcome: 'delivered' | 'failed'
  failureReason?: string
}, options: RelayQueueOptions = {}): Promise<RelayEnvelope> {
  const deviceId = requireDeviceId(input.deviceId, 'device')
  const envelopeId = typeof input.envelopeId === 'string' ? input.envelopeId.trim() : ''
  if (!ENVELOPE_ID.test(envelopeId)) throw new Error('linked computers: invalid relay envelope')
  if (input.outcome !== 'delivered' && input.outcome !== 'failed') {
    throw new Error('linked computers: invalid relay completion')
  }
  const leaseToken = typeof input.leaseToken === 'string' ? input.leaseToken : ''
  const nowMs = nowOf(options)
  const db = dbOf(options)
  return db.runTransaction(async (tx) => {
    const ref = db.collection(LINKED_RELAY_ENVELOPES).doc(envelopeId)
    const snap = await tx.get(ref)
    const envelope = asEnvelope(envelopeId, snap.data())
    if (!snap.exists || !envelope) throw new Error('linked computers: relay not found')
    if (envelope.status === input.outcome) return envelope
    if (['failed', 'expired'].includes(envelope.status)) throw new Error('linked computers: run already final')
    if (envelope.expiresAtMs <= nowMs && envelope.status !== 'delivered' && envelope.status !== 'replied') {
      throw new Error('linked computers: run expired')
    }
    requireLiveLease(envelope, deviceId, leaseToken, nowMs)
    const failureReason = input.outcome === 'failed'
      ? sanitizeLinkedResult((input.failureReason ?? 'failed').slice(0, 500))
      : undefined
    const next: RelayEnvelope = {
      ...envelope,
      status: input.outcome,
      updatedAtMs: nowMs,
      ...(failureReason ? { failureReason } : {}),
      ...(envelope.reply ? { reply: { ...envelope.reply, status: 'delivered' as const } } : {}),
    }
    const receiverQueueRef = db.collection(LINKED_RELAY_QUEUES).doc(envelope.to.deviceId)
    const receiverQueue = await tx.get(receiverQueueRef)
    tx.update(ref, toStored(next))
    tx.set(receiverQueueRef, {
      pendingEnvelopeIds: pendingIds(receiverQueue.data()).filter((id) => id !== envelopeId),
      updatedAtMs: nowMs,
    }, { merge: true })
    return next
  })
}
