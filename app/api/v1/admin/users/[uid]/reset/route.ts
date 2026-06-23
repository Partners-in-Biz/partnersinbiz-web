/**
 * POST /api/v1/admin/users/[uid]/reset
 *
 * Generate a Firebase password-reset link for the target user (US-254).
 * Super admins only. Optionally emails the link to the user via the system
 * Resend sender; the link is returned in the response regardless so the admin
 * can deliver it manually if email is not configured.
 *
 * Audits `user.reset_password`.
 */
import { NextRequest } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { writeAdminAudit } from '@/lib/admin/audit'
import { getResendClient, FROM_ADDRESS } from '@/lib/email/resend'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ uid: string }> }

export const POST = withAuth('admin', async (_req: NextRequest, user, context?: Params) => {
  if (!isSuperAdmin(user)) {
    return apiError('Only super admins can reset passwords', 403)
  }

  const { uid } = await (context as Params).params
  if (!uid || typeof uid !== 'string') {
    return apiError('uid is required', 400)
  }

  let authUser
  try {
    authUser = await adminAuth.getUser(uid)
  } catch {
    return apiError('User not found', 404)
  }

  const email = authUser.email
  if (!email) {
    return apiError('User has no email address — cannot generate a reset link', 400)
  }

  const link = await adminAuth.generatePasswordResetLink(email)

  // Best-effort delivery: never block the response if the mail send fails.
  let emailed = false
  try {
    if (process.env.RESEND_API_KEY) {
      const resend = getResendClient()
      const result = await resend.emails.send({
        from: FROM_ADDRESS,
        to: email,
        subject: 'Reset your Partners in Biz password',
        html: `
          <div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #111;">
            <p>An administrator initiated a password reset for your Partners in Biz account.</p>
            <p><a href="${link}" style="color:#2563eb;">Click here to set a new password</a>.</p>
            <p>If you did not expect this, you can safely ignore this email.</p>
          </div>
        `,
        text: `An administrator initiated a password reset for your Partners in Biz account.\n\nReset your password: ${link}\n\nIf you did not expect this, you can safely ignore this email.`,
      })
      emailed = !result.error
    }
  } catch (err) {
    console.error('[user.reset_password] email send failed', uid, err)
  }

  await writeAdminAudit(user, {
    action: 'user.reset_password',
    targetUid: uid,
    summary: `Generated password reset link for ${email}`,
    metadata: { email, emailed },
  })

  return apiSuccess({ uid, email, link, emailed })
})
