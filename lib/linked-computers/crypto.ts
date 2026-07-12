import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  verify,
} from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { LinkedDeviceArchitecture, LinkedDevicePlatform } from './types'

const CHALLENGES = 'linked_device_pairing_challenges'
const DEVICES = 'linked_devices'
const CREDENTIALS = 'linked_device_credentials'
const AUDIT = 'linked_computer_audit_events'
const PAIRING_TTL_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 5

interface RefLike { id: string; path?: string }
interface SnapshotLike { exists: boolean; data(): Record<string, unknown> | undefined }
interface TransactionLike {
  get(ref: RefLike): Promise<SnapshotLike>
  create(ref: RefLike, value: Record<string, unknown>): void
  update(ref: RefLike, value: Record<string, unknown>): void
}
export interface LinkedComputerPairingDb {
  collection(name: string): { doc(id: string): RefLike }
  runTransaction<T>(fn: (tx: TransactionLike) => Promise<T>): Promise<T>
}
interface Options {
  db?: LinkedComputerPairingDb
  now?: () => unknown
  nowMs?: () => number
  randomId?: () => string
  randomSecret?: () => string
}

function required(value: string, field: string): string {
  const clean = value.trim()
  if (!clean) throw new Error(`linked computers: ${field} is required`)
  return clean
}

export function hashLinkedComputerSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

export function constantTimeSecretMatch(secret: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashLinkedComputerSecret(secret), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function pairingProofPayload(input: {
  challengeId: string; secret: string; deviceId: string; publicKey: string
}): string {
  return `${input.challengeId}\n${input.secret}\n${input.deviceId}\n${input.publicKey}`
}

function timestamp(options: Options): unknown {
  return options.now ? options.now() : FieldValue.serverTimestamp()
}

function auditRef(db: LinkedComputerPairingDb): RefLike {
  return db.collection(AUDIT).doc(randomUUID())
}

export async function createPairing(
  input: { actorUserId: string },
  options: Options = {},
): Promise<{ challengeId: string; secret: string; expiresAt: string }> {
  const db = options.db ?? (adminDb as unknown as LinkedComputerPairingDb)
  const ownerUserId = required(input.actorUserId, 'actorUserId')
  const challengeId = options.randomId?.() ?? randomUUID()
  const secret = options.randomSecret?.() ?? randomBytes(24).toString('base64url')
  const expiresAt = new Date((options.nowMs?.() ?? Date.now()) + PAIRING_TTL_MS).toISOString()
  const at = timestamp(options)
  await db.runTransaction(async (tx) => {
    const ref = db.collection(CHALLENGES).doc(challengeId)
    if ((await tx.get(ref)).exists) throw new Error('linked computers: pairing challenge already exists')
    tx.create(ref, {
      challengeId, ownerUserId, secretHash: hashLinkedComputerSecret(secret), expiresAt,
      attempts: 0, maxAttempts: MAX_ATTEMPTS, createdAt: at,
    })
    tx.create(auditRef(db), {
      eventId: randomUUID(), action: 'pairing.created', actorUserId: ownerUserId,
      challengeId, createdAt: at,
    })
  })
  return { challengeId, secret, expiresAt }
}

export interface PairingExchangeInput {
  challengeId: string
  secret: string
  deviceId: string
  publicKey: string
  proof: string
  label: string
  platform: LinkedDevicePlatform
  architecture: LinkedDeviceArchitecture
  runtimeVersion: string
}

export async function exchangePairing(
  input: PairingExchangeInput,
  options: Options = {},
): Promise<{ deviceId: string; credential: string; credentialVersion: number }> {
  const db = options.db ?? (adminDb as unknown as LinkedComputerPairingDb)
  const challengeId = required(input.challengeId, 'challengeId')
  const deviceId = required(input.deviceId, 'deviceId')
  const publicKey = required(input.publicKey, 'publicKey')
  if (!['macos', 'windows'].includes(input.platform)) throw new Error('linked computers: invalid platform')
  if (!['arm64', 'x64'].includes(input.architecture)) throw new Error('linked computers: invalid architecture')
  if (publicKey.length > 8_192) throw new Error('linked computers: invalid publicKey')
  if (input.proof.length > 2_048) throw new Error('linked computers: invalid pairing proof')
  const credential = options.randomSecret?.() ?? randomBytes(32).toString('base64url')

  return db.runTransaction(async (tx) => {
    const challengeRef = db.collection(CHALLENGES).doc(challengeId)
    const challengeSnap = await tx.get(challengeRef)
    if (!challengeSnap.exists) throw new Error('linked computers: pairing challenge not found')
    const challenge = challengeSnap.data() ?? {}
    if (challenge.consumedAt) throw new Error('linked computers: pairing challenge already consumed')
    if ((options.nowMs?.() ?? Date.now()) >= Date.parse(String(challenge.expiresAt))) {
      throw new Error('linked computers: pairing challenge expired')
    }
    const attempts = Number(challenge.attempts ?? 0)
    if (attempts >= Number(challenge.maxAttempts ?? MAX_ATTEMPTS)) {
      throw new Error('linked computers: pairing attempts exhausted')
    }
    if (!constantTimeSecretMatch(input.secret, String(challenge.secretHash ?? ''))) {
      tx.update(challengeRef, { attempts: attempts + 1 })
      return { error: 'linked computers: invalid pairing secret' } as never
    }

    let proofValid = false
    try {
      proofValid = verify(
        null,
        Buffer.from(pairingProofPayload({ challengeId, secret: input.secret, deviceId, publicKey })),
        publicKey,
        Buffer.from(input.proof, 'base64url'),
      )
    } catch {
      proofValid = false
    }
    if (!proofValid) throw new Error('linked computers: invalid pairing proof')

    const ownerUserId = required(String(challenge.ownerUserId ?? ''), 'persisted ownerUserId')
    const deviceRef = db.collection(DEVICES).doc(deviceId)
    const deviceSnap = await tx.get(deviceRef)
    const existing = deviceSnap.data() ?? {}
    if (deviceSnap.exists && existing.ownerUserId !== ownerUserId) {
      throw new Error('linked computers: device owner mismatch')
    }
    if (deviceSnap.exists && existing.status !== 'active') {
      throw new Error('linked computers: active device required for re-pairing')
    }
    const credentialVersion = deviceSnap.exists ? Number(existing.credentialVersion ?? 0) + 1 : 1
    const at = timestamp(options)
    const fingerprint = `sha256:${createHash('sha256').update(publicKey).digest('base64url')}`
    const device = {
      deviceId, ownerUserId, runtimeTargetId: `linked-device:${deviceId}`,
      publicKey, publicKeyFingerprint: fingerprint,
      label: required(input.label, 'label'), platform: input.platform, architecture: input.architecture,
      runtimeVersion: required(input.runtimeVersion, 'runtimeVersion'), capabilities: ['workspace.execute'],
      status: 'active', credentialVersion,
      ...(deviceSnap.exists ? { updatedAt: at } : { createdAt: at, updatedAt: at, lastSeenAt: null }),
    }
    if (deviceSnap.exists) tx.update(deviceRef, device)
    else tx.create(deviceRef, device)
    const credentialRef = db.collection(CREDENTIALS).doc(deviceId)
    const credentialRow = {
      deviceId, credentialHash: hashLinkedComputerSecret(credential), credentialVersion,
      issuedAt: at, revokedAt: null,
    }
    if ((await tx.get(credentialRef)).exists) tx.update(credentialRef, credentialRow)
    else tx.create(credentialRef, credentialRow)
    tx.update(challengeRef, { consumedAt: at, deviceId })
    tx.create(auditRef(db), {
      eventId: randomUUID(), action: 'pairing.consumed', actorUserId: ownerUserId,
      challengeId, deviceId, createdAt: at,
    })
    tx.create(auditRef(db), {
      eventId: randomUUID(), action: 'device.paired', actorUserId: ownerUserId,
      deviceId, createdAt: at,
    })
    return { deviceId, credential, credentialVersion }
  }).then((result) => {
    if ('error' in (result as unknown as Record<string, unknown>)) {
      throw new Error(String((result as unknown as { error: string }).error))
    }
    return result
  })
}
