import { NextRequest, NextResponse } from 'next/server'
import { authenticateSignedDeviceRequest, noStoreHeaders } from '@/lib/linked-computers/http'
import { completeWorkbenchSession } from '@/lib/messages/workbench/session-store'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ deviceId: string; sessionId: string }> }
type DeviceIdentity = Awaited<ReturnType<typeof authenticateSignedDeviceRequest>>

function completionError(error: unknown): Response {
  const message = error instanceof Error ? error.message : ''
  const status = /not found/.test(message) ? 404
    : /authentication|signature|credential|replay|timestamp|tenant|authorization|revoked|device mismatch/.test(message) ? 403
      : /lease|immutable|already final/.test(message) ? 409
        : 400
  const publicMessage = status === 404 ? 'Workbench session not found'
    : status === 403 ? 'Linked computer access denied'
      : status === 409 ? 'Workbench session completion is no longer current'
        : 'Linked computer workbench session completion invalid'
  return NextResponse.json({ success: false, error: publicMessage }, { status, headers: noStoreHeaders })
}

/** Device worker reports the pty's terminal outcome: `exited` (own exit code), `killed`, or `failed` (spawn error). */
export async function handleWorkbenchSessionComplete(
  request: NextRequest,
  deviceId: string,
  sessionId: string,
  authenticate: (request: NextRequest, deviceId: string, rawBody: string) => Promise<DeviceIdentity> = authenticateSignedDeviceRequest,
  complete: typeof completeWorkbenchSession = completeWorkbenchSession,
): Promise<Response> {
  try {
    const rawBody = await request.text()
    const identity = await authenticate(request, deviceId, rawBody)
    if (identity.deviceId !== deviceId) throw new Error('workbench: tenant device mismatch')
    const body = JSON.parse(rawBody) as Record<string, unknown>
    const attempt = Number(body.attempt)
    const leaseToken = typeof body.leaseToken === 'string' ? body.leaseToken : ''
    const outcome = typeof body.outcome === 'string' ? body.outcome : ''
    if (!Number.isSafeInteger(attempt) || attempt < 1
      || !/^[A-Za-z0-9_-]{16,128}$/.test(leaseToken)
      || !['exited', 'killed', 'failed'].includes(outcome)) {
      throw new Error('workbench: invalid session completion')
    }
    const completed = await complete({
      deviceId, ownerUserId: identity.ownerUserId, credentialVersion: identity.credentialVersion,
      sessionId, attempt, leaseToken, outcome: outcome as 'exited' | 'killed' | 'failed',
      ...(typeof body.exitCode === 'number' ? { exitCode: body.exitCode } : {}),
      ...(typeof body.error === 'string' ? { error: body.error } : {}),
    })
    return NextResponse.json({
      success: true,
      data: { accepted: true, sessionId: completed.sessionId, status: completed.status },
    }, { headers: noStoreHeaders })
  } catch (error) {
    return completionError(error)
  }
}

export const POST = async (request: NextRequest, context: Context) => {
  const { deviceId, sessionId } = await context.params
  return handleWorkbenchSessionComplete(request, deviceId, sessionId)
}
