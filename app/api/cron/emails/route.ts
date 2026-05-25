/**
 * GET /api/cron/emails — process scheduled emails due now
 *
 * Secured by Authorization: Bearer ${CRON_SECRET}
 * Vercel cron schedule: every 15 minutes  (see vercel.json)
 *
 * For each email where status == "scheduled" AND scheduledFor <= now:
 *   1. Resolve sender (campaign-aware) and interpolate template vars
 *   2. Send via Resend (sendCampaignEmail)
 *   3. Update status to "sent", set sentAt, resendId, from
 *   4. If campaign-linked, increment campaign.stats.sent
 *   5. Log email_sent activity on linked contact (if contactId set)
 */
import { NextRequest, NextResponse } from 'next/server'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { sendCampaignEmail } from '@/lib/email/resend'
import { resolveFrom } from '@/lib/email/resolveFrom'
import { interpolate, varsFromContact } from '@/lib/email/template'
import { isSuppressed } from '@/lib/email/suppressions'
import { shouldSendToContact } from '@/lib/preferences/store'
import { isWithinFrequencyCap, logFrequencySkip } from '@/lib/email/frequency'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authHeader = req.headers.get('authorization') ?? ''
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = Timestamp.now()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snapshot = await (adminDb.collection('emails') as any)
    .where('status', '==', 'scheduled')
    .where('scheduledFor', '<=', now)
    .get()

  let processed = 0

  for (const docSnap of snapshot.docs) {
    try {
      const email = docSnap.data() as {
        to: string
        from: string
        cc: string[]
        subject: string
        bodyHtml: string
        bodyText: string
        contactId: string
        sequenceId: string
        orgId?: string
        campaignId?: string
        fromDomainId?: string
        topicId?: string
      }

      const orgId = email.orgId ?? ''
      const campaignId = email.campaignId ?? ''
      const contactId = email.contactId ?? ''
      const topicId = email.topicId || 'transactional'

      const markSkipped = async (reason: string) => {
        await adminDb.collection('emails').doc(docSnap.id).update({
          status: 'skipped',
          skippedReason: reason,
          skippedAt: FieldValue.serverTimestamp(),
        })
      }

      // Look up org for fallback display name
      let orgName = ''
      if (orgId) {
        const orgSnap = await adminDb.collection('organizations').doc(orgId).get()
        if (orgSnap.exists) {
          orgName = (orgSnap.data() as { name?: string })?.name ?? ''
        }
      }

      // If campaign-linked, use campaign sender fields
      type CampaignLite = {
        fromDomainId?: string
        fromName?: string
        fromLocal?: string
        replyTo?: string
      }
      let campaign: CampaignLite | null = null
      if (campaignId) {
        const campSnap = await adminDb.collection('campaigns').doc(campaignId).get()
        if (campSnap.exists) {
          campaign = (campSnap.data() ?? null) as CampaignLite | null
        }
      }

      // Send gates. Scheduled campaign/one-off emails are created ahead of
      // dispatch, so preferences/suppressions can change between scheduling
      // and cron execution. Re-check the canonical gates immediately before
      // provider dispatch and mark the email skipped instead of leaving it in
      // the due queue.
      if (orgId && email.to && (await isSuppressed(orgId, email.to))) {
        await markSkipped('suppressed')
        continue
      }

      if (orgId && contactId) {
        const prefsCheck = await shouldSendToContact({ contactId, orgId, topicId })
        if (!prefsCheck.allowed) {
          await markSkipped(prefsCheck.reason ?? 'blocked by preferences')
          continue
        }

        if (topicId !== 'transactional') {
          const freqCheck = await isWithinFrequencyCap(orgId, contactId, topicId)
          if (!freqCheck.allowed) {
            const reason = freqCheck.reason ?? 'frequency cap'
            await logFrequencySkip({
              orgId,
              contactId,
              topicId,
              source: campaignId ? 'campaign' : email.sequenceId ? 'sequence' : 'transactional',
              sourceId: campaignId || email.sequenceId || docSnap.id,
              reason,
            })
            await markSkipped(reason)
            continue
          }
        }
      }

      const resolved = campaign
        ? await resolveFrom({
            fromDomainId: campaign.fromDomainId,
            fromName: campaign.fromName,
            fromLocal: campaign.fromLocal,
            orgName,
          })
        : await resolveFrom({
            fromDomainId: email.fromDomainId,
            orgName,
          })

      // Build template variables and interpolate
      let vars: Record<string, string | number | undefined> = { orgName }
      if (contactId) {
        const contactSnap = await adminDb.collection('contacts').doc(contactId).get()
        if (contactSnap.exists) {
          vars = { ...varsFromContact(contactSnap.data()!), orgName }
        }
      }

      const subject = interpolate(email.subject ?? '', vars)
      const bodyHtml = interpolate(email.bodyHtml ?? '', vars)
      const bodyText = interpolate(email.bodyText ?? '', vars)

      const sendResult = await sendCampaignEmail({
        from: resolved.from,
        to: email.to,
        cc: email.cc,
        replyTo: campaign?.replyTo,
        subject,
        html: bodyHtml,
        text: bodyText,
      })

      if (!sendResult.ok) {
        await adminDb.collection('emails').doc(docSnap.id).update({
          status: 'failed',
          from: resolved.from,
        })
        continue
      }

      await adminDb.collection('emails').doc(docSnap.id).update({
        status: 'sent',
        from: resolved.from,
        resendId: sendResult.resendId,
        provider: sendResult.provider,
        providerMessageId: sendResult.resendId,
        sentAt: FieldValue.serverTimestamp(),
      })

      if (campaignId) {
        await adminDb.collection('campaigns').doc(campaignId).update({
          'stats.sent': FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        })
      }

      if (contactId && orgId) {
        await adminDb.collection('activities').add({
          orgId,
          contactId,
          dealId: '',
          type: 'email_sent',
          summary: `Email sent: ${subject}`,
          metadata: { emailId: docSnap.id, to: email.to, campaignId },
          createdBy: 'cron',
          createdAt: FieldValue.serverTimestamp(),
        })
      }

      processed++
    } catch (err) {
      console.error('[cron/emails] email failed', docSnap.id, err)
    }
  }

  return NextResponse.json({ success: true, data: { processed } })
}
