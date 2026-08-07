/**
 * POST /api/v1/communications/webhooks/twilio
 *
 * Per-org Twilio webhook receiver (Workstream 1 of the WhatsApp connector spec).
 * Public endpoint — no auth middleware; Twilio callbacks are verified with the
 * `X-Twilio-Signature` header against the resolved org's decrypted auth token
 * (or the platform env token for the platform's own account).
 *
 * Handles:
 *   - Inbound WhatsApp/SMS messages → conversation create/update + routing.
 *   - Outbound status callbacks (sent/delivered/read/failed) → per-org message
 *     status updates.
 *
 * Org resolution order: `?orgId=` query (our generated statusCallback URLs) →
 * webhook route mapping by the `To` sender number → platform env fallback.
 */
import { NextRequest, NextResponse } from 'next/server'
import { validateRequest } from 'twilio'
import { getWebhookRouteBySender, getChannelAccount } from '@/lib/communications/store'
import {
  ingestInboundMessage,
  isStatusCallback,
  parseInboundMessage,
  parseTwilioFormParams,
  resolveValidationAuthToken,
  resolveWebhookOrg,
} from '@/lib/communications/inbound'
import { updateMessageDeliveryStatus } from '@/lib/communications/store'
import type { ChannelAccount } from '@/lib/communications/types'

export const dynamic = 'force-dynamic'

function xmlResponse(status: number): NextResponse {
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
    status,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  })
}

/** Twilio signs the exact URL it posts to. Rebuild it from the configured public base when behind a proxy. */
function canonicalWebhookUrl(reqUrl: string): string {
  const configured = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? '').replace(/\/$/, '')
  if (configured && reqUrl.includes('/api/v1/communications/webhooks/twilio')) {
    const url = new URL(reqUrl)
    return `${configured}${url.pathname}${url.search}`
  }
  return reqUrl
}

function mapStatusCallback(rawStatus: string): 'sent' | 'delivered' | 'read' | 'failed' | null {
  const norm = (rawStatus ?? '').trim().toLowerCase()
  if (norm === 'delivered') return 'delivered'
  if (norm === 'read') return 'read'
  if (norm === 'failed' || norm === 'undelivered') return 'failed'
  if (norm === 'sent' || norm === 'accepted' || norm === 'sending') return 'sent'
  return null // queued etc. — nothing durable to record
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text()
  const params = parseTwilioFormParams(rawBody)
  const signature = req.headers.get('x-twilio-signature') ?? ''

  const url = new URL(req.url)
  const queryOrgId = url.searchParams.get('orgId')?.trim() || null
  const to = (params.To ?? '').trim()

  const resolved = await resolveWebhookOrg(queryOrgId, to)
  if (!resolved) {
    console.warn('[communications/webhooks/twilio] could not resolve org for webhook', { to: to || '(no To)' })
    // Ack so Twilio stops retrying an unknown sender; nothing was ingested.
    return xmlResponse(200)
  }
  const { orgId, source } = resolved

  // Signature verification with the resolved org's credentials (or platform env).
  const authToken = await resolveValidationAuthToken(orgId)
  if (authToken) {
    const urlToVerify = canonicalWebhookUrl(req.url)
    const valid = validateRequest(authToken, signature, urlToVerify, params)
    if (!valid) {
      console.warn('[communications/webhooks/twilio] signature verification failed', { orgId, source })
      return xmlResponse(403)
    }
  } else {
    console.warn('[communications/webhooks/twilio] no auth token available for org — accepting unsigned webhook', { orgId, source })
  }

  try {
    if (isStatusCallback(params)) {
      const sid = (params.MessageSid ?? params.SmsMessageSid ?? '').trim()
      const rawStatus = (params.MessageStatus ?? params.SmsStatus ?? '').trim()
      const mapped = mapStatusCallback(rawStatus)
      if (sid && mapped) {
        const result = await updateMessageDeliveryStatus(orgId, sid, {
          status: mapped,
          rawStatus,
          errorCode: params.ErrorCode ?? null,
          errorMessage: params.ErrorMessage ?? null,
        })
        if (!result.found) {
          console.warn('[communications/webhooks/twilio] status callback for unknown message SID', { orgId, sid })
        }
      }
      return xmlResponse(200)
    }

    const inbound = parseInboundMessage(params)
    if (!inbound.from || !inbound.to || !inbound.messageSid) {
      console.warn('[communications/webhooks/twilio] malformed inbound payload', { orgId, hasFrom: Boolean(inbound.from), hasSid: Boolean(inbound.messageSid) })
      return xmlResponse(200)
    }

    let channelAccount: ChannelAccount | null = null
    try {
      const route = await getWebhookRouteBySender(to)
      if (route?.accountId) channelAccount = await getChannelAccount(orgId, route.accountId)
    } catch (error) {
      console.warn('[communications/webhooks/twilio] failed to load channel account for after-hours evaluation', error)
    }

    const result = await ingestInboundMessage(orgId, inbound, { channelAccount })
    console.info('[communications/webhooks/twilio] inbound ingested', {
      orgId,
      source,
      conversationId: result.conversation.id,
      messageId: result.messageId,
      duplicate: result.duplicate,
      intent: result.classification.intent,
    })
    return xmlResponse(200)
  } catch (error) {
    console.error('[communications/webhooks/twilio] webhook handling failed', error)
    // Non-2xx so Twilio retries transient failures.
    return new NextResponse(JSON.stringify({ error: 'webhook handling failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
