import { verify } from 'node:crypto'
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
  signature: string
  method: string
  path: string
  body: string
}

export function deviceRequestPayload(input: Pick<DeviceAuthInput, 'method' | 'path' | 'timestamp' | 'body'>): string {
  return `${input.method.toUpperCase()}\n${input.path}\n${input.timestamp}\n${input.body}`
}

export async function authenticateDeviceRequest(
  input: DeviceAuthInput,
  options: { db?: LinkedComputerPairingDb; nowMs?: () => number } = {},
): Promise<{ deviceId: string; ownerUserId: string; credentialVersion: number }> {
  const db = options.db ?? (adminDb as unknown as LinkedComputerPairingDb)
  const requestTime = Number(input.timestamp)
  if (!Number.isFinite(requestTime) || Math.abs((options.nowMs?.() ?? Date.now()) - requestTime) > MAX_CLOCK_SKEW_MS) {
    throw new Error('linked computers: stale device request timestamp')
  }
  return db.runTransaction(async (tx) => {
    const deviceSnap = await tx.get(db.collection('linked_devices').doc(input.deviceId))
    const credentialSnap = await tx.get(db.collection('linked_device_credentials').doc(input.deviceId))
    if (!deviceSnap.exists || !credentialSnap.exists) throw new Error('linked computers: device authentication failed')
    const device = deviceSnap.data() ?? {}
    const storedCredential = credentialSnap.data() ?? {}
    if (device.status !== 'active') throw new Error('linked computers: active device required')
    if (storedCredential.revokedAt) throw new Error('linked computers: device credential revoked')
    if (Number(device.credentialVersion) !== input.credentialVersion || Number(storedCredential.credentialVersion) !== input.credentialVersion) {
      throw new Error('linked computers: device credential version mismatch')
    }
    if (!constantTimeSecretMatch(input.credential, String(storedCredential.credentialHash ?? ''))) {
      throw new Error('linked computers: device authentication failed')
    }
    let validSignature = false
    try {
      validSignature = verify(null, Buffer.from(deviceRequestPayload(input)), String(device.publicKey ?? ''), Buffer.from(input.signature, 'base64url'))
    } catch {
      validSignature = false
    }
    if (!validSignature) throw new Error('linked computers: invalid device signature')
    return { deviceId: input.deviceId, ownerUserId: String(device.ownerUserId), credentialVersion: input.credentialVersion }
  })
}
