import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { MemberRef } from '@/lib/orgMembers/memberRef'
import type { SequenceEnrollment } from './types'

export class DeadLetterReplayError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'DeadLetterReplayError'
  }
}

export function buildDeadLetterReplayDecision(
  enrollment: SequenceEnrollment,
  replayKey: string,
  actor: MemberRef,
  now: Timestamp,
): { idempotent: boolean; patch: Record<string, unknown> | null } {
  const priorReplay = enrollment.deadLetterHistory?.some((entry) => entry.replayKey === replayKey) ?? false
  if (enrollment.replayKey === replayKey || priorReplay) {
    return { idempotent: true, patch: null }
  }
  if (enrollment.status !== 'dead_letter' || !enrollment.deadLetter?.replayable) {
    throw new DeadLetterReplayError('Enrollment is not replayable', 409)
  }
  const history = Array.isArray(enrollment.deadLetterHistory) ? enrollment.deadLetterHistory : []
  return {
    idempotent: false,
    patch: {
      status: 'active',
      exitReason: FieldValue.delete(),
      deliveryAttempts: 0,
      lastDeliveryError: FieldValue.delete(),
      lastDeliveryAttemptAt: FieldValue.delete(),
      nextSendAt: now,
      replayKey,
      replayedAt: now,
      replayedByRef: actor,
      deadLetterHistory: [...history.slice(-19), { ...enrollment.deadLetter, replayKey, replayedAt: now, replayedByRef: actor }],
      deadLetter: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedByRef: actor,
    },
  }
}

export async function replaySequenceDeadLetter(args: {
  orgId: string
  sequenceId: string
  enrollmentId: string
  replayKey: string
  actor: MemberRef
}): Promise<{ enrollmentId: string; idempotent: boolean; status: SequenceEnrollment['status'] }> {
  const enrollmentRef = adminDb.collection('sequence_enrollments').doc(args.enrollmentId)
  const sequenceRef = adminDb.collection('sequences').doc(args.sequenceId)
  return adminDb.runTransaction(async (transaction) => {
    const [enrollmentSnap, sequenceSnap] = await Promise.all([
      transaction.get(enrollmentRef),
      transaction.get(sequenceRef),
    ])
    if (!enrollmentSnap.exists) throw new DeadLetterReplayError('Enrollment not found', 404)
    const enrollment = { id: enrollmentSnap.id, ...enrollmentSnap.data() } as SequenceEnrollment
    if (enrollment.orgId !== args.orgId || enrollment.sequenceId !== args.sequenceId) {
      throw new DeadLetterReplayError('Enrollment not found', 404)
    }
    const sequence = sequenceSnap.exists ? sequenceSnap.data() : null
    if (!sequence || sequence.orgId !== args.orgId || sequence.deleted || sequence.status !== 'active') {
      throw new DeadLetterReplayError('Sequence must be active before replay', 409)
    }
    const decision = buildDeadLetterReplayDecision(enrollment, args.replayKey, args.actor, Timestamp.now())
    if (decision.patch) transaction.update(enrollmentRef, decision.patch)
    return {
      enrollmentId: args.enrollmentId,
      idempotent: decision.idempotent,
      status: decision.idempotent ? enrollment.status : 'active',
    }
  })
}
