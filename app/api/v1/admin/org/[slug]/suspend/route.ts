/**
 * POST /api/v1/admin/org/[slug]/suspend (US-294)
 *
 * Suspend or unsuspend a client organisation.
 *  - action 'suspend': set status='suspended', store reason + internal note on
 *    org.suspension, optionally email the owner, audit.
 *  - action 'unsuspend': restore status='active', clear suspension, audit.
 *
 * Auth: super-admin only.
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb, adminAuth } from '@/lib/firebase/admin'
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
  const action = body?.action === 'unsuspend' ? 'unsuspend' : 'suspend'
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
  const internalNote = typeof body?.internalNote === 'string' ? body.internalNote.trim() : ''
  const notify = body?.notify === true

  if (action === 'suspend' && !reason) {
    return apiError('A suspension reason is required', 400)
  }

  const orgName = org.name ?? slug

  if (action === 'unsuspend') {
    await adminDb.collection('organizations').doc(id).update({
      status: 'active',
      suspension: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    await writeAdminAudit(user, {
      action: 'org.unsuspend',
      orgId: id,
      summary: `Unsuspended organisation "${orgName}" (status → active)`,
      metadata: { slug },
    })
    return apiSuccess({ id, status: 'active', suspended: false })
  }

  // ---- suspend ----
  await adminDb.collection('organizations').doc(id).update({
    status: 'suspended',
    suspension: {
      reason,
      internalNote: internalNote || null,
      suspendedBy: user.uid,
      suspendedAt: new Date().toISOString(),
      notified: notify,
    },
    updatedAt: FieldValue.serverTimestamp(),
  })

  // Notify owner via Resend (system mail).
  let emailSent = false
  let emailError: string | null = null
  if (notify) {
    const ownerUid = resolveOwnerUid(org)
    let ownerEmail = org.billingEmail ?? ''
    if (ownerUid) {
      try {
        const authUser = await adminAuth.getUser(ownerUid)
        ownerEmail = authUser.email ?? ownerEmail
      } catch {
        /* fall back to billingEmail */
      }
    }
    if (ownerEmail) {
      try {
        const text = [
          `Hi,`,
          ``,
          `Your Partners in Biz workspace "${orgName}" has been suspended.`,
          ``,
          `Reason: ${reason}`,
          ``,
          `If you believe this is a mistake or would like to resolve it, please reply to this email and our team will help you restore access.`,
          ``,
          `— Partners in Biz`,
        ].join('\n')
        const result = await getResendClient().emails.send({
          from: FROM_ADDRESS,
          to: ownerEmail,
          subject: `Your Partners in Biz workspace has been suspended`,
          html: plainTextToHtml(text),
          text,
        })
        emailSent = !result.error
        if (result.error) emailError = result.error.message
      } catch (err) {
        emailError = err instanceof Error ? err.message : 'Failed to send suspension email'
      }
    } else {
      emailError = 'No owner email on record'
    }
  }

  await writeAdminAudit(user, {
    action: 'org.suspend',
    orgId: id,
    summary: `Suspended organisation "${orgName}"`,
    metadata: { slug, reason, internalNote: internalNote || null, notify, emailSent, emailError },
  })

  return apiSuccess({ id, status: 'suspended', suspended: true, emailSent, emailError })
})
