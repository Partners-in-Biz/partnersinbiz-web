import { NextRequest } from 'next/server'
import { getOrgTwilioCredentials } from '@/lib/communications/store'
import { upsertTwilioCall } from '@/lib/twilio/calls'
import { validateTwilioSignature } from '@/lib/twilio/sms'
import { normalizePhoneKey } from '@/lib/communications/credentials'
import { adminDb } from '@/lib/firebase/admin'
import { COMMUNICATION_COLLECTIONS } from '@/lib/communications/store'

export const dynamic = 'force-dynamic'

async function parseForm(req: NextRequest): Promise<Record<string, string>> {
  const form = await req.formData().catch(async () => {
    const text = await req.text()
    const params = new URLSearchParams(text)
    const fd = new FormData()
    params.forEach((v, k) => fd.set(k, v))
    return fd
  })
  const out: Record<string, string> = {}
  form.forEach((value, key) => {
    out[key] = typeof value === 'string' ? value : value.name
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
  return route.exists && typeof route.data()?.orgId === 'string' ? route.data()!.orgId : null
}

export async function POST(req: NextRequest) {
  const params = await parseForm(req)
  const orgId = await resolveOrgId(req, params)
  if (!orgId) return new Response('ok', { status: 200 })

  const credentials = await getOrgTwilioCredentials(orgId)
  if (credentials?.authToken) {
    const signature = req.headers.get('x-twilio-signature')
    const ok =
      (await validateTwilioSignature({
        authToken: credentials.authToken,
        signature,
        url: req.url,
        params,
      }))
      || (await validateTwilioSignature({
        authToken: credentials.authToken,
        signature,
        url: `${new URL(req.url).origin}${new URL(req.url).pathname}`,
        params,
      }))
    if (!ok) return new Response('Invalid signature', { status: 403 })
  }

  const callSid = params.CallSid || params.ParentCallSid || ''
  if (!callSid) return new Response('ok', { status: 200 })

  const status = (params.CallStatus || params.DialCallStatus || 'in-progress').toLowerCase()
  const duration = params.CallDuration || params.DialCallDuration
  const from = params.From || ''
  const to = params.To || ''
  const direction = from.startsWith('client:') ? 'outbound' : 'inbound'

  await upsertTwilioCall({
    orgId,
    callSid,
    parentCallSid: params.ParentCallSid || null,
    direction,
    status,
    from,
    to,
    durationSeconds: duration != null ? Number(duration) : null,
    errorCode: params.ErrorCode || null,
    errorMessage: params.ErrorMessage || null,
    ended: ['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(status),
    metadata: { statusCallback: true },
  })

  return new Response('ok', { status: 200 })
}
