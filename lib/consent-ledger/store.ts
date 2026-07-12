import { createHash } from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { canonicalizeEventMetadata } from '@/lib/email-events/identity'
import type { ContactConsentEventInput } from './types'

interface DocumentRefLike { id: string }
interface SnapshotLike { exists: boolean; data(): Record<string, unknown> | undefined }
interface TransactionLike {
  get(ref: DocumentRefLike): Promise<SnapshotLike>
  create(ref: DocumentRefLike, value: Record<string, unknown>): void
}
interface DatabaseLike {
  collection(name: string): { doc(id: string): DocumentRefLike }
  runTransaction<T>(fn: (tx: TransactionLike) => Promise<T>): Promise<T>
}

export interface ConsentEventIdentity { id: string; deduplicationKey: string }
export interface AppendConsentEventOptions { db?: DatabaseLike; now?: () => unknown }
export interface AppendConsentEventResult extends ConsentEventIdentity { created: boolean }

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function required(value: string | undefined, field: string): string {
  const clean = value?.trim()
  if (!clean) throw new Error(`appendConsentEvent: ${field} is required`)
  return clean
}

export function buildConsentEventIdentity(input: ContactConsentEventInput): ConsentEventIdentity {
  const sourceEventId = input.sourceEventId?.trim()
  const fallback = {
    contactId: input.contactId,
    channel: input.channel,
    topicId: input.topicId,
    state: input.state,
    legalBasis: input.legalBasis,
    source: input.source,
    sourceId: input.sourceId || '',
    occurredAt: input.occurredAt,
    captureVersion: input.captureVersion || '',
    formCopyVersion: input.formCopyVersion || '',
    policyVersion: input.policyVersion || '',
  }
  const deduplicationKey = sourceEventId
    ? `${input.orgId}:consent-source:${sourceEventId}`
    : `${input.orgId}:consent-derived:${sha256(canonicalizeEventMetadata(fallback))}`
  return {
    id: `consent_${sha256(deduplicationKey).slice(0, 40)}`,
    deduplicationKey,
  }
}

/** Append-only consent proof. Projected preferences remain a separate read model. */
export async function appendConsentEvent(
  input: ContactConsentEventInput,
  options: AppendConsentEventOptions = {},
): Promise<AppendConsentEventResult> {
  const orgId = required(input.orgId, 'orgId')
  const contactId = required(input.contactId, 'contactId')
  const topicId = required(input.topicId, 'topicId')
  required(input.occurredAt, 'occurredAt')
  const normalizedInput = { ...input, orgId, contactId, topicId }
  const identity = buildConsentEventIdentity(normalizedInput)
  const db = options.db ?? (adminDb as unknown as DatabaseLike)
  const ref = db.collection('contact_consent_events').doc(identity.id)

  const created = await db.runTransaction(async (tx) => {
    const existing = await tx.get(ref)
    if (existing.exists) {
      const row = existing.data() ?? {}
      if (
        row.orgId !== orgId ||
        row.contactId !== contactId ||
        row.deduplicationKey !== identity.deduplicationKey
      ) {
        throw new Error(`appendConsentEvent: immutable identity collision for ${identity.id}`)
      }
      return false
    }
    tx.create(ref, {
      ...normalizedInput,
      ...identity,
      metadata: normalizedInput.metadata ?? {},
      schemaVersion: 1,
      immutable: true,
      receivedAt: options.now ? options.now() : FieldValue.serverTimestamp(),
    })
    return true
  })

  return { ...identity, created }
}
