/**
 * POST /api/v1/admin/org/[slug]/message
 *
 * Sends a platform-admin message to a client organisation. Writes a record to
 * the `org_messages` collection (so it shows in the org's admin message log)
 * and optionally emails the org owner via Resend.
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
  const subject = typeof body?.subject === 'string' ? body.subject.trim() : ''
  const message = typeof body?.message === 'string' ? body.message.trim() : ''
  const alsoEmail = body?.alsoEmail === true
  if (!message) return apiError('Message body is required', 400)

  const orgName = org.name ?? slug

  // Resolve owner email for the email channel.
  const ownerUid = resolveOwnerUid(org)
  let ownerEmail = org.billingEmail ?? ''
  if (ownerUid) {
    try {
      const authUser = await adminAuth.getUser(ownerUid)
      ownerEmail = authUser.email ?? ownerEmail
    } catch {
      /* keep billingEmail fallback */
    }
  }

  const docRef = await adminDb.collection('org_messages').add({
    orgId: id,
    orgSlug: slug,
    subject: subject || null,
    body: message,
    channel: alsoEmail ? 'email+log' : 'log',
    direction: 'admin_to_org',
    fromUid: user.uid,
    toUid: ownerUid ?? null,
    toEmail: ownerEmail || null,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  })

  let emailSent = false
  let emailError: string | null = null
  if (alsoEmail) {
    if (ownerEmail) {
      try {
        const text = [message, '', '— Partners in Biz'].join('\n')
        const result = await getResendClient().emails.send({
          from: FROM_ADDRESS,
          to: ownerEmail,
          subject: subject || `A message about your Partners in Biz workspace`,
          html: plainTextToHtml(text),
          text,
        })
        emailSent = !result.error
        if (result.error) emailError = result.error.message
      } catch (err) {
        emailError = err instanceof Error ? err.message : 'Failed to send email'
      }
    } else {
      emailError = 'No owner email on record'
    }
  }

  await writeAdminAudit(user, {
    action: 'org.message',
    orgId: id,
    targetUid: ownerUid ?? undefined,
    summary: `Sent message to "${orgName}"${subject ? `: ${subject}` : ''}`,
    metadata: { slug, alsoEmail, emailSent, emailError, messageId: docRef.id },
  })

  return apiSuccess({ id: docRef.id, emailSent, emailError })
})

export const GET = withAuth('admin', async (_req: NextRequest, user, ctx) => {
  if (!isSuperAdmin(user)) return apiError('Super-admin access required', 403)
  const { slug } = await (ctx as RouteContext).params
  const resolved = await resolveOrgBySlug(slug)
  if (!resolved) return apiError('Organisation not found', 404)

  const snap = await adminDb.collection('org_messages').where('orgId', '==', resolved.id).get()
  const messages = snap.docs
    .map((d) => {
      const data = d.data()
      const ts = data.createdAt as { _seconds?: number; seconds?: number } | undefined
      const seconds = ts?._seconds ?? ts?.seconds
      return {
        id: d.id,
        subject: typeof data.subject === 'string' ? data.subject : null,
        body: typeof data.body === 'string' ? data.body : '',
        channel: typeof data.channel === 'string' ? data.channel : 'log',
        createdAt: typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : null,
      }
    })
    .sort((a, b) => (b.createdAt ? Date.parse(b.createdAt) : 0) - (a.createdAt ? Date.parse(a.createdAt) : 0))
    .slice(0, 50)

  return apiSuccess({ messages })
})
