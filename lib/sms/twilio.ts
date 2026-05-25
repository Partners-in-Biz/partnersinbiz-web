// lib/sms/twilio.ts
//
// SERVER-ONLY Twilio wrapper. Imports the Node SDK (uses fs/net/tls) — must
// NOT be imported into client components. For browser-safe helpers (segment
// counting, E.164 validation/normalisation) import from `lib/sms/segments.ts`
// instead — those have zero deps and bundle for the browser.
//
// Centralises:
//   • client construction (and dry-run when env vars are missing)
//   • a single sendSms entry point that callers can rely on
//
// The pattern mirrors lib/email/resend.ts: if TWILIO_AUTH_TOKEN is unset we
// log a warning and return a stub success with a `dryrun_*` SID so the rest
// of the pipeline (preferences gate, sms-doc writes, stat rollups) still flows
// in local/preview environments.
//
// Sending uses a Messaging Service when TWILIO_MESSAGING_SERVICE_SID is set
// (preferred — Twilio picks the right number / handles compliance) and falls
// back to a single `from` number otherwise.

import twilio from 'twilio'
// Re-export pure helpers from the browser-safe module so existing server
// callers (e.g. lib/sms/send.ts, sms route handlers) keep working unchanged.
export { isValidE164, normalizeToE164, countSmsSegments } from './segments'
import { isValidE164, countSmsSegments } from './segments'

// ── Public types ────────────────────────────────────────────────────────────

export interface SmsSendInput {
  to: string
  body: string
  from?: string
  mediaUrls?: string[]
  statusCallbackUrl?: string
}

export interface SmsSendResult {
  ok: boolean
  twilioSid: string
  error?: string
  errorCode?: string
  segmentsCount: number
}

// ── Client construction ─────────────────────────────────────────────────────

// Cached client — twilio() opens nothing until first call, but we still keep
// a single instance per process.
let _client: twilio.Twilio | null = null

export function getTwilioClient(): twilio.Twilio | null {
  if (_client) return _client
  const sid = (process.env.TWILIO_ACCOUNT_SID ?? '').trim()
  const token = (process.env.TWILIO_AUTH_TOKEN ?? '').trim()
  if (!sid || !token) return null
  _client = twilio(sid, token)
  return _client
}

// ── Sending ─────────────────────────────────────────────────────────────────

function defaultStatusCallback(): string | undefined {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? '').replace(
    /\/$/,
    '',
  )
  if (!base) return undefined
  return `${base}/api/v1/sms/status-webhook`
}

export async function sendSms(input: SmsSendInput): Promise<SmsSendResult> {
  const to = (input.to ?? '').trim()
  const body = input.body ?? ''
  const seg = countSmsSegments(body)

  if (!to || !isValidE164(to)) {
    return {
      ok: false,
      twilioSid: '',
      error: `invalid recipient phone: "${to}"`,
      errorCode: 'invalid_phone',
      segmentsCount: seg.segments,
    }
  }

  if (!body.trim()) {
    return {
      ok: false,
      twilioSid: '',
      error: 'empty SMS body',
      errorCode: 'empty_body',
      segmentsCount: 0,
    }
  }

  const client = getTwilioClient()
  if (!client) {
    const sid = (process.env.TWILIO_ACCOUNT_SID ?? '').trim()
    const token = (process.env.TWILIO_AUTH_TOKEN ?? '').trim()
    if (sid || token) {
      return {
        ok: false,
        twilioSid: '',
        error: 'incomplete Twilio configuration — set both TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN',
        errorCode: 'missing_twilio_credentials',
        segmentsCount: seg.segments,
      }
    }

    // Dev / preview without Twilio creds — log and pretend success so the rest
    // of the pipeline (preferences, stats, sms docs, idempotency) still flows.
    console.warn(
      `[sms/twilio] TWILIO_AUTH_TOKEN not set — skipping actual send to ${to} (${seg.segments} seg)`,
    )
    return {
      ok: true,
      twilioSid: `dryrun_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      segmentsCount: seg.segments,
    }
  }

  const messagingServiceSid = (process.env.TWILIO_MESSAGING_SERVICE_SID ?? '').trim()
  const fallbackFrom =
    (input.from ?? '').trim() || (process.env.TWILIO_DEFAULT_FROM_NUMBER ?? '').trim()

  if (!messagingServiceSid && !fallbackFrom) {
    return {
      ok: false,
      twilioSid: '',
      error:
        'no sender configured — set TWILIO_MESSAGING_SERVICE_SID or TWILIO_DEFAULT_FROM_NUMBER',
      errorCode: 'no_sender',
      segmentsCount: seg.segments,
    }
  }

  const statusCallback = (input.statusCallbackUrl ?? '').trim() || defaultStatusCallback()

  type TwilioCreateParams = Parameters<typeof client.messages.create>[0]
  const params: TwilioCreateParams = { to, body } as TwilioCreateParams
  if (messagingServiceSid) {
    ;(params as { messagingServiceSid?: string }).messagingServiceSid = messagingServiceSid
  } else if (fallbackFrom) {
    ;(params as { from?: string }).from = fallbackFrom
  }
  if (input.mediaUrls && input.mediaUrls.length > 0) {
    ;(params as { mediaUrl?: string[] }).mediaUrl = input.mediaUrls
  }
  if (statusCallback) {
    ;(params as { statusCallback?: string }).statusCallback = statusCallback
  }

  try {
    const msg = await client.messages.create(params)
    const numSegmentsRaw = (msg as { numSegments?: string | number }).numSegments
    const numSegments = (() => {
      if (typeof numSegmentsRaw === 'number' && Number.isFinite(numSegmentsRaw)) return numSegmentsRaw
      if (typeof numSegmentsRaw === 'string') {
        const n = parseInt(numSegmentsRaw, 10)
        if (Number.isFinite(n) && n > 0) return n
      }
      return seg.segments
    })()
    return { ok: true, twilioSid: msg.sid, segmentsCount: numSegments }
  } catch (err) {
    const e = err as { message?: string; code?: string | number }
    return {
      ok: false,
      twilioSid: '',
      error: e?.message ?? 'twilio send failed',
      errorCode: e?.code !== undefined ? String(e.code) : 'twilio_error',
      segmentsCount: seg.segments,
    }
  }
}
