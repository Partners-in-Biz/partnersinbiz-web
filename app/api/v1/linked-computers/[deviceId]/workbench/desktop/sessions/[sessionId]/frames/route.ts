import { NextRequest, NextResponse } from 'next/server'
import { authenticateSignedDeviceRequest, noStoreHeaders } from '@/lib/linked-computers/http'
import {
  isWorkbenchBrowserFrameContentType,
  MAX_WORKBENCH_BROWSER_FRAME_BYTES,
} from '@/lib/messages/workbench/browser-frame-storage'
import { desktopSessionHttpStatus } from '@/lib/messages/workbench/desktop-session'
import { storeDesktopFrame } from '@/lib/messages/workbench/desktop-session-store'

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
    const seq = Number(body.seq)
    const contentType = typeof body.contentType === 'string' ? body.contentType : ''
    const dataBase64 = typeof body.dataBase64 === 'string' ? body.dataBase64 : ''
    if (!leaseToken || !Number.isSafeInteger(seq) || seq < 0 || !dataBase64) {
      return NextResponse.json({ success: false, error: 'Invalid frame request' }, { status: 400, headers: noStoreHeaders })
    }
    if (!isWorkbenchBrowserFrameContentType(contentType)) {
      return NextResponse.json({ success: false, error: 'Invalid frame request' }, { status: 400, headers: noStoreHeaders })
    }
    const frameContentType: 'image/jpeg' | 'image/png' = contentType === 'image/png' ? 'image/png' : 'image/jpeg'
    if (dataBase64.length > Math.ceil(MAX_WORKBENCH_BROWSER_FRAME_BYTES * 4 / 3) + 1_024) {
      return NextResponse.json({ success: false, error: 'Frame too large' }, { status: 413, headers: noStoreHeaders })
    }
    const bytes = Buffer.from(dataBase64, 'base64')
    const session = await storeDesktopFrame({
      sessionId,
      deviceId,
      leaseToken,
      seq,
      contentType: frameContentType,
      bytes,
      credentialVersion: identity.credentialVersion,
      screenWidth: typeof body.screenWidth === 'number' ? body.screenWidth : undefined,
      screenHeight: typeof body.screenHeight === 'number' ? body.screenHeight : undefined,
    })
    return NextResponse.json({
      success: true,
      data: { imageUrl: session.latestFrameUrl, seq, sessionId },
    }, { headers: noStoreHeaders })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'frame upload failed'
    const status = desktopSessionHttpStatus(error)
    return NextResponse.json({ success: false, error: message }, { status, headers: noStoreHeaders })
  }
}
