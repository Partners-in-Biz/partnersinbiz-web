import { randomUUID } from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import {
  LLM_CREDENTIAL_AUDIT_COLLECTION,
  type LlmCredentialAuditEvent,
} from './types'

export async function writeLlmCredentialAudit(
  event: Omit<LlmCredentialAuditEvent, 'eventId' | 'createdAt'>,
): Promise<void> {
  const eventId = randomUUID()
  const row: LlmCredentialAuditEvent = {
    ...event,
    eventId,
    createdAt: FieldValue.serverTimestamp(),
  }
  await adminDb.collection(LLM_CREDENTIAL_AUDIT_COLLECTION).doc(eventId).set(row)
}
