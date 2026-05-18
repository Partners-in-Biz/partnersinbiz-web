// lib/sequences/store.ts
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import type { Sequence, SequenceInput } from './types'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

const SEQUENCES = 'sequences'

export async function listSequences(orgId: string): Promise<Sequence[]> {
  const snap = await adminDb
    .collection(SEQUENCES)
    .where('orgId', '==', orgId)
    .where('deleted', '!=', true)
    .orderBy('name', 'asc')
    .get()
  return snap.docs.map((d) => ({ ...(d.data() as Omit<Sequence, 'id'>), id: d.id }))
}

export async function getSequence(orgId: string, sequenceId: string): Promise<Sequence | null> {
  const snap = await adminDb.collection(SEQUENCES).doc(sequenceId).get()
  if (!snap.exists) return null
  const data = snap.data() as Sequence
  if (data.orgId !== orgId) return null
  return { ...data, id: snap.id }
}

export async function createSequence(
  orgId: string,
  input: SequenceInput,
  actor: MemberRef,
): Promise<Sequence> {
  const ref = await adminDb.collection(SEQUENCES).add({
    ...input,
    orgId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdByRef: actor,
    updatedByRef: actor,
  })
  const snap = await ref.get()
  return { ...snap.data(), id: ref.id } as Sequence
}

export async function updateSequence(
  orgId: string,
  sequenceId: string,
  patch: Partial<SequenceInput>,
  actor: MemberRef,
): Promise<Sequence> {
  const ref = adminDb.collection(SEQUENCES).doc(sequenceId)
  const snap = await ref.get()
  if (!snap.exists) throw new Error(`Sequence not found: ${sequenceId}`)
  const existing = snap.data() as Sequence
  if (existing.orgId !== orgId) throw new Error(`Sequence not found: ${sequenceId}`)
  await ref.update({
    ...patch,
    updatedAt: FieldValue.serverTimestamp(),
    updatedByRef: actor,
  })
  const updated = await ref.get()
  return { ...updated.data(), id: ref.id } as Sequence
}

export async function deleteSequence(
  orgId: string,
  sequenceId: string,
  actor: MemberRef,
): Promise<void> {
  const ref = adminDb.collection(SEQUENCES).doc(sequenceId)
  const snap = await ref.get()
  if (!snap.exists) throw new Error(`Sequence not found: ${sequenceId}`)
  const existing = snap.data() as Sequence
  if (existing.orgId !== orgId) throw new Error(`Sequence not found: ${sequenceId}`)
  await ref.update({
    deleted: true,
    updatedAt: FieldValue.serverTimestamp(),
    updatedByRef: actor,
  })
}
