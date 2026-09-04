import { NextRequest, NextResponse } from 'next/server'
import { authenticateSignedDeviceRequest, noStoreHeaders } from '@/lib/linked-computers/http'
import { getWorkbenchDesktopSession } from '@/lib/messages/workbench/desktop-session-store'

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
    const session = await getWorkbenchDesktopSession(sessionId)
    if (session.deviceId !== deviceId) {
      return NextResponse.json({ success: false, error: 'device mismatch' }, { status: 403, headers: noStoreHeaders })
    }
    // Heartbeat / progress ack — no state change required beyond liveness.
    return NextResponse.json({ success: true, data: { sessionId, status: session.status } }, { headers: noStoreHeaders })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'progress failed',
    }, { status: 500, headers: noStoreHeaders })
  }
}
