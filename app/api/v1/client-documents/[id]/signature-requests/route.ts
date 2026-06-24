/**
 * Signature requests for a client document (US-172 — signer-facing e-signature).
 *
 *   GET  — list signature requests for the document (admin/agent only).
 *   POST — create a signature request: invite a named signer by email with an
 *          optional message, mint a per-signer sign token, and email them a link
 *          to the public signing page (/d/[shareToken]/sign?st=[signToken]).
 *
 * This is the provider/admin side that *initiates* the signer flow. The signer
 * completes it on the public page, which calls the public sign endpoint.
 *
 * Auth: admin (org-scoped via getAccessibleClientDocument).
 */
import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'
import crypto from 'crypto'

import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { getAccessibleClientDocument } from '@/lib/client-documents/access'
import { CLIENT_DOCUMENTS_COLLECTION } from '@/lib/client-documents/store'
import { adminDb } from '@/lib/firebase/admin'
import { sendEmail } from '@/lib/email/send'
import { isSuppressed } from '@/lib/email/suppressions'
import type { SignatureRequest } from '@/lib/client-documents/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function actorType(user: ApiUser) {
  return user.role === 'ai' ? 'agent' : 'user'
}

function requiredText(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function baseUrlFrom(req: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL
  if (env) return env.replace(/\/+$/, '')
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
  const proto = req.headers.get('x-forwarded-proto') || 'https'
  if (host) return `${proto}://${host}`
  return 'https://partnersinbiz.online'
}

function signInviteHtml(opts: {
  signerName: string
  documentTitle: string
  message: string
  signUrl: string
}): string {
  const greeting = opts.signerName ? `Hi ${escapeHtml(opts.signerName)},` : 'Hi,'
  const note = opts.message
    ? `<p style="margin:0 0 16px;color:#374151;line-height:1.6;">${escapeHtml(opts.message)}</p>`
    : ''
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
      <tr><td style="padding:32px 32px 24px;">
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#6b7280;">Signature requested</p>
        <h1 style="margin:0 0 16px;font-size:22px;color:#111827;">${escapeHtml(opts.documentTitle)}</h1>
        <p style="margin:0 0 16px;color:#374151;line-height:1.6;">${greeting}</p>
        <p style="margin:0 0 16px;color:#374151;line-height:1.6;">You've been asked to review and electronically sign this document.</p>
        ${note}
        <p style="margin:24px 0;">
          <a href="${opts.signUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px;">Review &amp; sign</a>
        </p>
        <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6;">If the button doesn't work, copy this link into your browser:<br/><span style="color:#6b7280;word-break:break-all;">${opts.signUrl}</span></p>
      </td></tr>
    </table>
  </body></html>`
}

/** GET — list signature requests for the document. */
export const GET = withAuth('admin', async (_req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const access = await getAccessibleClientDocument(id, user)
  if (!access.ok) return access.response

  const snap = await adminDb
    .collection(CLIENT_DOCUMENTS_COLLECTION)
    .doc(id)
    .collection('signature_requests')
    .orderBy('createdAt', 'desc')
    .get()
    .catch(() => null)

  const requests = (snap?.docs ?? []).map((d) => ({ id: d.id, ...d.data() }) as SignatureRequest)
  return apiSuccess(requests)
})

/** POST — create a signature request and email the signer. */
export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const access = await getAccessibleClientDocument(id, user)
  if (!access.ok) return access.response

  const document = access.document

  if (!document.shareToken || document.shareEnabled !== true) {
    return apiError('Enable the public share link before requesting a signature', 400)
  }
  if (!document.latestPublishedVersionId) {
    return apiError('Publish a version before requesting a signature', 400)
  }

  const body = await req.json().catch(() => ({}))
  const signerName = requiredText(body.signerName)
  const signerEmail = requiredText(body.signerEmail).toLowerCase()
  const message = requiredText(body.message)

  if (!signerName) return apiError('signerName is required', 400)
  if (!signerEmail) return apiError('signerEmail is required', 400)
  if (!EMAIL_RE.test(signerEmail)) return apiError('signerEmail is not a valid email address', 400)

  // Respect the org suppression list — never email a suppressed signer.
  if (document.orgId && (await isSuppressed(document.orgId, signerEmail, 'email'))) {
    return apiError('This email is on the suppression list (unsubscribed or bounced) and cannot be contacted', 422)
  }

  const signToken = crypto.randomBytes(24).toString('hex')
  const requestRef = adminDb
    .collection(CLIENT_DOCUMENTS_COLLECTION)
    .doc(id)
    .collection('signature_requests')
    .doc()

  const now = FieldValue.serverTimestamp()
  const record = {
    documentId: id,
    versionId: document.latestPublishedVersionId,
    signerName,
    signerEmail,
    message: message || '',
    status: 'pending' as const,
    signToken,
    createdBy: user.uid,
    createdByType: actorType(user),
    createdAt: now,
  }
  await requestRef.set(record)

  // Build the public signing link and email the signer.
  const baseUrl = baseUrlFrom(req)
  const signUrl = `${baseUrl}/d/${document.shareToken}/sign?st=${signToken}`

  let emailSent = false
  let emailError: string | undefined
  const result = await sendEmail({
    to: signerEmail,
    subject: `Signature requested: ${document.title ?? 'Document'}`,
    html: signInviteHtml({ signerName, documentTitle: document.title ?? 'Document', message, signUrl }),
  }).catch((err) => ({ success: false, error: err instanceof Error ? err.message : 'send failed' }))

  if (result.success) {
    emailSent = true
    await requestRef.update({ invitedAt: now }).catch(() => {})
  } else {
    emailError = result.error
  }

  return apiSuccess({
    id: requestRef.id,
    signToken,
    signUrl,
    emailSent,
    ...(emailError ? { emailError } : {}),
  })
})
