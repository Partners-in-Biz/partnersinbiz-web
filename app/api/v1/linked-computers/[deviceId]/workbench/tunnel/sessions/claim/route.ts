import { NextRequest, NextResponse } from 'next/server'
import { authenticateSignedDeviceRequest, noStoreHeaders } from '@/lib/linked-computers/http'
import { claimOldestWorkbenchTunnelWork } from '@/lib/messages/workbench/tunnel-session-store'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ deviceId: string }> }
type DeviceIdentity = Awaited<ReturnType<typeof authenticateSignedDeviceRequest>>

function deviceError(error: unknown): Response {
  const message = error instanceof Error ? error.message : ''
  const status = /not found/.test(message) ? 404
    : /authentication|signature|credential|replay|timestamp|tenant|authorization|revoked|device mismatch/.test(message) ? 403
      : /lease|already final/.test(message) ? 409
        : 400
  const publicMessage = status === 404 ? 'Workbench tunnel not found'
    : status === 403 ? 'Linked computer access denied'
      : status === 409 ? 'Workbench tunnel lease is no longer current'
        : 'Linked computer workbench tunnel request invalid'
  return NextResponse.json({ success: false, error: publicMessage }, { status, headers: noStoreHeaders })
}

/**
 * Device worker poll endpoint. Returns 204 when there is no pending tunnel
 * work; otherwise returns a `WorkbenchTunnelClaim` (see
 * tunnel-session-store.ts): either `{ kind: 'create', sessionId, port,
 * bindHost, provider, workspaceId, mappingId, relativeFolder, attempt,
 * leaseToken }` to spawn the outbound tunnel process, or `{ kind: 'control',
 * sessionId, control: { kind: 'kill' }, attempt, leaseToken }` to tear down
 * a tunnel the device already owns and is running.
 */
export async function handleWorkbenchTunnelClaim(
  request: NextRequest,
  deviceId: string,
  authenticate: (request: NextRequest, deviceId: string, rawBody: string) => Promise<DeviceIdentity> = authenticateSignedDeviceRequest,
  claim: typeof claimOldestWorkbenchTunnelWork = claimOldestWorkbenchTunnelWork,
): Promise<Response> {
  try {
    const rawBody = await request.text()
    const identity = await authenticate(request, deviceId, rawBody)
    if (identity.deviceId !== deviceId) throw new Error('workbench: tenant device mismatch')
    const claimed = await claim({ deviceId, ownerUserId: identity.ownerUserId, credentialVersion: identity.credentialVersion })
    if (!claimed) return new Response(null, { status: 204, headers: noStoreHeaders })
    return NextResponse.json({ success: true, data: claimed }, { status: 200, headers: noStoreHeaders })
  } catch (error) {
    return deviceError(error)
  }
}

export const POST = async (request: NextRequest, context: Context) => {
  const { deviceId } = await context.params
  return handleWorkbenchTunnelClaim(request, deviceId)
}
