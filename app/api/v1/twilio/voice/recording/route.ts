import { NextRequest } from 'next/server'
import { getOrgTwilioCredentials } from '@/lib/communications/store'
import { resolveTwilioOrg } from '@/lib/twilio/org-client'
import { applyRecordingCallback, requestCallTranscription } from '@/lib/twilio/recordings'
import { validateTwilioSignature } from '@/lib/twilio/sms'

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

export async function POST(req: NextRequest) {
  const params = await parseForm(req)
  const orgId = new URL(req.url).searchParams.get('orgId')?.trim()
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

  const callSid = params.CallSid || ''
  const recordingSid = params.RecordingSid || ''
  const recordingUrl = params.RecordingUrl || ''
  if (!callSid) return new Response('ok', { status: 200 })

  await applyRecordingCallback({
    orgId,
    callSid,
    recordingSid: recordingSid || undefined,
    recordingUrl: recordingUrl || undefined,
    recordingStatus: params.RecordingStatus || 'completed',
    recordingDuration: params.RecordingDuration,
  })

  const resolved = await resolveTwilioOrg(orgId, { allowPlatformFallback: false })
  if (resolved && recordingSid) {
    await requestCallTranscription(resolved, { callSid, recordingSid })
  }

  return new Response('ok', { status: 200 })
}
