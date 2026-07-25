import { NextRequest, NextResponse } from 'next/server'
import { authenticateSignedDeviceRequest, noStoreHeaders } from '@/lib/linked-computers/http'
import { appendWorkbenchSessionProgress } from '@/lib/messages/workbench/session-store'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ deviceId: string; sessionId: string }> }
type DeviceIdentity = Awaited<ReturnType<typeof authenticateSignedDeviceRequest>>

function progressError(error: unknown): Response {
  const message = error instanceof Error ? error.message : ''
  const status = /not found/.test(message) ? 404
    : /authentication|signature|credential|replay|timestamp|tenant|authorization|revoked|device mismatch/.test(message) ? 403
      : /lease|already final|not claimed/.test(message) ? 409
        : 400
  const publicMessage = status === 404 ? 'Workbench session not found'
    : status === 403 ? 'Linked computer access denied'
      : status === 409 ? 'Workbench session lease is no longer current'
        : 'Linked computer workbench session progress invalid'
  return NextResponse.json({ success: false, error: publicMessage }, { status, headers: noStoreHeaders })
}

/** Device worker streams stdout/stderr/status chunks and renews its lease while the pty is alive. */
export async function handleWorkbenchSessionProgress(
  request: NextRequest,
  deviceId: string,
  sessionId: string,
  authenticate: (request: NextRequest, deviceId: string, rawBody: string) => Promise<DeviceIdentity> = authenticateSignedDeviceRequest,
  append: typeof appendWorkbenchSessionProgress = appendWorkbenchSessionProgress,
): Promise<Response> {
  try {
    const rawBody = await request.text()
    const identity = await authenticate(request, deviceId, rawBody)
    if (identity.deviceId !== deviceId) throw new Error('workbench: tenant device mismatch')
    const body = JSON.parse(rawBody) as Record<string, unknown>
    const attempt = Number(body.attempt)
    const leaseToken = typeof body.leaseToken === 'string' ? body.leaseToken : ''
    if (!Number.isSafeInteger(attempt) || attempt < 1 || !/^[A-Za-z0-9_-]{16,128}$/.test(leaseToken)) {
      throw new Error('workbench: invalid session progress request')
    }
    const progress = await append({
      deviceId, ownerUserId: identity.ownerUserId, credentialVersion: identity.credentialVersion,
      sessionId, attempt, leaseToken, chunk: body.chunk,
    })
    return NextResponse.json({
      success: true,
      data: {
        accepted: true, sessionId: progress.sessionId, status: progress.status,
        leaseExpiresAt: new Date(progress.leaseExpiresAtMs).toISOString(),
      },
    }, { headers: noStoreHeaders })
  } catch (error) {
    return progressError(error)
  }
}

export const POST = async (request: NextRequest, context: Context) => {
  const { deviceId, sessionId } = await context.params
  return handleWorkbenchSessionProgress(request, deviceId, sessionId)
}
