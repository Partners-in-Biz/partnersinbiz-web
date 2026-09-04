import { NextRequest, NextResponse } from 'next/server'
import { authenticateSignedDeviceRequest, lifecycleError, noStoreHeaders } from '@/lib/linked-computers/http'
import { isRelayNotTeammatesError, replyRelayEnvelope } from '@/lib/linked-computers/relay-queue'

type Context = { params: Promise<{ deviceId: string }> }

function relayError(error: unknown): Response {
  if (isRelayNotTeammatesError(error)) {
    return NextResponse.json(
      { success: false, error: 'These agents are not in a shared room.', reason: 'not_teammates' },
      { status: 403, headers: noStoreHeaders },
    )
  }
  return lifecycleError(error)
}

export async function handleRelayReply(
  req: NextRequest,
  deviceId: string,
  auth = authenticateSignedDeviceRequest,
  reply = replyRelayEnvelope,
): Promise<Response> {
  try {
    const rawBody = await req.text()
    const identity = await auth(req, deviceId, rawBody)
    if (identity.deviceId !== deviceId) throw new Error('linked computers: tenant scope mismatch')
    const body = JSON.parse(rawBody) as Record<string, unknown>
    const envelope = await reply({
      deviceId,
      envelopeId: String(body.envelopeId ?? ''),
      leaseToken: String(body.leaseToken ?? ''),
      payload: body.payload,
    })
    return NextResponse.json({
      success: true,
      data: { envelopeId: envelope.envelopeId, status: envelope.status, replyStatus: envelope.reply?.status },
    }, { headers: noStoreHeaders })
  } catch (error) { return relayError(error) }
}

export const POST = async (req: NextRequest, context: Context) => handleRelayReply(req, (await context.params).deviceId)
