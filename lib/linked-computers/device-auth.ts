import { createHash, verify } from 'node:crypto'
import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import {
  constantTimeSecretMatch,
  type LinkedComputerPairingDb,
} from './crypto'

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000

interface DeviceAuthInput {
  deviceId: string
  credential: string
  credentialVersion: number
  timestamp: string
  requestId: string
  signature: string
  method: string
  path: string
  body: string
}

export function deviceRequestPayload(input: Pick<DeviceAuthInput, 'method' | 'path' | 'timestamp' | 'requestId' | 'body'>): string {
  return `${input.method.toUpperCase()}\n${input.path}\n${input.timestamp}\n${input.requestId}\n${input.body}`
}

export async function authenticateDeviceRequest(
  input: DeviceAuthInput,
  options: { db?: LinkedComputerPairingDb; nowMs?: () => number } = {},
): Promise<{ deviceId: string; ownerUserId: string; credentialVersion: number }> {
  const db = options.db ?? (adminDb as unknown as LinkedComputerPairingDb)
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.deviceId)) {
    throw new Error('linked computers: invalid deviceId')
  }
  const currentTime = options.nowMs?.() ?? Date.now()
  const requestTime = Number(input.timestamp)
  if (!Number.isFinite(requestTime) || Math.abs(currentTime - requestTime) > MAX_CLOCK_SKEW_MS) {
    throw new Error('linked computers: stale device request timestamp')
  }
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(input.requestId)) {
    throw new Error('linked computers: invalid device requestId')
  }
  return db.runTransaction(async (tx) => {
    const deviceSnap = await tx.get(db.collection('linked_devices').doc(input.deviceId))
    const credentialSnap = await tx.get(db.collection('linked_device_credentials').doc(input.deviceId))
    const nonceId = createHash('sha256').update(`${input.deviceId}\n${input.requestId}`).digest('hex')
    const nonceRef = db.collection('linked_device_request_nonces').doc(nonceId)
    const nonceSnap = await tx.get(nonceRef)
    if (!deviceSnap.exists || !credentialSnap.exists) throw new Error('linked computers: device authentication failed')
    const device = deviceSnap.data() ?? {}
    const storedCredential = credentialSnap.data() ?? {}
    if (device.status !== 'active') throw new Error('linked computers: active device required')
    if (storedCredential.revokedAt) throw new Error('linked computers: device credential revoked')
    const currentVersion = Number(device.credentialVersion) === input.credentialVersion
      && Number(storedCredential.credentialVersion) === input.credentialVersion
    const previousVersion = Number(storedCredential.previousCredentialVersion) === input.credentialVersion
      && currentTime <= Date.parse(String(storedCredential.previousCredentialExpiresAt ?? ''))
    if (previousVersion) {
      let rotationClaim = false
      try { rotationClaim = input.path.endsWith(`/linked-computers/${input.deviceId}/heartbeat`) && JSON.parse(input.body)?.claimRotation === true } catch { rotationClaim = false }
      if (!rotationClaim) throw new Error('linked computers: previous credential restricted to rotation delivery')
    }
    if (!currentVersion && !previousVersion) {
      throw new Error('linked computers: device credential version mismatch')
    }
    const expectedHash = previousVersion ? storedCredential.previousCredentialHash : storedCredential.credentialHash
    if (!constantTimeSecretMatch(input.credential, String(expectedHash ?? ''))) {
      throw new Error('linked computers: device authentication failed')
    }
    let validSignature = false
    try {
      validSignature = verify(null, Buffer.from(deviceRequestPayload(input)), String(device.publicKey ?? ''), Buffer.from(input.signature, 'base64url'))
    } catch {
      validSignature = false
    }
    if (!validSignature) throw new Error('linked computers: invalid device signature')
    if (nonceSnap.exists) throw new Error('linked computers: device request replay')
    tx.create(nonceRef, {
      deviceId: input.deviceId, requestIdHash: createHash('sha256').update(input.requestId).digest('hex'),
      credentialVersion: input.credentialVersion, requestTimestamp: requestTime,
      expiresAt: Timestamp.fromMillis(Math.max(currentTime, requestTime) + MAX_CLOCK_SKEW_MS),
    })
    return { deviceId: input.deviceId, ownerUserId: String(device.ownerUserId), credentialVersion: input.credentialVersion }
  })
}

export async function authenticateDeviceRevocationRequest(input: DeviceAuthInput, options: { db?: LinkedComputerPairingDb; nowMs?: () => number } = {}): Promise<{ deviceId: string; ownerUserId: string; credentialVersion: number; status: string }> {
  const expectedPath = `/api/v1/linked-computers/${input.deviceId}/revoke`
  if (input.method.toUpperCase() !== 'POST' || input.path !== expectedPath) throw new Error('linked computers: revocation authentication route required')
  const db = options.db ?? (adminDb as unknown as LinkedComputerPairingDb)
  const now = options.nowMs?.() ?? Date.now(); const requestTime = Number(input.timestamp)
  if (!Number.isFinite(requestTime) || Math.abs(now - requestTime) > MAX_CLOCK_SKEW_MS || !/^[A-Za-z0-9_-]{16,128}$/.test(input.requestId)) throw new Error('linked computers: invalid revocation request')
  return db.runTransaction(async (tx) => {
    const deviceRef = db.collection('linked_devices').doc(input.deviceId); const credentialRef = db.collection('linked_device_credentials').doc(input.deviceId)
    const nonceRef = db.collection('linked_device_request_nonces').doc(createHash('sha256').update(`${input.deviceId}\n${input.requestId}`).digest('hex'))
    const [deviceSnap, credentialSnap, nonceSnap] = await Promise.all([tx.get(deviceRef), tx.get(credentialRef), tx.get(nonceRef)])
    if (!deviceSnap.exists || !credentialSnap.exists || nonceSnap.exists) throw new Error('linked computers: revocation authentication failed')
    const device = deviceSnap.data() ?? {}; const credential = credentialSnap.data() ?? {}
    if (!['active', 'revoked', 'removed'].includes(String(device.status)) || Number(device.credentialVersion) !== input.credentialVersion || Number(credential.credentialVersion) !== input.credentialVersion
      || !constantTimeSecretMatch(input.credential, String(credential.credentialHash ?? ''))) throw new Error('linked computers: revocation authentication failed')
    let valid = false
    try { valid = verify(null, Buffer.from(deviceRequestPayload(input)), String(device.publicKey ?? ''), Buffer.from(input.signature, 'base64url')) } catch { valid = false }
    if (!valid) throw new Error('linked computers: revocation authentication failed')
    tx.create(nonceRef, { deviceId: input.deviceId, requestIdHash: createHash('sha256').update(input.requestId).digest('hex'), credentialVersion: input.credentialVersion, requestTimestamp: requestTime, expiresAt: Timestamp.fromMillis(Math.max(now, requestTime) + MAX_CLOCK_SKEW_MS) })
    return { deviceId: input.deviceId, ownerUserId: String(device.ownerUserId), credentialVersion: input.credentialVersion, status: String(device.status) }
  })
}
