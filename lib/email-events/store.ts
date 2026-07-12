import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { buildEmailEventIdentity } from './identity'
import { canonicalizeEventMetadata } from './identity'
import { createHash } from 'crypto'
import { randomUUID } from 'crypto'
import type { EmailEventInput } from './types'

interface DocumentRefLike { id: string }
interface SnapshotLike { exists: boolean; data(): Record<string, unknown> | undefined }
interface TransactionLike {
  get(ref: DocumentRefLike): Promise<SnapshotLike>
  create(ref: DocumentRefLike, value: Record<string, unknown>): void
  set?(ref: DocumentRefLike, value: Record<string, unknown>, options?: { merge: boolean }): void
}
interface DatabaseLike {
  collection(name: string): { doc(id: string): DocumentRefLike }
  runTransaction<T>(fn: (tx: TransactionLike) => Promise<T>): Promise<T>
}

export interface AppendEmailEventOptions {
  db?: DatabaseLike
  now?: () => unknown
}

export interface AppendEmailEventResult {
  id: string
  deduplicationKey: string
  uniqueEventKey: string
  created: boolean
}

/** Claim projection work independently from append so a replay repairs an append-only crash. */
export async function claimEmailEventProjection(
  eventId: string,
  options: AppendEmailEventOptions & { leaseMs?: number; token?: string } = {},
): Promise<string | null> {
  const db = options.db ?? (adminDb as unknown as DatabaseLike)
  const ref = db.collection('email_event_projections').doc(eventId)
  const nowMs = Date.now()
  const token = options.token ?? randomUUID()
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref)
    const row = snapshot.data() ?? {}
    if (row.status === 'completed') return null
    if (row.status === 'processing' && typeof row.leaseExpiresAt === 'number' && row.leaseExpiresAt > nowMs) return null
    const value = {
      eventId,
      status: 'processing',
      leaseToken: token,
      leaseExpiresAt: nowMs + (options.leaseMs ?? 5 * 60_000),
      schemaVersion: 1,
      claimedAt: options.now ? options.now() : FieldValue.serverTimestamp(),
    }
    if (snapshot.exists) tx.set?.(ref, value, { merge: true })
    else tx.create(ref, value)
    return token
  })
}

export async function completeEmailEventProjection(
  eventId: string,
  leaseToken: string,
  options: AppendEmailEventOptions = {},
): Promise<boolean> {
  const db = options.db ?? (adminDb as unknown as DatabaseLike)
  const ref = db.collection('email_event_projections').doc(eventId)
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref)
    const row = snapshot.data() ?? {}
    if (!snapshot.exists || row.leaseToken !== leaseToken || row.status !== 'processing') return false
    tx.set?.(ref, { status: 'completed', completedAt: options.now ? options.now() : FieldValue.serverTimestamp(), leaseExpiresAt: 0 }, { merge: true })
    return true
  })
}

function required(value: string | undefined, field: string): string {
  const clean = value?.trim()
  if (!clean) throw new Error(`appendEmailEvent: ${field} is required`)
  return clean
}

/**
 * Append-only provider event inbox. Firestore transaction + deterministic doc
 * ID make concurrent deliveries and later retries converge on one immutable row.
 */
export async function appendEmailEvent(
  input: EmailEventInput,
  options: AppendEmailEventOptions = {},
): Promise<AppendEmailEventResult> {
  const orgId = required(input.orgId, 'orgId')
  const messageId = required(input.messageId, 'messageId')
  const providerMessageId = required(input.providerMessageId, 'providerMessageId')
  const normalizedInput = { ...input, orgId, messageId, providerMessageId }
  const identity = buildEmailEventIdentity(normalizedInput)
  const payloadHash = createHash('sha256').update(canonicalizeEventMetadata({
    ...normalizedInput,
    metadata: normalizedInput.metadata ?? {},
  })).digest('hex')
  const db = options.db ?? (adminDb as unknown as DatabaseLike)
  const ref = db.collection('email_events').doc(identity.id)

  const created = await db.runTransaction(async (tx) => {
    const existing = await tx.get(ref)
    if (existing.exists) {
      const row = existing.data() ?? {}
      if (
        row.orgId !== orgId ||
        row.deduplicationKey !== identity.deduplicationKey ||
        row.messageId !== messageId
      ) {
        throw new Error(`appendEmailEvent: immutable identity collision for ${identity.id}`)
      }
      if (row.payloadHash && row.payloadHash !== payloadHash) {
        throw new Error(`appendEmailEvent: immutable payload collision for ${identity.id}`)
      }
      return false
    }

    tx.create(ref, {
      ...normalizedInput,
      ...identity,
      metadata: normalizedInput.metadata ?? {},
      schemaVersion: 1,
      immutable: true,
      payloadHash,
      receivedAt: options.now ? options.now() : FieldValue.serverTimestamp(),
    })
    return true
  })

  return { ...identity, created }
}
