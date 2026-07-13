import { NextRequest, NextResponse } from 'next/server'
import { authenticateDeviceRequest, authenticateDeviceRevocationRequest } from './device-auth'

export const noStoreHeaders = { 'Cache-Control': 'no-store', Pragma: 'no-cache' }

export function lifecycleError(error: unknown): Response {
  const message = error instanceof Error ? error.message : ''
  const status = /not found/.test(message) ? 404 : /owner|required|membership|administrator|tenant|grant|authentication|signature|credential|replay|timestamp/.test(message) ? 403 : 400
  return NextResponse.json({ success: false, error: status === 404 ? 'Linked computer not found' : status === 403 ? 'Linked computer access denied' : 'Linked computer request invalid' }, { status, headers: noStoreHeaders })
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
