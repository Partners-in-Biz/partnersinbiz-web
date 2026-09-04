import { NextRequest, NextResponse } from 'next/server'
import { authenticateSignedDeviceRequest, noStoreHeaders } from '@/lib/linked-computers/http'
import { claimWorkbenchDesktopSession } from '@/lib/messages/workbench/desktop-session-store'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ deviceId: string }> }

export async function POST(request: NextRequest, ctx: Context) {
  try {
    const { deviceId } = await ctx.params
    const rawBody = await request.text()
    const identity = await authenticateSignedDeviceRequest(request, deviceId, rawBody)
    if (identity.deviceId !== deviceId) {
      return NextResponse.json({ success: false, error: 'Linked computer access denied' }, { status: 403, headers: noStoreHeaders })
    }
    const claim = await claimWorkbenchDesktopSession({
      deviceId,
      credentialVersion: identity.credentialVersion,
    })
    if (!claim) return new NextResponse(null, { status: 204, headers: noStoreHeaders })
    return NextResponse.json({ success: true, data: claim }, { headers: noStoreHeaders })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'claim failed'
    const status = /authentication|signature|credential|revoked/.test(message) ? 403 : 500
    return NextResponse.json({ success: false, error: message }, { status, headers: noStoreHeaders })
  }
}
