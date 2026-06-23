/**
 * POST /api/v1/email/transactional — org-scoped transactional email send (US-110)
 *
 * Auth: org-scoped agent API key (Authorization: Bearer pib_…). Agent keys
 * carry an `orgId`; we resolve the send under that org via resolveOrgScope.
 * Admin / legacy-ai keys also work and must pass `orgId` in the body.
 *
 * Body:
 *   to       string   (required)
 *   subject  string   (required)
 *   html     string   (required if `text` not provided)
 *   text     string   (required if `html` not provided)
 *   from?    string   (optional — must be on a verified org domain)
 *   orgId?   string   (required for admin/legacy-ai keys; ignored for org keys)
 *
 * Preconditions:
 *   • The org MUST have at least one verified sending domain.
 *   • If `from` is supplied, its domain MUST be one of the org's verified
 *     domains — otherwise 422.
 *   • Per-org rate limit: TRANSACTIONAL_RATE_LIMIT/min (Firestore token bucket).
 *   • Recipient must not be on the org suppression list.
 *
 * Stores the sent message in the `emails` collection (consistent with
 * lib/email/send.ts) so the Resend webhook can attribute opens/clicks/bounces.
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { sendCampaignEmail, plainTextToHtml, htmlToPlainText } from '@/lib/email/resend'
import { isSuppressed } from '@/lib/email/suppressions'
import { listVerifiedOrgDomains, extractSenderDomain } from '@/lib/email/orgDomains'
import { checkAndIncrementRateLimit } from '@/lib/rateLimit'
import { checkQuota } from '@/lib/platform/quotas'
import type { ApiUser } from '@/lib/api/types'

// Per-org transactional rate limit. Sane default for a transactional API —
// generous enough for password resets / receipts, low enough to cap abuse.
const TRANSACTIONAL_RATE_LIMIT = 100 // requests
const TRANSACTIONAL_RATE_WINDOW_MS = 60 * 1000 // per minute

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type TransactionalBody = {
  to?: string
  subject?: string
  html?: string
  text?: string
  from?: string
  orgId?: string
}

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const body = (await req.json().catch(() => null)) as TransactionalBody | null
  if (!body) return apiError('Invalid JSON', 400)

  // Resolve org. Org-scoped agent keys carry user.orgId; resolveOrgScope
  // accepts that (or a body.orgId for admin/legacy-ai callers).
  const requestedOrgId =
    typeof body.orgId === 'string' && body.orgId.trim()
      ? body.orgId.trim()
      : (user.orgId ?? null)
  const scope = resolveOrgScope(user, requestedOrgId)
  if (!scope.ok) return apiError(scope.error, scope.status)
  const orgId = scope.orgId

  const to = (body.to ?? '').trim()
  const subject = (body.subject ?? '').trim()
  const html = (body.html ?? '').trim()
  const text = (body.text ?? '').trim()
  const fromOverride = (body.from ?? '').trim()

  if (!to) return apiError('to is required')
  if (!EMAIL_RE.test(to)) return apiError('to is not a valid email address')
  if (!subject) return apiError('subject is required')
  if (!html && !text) return apiError('html or text is required')

  // Precondition: org must have a verified sending domain.
  const verifiedDomains = await listVerifiedOrgDomains(orgId)
  if (verifiedDomains.length === 0) {
    return apiError(
      'No verified sending domain for this organisation. Verify a domain before sending transactional email.',
      422,
    )
  }
  const verifiedNames = new Set(verifiedDomains.map((d) => d.name.toLowerCase()))

  // Resolve the sender. If a `from` is supplied it must be on a verified
  // domain; otherwise default to noreply@<first verified domain>.
  let fromAddress: string
  if (fromOverride) {
    const fromDomain = extractSenderDomain(fromOverride)
    if (!fromDomain) return apiError('from is not a valid sender address', 422)
    if (!verifiedNames.has(fromDomain)) {
      return apiError(
        `Sender domain "${fromDomain}" is not a verified sending domain for this organisation.`,
        422,
      )
    }
    fromAddress = fromOverride
  } else {
    fromAddress = `noreply@${verifiedDomains[0].name}`
  }

  // Per-org rate limit (Firestore token bucket — same backend as the public
  // limiter). Keyed on org so each tenant gets its own budget.
  let limit
  try {
    limit = await checkAndIncrementRateLimit({
      key: `email_transactional:${orgId}`,
      limit: TRANSACTIONAL_RATE_LIMIT,
      windowMs: TRANSACTIONAL_RATE_WINDOW_MS,
      orgId,
    })
  } catch {
    // Limiter unavailable — fail open so a Firestore blip doesn't break sends.
    limit = null
  }
  if (limit && !limit.allowed) {
    return apiError(
      `Transactional rate limit reached (${TRANSACTIONAL_RATE_LIMIT}/min). Try again shortly.`,
      429,
      { resetAt: limit.resetAt.toISOString() },
    )
  }

  // Suppression gate — never send to a suppressed address.
  if (await isSuppressed(orgId, to)) {
    return apiError('Recipient is on the suppression list for this organisation', 422)
  }

  const finalHtml = html || plainTextToHtml(text)
  const finalText = text || htmlToPlainText(html)

  // 1. Create the email doc first so the resendId can be written back and the
  //    webhook can attribute events. Shape mirrors lib/email/send.ts.
  const docRef = await adminDb.collection('emails').add({
    orgId,
    campaignId: '',
    broadcastId: '',
    fromDomainId: '',
    direction: 'outbound',
    contactId: '',
    resendId: '',
    provider: '',
    providerMessageId: '',
    from: fromAddress,
    to,
    cc: [],
    subject,
    bodyHtml: finalHtml,
    bodyText: finalText,
    status: 'draft',
    scheduledFor: null,
    sentAt: null,
    openedAt: null,
    clickedAt: null,
    bouncedAt: null,
    sequenceId: '',
    sequenceStep: null,
    variantId: '',
    topicId: 'transactional',
    source: 'transactional-api',
    deleted: false,
    createdAt: FieldValue.serverTimestamp(),
  })

  // 2. Send via the configured provider.
  const sendResult = await sendCampaignEmail({
    from: fromAddress,
    to,
    subject,
    html: finalHtml,
    text: finalText,
  })

  if (!sendResult.ok) {
    await adminDb.collection('emails').doc(docRef.id).update({ status: 'failed' })
    return apiError(sendResult.error ?? 'Email send failed', 502)
  }

  // 3. Mark sent + persist the provider message id for webhook attribution.
  await adminDb.collection('emails').doc(docRef.id).update({
    status: 'sent',
    resendId: sendResult.resendId,
    providerMessageId: sendResult.resendId,
    provider: sendResult.provider,
    sentAt: FieldValue.serverTimestamp(),
  })

  // Fire-and-forget quota tracking — never blocks the response.
  checkQuota(orgId, 'emailsPerMonth').catch(() => {})

  return apiSuccess({ id: docRef.id }, 201)
})
