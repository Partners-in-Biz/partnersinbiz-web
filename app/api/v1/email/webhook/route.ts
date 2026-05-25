/**
 * POST /api/v1/email/webhook — Resend webhook receiver
 *
 * Public endpoint — no auth middleware.
 * Security model: verify Resend's Svix signature when RESEND_WEBHOOK_SECRET is set.
 * Dev/preview environments may run unsigned and log a warning when the secret is absent.
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
import { Webhook } from 'svix'
import { adminDb } from '@/lib/firebase/admin'
import { incrementVariantStat, type VariantStatField } from '@/lib/ab-testing/cronHelpers'
import {
  addSuppression,
  temporaryExpiryFromNow,
  type SuppressionReason,
} from '@/lib/email/suppressions'

// Resend webhook signature verification uses svix.
// Set RESEND_WEBHOOK_SECRET (format: whsec_xxxx) in env to enforce verification.
// If unset, requests are allowed through (a one-time warning is logged at cold start)
// so dev/preview environments without webhook setup still work.
// See: https://resend.com/docs/dashboard/webhooks/verify-webhook-requests

let missingSecretWarned = false

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Read raw body BEFORE parsing — svix needs the exact bytes to verify the signature.
  const rawBody = await req.text()

  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (secret) {
    const headers = {
      'svix-id': req.headers.get('svix-id') ?? '',
      'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
      'svix-signature': req.headers.get('svix-signature') ?? '',
    }
    try {
      new Webhook(secret).verify(rawBody, headers)
    } catch (err) {
      console.warn('[email/webhook] signature verification failed', err)
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
    }
  } else if (!missingSecretWarned) {
    missingSecretWarned = true
    console.warn(
      '[email/webhook] RESEND_WEBHOOK_SECRET is not set — accepting unsigned webhooks. Set this in production.',
    )
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

    const isHard = rawBounceType === 'permanent' || rawBounceType === 'hard'
    // Treat anything explicitly transient/soft as soft; undetermined → soft.
    const isSoft =
      rawBounceType === 'transient' ||
      rawBounceType === 'soft' ||
      rawBounceType === 'undetermined' ||
      rawBounceType === ''

    await docRef.update({
      status: 'failed',
      // Only stamp bouncedAt for hard bounces — soft bounces are recoverable.
      ...(isHard ? { bouncedAt: FieldValue.serverTimestamp() } : {}),
    })
    campaignStatField = 'stats.bounced'

    // Only hard bounces poison the contact record.
    if (isHard && contactId) {
      try {
        await adminDb.collection('contacts').doc(contactId).update({
          bouncedAt: FieldValue.serverTimestamp(),
        })
      } catch (err) {
        console.error('[email/webhook] failed to flag contact bouncedAt', contactId, err)
      }
    }

    // Add to suppression list. Hard → permanent; soft → 24h temporary.
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
