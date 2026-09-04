import { NextRequest, NextResponse } from 'next/server'
import { authenticateSignedDeviceRequest, noStoreHeaders } from '@/lib/linked-computers/http'
import { desktopSessionHttpStatus } from '@/lib/messages/workbench/desktop-session'
import { completeDesktopSession } from '@/lib/messages/workbench/desktop-session-store'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ deviceId: string; sessionId: string }> }

export async function POST(request: NextRequest, ctx: Context) {
  try {
    const { deviceId, sessionId } = await ctx.params
    const rawBody = await request.text()
    const identity = await authenticateSignedDeviceRequest(request, deviceId, rawBody)
    if (identity.deviceId !== deviceId) {
      return NextResponse.json({ success: false, error: 'Linked computer access denied' }, { status: 403, headers: noStoreHeaders })
    }
    const body = JSON.parse(rawBody) as Record<string, unknown>
    const leaseToken = typeof body.leaseToken === 'string' ? body.leaseToken : ''
    if (!leaseToken) {
      return NextResponse.json({ success: false, error: 'lease mismatch' }, { status: 409, headers: noStoreHeaders })
    }
    const status = body.status === 'exited' || body.status === 'failed' ? body.status : 'killed'
    const session = await completeDesktopSession({
      sessionId,
      deviceId,
      credentialVersion: identity.credentialVersion,
      leaseToken,
      status,
    })
    return NextResponse.json({ success: true, data: { sessionId, status: session.status } }, { headers: noStoreHeaders })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'complete failed'
    const status = desktopSessionHttpStatus(error)
    return NextResponse.json({
      success: false,
      error: message,
    }, { status, headers: noStoreHeaders })
  }
}
