import { NextRequest, NextResponse } from 'next/server'
import { authenticateSignedDeviceRequest, lifecycleError, noStoreHeaders } from '@/lib/linked-computers/http'
import {
  enqueueRelayEnvelope,
  isRelayNotTeammatesError,
  type RelayKind,
} from '@/lib/linked-computers/relay-queue'

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

export async function handleRelayOutbox(
  req: NextRequest,
  deviceId: string,
  auth = authenticateSignedDeviceRequest,
  enqueue = enqueueRelayEnvelope,
): Promise<Response> {
  try {
    const rawBody = await req.text()
    const identity = await auth(req, deviceId, rawBody)
    if (identity.deviceId !== deviceId) throw new Error('linked computers: tenant scope mismatch')
    const body = JSON.parse(rawBody) as Record<string, unknown>
    const from = body.from && typeof body.from === 'object' && !Array.isArray(body.from)
      ? body.from as Record<string, unknown>
      : {}
    const to = body.to && typeof body.to === 'object' && !Array.isArray(body.to)
      ? body.to as Record<string, unknown>
      : {}
    const envelope = await enqueue({
      fromDeviceId: deviceId,
      outboxItemId: String(body.outboxItemId ?? ''),
      orgId: String(body.orgId ?? ''),
      roomId: typeof body.roomId === 'string' || body.roomId === null ? body.roomId as string | null : null,
      from: {
        profile: String(from.profile ?? ''),
        agentId: String(from.agentId ?? ''),
      },
      to: {
        deviceId: String(to.deviceId ?? ''),
        profile: String(to.profile ?? ''),
        agentId: String(to.agentId ?? ''),
      },
      kind: body.kind as RelayKind,
      payload: body.payload,
    })
    return NextResponse.json({
      success: true,
      data: {
        envelopeId: envelope.envelopeId,
        idempotencyKey: envelope.idempotencyKey,
        status: envelope.status,
        expiresAtMs: envelope.expiresAtMs,
      },
    }, { headers: noStoreHeaders })
  } catch (error) { return relayError(error) }
}

export const POST = async (req: NextRequest, context: Context) => handleRelayOutbox(req, (await context.params).deviceId)
