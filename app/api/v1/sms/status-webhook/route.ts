/**
 * POST /api/v1/sms/status-webhook — Twilio outbound status callback receiver.
 *
 * Public endpoint — no auth middleware. Verified via the
 * `X-Twilio-Signature` header against TWILIO_AUTH_TOKEN.
 *
 * Twilio posts application/x-www-form-urlencoded callbacks at delivery
 * milestones for outbound messages we send (when we provide a
 * `statusCallback` on the create() call). Fields we care about:
 *   MessageSid     — Twilio SID of the message we tracked
 *   MessageStatus  — queued | sending | sent | delivered | undelivered |
 *                    failed
 *   ErrorCode      — Twilio error code on failure
 *   ErrorMessage   — human-readable error on failure
 *
 * Behaviour:
 *   1. Verify signature (skip-with-warning if TWILIO_AUTH_TOKEN unset).
 *   2. Look up the sms doc by `twilioSid`.
 *   3. Update `status`, plus `deliveredAt` / `failedAt` / `failureReason`.
 *   4. On `failed` / `undelivered` with a recognised error code, add an
 *      SMS suppression for the recipient and (for hard-failure codes) flag
 *      the contact's smsBouncedAt.
 *   5. Roll up broadcast / campaign stats for terminal states.
 *
 * Response: always 200 with empty TwiML so Twilio doesn't retry.
 */
import { NextRequest, NextResponse } from 'next/server'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { validateRequest } from 'twilio'
import { adminDb } from '@/lib/firebase/admin'
import { addSuppression, type SuppressionReason } from '@/lib/email/suppressions'

export const dynamic = 'force-dynamic'

let missingTokenWarned = false

function xml200(): NextResponse {
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  })
}

function xml403(): NextResponse {
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
    status: 403,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  })
}

// Twilio error codes that indicate a permanent delivery failure (invalid
// number, opt-out, landline-cannot-receive, blacklisted, etc.). Codes outside
// this set are treated as transient.
// See: https://www.twilio.com/docs/api/errors
const HARD_FAIL_CODES = new Set<string>([
  '21211', // invalid 'To' phone
  '21408', // permission to send to country denied
  '21610', // recipient unsubscribed (STOP)
  '21614', // not a valid mobile number
  '30003', // unreachable destination
  '30005', // unknown destination handset
  '30006', // landline or unreachable carrier
  '30007', // carrier violation
  '30008', // unknown error / blacklisted
])

function statusToSmsStatus(s: string): {
  status: 'queued' | 'sent' | 'delivered' | 'failed' | 'undelivered'
  terminal: boolean
} {
  const norm = (s ?? '').trim().toLowerCase()
  if (norm === 'delivered') return { status: 'delivered', terminal: true }
  if (norm === 'failed') return { status: 'failed', terminal: true }
  if (norm === 'undelivered') return { status: 'undelivered', terminal: true }
  if (norm === 'sent') return { status: 'sent', terminal: false }
  // Default — queued / sending / accepted etc.
  return { status: 'queued', terminal: false }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text()
  const params: Record<string, string> = {}
  for (const [k, v] of new URLSearchParams(rawBody).entries()) {
    params[k] = v
  }

  // Signature verification.
  const authToken = (process.env.TWILIO_AUTH_TOKEN ?? '').trim()
  const signature = req.headers.get('x-twilio-signature') ?? ''
  if (authToken) {
    const configuredBase = (process.env.NEXT_PUBLIC_BASE_URL ?? '').replace(/\/$/, '')
    const reqUrl = req.url
    const url =
      configuredBase && reqUrl.includes('/api/v1/sms/status-webhook')
        ? `${configuredBase}/api/v1/sms/status-webhook`
        : reqUrl
    const valid = validateRequest(authToken, signature, url, params)
    if (!valid) {
      console.warn('[sms/status-webhook] Twilio signature verification failed')
      return xml403()
    }
  } else if (!missingTokenWarned) {
    missingTokenWarned = true
    console.warn(
      '[sms/status-webhook] TWILIO_AUTH_TOKEN is not set — accepting unsigned webhooks. Set this in production.',
    )
  }

  const twilioSid = (params['MessageSid'] ?? '').trim()
  const rawStatus = (params['MessageStatus'] ?? params['SmsStatus'] ?? '').trim()
  const errorCode = (params['ErrorCode'] ?? '').trim()
  const errorMessage = (params['ErrorMessage'] ?? '').trim()
  const toAddress = (params['To'] ?? '').trim()

  if (!twilioSid) return xml200() // nothing to update

  // Find the sms doc by twilioSid.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = await (adminDb.collection('sms') as any)
    .where('twilioSid', '==', twilioSid)
    .limit(1)
    .get()

  if (snap.empty) {
    // Unknown SID — could be a webhook for a message we didn't track (test
    // sends, manual sends). Ack so Twilio doesn't retry.
    return xml200()
  }

  const docRef = snap.docs[0].ref
  const docData = (snap.docs[0].data() ?? {}) as {
    orgId?: string
    contactId?: string
    broadcastId?: string
    campaignId?: string
    to?: string
    status?: string
  }
  const orgId = docData.orgId ?? ''
  const contactId = docData.contactId ?? ''
  const broadcastId = docData.broadcastId ?? ''
  const campaignId = docData.campaignId ?? ''
  const recipient = (docData.to || toAddress || '').trim()

  const mapped = statusToSmsStatus(rawStatus)

  // Don't downgrade a terminal status. e.g. once delivered, ignore later
  // "sent" reorderings; once failed, ignore a stray "sent".
  const currentStatus = (docData.status ?? '').toLowerCase()
  const TERMINAL = new Set(['delivered', 'failed', 'undelivered'])
  if (TERMINAL.has(currentStatus) && currentStatus === mapped.status) {
    return xml200()
  }
  if (TERMINAL.has(currentStatus) && !TERMINAL.has(mapped.status)) {
    return xml200()
  }

  const update: Record<string, unknown> = {
    status: mapped.status,
    updatedAt: FieldValue.serverTimestamp(),
  }
  if (mapped.status === 'delivered') {
    update.deliveredAt = FieldValue.serverTimestamp()
  }
  if (mapped.status === 'failed' || mapped.status === 'undelivered') {
    update.failedAt = FieldValue.serverTimestamp()
    if (errorMessage || errorCode) {
      update.failureReason = errorMessage || `Twilio error ${errorCode}`
    }
  }
  await docRef.update(update)

  // Bump campaign / broadcast roll-ups on terminal events.
  if (mapped.status === 'delivered') {
    if (broadcastId) {
      try {
        await adminDb.collection('broadcasts').doc(broadcastId).update({
          'stats.delivered': FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        })
      } catch (err) {
        console.error('[sms/status-webhook] broadcast delivered++ failed', err)
      }
    }
    if (campaignId) {
      try {
        await adminDb.collection('campaigns').doc(campaignId).update({
          'stats.delivered': FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        })
      } catch (err) {
        console.error('[sms/status-webhook] campaign delivered++ failed', err)
      }
    }
  } else if (mapped.status === 'failed' || mapped.status === 'undelivered') {
    if (broadcastId) {
      try {
        await adminDb.collection('broadcasts').doc(broadcastId).update({
          'stats.bounced': FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        })
      } catch (err) {
        console.error('[sms/status-webhook] broadcast bounced++ failed', err)
      }
    }
    if (campaignId) {
      try {
        await adminDb.collection('campaigns').doc(campaignId).update({
          'stats.bounced': FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        })
      } catch (err) {
        console.error('[sms/status-webhook] campaign bounced++ failed', err)
      }
    }

    // Add SMS suppression for the recipient.
    if (orgId && recipient) {
      const isHard = HARD_FAIL_CODES.has(errorCode)
      const reason: SuppressionReason =
        errorCode === '21610' ? 'manual-unsub' : isHard ? 'hard-bounce' : 'soft-bounce'
      try {
        await addSuppression({
          orgId,
          email: recipient,
          channel: 'sms',
          reason,
          source: 'webhook',
          scope: isHard || errorCode === '21610' ? 'permanent' : 'temporary',
          expiresAt:
            isHard || errorCode === '21610'
              ? null
              : Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000)),
          details: { smsId: snap.docs[0].id as string, twilioErrorCode: errorCode || '' },
          createdBy: 'system',
        })
      } catch (err) {
        console.error('[sms/status-webhook] addSuppression failed', err)
      }
      if (isHard && contactId) {
        try {
          await adminDb.collection('contacts').doc(contactId).update({
            smsBouncedAt: FieldValue.serverTimestamp(),
          })
        } catch (err) {
           console.error('[sms/status-webhook] failed to flag contact smsBouncedAt', err)
        }
      }
    }
  }

  return xml200()
}
