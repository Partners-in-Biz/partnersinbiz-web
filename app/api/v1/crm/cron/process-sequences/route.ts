// app/api/v1/crm/cron/process-sequences/route.ts
//
// Cron endpoint — processes due sequence enrollments and sends step emails.
// Pattern: GET, Bearer CRON_SECRET auth, 55 s time budget, batch 100.

import { NextRequest } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'
import { apiSuccess, apiError } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { getDueEnrollments, advanceEnrollment } from '@/lib/sequences/enrollment'
import { getSequence } from '@/lib/sequences/store'
import { sendEmail } from '@/lib/email/send'

export const dynamic = 'force-dynamic'

const TIME_BUDGET_MS = 55_000
const BATCH_SIZE = 100

export async function GET(req: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return apiError('CRON_SECRET not configured', 500)
  }

  const provided = req.headers.get('authorization')
  if (provided !== `Bearer ${cronSecret}`) {
    return apiError('Unauthorized', 401)
  }

  // ── Init ─────────────────────────────────────────────────────────────────────
  const startedAt = Date.now()
  let processed = 0
  let succeeded = 0
  let failed = 0
  const errors: string[] = []

  const enrollments = await getDueEnrollments(BATCH_SIZE)

  for (const enrollment of enrollments) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break

    try {
      // 1. Load sequence
      const seq = await getSequence(enrollment.orgId, enrollment.sequenceId)
      if (!seq || seq.status !== 'active') {
        await advanceEnrollment(enrollment.id, { status: 'exited', exitReason: 'manual' })
        processed++
        continue
      }

      // 2. Get current step
      const step = seq.steps[enrollment.currentStep]
      if (!step) {
        await advanceEnrollment(enrollment.id, {
          status: 'completed',
          exitReason: 'completed',
          completedAt: Timestamp.now(),
        })
        succeeded++
        processed++
        continue
      }

      // 3. Fetch contact email
      const contactSnap = await adminDb.collection('contacts').doc(enrollment.contactId).get()
      const contact = contactSnap.data() as { email?: string; orgId?: string } | undefined
      if (!contact || contact.orgId !== enrollment.orgId || !contact.email) {
        await advanceEnrollment(enrollment.id, { status: 'exited', exitReason: 'manual' })
        processed++
        continue
      }

      // 4. Send email
      await sendEmail({ to: contact.email, subject: step.subject, html: step.bodyHtml })

      // 5. Advance
      const nextStepIndex = enrollment.currentStep + 1
      const nextStep = seq.steps[nextStepIndex]
      if (nextStep) {
        await advanceEnrollment(enrollment.id, {
          currentStep: nextStepIndex,
          nextSendAt: Timestamp.fromMillis(Date.now() + nextStep.delayDays * 86_400_000),
        })
      } else {
        await advanceEnrollment(enrollment.id, {
          status: 'completed',
          exitReason: 'completed',
          completedAt: Timestamp.now(),
        })
      }

      succeeded++
    } catch (err) {
      const msg = `enrollment ${enrollment.id}: ${(err as Error).message}`
      console.error('[process-sequences]', msg)
      errors.push(msg)
      failed++
    }
    processed++
  }

  return apiSuccess({ processed, succeeded, failed, errors })
}
