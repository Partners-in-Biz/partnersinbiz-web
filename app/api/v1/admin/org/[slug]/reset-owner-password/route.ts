/**
 * POST /api/v1/admin/org/[slug]/reset-owner-password
 *
 * Generates a Firebase password-reset link for the org owner and (optionally)
 * emails it to them via Resend. Returns the link to the admin either way.
 *
 * Auth: super-admin only.
 */
import { NextRequest } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { writeAdminAudit } from '@/lib/admin/audit'
import { getResendClient, FROM_ADDRESS, plainTextToHtml } from '@/lib/email/resend'
import { resolveOrgBySlug, resolveOwnerUid } from '../route'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ slug: string }> }

export const POST = withAuth('admin', async (req: NextRequest, user, ctx) => {
  if (!isSuperAdmin(user)) return apiError('Super-admin access required', 403)

  const { slug } = await (ctx as RouteContext).params
  const resolved = await resolveOrgBySlug(slug)
  if (!resolved) return apiError('Organisation not found', 404)
  const { id, data: org } = resolved

  const body = await req.json().catch(() => ({}))
  const sendEmail = body?.sendEmail === true

  const ownerUid = resolveOwnerUid(org)
  if (!ownerUid) return apiError('Could not resolve an owner for this organisation', 404)

  let ownerEmail = ''
  try {
    const authUser = await adminAuth.getUser(ownerUid)
    ownerEmail = authUser.email ?? ''
  } catch {
    return apiError('Owner user not found in auth', 404)
  }
  if (!ownerEmail) return apiError('Owner has no email address on record', 400)

  let link: string
  try {
    link = await adminAuth.generatePasswordResetLink(ownerEmail)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to generate reset link', 500)
  }

  let emailSent = false
  let emailError: string | null = null
  if (sendEmail) {
    try {
      const text = [
        `Hi,`,
        ``,
        `A password reset was requested for your Partners in Biz account (${org.name ?? slug}).`,
        ``,
        `Reset your password here:`,
        link,
        ``,
        `If you did not expect this, you can safely ignore this email.`,
        ``,
        `— Partners in Biz`,
      ].join('\n')
      const result = await getResendClient().emails.send({
        from: FROM_ADDRESS,
        to: ownerEmail,
        subject: 'Reset your Partners in Biz password',
        html: plainTextToHtml(text),
        text,
      })
      emailSent = !result.error
      if (result.error) emailError = result.error.message
    } catch (err) {
      emailError = err instanceof Error ? err.message : 'Failed to send reset email'
    }
  }

  await writeAdminAudit(user, {
    action: 'org.reset_owner_password',
    orgId: id,
    targetUid: ownerUid,
    summary: `Generated owner password-reset link for "${org.name ?? slug}"`,
    metadata: { slug, ownerEmail, emailed: sendEmail, emailSent, emailError },
  })

  return apiSuccess({ link, ownerEmail, emailSent, emailError })
})
