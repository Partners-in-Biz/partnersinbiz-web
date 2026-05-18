// lib/sequences/enrollment.ts
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import type { SequenceEnrollment } from './types'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

const ENROLLMENTS = 'sequence_enrollments'

export interface ListEnrollmentOpts {
  sequenceId?: string
  contactId?: string
  status?: string
}

export async function listEnrollments(
  orgId: string,
  opts?: ListEnrollmentOpts,
): Promise<SequenceEnrollment[]> {
  let q = adminDb.collection(ENROLLMENTS).where('orgId', '==', orgId) as FirebaseFirestore.Query
  if (opts?.sequenceId) q = q.where('sequenceId', '==', opts.sequenceId)
  if (opts?.contactId) q = q.where('contactId', '==', opts.contactId)
  if (opts?.status) q = q.where('status', '==', opts.status)
  const snap = await q.get()
  return snap.docs.map((d) => ({ ...(d.data() as Omit<SequenceEnrollment, 'id'>), id: d.id }))
}

export async function getEnrollment(
  orgId: string,
  enrollmentId: string,
): Promise<SequenceEnrollment | null> {
  const snap = await adminDb.collection(ENROLLMENTS).doc(enrollmentId).get()
  if (!snap.exists) return null
  const data = snap.data() as SequenceEnrollment
  if (data.orgId !== orgId) return null
  return { ...data, id: snap.id }
}

export async function enrollContact(
  orgId: string,
  sequenceId: string,
  contactId: string,
  actor: MemberRef,
  firstStepDelayDays: number,
): Promise<SequenceEnrollment> {
  const ref = await adminDb.collection(ENROLLMENTS).add({
    orgId,
    sequenceId,
    contactId,
    campaignId: '',
    status: 'active',
    currentStep: 0,
    enrolledAt: FieldValue.serverTimestamp(),
    nextSendAt: Timestamp.fromMillis(Date.now() + firstStepDelayDays * 86_400_000),
    createdByRef: actor,
    updatedByRef: actor,
  })
  const snap = await ref.get()
  return { ...snap.data(), id: ref.id } as SequenceEnrollment
}

export async function unenrollContact(
  orgId: string,
  enrollmentId: string,
  actor: MemberRef,
): Promise<void> {
  const ref = adminDb.collection(ENROLLMENTS).doc(enrollmentId)
  await ref.update({
    status: 'exited',
    exitReason: 'manual',
    updatedAt: FieldValue.serverTimestamp(),
    updatedByRef: actor,
  })
}

export async function getDueEnrollments(limit = 100): Promise<SequenceEnrollment[]> {
  const snap = await adminDb
    .collection(ENROLLMENTS)
    .where('status', '==', 'active')
    .where('nextSendAt', '<=', Timestamp.now())
    .orderBy('nextSendAt', 'asc')
    .limit(limit)
    .get()
  return snap.docs.map((d) => ({ ...(d.data() as Omit<SequenceEnrollment, 'id'>), id: d.id }))
}

export async function advanceEnrollment(
  enrollmentId: string,
  patch: Partial<
    Pick<SequenceEnrollment, 'status' | 'currentStep' | 'nextSendAt' | 'exitReason' | 'completedAt'>
  >,
): Promise<void> {
  const ref = adminDb.collection(ENROLLMENTS).doc(enrollmentId)
  await ref.update({
    ...patch,
    updatedAt: FieldValue.serverTimestamp(),
  })
}
