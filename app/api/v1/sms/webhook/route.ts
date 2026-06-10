/**
 * POST /api/v1/sms/webhook — Twilio inbound SMS receiver.
 *
 * Public endpoint — no auth middleware. Verified via the
 * `X-Twilio-Signature` header against TWILIO_AUTH_TOKEN.
 *
 * Twilio posts inbound SMS as application/x-www-form-urlencoded with at
 * least these fields:
 *   From, To, Body, MessageSid, NumSegments, AccountSid, FromCountry, …
 *
 * Behaviour per message:
 *   1. Verify Twilio signature (fail closed in production if
 *      TWILIO_AUTH_TOKEN is unset; skip-with-warning outside production).
 *   2. Persist an `sms` doc (direction: 'inbound', status: 'delivered').
 *   3. Match the From phone to a contact via `phone` field; if found, set
 *      the contactId on the doc.
 *   4. Classify body for STOP / HELP / START keywords:
 *        STOP  / STOPALL / UNSUBSCRIBE / CANCEL / QUIT / END
 *          → add SMS suppression (manual-unsub, permanent), set
 *            `contact.smsUnsubscribedAt`, return TwiML acknowledging the opt-out.
 *        START / UNSTOP / YES
 *          → remove the SMS suppression for this org+phone (if any),
 *            return TwiML confirming.
 *        HELP / INFO
 *          → return TwiML with a short help message (org name + support email).
 *   5. Anything else → notify `org.settings.smsReplyNotifyEmails` (falls back
 *      to `replyNotifyEmails`, then `notificationEmail`).
 *
 * Response: 200 with `<Response/>` TwiML (Twilio expects valid TwiML; empty
 * is fine and prevents Twilio from sending an auto-reply). For STOP/HELP/START
 * we still send a 200 — Twilio handles compliance auto-replies for STOP/HELP
 * on its side; ours are operator-visible records.
 */
import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { validateRequest } from 'twilio'
import { adminDb } from '@/lib/firebase/admin'
import { isValidE164, normalizeToE164 } from '@/lib/sms/twilio'
import { getResendClient } from '@/lib/email/resend'
import { resolveFrom } from '@/lib/email/resolveFrom'
import {
  addSuppression,
  removeSuppression,
  isSuppressed,
} from '@/lib/email/suppressions'

export const dynamic = 'force-dynamic'

let missingTokenWarned = false

function twiml(messageBody?: string): string {
  // Empty <Response/> prevents Twilio from auto-replying. <Message> when we
  // want to acknowledge (HELP only — STOP/START are auto-handled by Twilio).
  if (!messageBody) return '<?xml version="1.0" encoding="UTF-8"?><Response/>'
  const escaped = messageBody
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`
}

function xmlResponse(body: string, status = 200): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  })
}

function requiresTwilioAuthToken(): boolean {
  return process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production'
}

const STOP_KEYWORDS = new Set([
  'stop',
  'stopall',
  'unsubscribe',
  'cancel',
  'quit',
  'end',
  'opt-out',
  'optout',
])
const START_KEYWORDS = new Set(['start', 'unstop', 'yes', 'opt-in', 'optin'])
const HELP_KEYWORDS = new Set(['help', 'info'])

type KeywordIntent = 'stop' | 'start' | 'help' | null

function classifyKeyword(body: string): KeywordIntent {
  const first = (body ?? '').trim().toLowerCase().split(/\s+/)[0] ?? ''
  if (!first) return null
  if (STOP_KEYWORDS.has(first)) return 'stop'
  if (START_KEYWORDS.has(first)) return 'start'
  if (HELP_KEYWORDS.has(first)) return 'help'
  return null
}

/**
 * Look up the org by the To phone number. We search `organizations` for any
 * doc whose `settings.smsTwilioNumbers` array contains the To number. When
 * no match (e.g. shared Messaging Service), we fall back to looking up the
 * most recent outbound sms doc that used this `to` as its `from`. As a last
 * resort, we return '' so the doc is still persisted for ops triage.
 */
async function resolveOrgForToNumber(toE164: string): Promise<string> {
  if (!toE164) return ''

  // 1. Direct match on per-org configured numbers.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const numSnap = await (adminDb.collection('organizations') as any)
    .where('settings.smsTwilioNumbers', 'array-contains', toE164)
    .limit(1)
    .get()
  if (!numSnap.empty) return numSnap.docs[0].id as string

  // 2. Reverse-lookup: who has sent FROM this number recently?
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fromSnap = await (adminDb.collection('sms') as any)
    .where('direction', '==', 'outbound')
    .where('from', '==', toE164)
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get()
  if (!fromSnap.empty) {
    const data = fromSnap.docs[0].data() ?? {}
    if (typeof data.orgId === 'string' && data.orgId) return data.orgId as string
  }

  return ''
}

async function findContactByPhone(orgId: string, phoneE164: string): Promise<string> {
  if (!orgId || !phoneE164) return ''
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = await (adminDb.collection('contacts') as any)
    .where('orgId', '==', orgId)
    .where('phone', '==', phoneE164)
    .limit(1)
    .get()
  if (!snap.empty) return snap.docs[0].id as string

  // Fallback — many contacts have unnormalised phones. Try the raw form too.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap2 = await (adminDb.collection('contacts') as any)
    .where('orgId', '==', orgId)
    .where('phone', '==', phoneE164.replace(/^\+/, ''))
    .limit(1)
    .get()
  if (!snap2.empty) return snap2.docs[0].id as string
  return ''
}

async function notifyAdminsOfReply(args: {
  orgId: string
  fromPhone: string
  body: string
  contactId: string
  twilioSid: string
}): Promise<void> {
  if (!args.orgId) return
  try {
    const orgSnap = await adminDb.collection('organizations').doc(args.orgId).get()
    if (!orgSnap.exists) return
    const org = (orgSnap.data() ?? {}) as {
      name?: string
      settings?: {
        smsReplyNotifyEmails?: string[]
        replyNotifyEmails?: string[]
        notificationEmail?: string
      }
    }

    const list = Array.from(
      new Set(
        (org.settings?.smsReplyNotifyEmails ?? [])
          .concat(org.settings?.replyNotifyEmails ?? [])
          .concat(org.settings?.notificationEmail ? [org.settings.notificationEmail] : [])
          .map((e) => (e ?? '').trim().toLowerCase())
          .filter((e) => e && e.includes('@')),
      ),
    )
    if (list.length === 0) return

    const orgName = org.name ?? ''
    const subject = `[${orgName || 'PiB'}] SMS reply from ${args.fromPhone}`
    const snippet = (args.body ?? '').slice(0, 600)
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://partnersinbiz.online'
    const html = `
      <p><strong>SMS reply</strong> from <code>${args.fromPhone}</code></p>
      <pre style="white-space:pre-wrap;font:13px/1.4 monospace;background:#f5f5f5;padding:12px;border-radius:6px">${snippet
        .replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))}</pre>
      ${args.contactId ? `<p><a href="${baseUrl}/admin/crm/contacts/${args.contactId}">View contact</a></p>` : ''}
      <p style="font-size:11px;color:#888">Twilio SID: ${args.twilioSid}</p>
    `

    if (!process.env.RESEND_API_KEY?.trim()) {
      // eslint-disable-next-line no-console
      console.warn(
        '[sms/webhook] RESEND_API_KEY not set — skipping reply notification email',
      )
      return
    }

    const resolved = await resolveFrom({
      fromDomainId: '',
      fromName: 'Partners in Biz',
      fromLocal: 'notifications',
      orgName,
    })

    const client = getResendClient()
    await client.emails.send({
      from: resolved.from,
      to: list,
      subject,
      html,
      text: `SMS reply from ${args.fromPhone}\nTwilio SID: ${args.twilioSid}\n\n${snippet}`,
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[sms/webhook] notifyAdminsOfReply failed', err)
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Twilio posts application/x-www-form-urlencoded. We need both the raw
  // text (for signature verification) and the parsed params (for routing).
  const rawBody = await req.text()
  const params: Record<string, string> = {}
  for (const [k, v] of new URLSearchParams(rawBody).entries()) {
    // For arrays Twilio would send `Media0`, `Media1`, etc — keep last value.
    params[k] = v
  }

  // Signature verification.
  const authToken = (process.env.TWILIO_AUTH_TOKEN ?? '').trim()
  const signature = req.headers.get('x-twilio-signature') ?? ''
  if (authToken) {
    // The URL Twilio used for signing must match what was configured. Use the
    // request URL; for proxies, NEXT_PUBLIC_BASE_URL can override.
    const configuredBase = (process.env.NEXT_PUBLIC_BASE_URL ?? '').replace(/\/$/, '')
    const reqUrl = req.url
    const url =
      configuredBase && reqUrl.includes('/api/v1/sms/webhook')
        ? `${configuredBase}/api/v1/sms/webhook`
        : reqUrl
    const valid = validateRequest(authToken, signature, url, params)
    if (!valid) {
      // eslint-disable-next-line no-console
      console.warn('[sms/webhook] Twilio signature verification failed')
      return xmlResponse(twiml(), 403)
    }
  } else if (requiresTwilioAuthToken()) {
    // eslint-disable-next-line no-console
    console.error('[sms/webhook] TWILIO_AUTH_TOKEN is not set — rejecting production webhook')
    return xmlResponse(twiml(), 403)
  } else if (!missingTokenWarned) {
    missingTokenWarned = true
    // eslint-disable-next-line no-console
    console.warn(
      '[sms/webhook] TWILIO_AUTH_TOKEN is not set — accepting unsigned webhooks outside production. Set this in production.',
    )
  }

  const fromRaw = (params['From'] ?? '').trim()
  const toRaw = (params['To'] ?? '').trim()
  const body = (params['Body'] ?? '').trim()
  const twilioSid = (params['MessageSid'] ?? '').trim()
  const numSegmentsRaw = params['NumSegments'] ?? ''
  const segmentsCount = (() => {
    const n = parseInt(numSegmentsRaw, 10)
    return Number.isFinite(n) && n > 0 ? n : 1
  })()

  const fromE164 = normalizeToE164(fromRaw) ?? fromRaw
  const toE164 = normalizeToE164(toRaw) ?? toRaw

  if (!isValidE164(fromE164) || !isValidE164(toE164)) {
    // We still ack to Twilio; just don't persist.
    return xmlResponse(twiml(), 200)
  }

  const orgId = await resolveOrgForToNumber(toE164)
  const contactId = orgId ? await findContactByPhone(orgId, fromE164) : ''

  // Persist the inbound sms doc.
  const smsRef = await adminDb.collection('sms').add({
    orgId,
    direction: 'inbound',
    contactId,
    twilioSid,
    from: fromE164,
    to: toE164,
    body,
    status: 'delivered',
    segmentsCount,
    costEstimateUsd: 0,
    sequenceId: '',
    sequenceStep: null,
    campaignId: '',
    broadcastId: '',
    topicId: '',
    variantId: '',
    sentAt: null,
    deliveredAt: FieldValue.serverTimestamp(),
    failedAt: null,
    failureReason: '',
    scheduledFor: null,
    createdAt: FieldValue.serverTimestamp(),
    deleted: false,
  })

  // Log activity if linked to a contact.
  if (orgId && contactId) {
    try {
      await adminDb.collection('activities').add({
        orgId,
        contactId,
        dealId: '',
        type: 'sms_received',
        summary: `SMS received: ${body.slice(0, 80)}${body.length > 80 ? '…' : ''}`,
        metadata: { smsId: smsRef.id, twilioSid, from: fromE164 },
        createdBy: 'system',
        createdAt: FieldValue.serverTimestamp(),
      })
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[sms/webhook] activity log failed', err)
    }
  }

  // Keyword routing.
  const intent = classifyKeyword(body)

  if (intent === 'stop' && orgId) {
    try {
      await addSuppression({
        orgId,
        email: fromE164,
        channel: 'sms',
        reason: 'manual-unsub',
        source: 'webhook',
        scope: 'permanent',
        expiresAt: null,
        details: { smsId: smsRef.id, twilioErrorCode: '' },
        createdBy: 'system',
      })
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[sms/webhook] addSuppression(STOP) failed', err)
    }
    if (contactId) {
      try {
        await adminDb.collection('contacts').doc(contactId).update({
          smsUnsubscribedAt: FieldValue.serverTimestamp(),
        })
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[sms/webhook] failed to flag contact smsUnsubscribedAt', err)
      }
    }
    return xmlResponse(twiml(), 200)
  }

  if (intent === 'start' && orgId) {
    try {
      if (await isSuppressed(orgId, fromE164, 'sms')) {
        await removeSuppression(orgId, fromE164, 'sms')
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[sms/webhook] removeSuppression(START) failed', err)
    }
    if (contactId) {
      try {
        await adminDb.collection('contacts').doc(contactId).update({
          smsUnsubscribedAt: null,
        })
      } catch {
        // Non-fatal.
      }
    }
    return xmlResponse(twiml(), 200)
  }

  if (intent === 'help') {
    let orgName = 'Partners in Biz'
    let supportEmail = ''
    if (orgId) {
      const orgSnap = await adminDb.collection('organizations').doc(orgId).get()
      if (orgSnap.exists) {
        const od = (orgSnap.data() ?? {}) as {
          name?: string
          settings?: { notificationEmail?: string }
        }
        if (od.name) orgName = od.name
        if (od.settings?.notificationEmail) supportEmail = od.settings.notificationEmail
      }
    }
    const msg = supportEmail
      ? `${orgName}: For help, email ${supportEmail}. Reply STOP to opt out.`
      : `${orgName}: For help reply HELP. Reply STOP to opt out.`
    return xmlResponse(twiml(msg), 200)
  }

  // Default — route to the org's SMS reply notify list (best-effort).
  if (orgId) {
    notifyAdminsOfReply({
      orgId,
      fromPhone: fromE164,
      body,
      contactId,
      twilioSid,
    }).catch(() => {})
  }

  return xmlResponse(twiml(), 200)
}
