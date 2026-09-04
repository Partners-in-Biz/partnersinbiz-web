import { NextRequest, NextResponse } from 'next/server'
import { authenticateSignedDeviceRequest, noStoreHeaders } from '@/lib/linked-computers/http'
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
    const status = body.status === 'exited' || body.status === 'failed' ? body.status : 'killed'
    await completeDesktopSession(sessionId, status)
    return NextResponse.json({ success: true, data: { sessionId, status } }, { headers: noStoreHeaders })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'complete failed',
    }, { status: 500, headers: noStoreHeaders })
  }
}
