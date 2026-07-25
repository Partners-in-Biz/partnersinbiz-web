import { NextRequest, NextResponse } from 'next/server'
import { authenticateSignedDeviceRequest, noStoreHeaders } from '@/lib/linked-computers/http'
import {
  isWorkbenchBrowserFrameContentType,
  MAX_WORKBENCH_BROWSER_FRAME_BYTES,
  storeWorkbenchBrowserFrame,
} from '@/lib/messages/workbench/browser-frame-storage'
import { verifyWorkbenchBrowserSessionClaim } from '@/lib/messages/workbench/browser-session-store'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ deviceId: string; sessionId: string }> }
type DeviceIdentity = Awaited<ReturnType<typeof authenticateSignedDeviceRequest>>

function frameError(error: unknown): Response {
  const message = error instanceof Error ? error.message : ''
  const status = /not found/.test(message) ? 404
    : /authentication|signature|credential|replay|timestamp|tenant|authorization|revoked|device mismatch/.test(message) ? 403
      : /lease|not claimed/.test(message) ? 409
        : /size limit|content type|seq is invalid/.test(message) ? 413
          : 400
  const publicMessage = status === 404 ? 'Workbench browser session not found'
    : status === 403 ? 'Linked computer access denied'
      : status === 409 ? 'Workbench browser session lease is no longer current'
        : status === 413 ? 'Workbench browser frame invalid or too large'
          : 'Linked computer workbench browser frame request invalid'
  return NextResponse.json({ success: false, error: publicMessage }, { status, headers: noStoreHeaders })
}

/**
 * Device worker uploads one headless-Chrome screenshot as a durable URL.
 *
 * The device's outbound HTTP client (`runtime-installers/runtime/client.ts:
 * DeviceApiClient.post`) always JSON.stringify()s its body and signs over
 * that exact string (`lib/linked-computers/device-auth.ts:
 * deviceRequestPayload`) — there is no separate binary/multipart signing
 * path, and raw image bytes are not valid UTF-8 in general, so re-decoding
 * them via `request.text()` before verifying the signature would silently
 * corrupt the payload the device actually signed. Rather than build a
 * second signing scheme for this one route, the image bytes travel
 * base64-encoded inside the same signed JSON envelope as every other
 * device -> server call: `{ attempt, leaseToken, seq, contentType,
 * dataBase64 }`. At up to ~1.5MB per frame the ~33% base64 overhead is
 * immaterial next to the payload sizes `runs`/`sync` already send.
 *
 * Storage reuses `browser-frame-storage.ts` (mirrors `conversation
 * -attachments` and `project-sync/storage.ts`): bytes go to Firebase
 * Storage under `workbench-browser-frames/<org>/<conversation>/<session>/`,
 * and only a short-lived v4 signed download URL is returned — never a
 * base64 blob — so the caller can embed `imageUrl` directly in a
 * `progress` call's `frame` chunk.
 */
export async function handleWorkbenchBrowserSessionFrameUpload(
  request: NextRequest,
  deviceId: string,
  sessionId: string,
  authenticate: (request: NextRequest, deviceId: string, rawBody: string) => Promise<DeviceIdentity> = authenticateSignedDeviceRequest,
  verifyClaim: typeof verifyWorkbenchBrowserSessionClaim = verifyWorkbenchBrowserSessionClaim,
  store: typeof storeWorkbenchBrowserFrame = storeWorkbenchBrowserFrame,
): Promise<Response> {
  try {
    const rawBody = await request.text()
    const identity = await authenticate(request, deviceId, rawBody)
    if (identity.deviceId !== deviceId) throw new Error('workbench: tenant device mismatch')
    const body = JSON.parse(rawBody) as Record<string, unknown>
    const attempt = Number(body.attempt)
    const leaseToken = typeof body.leaseToken === 'string' ? body.leaseToken : ''
    const seq = Number(body.seq)
    const contentType = typeof body.contentType === 'string' ? body.contentType : ''
    const dataBase64 = typeof body.dataBase64 === 'string' ? body.dataBase64 : ''
    if (!Number.isSafeInteger(attempt) || attempt < 1
      || !/^[A-Za-z0-9_-]{16,128}$/.test(leaseToken)
      || !Number.isSafeInteger(seq) || seq < 0
      || !isWorkbenchBrowserFrameContentType(contentType)
      || !dataBase64) {
      throw new Error('workbench: invalid browser frame request')
    }
    // Base64 grows input by ~4/3; reject before decoding so an oversized
    // payload never gets fully buffered into memory as raw bytes first.
    if (dataBase64.length > Math.ceil(MAX_WORKBENCH_BROWSER_FRAME_BYTES * 4 / 3) + 1_024) {
      throw new Error('workbench: browser frame exceeds the size limit')
    }
    const bytes = Buffer.from(dataBase64, 'base64')

    const session = await verifyClaim({
      deviceId, ownerUserId: identity.ownerUserId, credentialVersion: identity.credentialVersion, sessionId, attempt, leaseToken,
    })
    const frame = await store({
      orgId: session.orgId, conversationId: session.conversationId, sessionId, seq, contentType, bytes,
    })
    return NextResponse.json({
      success: true,
      data: { imageUrl: frame.imageUrl, contentType: frame.contentType },
    }, { headers: noStoreHeaders })
  } catch (error) {
    return frameError(error)
  }
}

export const POST = async (request: NextRequest, context: Context) => {
  const { deviceId, sessionId } = await context.params
  return handleWorkbenchBrowserSessionFrameUpload(request, deviceId, sessionId)
}
