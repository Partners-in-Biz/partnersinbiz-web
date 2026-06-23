/**
 * POST /api/v1/email/send — send an email immediately via Resend
 *
 * Body:
 *   to         string  (required)
 *   subject    string  (required)
 *   bodyText   string  (required if bodyHtml not provided)
 *   bodyHtml   string  (optional — if omitted, generated from bodyText)
 *   cc         string[] (optional)
 *   contactId  string  (optional — links email to a CRM contact and logs activity)
 *   sequenceId string  (optional)
 *   sequenceStep number (optional)
 *
 * Auth: admin or ai
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { enforceAgentCapability } from '@/lib/api/capabilityGate'
import { sendCampaignEmail, FROM_ADDRESS, plainTextToHtml, htmlToPlainText } from '@/lib/email/resend'
import { signUnsubscribeToken } from '@/lib/email/unsubscribeToken'
import { isSuppressed } from '@/lib/email/suppressions'
import { checkQuota } from '@/lib/platform/quotas'
import type { ApiUser } from '@/lib/api/types'
import { shouldSendToContact } from '@/lib/preferences/store'
import { isWithinFrequencyCap, logFrequencySkip } from '@/lib/email/frequency'
import { assertOutboundEmailAllowed } from '@/lib/email/policy'

type SendEmailBody = {
  to?: string
  subject?: string
  bodyText?: string
  bodyHtml?: string
  text?: string
  html?: string
  cc?: string[]
  contactId?: string
  sequenceId?: string
  sequenceStep?: number | null
  campaignId?: string
  fromDomainId?: string
  orgId?: string
  topicId?: string
  approvalStatus?: string
  approvalGateTaskId?: string
}

async function resolveOrgIdFromContact(contactId: string): Promise<string | null> {
  if (!contactId.trim()) return null
  const snap = await adminDb.collection('contacts').doc(contactId.trim()).get()
  if (!snap.exists) return null
  const orgId = snap.data()?.orgId
  return typeof orgId === 'string' && orgId.trim() ? orgId.trim() : null
}

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json() as SendEmailBody & Record<string, unknown>
  const {
    to,
    subject,
    bodyText,
    bodyHtml,
    text,
    html,
    cc = [],
    contactId = '',
    sequenceId = '',
    sequenceStep = null,
    campaignId = '',
    fromDomainId = '',
  } = body

  const cleanTo = to?.trim() ?? ''
  const cleanSubject = subject?.trim() ?? ''
  const cleanBodyText = (bodyText ?? text)?.trim() ?? ''
  const cleanBodyHtml = (bodyHtml ?? html)?.trim() ?? ''

  if (!cleanTo) return apiError('to is required')
  if (!cleanSubject) return apiError('subject is required')
  if (!cleanBodyText && !cleanBodyHtml) return apiError('bodyText or bodyHtml is required')

  const policy = await assertOutboundEmailAllowed({ recipients: [cleanTo] })
  if (!policy.allowed) {
    return apiError(policy.error ?? 'Outbound email blocked by platform policy', policy.status ?? 403)
  }

  const requestedOrgId =
    typeof body.orgId === 'string' && body.orgId.trim()
      ? body.orgId.trim()
      : await resolveOrgIdFromContact(contactId)
  const scope = resolveOrgScope(user, requestedOrgId)
  if (!scope.ok) return apiError(scope.error, scope.status)
  const orgId = scope.orgId
  const capabilityError = enforceAgentCapability(user, 'message_client', req, body)
  if (capabilityError) return capabilityError

  // Refuse to send to addresses on the org suppression list (hard bounce,
  // complaint, manual unsub, or active soft-bounce hold).
  if (await isSuppressed(orgId, cleanTo)) {
    return apiError('Recipient is on the suppression list for this organisation', 422)
  }

  // Preferences gate. Transactional sends bypass topic/frequency opt-outs
  // (topicId='transactional' is documented as not turn-offable) but still
  // honour a hard global unsubscribe.
  // The caller can override the topic via `body.topicId` — defaults to
  // 'transactional' since this endpoint is the transactional send path.
  const requestedTopicId =
    typeof body.topicId === 'string' && body.topicId.trim() ? body.topicId.trim() : 'transactional'
  if (contactId) {
    const prefsCheck = await shouldSendToContact({ contactId, orgId, topicId: requestedTopicId })
    if (!prefsCheck.allowed) {
      return apiError(`Recipient has opted out: ${prefsCheck.reason ?? 'no reason'}`, 422)
    }

    if (requestedTopicId !== 'transactional') {
      const freqCheck = await isWithinFrequencyCap(orgId, contactId, requestedTopicId)
      if (!freqCheck.allowed) {
        const reason = freqCheck.reason ?? 'frequency cap'
        await logFrequencySkip({
          orgId,
          contactId,
          topicId: requestedTopicId,
          source: 'transactional',
          sourceId: campaignId || sequenceId || '',
          reason,
        })
        return apiError(`Recipient is over frequency cap: ${reason}`, 422)
      }
    }
  }

  const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://partnersinbiz.online'
  const unsubscribeToken = contactId
    ? signUnsubscribeToken(contactId, campaignId || undefined)
    : undefined
  const unsubscribeUrl = unsubscribeToken ? `${BASE_URL}/api/unsubscribe?token=${unsubscribeToken}` : undefined

  const unsubscribeFooter = unsubscribeUrl
    ? `<p style="font-size:11px;color:#666;text-align:center;margin-top:24px;">Don't want these emails? <a href="${unsubscribeUrl}" style="color:#888;">Unsubscribe</a></p>`
    : ''

  const rawHtml = cleanBodyHtml || plainTextToHtml(cleanBodyText)
  const finalBodyHtml = unsubscribeFooter ? rawHtml + unsubscribeFooter : rawHtml
  const finalBodyText = cleanBodyText || htmlToPlainText(cleanBodyHtml)

  // 1. Create draft doc first so we have an id for the activity log
  const docRef = await adminDb.collection('emails').add({
    orgId,
    campaignId,
    fromDomainId,
    direction: 'outbound',
    contactId,
    resendId: '',
    provider: '',
    providerMessageId: '',
    from: FROM_ADDRESS,
    to: cleanTo,
    cc,
    subject: cleanSubject,
    bodyHtml: finalBodyHtml,
    bodyText: finalBodyText,
    status: 'draft',
    scheduledFor: null,
    sentAt: null,
    openedAt: null,
    clickedAt: null,
    bouncedAt: null,
    sequenceId,
    sequenceStep,
    variantId: '',
    topicId: requestedTopicId,
    deleted: false,
    createdAt: FieldValue.serverTimestamp(),
  })

  // 2. Send via the configured provider (with one-click List-Unsubscribe when we have a token).
  const sendResult = await sendCampaignEmail({
    from: FROM_ADDRESS,
    to: cleanTo,
    cc: cc.length ? cc : undefined,
    subject: cleanSubject,
    html: finalBodyHtml,
    text: finalBodyText,
    listUnsubscribeUrl: unsubscribeUrl,
  })

  if (!sendResult.ok) {
    await adminDb.collection('emails').doc(docRef.id).update({
      status: 'failed',
    })
    return apiError(sendResult.error ?? 'Email send failed', 502)
  }

  // 3. Update status to sent
  await adminDb.collection('emails').doc(docRef.id).update({
    status: 'sent',
    resendId: sendResult.resendId,
    providerMessageId: sendResult.resendId,
    provider: sendResult.provider,
    sentAt: FieldValue.serverTimestamp(),
  })

  // 4. Log activity on linked contact
  if (contactId) {
    await adminDb.collection('activities').add({
      orgId,
      contactId,
      dealId: '',
      type: 'email_sent',
      summary: `Email sent: ${cleanSubject}`,
      metadata: { emailId: docRef.id, to: cleanTo },
      createdBy: user.uid,
      createdAt: FieldValue.serverTimestamp(),
    })
  }

  // Fire-and-forget quota tracking — never blocks the response
  checkQuota(orgId, 'emailsPerMonth').catch(() => {})

  return apiSuccess({ id: docRef.id }, 201)
})
