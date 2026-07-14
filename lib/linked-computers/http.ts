import { NextRequest, NextResponse } from 'next/server'
import { authenticateDeviceRequest, authenticateDeviceRevocationRequest } from './device-auth'

export const noStoreHeaders = { 'Cache-Control': 'no-store', Pragma: 'no-cache' }

export function lifecycleError(error: unknown): Response {
  const message = error instanceof Error ? error.message : ''
  const status = /not found/.test(message) ? 404 : /owner|required|membership|administrator|tenant|grant|authentication|signature|credential|replay|timestamp/.test(message) ? 403 : 400
  return NextResponse.json({ success: false, error: status === 404 ? 'Linked computer not found' : status === 403 ? 'Linked computer access denied' : 'Linked computer request invalid' }, { status, headers: noStoreHeaders })
}

/**
 * Device sync receipts must distinguish permanent protocol/authentication
 * failures from transient persistence and storage failures. Unknown errors are
 * deliberately retryable and never expose backend details to the runtime.
 */
export function projectSyncRuntimeError(error: unknown): Response {
  const message = error instanceof Error ? error.message : ''
  const invalidRequest = error instanceof SyntaxError
    || /^linked computers: (?:invalid workspace\.sync|workspace\.sync protocol required)/.test(message)
    || /^linked computers: invalid (?:deviceId|device requestId)$/.test(message)
  if (invalidRequest) {
    return NextResponse.json(
      { success: false, error: 'Linked computer request invalid' },
      { status: 400, headers: noStoreHeaders },
    )
  }
  if (/^linked computers: (?:device authentication failed|tenant scope mismatch|active device required|device credential revoked|previous credential restricted|device credential version mismatch|invalid device signature|device request replay|stale device request timestamp)/.test(message)
    || message === 'project sync workspace.sync binding denied') {
    return NextResponse.json(
      { success: false, error: 'Linked computer access denied' },
      { status: 403, headers: noStoreHeaders },
    )
  }
  if (message === 'project sync request not found' || message === 'project sync source manifest not found') {
    return NextResponse.json(
      { success: false, error: 'Project sync request not found' },
      { status: 404, headers: noStoreHeaders },
    )
  }
  if (/^project sync (?:runtime lease does not match this receipt|upload receipt (?:must contain the complete leased object set|manifest revision mismatch|manifest mismatch|source mismatch)|transfer receipt does not match its leased payload|failure does not match its leased payload)$/.test(message)) {
    return NextResponse.json(
      { success: false, error: 'Project sync receipt is no longer current' },
      { status: 409, headers: noStoreHeaders },
    )
  }
  if (/^project sync (?:manifest integrity check failed|inventory is not bound to a pristine bootstrap lease|pristine bootstrap requires an empty manifest)$/.test(message)) {
    return NextResponse.json(
      { success: false, error: 'Project sync receipt is invalid' },
      { status: 400, headers: noStoreHeaders },
    )
  }
  return NextResponse.json(
    { success: false, error: 'Project sync service temporarily unavailable' },
    { status: 503, headers: noStoreHeaders },
  )
}

export async function authenticateSignedDeviceRevocationRequest(req: NextRequest, deviceId: string, body: string) {
  if (req.headers.get('x-device-id') !== deviceId) throw new Error('linked computers: revocation authentication failed')
  return authenticateDeviceRevocationRequest({ deviceId, credential: req.headers.get('x-device-credential') ?? '', credentialVersion: Number(req.headers.get('x-device-credential-version')), timestamp: req.headers.get('x-device-timestamp') ?? '', requestId: req.headers.get('x-device-request-id') ?? '', signature: req.headers.get('x-device-signature') ?? '', method: req.method, path: req.nextUrl.pathname, body })
}

export async function authenticateSignedDeviceRequest(req: NextRequest, deviceId: string, body: string) {
  if (req.headers.get('x-device-id') !== deviceId) throw new Error('linked computers: device authentication failed')
  return authenticateDeviceRequest({
    deviceId,
    credential: req.headers.get('x-device-credential') ?? '',
    credentialVersion: Number(req.headers.get('x-device-credential-version')),
    timestamp: req.headers.get('x-device-timestamp') ?? '',
    requestId: req.headers.get('x-device-request-id') ?? '',
    signature: req.headers.get('x-device-signature') ?? '',
    method: req.method,
    path: req.nextUrl.pathname,
    body,
  })
}
