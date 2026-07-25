import { NextRequest, NextResponse } from 'next/server'
import { authenticateSignedDeviceRequest, noStoreHeaders } from '@/lib/linked-computers/http'
import { claimOldestWorkbenchSessionWork } from '@/lib/messages/workbench/session-store'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ deviceId: string }> }
type DeviceIdentity = Awaited<ReturnType<typeof authenticateSignedDeviceRequest>>

function deviceError(error: unknown): Response {
  const message = error instanceof Error ? error.message : ''
  const status = /not found/.test(message) ? 404
    : /authentication|signature|credential|replay|timestamp|tenant|authorization|revoked|device mismatch/.test(message) ? 403
      : /lease|already final/.test(message) ? 409
        : 400
  const publicMessage = status === 404 ? 'Workbench session not found'
    : status === 403 ? 'Linked computer access denied'
      : status === 409 ? 'Workbench session lease is no longer current'
        : 'Linked computer workbench session request invalid'
  return NextResponse.json({ success: false, error: publicMessage }, { status, headers: noStoreHeaders })
}

/**
 * Device worker poll endpoint. Returns 204 when there is no pending session
 * work; otherwise returns a `WorkbenchSessionClaim` (see session-store.ts):
 * either `{ kind: 'create', sessionId, shell, cols, rows, cwd, workspaceId,
 * mappingId, relativeFolder, attempt, leaseToken }` to spawn a new pty, or
 * `{ kind: 'control', sessionId, control, attempt, leaseToken }` to apply a
 * queued stdin/resize/kill control to a pty the device already owns and is
 * running.
 */
export async function handleWorkbenchSessionClaim(
  request: NextRequest,
  deviceId: string,
  authenticate: (request: NextRequest, deviceId: string, rawBody: string) => Promise<DeviceIdentity> = authenticateSignedDeviceRequest,
  claim: typeof claimOldestWorkbenchSessionWork = claimOldestWorkbenchSessionWork,
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
  return handleWorkbenchSessionClaim(request, deviceId)
}
