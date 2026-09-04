import { NextRequest, NextResponse } from 'next/server'
import { authenticateSignedDeviceRequest, lifecycleError, noStoreHeaders } from '@/lib/linked-computers/http'
import { claimOldestRelayEnvelope, isRelayNotTeammatesError } from '@/lib/linked-computers/relay-queue'

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

export async function handleRelayClaim(
  req: NextRequest,
  deviceId: string,
  auth = authenticateSignedDeviceRequest,
  claim = claimOldestRelayEnvelope,
): Promise<Response> {
  try {
    const rawBody = await req.text()
    const identity = await auth(req, deviceId, rawBody)
    if (identity.deviceId !== deviceId) throw new Error('linked computers: tenant scope mismatch')
    const envelope = await claim({ deviceId })
    if (!envelope) return new NextResponse(null, { status: 204, headers: noStoreHeaders })
    return NextResponse.json({ success: true, data: envelope }, { headers: noStoreHeaders })
  } catch (error) { return relayError(error) }
}

export const POST = async (req: NextRequest, context: Context) => handleRelayClaim(req, (await context.params).deviceId)
