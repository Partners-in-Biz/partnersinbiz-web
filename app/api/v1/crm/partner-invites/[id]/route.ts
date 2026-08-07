import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { getPartnerInviteById, revokePartnerInvite } from '@/lib/partner-links/store'
import { cleanString } from '@/lib/partner-links/identity'
import { isPartnerInviteExpired } from '@/lib/partner-links/types'
import { partnerInviteEmail } from '@/lib/email/templates/partner-invite'
import { sendEmail } from '@/lib/email/send'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL ?? 'https://partnersinbiz.online'
}

export const GET = withCrmAuth<RouteContext>('viewer', async (_req, ctx, routeCtx) => {
  try {
    const { id } = await routeCtx!.params
    const invite = await getPartnerInviteById(id)
    if (!invite || invite.sourceOrgId !== ctx.orgId) return apiError('Invitation not found', 404)
    return apiSuccess({ invite: { ...invite, inviteToken: undefined } })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const PATCH = withCrmAuth<RouteContext>('member', async (req: NextRequest, ctx: CrmAuthContext, routeCtx) => {
  try {
    const { id } = await routeCtx!.params
    const invite = await getPartnerInviteById(id)
    if (!invite || invite.sourceOrgId !== ctx.orgId) return apiError('Invitation not found', 404)

    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const action = cleanString(body.action)

    if (action === 'revoke') {
      if (invite.status === 'accepted') {
        return apiError('This invitation was already accepted — unlink the partnership instead', 409)
      }
      await revokePartnerInvite({ invite, actor: ctx.actor })
      return apiSuccess({ id: invite.id, status: 'revoked' })
    }

    if (action === 'resend') {
      if (invite.status !== 'pending') {
        return apiError(`Cannot resend an invitation that is ${invite.status}`, 409)
      }
      if (isPartnerInviteExpired(invite)) {
        return apiError('This invitation has expired — create a new one', 410)
      }
      const orgSnap = await adminDb.collection('organizations').doc(ctx.orgId).get()
      const inviterOrgName = cleanString((orgSnap.data() ?? {}).name) || ctx.orgId
      const acceptUrl = `${baseUrl()}/partners/invite/${invite.inviteToken}`
      const { subject, html } = partnerInviteEmail({
        inviterOrgName,
        inviterName: invite.inviterName,
        recipientName: invite.recipientName,
        acceptUrl,
        message: invite.message,
        expiresAt: invite.expiresAt,
      })
      const result = await sendEmail({ to: invite.recipientEmail, subject, html })
      return apiSuccess({ id: invite.id, emailSent: result.success, emailError: result.error })
    }

    return apiError('Unsupported action — use "revoke" or "resend"', 400)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
