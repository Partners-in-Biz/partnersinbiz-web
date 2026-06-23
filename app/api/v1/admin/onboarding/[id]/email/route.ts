/**
 * POST /api/v1/admin/onboarding/[id]/email — email the submission contact.
 *
 * Sends a follow-up email to the submission's contact via Resend (getResendClient
 * + FROM_ADDRESS — same system-sender path the public onboarding route uses).
 * Body: { subject, body }. The send is audited.
 *
 * Auth: super-admin only.
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { writeAdminAudit } from '@/lib/admin/audit'
import { getResendClient, FROM_ADDRESS, plainTextToHtml } from '@/lib/email/resend'
import { ONBOARDING_COLLECTION, toOnboardingView } from '../../_shared'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export const POST = withAuth('admin', async (req: NextRequest, user, ctx) => {
  if (!isSuperAdmin(user)) return apiError('Super-admin access required', 403)
  const { id } = await (ctx as RouteContext).params

  const ref = adminDb.collection(ONBOARDING_COLLECTION).doc(id)
  const snap = await ref.get()
  if (!snap.exists) return apiError('Submission not found', 404)
  const view = toOnboardingView(id, snap.data() as Record<string, unknown>)

  if (!view.contactEmail || !isValidEmail(view.contactEmail)) {
    return apiError('Submission has no valid contact email', 400)
  }

  const body = await req.json().catch(() => ({}))
  const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
  const message = typeof body.body === 'string' ? body.body.trim() : ''
  if (!subject) return apiError('subject is required', 400)
  if (!message) return apiError('body is required', 400)

  let messageId = ''
  try {
    const result = await getResendClient().emails.send({
      from: FROM_ADDRESS,
      to: view.contactEmail,
      replyTo: FROM_ADDRESS,
      subject,
      html: plainTextToHtml(message),
      text: message,
    })
    if (result.error) {
      return apiError(`Email send failed: ${result.error.message ?? 'unknown error'}`, 502)
    }
    messageId = result.data?.id ?? ''
  } catch (err) {
    const m = err instanceof Error ? err.message : 'Email send failed'
    return apiError(`Email send failed: ${m}`, 502)
  }

  // Log the send onto the submission timeline (best-effort).
  try {
    await ref.set({
      lastEmailedAt: FieldValue.serverTimestamp(),
      emailLog: FieldValue.arrayUnion({
        subject,
        to: view.contactEmail,
        sentBy: user.uid,
        messageId,
        sentAt: new Date().toISOString(),
      }),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  } catch { /* non-fatal */ }

  await writeAdminAudit(user, {
    action: 'onboarding.email',
    orgId: view.orgId,
    summary: `Emailed "${view.businessName || view.contactEmail}" — "${subject}"`,
    metadata: { submissionId: id, to: view.contactEmail, subject, messageId },
  })

  return apiSuccess({ id, sent: true, messageId, to: view.contactEmail })
})
