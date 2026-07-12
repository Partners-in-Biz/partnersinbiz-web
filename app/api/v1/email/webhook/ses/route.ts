/**
 * POST /api/v1/email/webhook/ses — Amazon SES → SNS webhook receiver
 *
 * Public endpoint. SES emits events (bounce / complaint / delivery / open /
 * click / delivery-delay / send / reject) to an SNS topic configured on the
 * SES ConfigurationSet, and SNS POSTs them here. There are two payload kinds:
 *   1. `SubscriptionConfirmation` — sent once when the SNS topic is subscribed
 *      to this URL. We GET `SubscribeURL` to confirm.
 *   2. `Notification` — the real event. `Message` is a JSON string of the SES
 *      event envelope (`eventType`, `mail`, `bounce` | `complaint` | ...).
 *
 * SES message-id ↔ Firestore lookup:
 *   SES populates `mail.messageId`. We persisted that as `providerMessageId`
 *   (and the legacy `resendId` field) at send time, so we look the email doc
 *   up by `providerMessageId == messageId`.
 *
 * Signature verification: SNS signs each message with RSA. We verify using the
 * PEM cert at SigningCertURL (must be from *.amazonaws.com). Enforced when
 * SES_SNS_TOPIC_ARN is set; skipped in dev/test so local tooling still works.
 */
import { createVerify } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { incrementVariantStat, type VariantStatField } from '@/lib/ab-testing/cronHelpers'
import {
  addSuppression,
  temporaryExpiryFromNow,
  type SuppressionReason,
} from '@/lib/email/suppressions'
import { appendEmailEvent, claimEmailEventProjection, completeEmailEventProjection } from '@/lib/email-events/store'
import type { EmailEventType } from '@/lib/email-events/types'
import { appendConsentEvent } from '@/lib/consent-ledger/store'
import { resolveProviderEventTarget } from '@/lib/email-events/provider-target'
import { applyFirestoreProjectionEffect } from '@/lib/email-events/effects'

// SNS signing cert must come from an amazonaws.com subdomain
const SNS_CERT_URL_RE = /^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com\//
const certCache = new Map<string, string>()

async function fetchSigningCert(url: string): Promise<string> {
  if (!SNS_CERT_URL_RE.test(url)) throw new Error(`Untrusted SNS cert URL: ${url}`)
  const cached = certCache.get(url)
  if (cached) return cached
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`Failed to fetch SNS signing cert: ${res.status}`)
  const pem = await res.text()
  certCache.set(url, pem)
  return pem
}

// Field order per AWS SNS signature spec
const NOTIFICATION_SIGN_FIELDS = ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type']
const CONFIRMATION_SIGN_FIELDS = ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type']

function buildStringToSign(msg: Record<string, string>): string {
  const fields = msg.Type === 'Notification' ? NOTIFICATION_SIGN_FIELDS : CONFIRMATION_SIGN_FIELDS
  return fields.filter(f => msg[f] !== undefined).map(f => `${f}\n${msg[f]}\n`).join('')
}

async function verifySnsSignature(msg: Record<string, string>): Promise<void> {
  const certUrl = msg.SigningCertURL
  const signature = msg.Signature
  if (!certUrl || !signature) throw new Error('Missing SNS signature fields')
  const pem = await fetchSigningCert(certUrl)
  const algorithm = msg.SignatureVersion === '2' ? 'SHA256withRSA' : 'sha1WithRSAEncryption'
  const verifier = createVerify(algorithm)
  verifier.update(buildStringToSign(msg))
  if (!verifier.verify(pem, signature, 'base64')) {
    throw new Error('SNS signature invalid')
  }
}

interface SnsEnvelope {
  Type: string                              // 'Notification' | 'SubscriptionConfirmation' | 'UnsubscribeConfirmation'
  MessageId: string
  TopicArn?: string
  Message: string                           // stringified JSON for Notification, plain text for confirmations
  Timestamp?: string
  Token?: string
  SubscribeURL?: string
  SigningCertURL?: string
  Signature?: string
  SignatureVersion?: string
  Subject?: string
}

interface SesMailObject {
  messageId: string
  destination?: string[]
  source?: string
}

interface SesBounceInfo {
  bounceType?: string                       // 'Permanent' | 'Transient' | 'Undetermined'
  bounceSubType?: string
  bouncedRecipients?: Array<{
    emailAddress?: string
    diagnosticCode?: string
    status?: string
  }>
}

interface SesComplaintInfo {
  complainedRecipients?: Array<{ emailAddress?: string }>
  complaintFeedbackType?: string
}

interface SesEventEnvelope {
  eventType?: string                        // 'Bounce' | 'Complaint' | 'Delivery' | 'Send' | 'Reject' | 'Open' | 'Click' | 'DeliveryDelay'
  notificationType?: string                 // older SES schema uses this
  mail: SesMailObject
  bounce?: SesBounceInfo
  complaint?: SesComplaintInfo
}

let missingTopicWarned = false

function canonicalSesEvent(eventType: string): EmailEventType | null {
  if (eventType === 'delivery') return 'delivered'
  if (eventType === 'open') return 'opened'
  if (eventType === 'click') return 'clicked'
  if (eventType === 'bounce') return 'bounced'
  if (eventType === 'complaint') return 'complained'
  if (eventType === 'deliverydelay') return 'deferred'
  if (eventType === 'send') return 'sent'
  if (eventType === 'reject') return 'failed'
  return null
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text()
  let envelope: SnsEnvelope
  try {
    envelope = JSON.parse(rawBody) as SnsEnvelope
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const expectedTopic = process.env.SES_SNS_TOPIC_ARN?.trim()
  if (expectedTopic && envelope.TopicArn && envelope.TopicArn !== expectedTopic) {
    return NextResponse.json({ error: 'Unexpected topic' }, { status: 400 })
  } else if (!expectedTopic && !missingTopicWarned) {
    missingTopicWarned = true
    console.warn(
      '[email/webhook/ses] SES_SNS_TOPIC_ARN is not set — accepting messages from any topic. Set this in production.',
    )
  }

  // Verify SNS signature when running in production (SES_SNS_TOPIC_ARN set).
  // Skipped in dev/test so local tooling still works without a real SNS cert.
  if (expectedTopic) {
    try {
      await verifySnsSignature(envelope as unknown as Record<string, string>)
    } catch (err) {
      console.error('[email/webhook/ses] SNS signature verification failed:', err)
      return NextResponse.json({ error: 'Signature verification failed' }, { status: 403 })
    }
  }

  // Subscription confirmation: SNS sends this once per subscription. We fetch
  // SubscribeURL to confirm. After this, real notifications start flowing.
  if (envelope.Type === 'SubscriptionConfirmation' && envelope.SubscribeURL) {
    try {
      const res = await fetch(envelope.SubscribeURL)
      if (!res.ok) {
        console.error('[email/webhook/ses] subscription confirm failed', res.status)
        return NextResponse.json({ error: 'confirm failed' }, { status: 500 })
      }
      return NextResponse.json({ ok: true, confirmed: true })
    } catch (err) {
      console.error('[email/webhook/ses] subscription confirm error', err)
      return NextResponse.json({ error: 'confirm error' }, { status: 500 })
    }
  }

  if (envelope.Type !== 'Notification') {
    return NextResponse.json({ ok: true, note: `ignored type ${envelope.Type}` })
  }

  let event: SesEventEnvelope
  try {
    event = JSON.parse(envelope.Message) as SesEventEnvelope
  } catch {
    return NextResponse.json({ error: 'Invalid Message JSON' }, { status: 400 })
  }

  const sesMessageId = event.mail?.messageId
  if (!sesMessageId) {
    return NextResponse.json({ ok: true, note: 'no messageId' })
  }

  // Look up the email doc by providerMessageId (the value we wrote at send
  // time). Falls back to the legacy `resendId` lookup so rows persisted before
  // the schema migration still resolve.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const coll = adminDb.collection('emails') as any
  let snapshot = await coll.where('providerMessageId', '==', sesMessageId).limit(2).get()
  if (snapshot.empty) {
    snapshot = await coll.where('resendId', '==', sesMessageId).limit(2).get()
  }
  if (snapshot.empty) {
    return NextResponse.json({ ok: true, note: 'email not found' })
  }

  try {
    resolveProviderEventTarget(snapshot.docs.map((doc: { id: string; data(): { orgId?: string } }) => ({
      id: doc.id,
      data: doc.data(),
    })))
  } catch (error) {
    console.error('[email/webhook/ses] unsafe provider target', error)
    return NextResponse.json({ error: 'Provider event target is not tenant-safe' }, { status: 409 })
  }
  const docRef = snapshot.docs[0].ref
  const emailData =
    typeof snapshot.docs[0].data === 'function'
      ? ((snapshot.docs[0].data() as {
          orgId?: string
          to?: string
          campaignId?: string
          contactId?: string
          variantId?: string
          broadcastId?: string
          sequenceId?: string
          sequenceStep?: number | null
        }) ?? {})
      : {}
  const emailOrgId = emailData?.orgId ?? ''
  const emailTo = emailData?.to ?? ''
  const campaignId = emailData?.campaignId ?? ''
  const contactId = emailData?.contactId ?? ''
  const variantId = emailData?.variantId ?? ''
  const broadcastId = emailData?.broadcastId ?? ''
  const sequenceId = emailData?.sequenceId ?? ''
  const sequenceStep = emailData?.sequenceStep ?? null

  const eventType = (event.eventType ?? event.notificationType ?? '').toLowerCase()
  const canonicalEvent = canonicalSesEvent(eventType)
  let ledgerEventId = ''
  let projectionLeaseToken = ''
  if (canonicalEvent) {
    const ledger = await appendEmailEvent({
      orgId: emailOrgId,
      messageId: snapshot.docs[0].id ?? docRef.id ?? sesMessageId,
      programId: broadcastId || campaignId || sequenceId || undefined,
      contactId: contactId || undefined,
      provider: 'ses',
      providerMessageId: sesMessageId,
      providerEventId: envelope.MessageId || undefined,
      event: canonicalEvent,
      providerTimestamp: envelope.Timestamp,
      recipient: emailTo || event.mail?.destination?.[0],
      bounceClass:
        canonicalEvent === 'bounced'
          ? (event.bounce?.bounceType ?? '').toLowerCase() === 'permanent'
            ? 'hard'
            : (event.bounce?.bounceType ?? '').toLowerCase() === 'transient'
              ? 'soft'
              : 'undetermined'
          : undefined,
      metadata: canonicalEvent === 'bounced' ? { bounce: event.bounce ?? {} } : {},
    })
    ledgerEventId = ledger.id

    if (canonicalEvent === 'complained' && contactId) {
      await appendConsentEvent({
        orgId: emailOrgId,
        contactId,
        channel: 'email',
        topicId: '*',
        state: 'revoked',
        legalBasis: 'consent',
        source: 'provider-complaint',
        sourceEventId: ledger.id,
        occurredAt: envelope.Timestamp ?? new Date().toISOString(),
        proofRef: `ses:${sesMessageId}`,
      })
    }

    projectionLeaseToken = (await claimEmailEventProjection(ledger.id)) ?? ''
    if (!projectionLeaseToken) {
      return NextResponse.json({ ok: true, replayed: true, eventId: ledger.id })
    }
  }
  let campaignStatField: string | null = null
  let variantStatField: VariantStatField | null = null

  if (eventType === 'delivery') {
    campaignStatField = 'stats.delivered'
    variantStatField = 'delivered'
  } else if (eventType === 'open') {
    await docRef.update({ status: 'opened', openedAt: FieldValue.serverTimestamp() })
    campaignStatField = 'stats.opened'
    variantStatField = 'opened'
  } else if (eventType === 'click') {
    await docRef.update({ status: 'clicked', clickedAt: FieldValue.serverTimestamp() })
    campaignStatField = 'stats.clicked'
    variantStatField = 'clicked'
  } else if (eventType === 'bounce') {
    const bounceType = (event.bounce?.bounceType ?? '').toLowerCase()
    const isHard = bounceType === 'permanent'
    const isSoft = bounceType === 'transient' || bounceType === 'undetermined' || bounceType === ''

    await docRef.update({
      status: 'failed',
      ...(isHard ? { bouncedAt: FieldValue.serverTimestamp() } : {}),
    })
    campaignStatField = 'stats.bounced'
    variantStatField = 'bounced'

    if (isHard && contactId) {
      try {
        await adminDb.collection('contacts').doc(contactId).update({
          bouncedAt: FieldValue.serverTimestamp(),
        })
      } catch (err) {
        console.error('[email/webhook/ses] failed to flag contact bouncedAt', contactId, err)
      }
    }

    const bouncedRecipient = event.bounce?.bouncedRecipients?.[0]
    const bouncedEmail = (bouncedRecipient?.emailAddress || emailTo || '').toString().trim()
    if (emailOrgId && bouncedEmail) {
      try {
        const reason: SuppressionReason = isHard ? 'hard-bounce' : 'soft-bounce'
        await addSuppression({
          orgId: emailOrgId,
          email: bouncedEmail,
          reason,
          source: 'webhook',
          scope: isHard ? 'permanent' : 'temporary',
          expiresAt: isHard ? null : temporaryExpiryFromNow(24),
          details: {
            diagnosticCode: bouncedRecipient?.diagnosticCode,
            smtpStatus: bouncedRecipient?.status,
            emailId: sesMessageId,
            broadcastId: broadcastId || undefined,
            campaignId: campaignId || undefined,
            sequenceId: sequenceId || undefined,
          },
          createdBy: 'system',
        })
      } catch (err) {
        console.error(
          '[email/webhook/ses] failed to add bounce suppression',
          { emailOrgId, bouncedEmail, isHard, isSoft },
          err,
        )
      }
    }
  } else if (eventType === 'complaint') {
    campaignStatField = 'stats.unsubscribed'
    variantStatField = 'unsubscribed'
    if (contactId) {
      try {
        await adminDb.collection('contacts').doc(contactId).update({
          unsubscribedAt: FieldValue.serverTimestamp(),
        })
      } catch (err) {
        console.error('[email/webhook/ses] failed to flag contact unsubscribedAt', contactId, err)
      }
    }

    const complainedRecipient = event.complaint?.complainedRecipients?.[0]
    const complainedEmail = (complainedRecipient?.emailAddress || emailTo || '').toString().trim()
    if (emailOrgId && complainedEmail) {
      try {
        await addSuppression({
          orgId: emailOrgId,
          email: complainedEmail,
          reason: 'complaint',
          source: 'webhook',
          scope: 'permanent',
          expiresAt: null,
          details: {
            emailId: sesMessageId,
            broadcastId: broadcastId || undefined,
            campaignId: campaignId || undefined,
            sequenceId: sequenceId || undefined,
          },
          createdBy: 'system',
        })
      } catch (err) {
        console.error(
          '[email/webhook/ses] failed to add complaint suppression',
          { emailOrgId, complainedEmail },
          err,
        )
      }
    }
  } else if (eventType === 'reject' || eventType === 'deliverydelay') {
    await docRef.update({ status: 'failed' })
  }
  // 'send' and unknown event types → no-op

  if (campaignStatField && campaignId) {
    try {
      await applyFirestoreProjectionEffect({ eventId: ledgerEventId, effectId: `campaign:${campaignId}:${campaignStatField}`, targetRef: adminDb.collection('campaigns').doc(campaignId), update: {
        [campaignStatField]: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      } })
    } catch (err) {
      console.error('[email/webhook/ses] failed to bump campaign stat', campaignId, campaignStatField, err)
    }
  }

  if (campaignStatField && broadcastId) {
    try {
      await applyFirestoreProjectionEffect({ eventId: ledgerEventId, effectId: `broadcast:${broadcastId}:${campaignStatField}`, targetRef: adminDb.collection('broadcasts').doc(broadcastId), update: {
        [campaignStatField]: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      } })
    } catch (err) {
      console.error('[email/webhook/ses] failed to bump broadcast stat', broadcastId, campaignStatField, err)
    }
  }

  if (variantId && variantStatField) {
    try {
      if (broadcastId) {
        await incrementVariantStat({
          targetCollection: 'broadcasts',
          targetId: broadcastId,
          variantId,
          field: variantStatField,
        })
      } else if (sequenceId && typeof sequenceStep === 'number') {
        await incrementVariantStat({
          targetCollection: 'sequences',
          targetId: sequenceId,
          stepNumber: sequenceStep,
          variantId,
          field: variantStatField,
        })
      }
    } catch (err) {
      console.error('[email/webhook/ses] failed to bump variant stat', {
        broadcastId, sequenceId, sequenceStep, variantId, variantStatField, err,
      })
    }
  }

  if (ledgerEventId && projectionLeaseToken) await completeEmailEventProjection(ledgerEventId, projectionLeaseToken)
  return NextResponse.json({ ok: true, ...(ledgerEventId ? { eventId: ledgerEventId } : {}) })
}
