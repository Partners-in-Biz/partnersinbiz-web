// app/api/v1/sequences/[id]/enroll/route.ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import type { ApiUser } from '@/lib/api/types'
import { evaluateSequenceReentry } from '@/lib/email-marketing/automation-policy'
import type { SequenceEnrollment, SequenceReentryPolicy } from '@/lib/sequences/types'
import { assertEmailMarketingAgentActionWithTask } from '@/lib/email-marketing/agent-governance'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params
  const body = await req.json().catch(() => null)
  if (!body?.contactIds?.length) return apiError('contactIds required', 400)

  const seqSnap = await adminDb.collection('sequences').doc(id).get()
  if (!seqSnap.exists || seqSnap.data()?.deleted) return apiError('Sequence not found', 404)
  const seq = seqSnap.data()!
  if (seq.status !== 'active') return apiError('Sequence must be active to enroll', 422)

  const seqOrgId: string = seq.orgId ?? ''
  if (!seqOrgId) return apiError('Sequence is missing orgId — run the orgId backfill first', 500)

  const scope = resolveOrgScope(user, seqOrgId)
  if (!scope.ok) return apiError(scope.error, scope.status)

  try {
    await assertEmailMarketingAgentActionWithTask(user, 'email_marketing_send', seq.approvalState, {
      orgId: scope.orgId, resourceType: 'email_sequence', resourceId: id,
    })
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Sequence enrollment is not authorised', 403)
  }

  const campaignId: string = typeof body.campaignId === 'string' ? body.campaignId : ''

  const firstStep = seq.steps?.[0]
  const delayMs = (firstStep?.delayDays ?? 0) * 24 * 60 * 60 * 1000
  const nextSendAt = Timestamp.fromDate(new Date(Date.now() + delayMs))

  const maxActiveEnrollments = Math.max(0, Math.floor(Number(seq.maxActiveEnrollments ?? 0) || 0))
  let activeEnrollmentCount = 0
  if (maxActiveEnrollments > 0) {
    const activeSnap = await adminDb
      .collection('sequence_enrollments')
      .where('orgId', '==', seqOrgId)
      .where('sequenceId', '==', id)
      .where('status', '==', 'active')
      .get()
    activeEnrollmentCount = activeSnap.docs.length
  }

  const enrolled: string[] = []
  const skipped: Array<{ contactId: string; reason: string }> = []
  for (const contactId of body.contactIds as string[]) {
    const contactSnap = await adminDb.collection('contacts').doc(contactId).get()
    if (!contactSnap.exists || contactSnap.data()?.deleted) continue
    // Cross-org isolation: contact must be in the same org as the sequence
    if (contactSnap.data()?.orgId && contactSnap.data()?.orgId !== seqOrgId) continue

    const historySnap = await adminDb
      .collection('sequence_enrollments')
      .where('orgId', '==', seqOrgId)
      .where('sequenceId', '==', id)
      .where('contactId', '==', contactId)
      .get()
    const history = historySnap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as SequenceEnrollment[]
    const reentry = evaluateSequenceReentry(
      history,
      seq.reentryPolicy as SequenceReentryPolicy | undefined,
    )
    if (reentry.existingEnrollmentId) {
      enrolled.push(reentry.existingEnrollmentId)
      continue
    }
    if (!reentry.allowed) {
      skipped.push({ contactId, reason: reentry.reason })
      continue
    }
    if (maxActiveEnrollments > 0 && activeEnrollmentCount >= maxActiveEnrollments) {
      skipped.push({ contactId, reason: 'sequence_capacity_reached' })
      continue
    }

    const ref = await adminDb.collection('sequence_enrollments').add({
      orgId: seqOrgId,
      campaignId,
      sequenceId: id,
      contactId,
      status: 'active',
      currentStep: 0,
      enrolledAt: FieldValue.serverTimestamp(),
      nextSendAt,
      deleted: false,
    })

    await adminDb.collection('activities').add({
      orgId: seqOrgId,
      contactId,
      type: 'sequence_enrolled',
      note: `Enrolled in sequence: ${seq.name}`,
      createdAt: FieldValue.serverTimestamp(),
    })

    enrolled.push(ref.id)
    activeEnrollmentCount++
  }

  return apiSuccess({ enrolled, skipped }, 201)
})
