/**
 * POST /api/v1/email/webhook — Resend webhook receiver
 *
 * Public endpoint — no auth middleware.
 * Security model: verify Resend's Svix signature when RESEND_WEBHOOK_SECRET is set.
 * Production fails closed when the secret is absent; dev/preview may run unsigned
 * and log a warning unless RESEND_WEBHOOK_REQUIRE_SIGNATURE=true.
 *
 * Handled event types:
 *   email.delivered        → stats.delivered++
 *   email.opened           → status = "opened",  openedAt = now,  stats.opened++
 *   email.clicked          → status = "clicked", clickedAt = now, stats.clicked++
 *   email.bounced          → status = "failed",  bouncedAt = now, stats.bounced++
 *                            also flag the linked contact's bouncedAt
 *   email.delivery_delayed → status = "failed"
 *   email.complained       → unsubscribe contact, stats.unsubscribed++
 *
 * Payload shape from Resend:
 *   { type: string, data: { email_id: string, ... } }
 *
 * We store Resend's email ID in the email doc as `resendId`.
 * Lookup: query emails where resendId == data.email_id.
 */
import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { incrementVariantStat, type VariantStatField } from '@/lib/ab-testing/cronHelpers'
import { verifyResendWebhookSignature } from '@/lib/email/resendWebhook'
import {
  addSuppression,
  temporaryExpiryFromNow,
  type SuppressionReason,
} from '@/lib/email/suppressions'
import {
  recordSoftBounce,
  SOFT_BOUNCE_ESCALATION_THRESHOLD,
} from '@/lib/email/bounceTracking'

// Resend webhook signature verification uses svix.
// Set RESEND_WEBHOOK_SECRET (format: whsec_xxxx) in env to verify signatures.
// Production fails closed if it is unset. Dev/preview accepts unsigned webhooks
// with a one-time warning unless RESEND_WEBHOOK_REQUIRE_SIGNATURE=true.
// See: https://resend.com/docs/dashboard/webhooks/verify-webhook-requests

let missingSecretWarned = false

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Read raw body BEFORE parsing — svix needs the exact bytes to verify the signature.
  const rawBody = await req.text()

  const verification = verifyResendWebhookSignature({
    rawBody,
    headers: {
      'svix-id': req.headers.get('svix-id') ?? '',
      'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
      'svix-signature': req.headers.get('svix-signature') ?? '',
    },
    routeLabel: 'email/webhook',
  })
  if (!verification.ok) {
    if (verification.warning) console.warn(verification.warning)
    return NextResponse.json({ error: verification.error }, { status: verification.status ?? 400 })
  }
  if (verification.warning && !missingSecretWarned) {
    missingSecretWarned = true
    console.warn(verification.warning)
  }

  // Resend's payloads include a `data` object with the email id plus event-
  // specific fields. For bounce events, `data.bounce` is an object with at
  // least `{ type, subType?, message? }`. We tolerate older payload shapes
  // that flatten `bounce_type` directly on `data` too.
  interface BouncePayloadShape {
    type?: string
    subType?: string
    sub_type?: string
    message?: string
    diagnosticCode?: string
    diagnostic_code?: string
    smtpStatus?: string
    smtp_status?: string
  }
  interface WebhookPayload {
    type: string
    data: {
      email_id: string
      to?: string | string[]
      bounce?: BouncePayloadShape
      bounce_type?: string
      bounceType?: string
    }
  }
  let payload: WebhookPayload

  try {
    payload = JSON.parse(rawBody) as WebhookPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { type, data } = payload
  const resendEmailId = data?.email_id
  if (!resendEmailId) {
    return NextResponse.json({ ok: true, note: 'no email_id' })
  }

  // Find the Firestore doc with this resendId
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snapshot = await (adminDb.collection('emails') as any)
    .where('resendId', '==', resendEmailId)
    .limit(1)
    .get()

  if (snapshot.empty) {
    return NextResponse.json({ ok: true, note: 'email not found' })
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

  let campaignStatField: string | null = null

  if (type === 'email.delivered') {
    campaignStatField = 'stats.delivered'
  } else if (type === 'email.opened') {
    await docRef.update({ status: 'opened', openedAt: FieldValue.serverTimestamp() })
    campaignStatField = 'stats.opened'
  } else if (type === 'email.clicked') {
    await docRef.update({ status: 'clicked', clickedAt: FieldValue.serverTimestamp() })
    campaignStatField = 'stats.clicked'
  } else if (type === 'email.bounced') {
    // Resolve recipient address for suppression. Prefer the stored email
    // doc's `to`; fall back to payload `data.to` (string or first of array).
    const payloadTo = Array.isArray(data?.to) ? data.to[0] : data?.to
    const bouncedEmail = (emailTo || payloadTo || '').toString().trim()

    // Parse the bounce sub-type. Resend nests bounce info under data.bounce
    // (newer payloads) or flattens it under data.bounce_type (older shapes).
    const bounce = data?.bounce ?? {}
    const rawBounceType = (
      bounce.type ??
      bounce.subType ??
      bounce.sub_type ??
      data?.bounce_type ??
      data?.bounceType ??
      ''
    )
      .toString()
      .toLowerCase()

    const isHardReported = rawBounceType === 'permanent' || rawBounceType === 'hard'
    // Treat anything explicitly transient/soft as soft; undetermined → soft.
    const isSoft =
      rawBounceType === 'transient' ||
      rawBounceType === 'soft' ||
      rawBounceType === 'undetermined' ||
      rawBounceType === ''

    // US-112 — soft-bounce aggregation.
    // A single soft bounce is recoverable (24h temporary hold). But a recipient
    // that soft-bounces repeatedly is effectively undeliverable, so we track a
    // durable per-(org,email) counter and ESCALATE the Nth soft bounce within a
    // rolling window to a hard bounce: permanent suppression + contact.bouncedAt.
    // Hard bounces reported directly by Resend bypass the counter entirely.
    let escalatedFromSoft = false
    if (isSoft && !isHardReported && emailOrgId && bouncedEmail) {
      try {
        const tracking = await recordSoftBounce({
          orgId: emailOrgId,
          email: bouncedEmail,
          emailId: resendEmailId,
        })
        // Duplicate webhook deliveries (same provider emailId) don't re-count
        // and must not escalate.
        escalatedFromSoft = tracking.escalate && !tracking.duplicate
      } catch (err) {
        console.error(
          '[email/webhook] soft-bounce tracking failed',
          { emailOrgId, bouncedEmail },
          err,
        )
      }
    }

    // `isHard` is the effective hard-bounce decision: either Resend reported a
    // permanent bounce, OR a soft bounce just escalated past the threshold.
    const isHard = isHardReported || escalatedFromSoft

    await docRef.update({
      status: 'failed',
      // Only stamp bouncedAt on the email doc for hard (or escalated) bounces —
      // a single soft bounce is recoverable.
      ...(isHard ? { bouncedAt: FieldValue.serverTimestamp() } : {}),
    })
    // Both soft and hard bounces increment stats.bounced exactly once. An
    // escalation does NOT double-count: the escalating delivery is still a
    // single bounce event, now recorded as a hard bounce.
    campaignStatField = 'stats.bounced'

    // Only hard (or escalated) bounces poison the contact record.
    if (isHard && contactId) {
      try {
        await adminDb.collection('contacts').doc(contactId).update({
          bouncedAt: FieldValue.serverTimestamp(),
        })
      } catch (err) {
        console.error('[email/webhook] failed to flag contact bouncedAt', contactId, err)
      }
    }

    // Add to suppression list.
    //   • Resend hard bounce        → permanent, reason 'hard-bounce'
    //   • Escalated soft bounce      → permanent, reason 'soft-bounce-escalated'
    //   • Single soft bounce         → 24h temporary, reason 'soft-bounce'
    // addSuppression is idempotent and upgrades temporary→permanent, so the
    // final escalating soft bounce cleanly promotes any existing temporary row.
    if (emailOrgId && bouncedEmail) {
      try {
        const reason: SuppressionReason = isHardReported
          ? 'hard-bounce'
          : escalatedFromSoft
            ? 'soft-bounce-escalated'
            : 'soft-bounce'
        await addSuppression({
          orgId: emailOrgId,
          email: bouncedEmail,
          reason,
          source: 'webhook',
          scope: isHard ? 'permanent' : 'temporary',
          expiresAt: isHard ? null : temporaryExpiryFromNow(24),
          details: {
            diagnosticCode:
              bounce.diagnosticCode ?? bounce.diagnostic_code ?? undefined,
            smtpStatus: bounce.smtpStatus ?? bounce.smtp_status ?? undefined,
            emailId: resendEmailId,
            broadcastId: broadcastId || undefined,
            campaignId: campaignId || undefined,
            sequenceId: sequenceId || undefined,
          },
          createdBy: 'system',
        })
        if (escalatedFromSoft) {
          console.warn(
            `[email/webhook] soft bounce escalated to hard after ${SOFT_BOUNCE_ESCALATION_THRESHOLD} bounces`,
            { emailOrgId, bouncedEmail },
          )
        }
      } catch (err) {
        console.error(
          '[email/webhook] failed to add bounce suppression',
          { emailOrgId, bouncedEmail, isHard, isSoft },
          err,
        )
      }
    }
  } else if (type === 'email.delivery_delayed') {
    await docRef.update({ status: 'failed' })
  } else if (type === 'email.complained') {
    campaignStatField = 'stats.unsubscribed'
    if (contactId) {
      try {
        await adminDb.collection('contacts').doc(contactId).update({
          unsubscribedAt: FieldValue.serverTimestamp(),
        })
      } catch (err) {
        console.error('[email/webhook] failed to flag contact unsubscribedAt', contactId, err)
      }
    }

    // Permanent suppression for the complaining address.
    const payloadTo = Array.isArray(data?.to) ? data.to[0] : data?.to
    const complainedEmail = (emailTo || payloadTo || '').toString().trim()
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
            emailId: resendEmailId,
            broadcastId: broadcastId || undefined,
            campaignId: campaignId || undefined,
            sequenceId: sequenceId || undefined,
          },
          createdBy: 'system',
        })
      } catch (err) {
        console.error(
          '[email/webhook] failed to add complaint suppression',
          { emailOrgId, complainedEmail },
          err,
        )
      }
    }
  }
  // unknown types → no-op

  if (campaignStatField && campaignId) {
    try {
      await adminDb.collection('campaigns').doc(campaignId).update({
        [campaignStatField]: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      })
    } catch (err) {
      console.error('[email/webhook] failed to bump campaign stat', campaignId, campaignStatField, err)
    }
  }

  // Broadcasts share the same stat field names (delivered/opened/clicked/
  // bounced/unsubscribed) so we reuse campaignStatField verbatim.
  if (campaignStatField && broadcastId) {
    try {
      await adminDb.collection('broadcasts').doc(broadcastId).update({
        [campaignStatField]: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      })
    } catch (err) {
      console.error('[email/webhook] failed to bump broadcast stat', broadcastId, campaignStatField, err)
    }
  }

  // A/B variant attribution — see lib/ab-testing/WEBHOOK-PATCH.md.
  // Maps Resend event → per-variant stat field on the parent broadcast or
  // sequence step. No-op when the email wasn't part of an A/B test.
  const variantStatField: VariantStatField | null =
    type === 'email.delivered' ? 'delivered'
    : type === 'email.opened' ? 'opened'
    : type === 'email.clicked' ? 'clicked'
    : type === 'email.bounced' ? 'bounced'
    : type === 'email.complained' ? 'unsubscribed'
    : null

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
      console.error('[email/webhook] failed to bump variant stat', {
        broadcastId, sequenceId, sequenceStep, variantId, variantStatField, err,
      })
    }
  }

  return NextResponse.json({ ok: true })
}
