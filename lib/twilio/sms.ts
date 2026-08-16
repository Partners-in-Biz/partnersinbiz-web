/**
 * Org-aware SMS send — prefers encrypted per-org Twilio credentials.
 */
import twilio from 'twilio'
import { isValidE164, countSmsSegments } from '@/lib/sms/segments'
import { resolveTwilioOrg } from './org-client'
import { appBaseUrl } from './org-client'

export interface OrgSmsSendInput {
  orgId: string
  to: string
  body: string
  from?: string
  mediaUrls?: string[]
  statusCallbackUrl?: string
  allowPlatformFallback?: boolean
}

export interface OrgSmsSendResult {
  ok: boolean
  twilioSid: string
  error?: string
  errorCode?: string
  segmentsCount: number
  source?: 'org' | 'platform' | 'dry_run'
}

export async function sendOrgSms(input: OrgSmsSendInput): Promise<OrgSmsSendResult> {
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

  const resolved = await resolveTwilioOrg(input.orgId, {
    allowPlatformFallback: input.allowPlatformFallback !== false,
  })

  if (!resolved) {
    console.warn(`[twilio/sms] no credentials for org ${input.orgId} — dry-run to ${to}`)
    return {
      ok: true,
      twilioSid: `dryrun_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      segmentsCount: seg.segments,
      source: 'dry_run',
    }
  }

  const messagingServiceSid = (resolved.credentials.messagingServiceSid ?? '').trim()
  const fallbackFrom =
    (input.from ?? '').trim()
    || (resolved.credentials.defaultFromNumber ?? '').trim()
    || (resolved.credentials.voiceCallerId ?? '').trim()

  if (!messagingServiceSid && !fallbackFrom) {
    return {
      ok: false,
      twilioSid: '',
      error: 'no sender configured — set Messaging Service SID or default from number on the org Twilio connection',
      errorCode: 'no_sender',
      segmentsCount: seg.segments,
    }
  }

  const base = appBaseUrl()
  const statusCallback =
    (input.statusCallbackUrl ?? '').trim()
    || (base ? `${base}/api/v1/sms/status-webhook?orgId=${encodeURIComponent(input.orgId)}` : undefined)

  type TwilioCreateParams = Parameters<typeof resolved.client.messages.create>[0]
  const params: TwilioCreateParams = { to, body } as TwilioCreateParams
  if (messagingServiceSid) {
    ;(params as { messagingServiceSid?: string }).messagingServiceSid = messagingServiceSid
  } else {
    ;(params as { from?: string }).from = fallbackFrom
  }
  if (input.mediaUrls?.length) {
    ;(params as { mediaUrl?: string[] }).mediaUrl = input.mediaUrls
  }
  if (statusCallback) {
    ;(params as { statusCallback?: string }).statusCallback = statusCallback
  }

  try {
    const msg = await resolved.client.messages.create(params)
    const numSegmentsRaw = (msg as { numSegments?: string | number }).numSegments
    const numSegments = (() => {
      if (typeof numSegmentsRaw === 'number' && Number.isFinite(numSegmentsRaw)) return numSegmentsRaw
      if (typeof numSegmentsRaw === 'string') {
        const n = parseInt(numSegmentsRaw, 10)
        if (Number.isFinite(n) && n > 0) return n
      }
      return seg.segments
    })()
    return {
      ok: true,
      twilioSid: msg.sid,
      segmentsCount: numSegments,
      source: resolved.source,
    }
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

/** List incoming phone numbers on the org Twilio account (for settings UI). */
export async function listOrgTwilioNumbers(orgId: string): Promise<Array<{
  sid: string
  phoneNumber: string
  friendlyName: string
  capabilities: { voice?: boolean; sms?: boolean; mms?: boolean }
}>> {
  const resolved = await resolveTwilioOrg(orgId, { allowPlatformFallback: false })
  if (!resolved) return []
  const numbers = await resolved.client.incomingPhoneNumbers.list({ limit: 50 })
  return numbers.map((n) => ({
    sid: n.sid,
    phoneNumber: n.phoneNumber,
    friendlyName: n.friendlyName,
    capabilities: {
      voice: Boolean(n.capabilities?.voice),
      sms: Boolean(n.capabilities?.sms),
      mms: Boolean(n.capabilities?.mms),
    },
  }))
}

export async function validateTwilioSignature(input: {
  authToken: string
  signature: string | null
  url: string
  params: Record<string, string>
}): Promise<boolean> {
  if (!input.signature || !input.authToken) return false
  return twilio.validateRequest(input.authToken, input.signature, input.url, input.params)
}
