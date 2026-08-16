import { NextRequest } from 'next/server'
import { getOrgTwilioCredentials } from '@/lib/communications/store'
import { resolveTwilioOrg } from '@/lib/twilio/org-client'
import {
  buildInboundDialTwiml,
  buildOutboundDialTwiml,
  buildRejectTwiml,
  voiceWebhookUrls,
} from '@/lib/twilio/voice'
import { upsertTwilioCall } from '@/lib/twilio/calls'
import { validateTwilioSignature } from '@/lib/twilio/sms'
import { normalizePhoneKey } from '@/lib/communications/credentials'
import { adminDb } from '@/lib/firebase/admin'
import { COMMUNICATION_COLLECTIONS } from '@/lib/communications/store'

export const dynamic = 'force-dynamic'

async function parseForm(req: NextRequest): Promise<Record<string, string>> {
  const contentType = req.headers.get('content-type') || ''
  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    const form = await req.formData()
    const out: Record<string, string> = {}
    form.forEach((value, key) => {
      out[key] = typeof value === 'string' ? value : value.name
    })
    return out
  }
  const text = await req.text()
  const params = new URLSearchParams(text)
  const out: Record<string, string> = {}
  params.forEach((value, key) => {
    out[key] = value
  })
  return out
}

async function resolveOrgId(req: NextRequest, params: Record<string, string>): Promise<string | null> {
  const fromQuery = new URL(req.url).searchParams.get('orgId')?.trim()
  if (fromQuery) return fromQuery
  const to = params.To || params.Called || ''
  const key = normalizePhoneKey(to)
  if (!key) return null
  const route = await adminDb.collection(COMMUNICATION_COLLECTIONS.webhookRoutes).doc(key).get()
  if (!route.exists) return null
  return typeof route.data()?.orgId === 'string' ? route.data()!.orgId : null
}

/**
 * Twilio Voice Request URL — returns TwiML for browser→PSTN or inbound→browser.
 */
export async function POST(req: NextRequest) {
  const params = await parseForm(req)
  const orgId = await resolveOrgId(req, params)
  if (!orgId) {
    return new Response(buildRejectTwiml('This number is not connected.'), {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    })
  }

  const credentials = await getOrgTwilioCredentials(orgId)
  const signature = req.headers.get('x-twilio-signature')
  if (credentials?.authToken) {
    const url = req.url
    const ok = await validateTwilioSignature({
      authToken: credentials.authToken,
      signature,
      url,
      params,
    })
    if (!ok) {
      // Retry without query string — Twilio signs the configured URL.
      const baseUrl = `${new URL(req.url).origin}${new URL(req.url).pathname}`
      const ok2 = await validateTwilioSignature({
        authToken: credentials.authToken,
        signature,
        url: baseUrl,
        params,
      })
      if (!ok2) {
        return new Response('Invalid signature', { status: 403 })
      }
    }
  }

  const resolved = await resolveTwilioOrg(orgId, { allowPlatformFallback: false })
  if (!resolved) {
    return new Response(buildRejectTwiml('Twilio is not configured.'), {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    })
  }

  const urls = voiceWebhookUrls(orgId)
  const record = resolved.config.recordCallsByDefault !== false
  const callerId = (resolved.credentials.voiceCallerId || resolved.credentials.defaultFromNumber || '').trim()
  const from = (params.From || '').trim()
  const toParam = (params.To || params.Called || '').trim()
  // Softphone passes destination in custom param `To` or `to`
  const dialTarget = (params.To || params.to || params.CallTo || '').trim()
  const direction = from.startsWith('client:') ? 'outbound' : 'inbound'

  if (direction === 'outbound') {
    const to = dialTarget || toParam
    if (!to || !callerId) {
      return new Response(buildRejectTwiml('Missing destination or caller ID.'), {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      })
    }
    const callSid = params.CallSid || ''
    if (callSid) {
      await upsertTwilioCall({
        orgId,
        callSid,
        direction: 'outbound',
        status: 'ringing',
        from: callerId,
        to,
        userId: from.replace(/^client:/, '').replace(/^user_/, '') || null,
        metadata: { params },
      })
    }
    const twiml = buildOutboundDialTwiml({
      to,
      callerId,
      record,
      statusCallbackUrl: urls.statusUrl,
      recordingStatusCallbackUrl: urls.recordingUrl,
    })
    return new Response(twiml, { status: 200, headers: { 'Content-Type': 'text/xml' } })
  }

  // Inbound: ring the softphone identity for the org owner pool — use shared client identity.
  const clientIdentity = `org_${orgId}`
  const callSid = params.CallSid || ''
  if (callSid) {
    await upsertTwilioCall({
      orgId,
      callSid,
      direction: 'inbound',
      status: 'ringing',
      from,
      to: toParam || callerId,
      metadata: { params },
    })
  }
  const twiml = buildInboundDialTwiml({
    clientIdentity,
    record,
    statusCallbackUrl: urls.statusUrl,
    recordingStatusCallbackUrl: urls.recordingUrl,
  })
  return new Response(twiml, { status: 200, headers: { 'Content-Type': 'text/xml' } })
}
