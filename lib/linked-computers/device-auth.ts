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
