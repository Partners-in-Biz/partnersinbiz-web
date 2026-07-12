import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { assertDeviceOrgAccess, assertGrantAdministrator } from './policy'
import type {
  ActiveOrgMembership,
  DeviceGrantStatus,
  LinkedDevice,
  LinkedDeviceArchitecture,
  LinkedDeviceCapability,
  LinkedDeviceGrant,
  LinkedDevicePlatform,
  LinkedDeviceStatus,
  WorkspaceMappingStatus,
} from './types'

const DEVICES = 'linked_devices'
const CHALLENGES = 'linked_device_pairing_challenges'
const GRANTS = 'linked_device_grants'
const MAPPINGS = 'linked_device_workspace_mappings'
const AUDIT = 'linked_computer_audit_events'
const MEMBERS = 'orgMembers'
const WORKSPACES = 'org_workspaces'
const PAIRING_TTL_MS = 10 * 60 * 1000
const PAIRING_MAX_ATTEMPTS = 5
const CREDENTIAL_ROTATION_OVERLAP_MS = 5 * 60 * 1000

interface RefLike { id: string; path?: string }
interface SnapshotLike { exists: boolean; data(): Record<string, unknown> | undefined }
interface TransactionLike {
  get(ref: RefLike): Promise<SnapshotLike>
  create(ref: RefLike, value: Record<string, unknown>): void
  set(ref: RefLike, value: Record<string, unknown>, options?: { merge?: boolean }): void
  update(ref: RefLike, value: Record<string, unknown>): void
}
interface DbLike {
  collection(name: string): { doc(id: string): RefLike }
  runTransaction<T>(fn: (tx: TransactionLike) => Promise<T>): Promise<T>
}
interface StoreOptions { db?: DbLike; now?: () => unknown; nowMs?: () => number }

export interface SafeLinkedDeviceDto {
  deviceId: string; label: string; platform: LinkedDevicePlatform; architecture: LinkedDeviceArchitecture
  runtimeVersion: string; capabilities: LinkedDeviceCapability[]; status: LinkedDeviceStatus
  credentialVersion: number; createdAt: unknown; updatedAt: unknown; lastSeenAt: unknown | null
}

export function toSafeLinkedDeviceDto(row: LinkedDevice): SafeLinkedDeviceDto {
  const { deviceId, label, platform, architecture, runtimeVersion, capabilities, status, credentialVersion, createdAt, updatedAt, lastSeenAt } = row
  return { deviceId, label, platform, architecture, runtimeVersion, capabilities, status, credentialVersion, createdAt, updatedAt, lastSeenAt }
}

export async function listOwnedDevices(actorUserId: string, options: StoreOptions = {}): Promise<SafeLinkedDeviceDto[]> {
  const db = (options.db ?? adminDb) as any
  const snapshot = await db.collection(DEVICES).where('ownerUserId', '==', required(actorUserId, 'actorUserId')).get()
  return snapshot.docs.map((doc: any) => toSafeLinkedDeviceDto(doc.data() as LinkedDevice))
}

export async function updateOwnedDevice(input: { deviceId: string; actorUserId: string; label?: string; status?: LinkedDeviceStatus }, options: StoreOptions = {}): Promise<void> {
  if (input.status) return transitionDeviceStatus({ deviceId: input.deviceId, actorUserId: input.actorUserId, status: input.status }, options)
  const db = options.db ?? (adminDb as unknown as DbLike)
  await db.runTransaction(async (tx) => {
    const ref = db.collection(DEVICES).doc(input.deviceId)
    const snap = await tx.get(ref)
    if (!snap.exists) throw new Error('linked computers: device not found')
    const device = snap.data() as unknown as LinkedDevice
    if (device.ownerUserId !== input.actorUserId) throw new Error('linked computers: device owner required')
    tx.update(ref, { label: required(input.label ?? '', 'label'), updatedAt: timestamp(options) })
  })
}

export async function recordDeviceHeartbeat(input: { deviceId: string; runtimeVersion: string; capabilities: LinkedDeviceCapability[]; health: 'ok' | 'degraded' }, options: StoreOptions = {}): Promise<void> {
  const db = options.db ?? (adminDb as unknown as DbLike)
  await db.runTransaction(async (tx) => {
    const ref = db.collection(DEVICES).doc(input.deviceId)
    const snap = await tx.get(ref)
    if (!snap.exists) throw new Error('linked computers: device not found')
    const device = snap.data() as unknown as LinkedDevice
    if (device.status !== 'active') throw new Error('linked computers: active device required')
    const at = timestamp(options)
    tx.update(ref, { runtimeVersion: required(input.runtimeVersion, 'runtimeVersion'), capabilities: input.capabilities, health: input.health, lastSeenAt: at, updatedAt: at })
  })
}

function timestamp(options: StoreOptions): unknown {
  return options.now ? options.now() : FieldValue.serverTimestamp()
}

function required(value: string, field: string): string {
  const clean = value.trim()
  if (!clean) throw new Error(`linked computers: ${field} is required`)
  return clean
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

function secretsMatch(actualSecret: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashSecret(actualSecret), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function auditRef(db: DbLike): RefLike {
  return db.collection(AUDIT).doc(randomUUID())
}

function membershipFrom(row: Record<string, unknown> | undefined, orgId: string, userId: string): ActiveOrgMembership {
  return {
    orgId,
    userId,
    active: Boolean(row) && row?.orgId === orgId && (row.uid === userId || row.userId === userId) && row.status === 'active',
    role: typeof row?.role === 'string' ? row.role : undefined,
  }
}

export async function createDevice(input: {
  deviceId: string
  actorUserId: string
  runtimeTargetId: string
  publicKeyFingerprint: string
  label: string
  platform: LinkedDevicePlatform
  architecture: LinkedDeviceArchitecture
  runtimeVersion: string
  capabilities: LinkedDeviceCapability[]
}, options: StoreOptions = {}): Promise<void> {
  const db = options.db ?? (adminDb as unknown as DbLike)
  const deviceId = required(input.deviceId, 'deviceId')
  const ownerUserId = required(input.actorUserId, 'actorUserId')
  const at = timestamp(options)
  await db.runTransaction(async (tx) => {
    const deviceRef = db.collection(DEVICES).doc(deviceId)
    if ((await tx.get(deviceRef)).exists) throw new Error('linked computers: device already exists')
    tx.create(deviceRef, {
      deviceId,
      ownerUserId,
      runtimeTargetId: required(input.runtimeTargetId, 'runtimeTargetId'),
      publicKeyFingerprint: required(input.publicKeyFingerprint, 'publicKeyFingerprint'),
      label: required(input.label, 'label'),
      platform: input.platform,
      architecture: input.architecture,
      runtimeVersion: required(input.runtimeVersion, 'runtimeVersion'),
      capabilities: input.capabilities,
      status: 'active', credentialVersion: 1,
      createdAt: at, updatedAt: at, lastSeenAt: null,
    })
    tx.create(auditRef(db), {
      eventId: randomUUID(), action: 'device.paired', actorUserId: ownerUserId, deviceId, createdAt: at,
    })
  })
}

export async function createPairingChallenge(input: {
  challengeId: string
  actorUserId: string
  deviceId: string
  secret: string
}, options: StoreOptions = {}): Promise<{ challengeId: string; expiresAt: string }> {
  const db = options.db ?? (adminDb as unknown as DbLike)
  required(input.secret, 'pairing secret')
  const actorUserId = required(input.actorUserId, 'actorUserId')
  const deviceId = required(input.deviceId, 'deviceId')
  const expiresAt = new Date((options.nowMs?.() ?? Date.now()) + PAIRING_TTL_MS).toISOString()
  const at = timestamp(options)
  await db.runTransaction(async (tx) => {
    const deviceSnap = await tx.get(db.collection(DEVICES).doc(deviceId))
    if (!deviceSnap.exists) throw new Error('linked computers: device not found')
    const device = deviceSnap.data() as unknown as LinkedDevice
    if (device.ownerUserId !== actorUserId) throw new Error('linked computers: device owner required')
    const ref = db.collection(CHALLENGES).doc(required(input.challengeId, 'challengeId'))
    if ((await tx.get(ref)).exists) throw new Error('linked computers: pairing challenge already exists')
    tx.create(ref, {
      challengeId: input.challengeId, deviceId, ownerUserId: device.ownerUserId,
      secretHash: hashSecret(input.secret), expiresAt, attempts: 0,
      maxAttempts: PAIRING_MAX_ATTEMPTS, createdAt: at,
    })
    tx.create(auditRef(db), {
      eventId: randomUUID(), action: 'pairing.created', actorUserId, challengeId: input.challengeId, deviceId, createdAt: at,
    })
  })
  return { challengeId: input.challengeId, expiresAt }
}

export async function consumePairingChallenge(input: {
  challengeId: string
  secret: string
}, options: StoreOptions = {}): Promise<void> {
  const db = options.db ?? (adminDb as unknown as DbLike)
  const result = await db.runTransaction(async (tx): Promise<'consumed' | 'invalid-secret'> => {
    const ref = db.collection(CHALLENGES).doc(input.challengeId)
    const snapshot = await tx.get(ref)
    if (!snapshot.exists) throw new Error('linked computers: pairing challenge not found')
    const row = snapshot.data() ?? {}
    const deviceId = required(String(row.deviceId ?? ''), 'persisted deviceId')
    const deviceSnap = await tx.get(db.collection(DEVICES).doc(deviceId))
    if (!deviceSnap.exists) throw new Error('linked computers: paired device not found')
    const device = deviceSnap.data() as unknown as LinkedDevice
    if (row.ownerUserId !== device.ownerUserId) throw new Error('linked computers: persisted pairing owner mismatch')
    if (row.consumedAt) throw new Error('linked computers: pairing challenge already consumed')
    if ((options.nowMs?.() ?? Date.now()) >= Date.parse(String(row.expiresAt))) throw new Error('linked computers: pairing challenge expired')
    if (Number(row.attempts ?? 0) >= Number(row.maxAttempts ?? 5)) throw new Error('linked computers: pairing attempts exhausted')
    if (!secretsMatch(input.secret, String(row.secretHash))) {
      tx.update(ref, { attempts: Number(row.attempts ?? 0) + 1 })
      return 'invalid-secret'
    }
    const at = timestamp(options)
    tx.update(ref, { consumedAt: at })
    tx.create(auditRef(db), {
      eventId: randomUUID(), action: 'pairing.consumed', actorUserId: device.ownerUserId,
      challengeId: input.challengeId, deviceId, createdAt: at,
    })
    return 'consumed'
  })
  if (result === 'invalid-secret') throw new Error('linked computers: invalid pairing secret')
}

const TRANSITIONS: Record<LinkedDeviceStatus, LinkedDeviceStatus[]> = {
  active: ['paused', 'revoked'], paused: ['active', 'revoked'], revoked: ['removed'], removed: [],
}
const GRANT_TRANSITIONS: Record<DeviceGrantStatus, DeviceGrantStatus[]> = {
  active: ['paused', 'revoked'], paused: ['active', 'revoked'], revoked: [],
}
const MAPPING_TRANSITIONS: Record<WorkspaceMappingStatus, WorkspaceMappingStatus[]> = {
  active: ['stale', 'missing', 'paused', 'removed'],
  stale: ['active', 'missing', 'paused', 'removed'],
  missing: ['active', 'stale', 'paused', 'removed'],
  paused: ['active', 'stale', 'missing', 'removed'],
  removed: [],
}

export async function transitionDeviceStatus(input: {
  deviceId: string
  actorUserId: string
  status: LinkedDeviceStatus
}, options: StoreOptions = {}): Promise<void> {
  const db = options.db ?? (adminDb as unknown as DbLike)
  await db.runTransaction(async (tx) => {
    const ref = db.collection(DEVICES).doc(input.deviceId)
    const snapshot = await tx.get(ref)
    if (!snapshot.exists) throw new Error('linked computers: device not found')
    const device = snapshot.data() as unknown as LinkedDevice
    if (device.ownerUserId !== input.actorUserId) throw new Error('linked computers: device owner required')
    if (!TRANSITIONS[device.status].includes(input.status)) throw new Error('linked computers: invalid status transition')
    const at = timestamp(options)
    const statusAt = input.status === 'paused' ? { pausedAt: at }
      : input.status === 'revoked' ? { revokedAt: at }
        : input.status === 'removed' ? { removedAt: at } : {}
    tx.update(ref, { status: input.status, updatedAt: at, ...statusAt })
    tx.create(auditRef(db), {
      eventId: randomUUID(), action: 'device.status_changed', actorUserId: input.actorUserId,
      deviceId: input.deviceId, fromStatus: device.status, toStatus: input.status, createdAt: at,
    })
  })
}

export async function rotateDeviceCredential(input: {
  deviceId: string
  actorUserId: string
}, options: StoreOptions = {}): Promise<{ deviceId: string; credential: string; credentialVersion: number; overlapExpiresAt: string }> {
  const db = options.db ?? (adminDb as unknown as DbLike)
  const credential = randomBytes(32).toString('base64url')
  const overlapExpiresAt = new Date((options.nowMs?.() ?? Date.now()) + CREDENTIAL_ROTATION_OVERLAP_MS).toISOString()
  return db.runTransaction(async (tx) => {
    const deviceRef = db.collection(DEVICES).doc(input.deviceId)
    const credentialRef = db.collection('linked_device_credentials').doc(input.deviceId)
    const [deviceSnap, credentialSnap] = await Promise.all([tx.get(deviceRef), tx.get(credentialRef)])
    if (!deviceSnap.exists || !credentialSnap.exists) throw new Error('linked computers: device credential not found')
    const device = deviceSnap.data() as unknown as LinkedDevice
    const old = credentialSnap.data() ?? {}
    if (device.ownerUserId !== input.actorUserId) throw new Error('linked computers: device owner required')
    if (device.status === 'revoked' || device.status === 'removed') throw new Error('linked computers: active or paused device required')
    if (old.revokedAt) throw new Error('linked computers: device credential revoked')
    const credentialVersion = Number(device.credentialVersion) + 1
    const at = timestamp(options)
    tx.update(deviceRef, { credentialVersion, updatedAt: at })
    tx.update(credentialRef, {
      credentialHash: hashSecret(credential), credentialVersion, issuedAt: at, revokedAt: null,
      previousCredentialHash: old.credentialHash, previousCredentialVersion: old.credentialVersion,
      previousCredentialExpiresAt: overlapExpiresAt,
    })
    tx.create(auditRef(db), { eventId: randomUUID(), action: 'credential.rotated', actorUserId: input.actorUserId, deviceId: input.deviceId, createdAt: at })
    return { deviceId: input.deviceId, credential, credentialVersion, overlapExpiresAt }
  })
}

export async function revokeDeviceCredential(input: {
  deviceId: string
  actorUserId: string
}, options: StoreOptions = {}): Promise<void> {
  const db = options.db ?? (adminDb as unknown as DbLike)
  await db.runTransaction(async (tx) => {
    const deviceRef = db.collection(DEVICES).doc(input.deviceId)
    const credentialRef = db.collection('linked_device_credentials').doc(input.deviceId)
    const [deviceSnap, credentialSnap] = await Promise.all([tx.get(deviceRef), tx.get(credentialRef)])
    if (!deviceSnap.exists || !credentialSnap.exists) throw new Error('linked computers: device credential not found')
    const device = deviceSnap.data() as unknown as LinkedDevice
    if (device.ownerUserId !== input.actorUserId) throw new Error('linked computers: device owner required')
    const at = timestamp(options)
    tx.update(credentialRef, { revokedAt: at, previousCredentialHash: null, previousCredentialVersion: null, previousCredentialExpiresAt: null })
    tx.create(auditRef(db), { eventId: randomUUID(), action: 'credential.revoked', actorUserId: input.actorUserId, deviceId: input.deviceId, createdAt: at })
  })
}

export async function removeOwnedDevice(input: { deviceId: string; actorUserId: string }, options: StoreOptions = {}): Promise<void> {
  const db = (options.db ?? adminDb) as any
  await db.runTransaction(async (tx: any) => {
    const deviceRef = db.collection(DEVICES).doc(input.deviceId)
    const credentialRef = db.collection('linked_device_credentials').doc(input.deviceId)
    const [deviceSnap, credentialSnap, mappings, grants] = await Promise.all([
      tx.get(deviceRef), tx.get(credentialRef),
      tx.get(db.collection(MAPPINGS).where('deviceId', '==', input.deviceId)),
      tx.get(db.collection(GRANTS).where('deviceId', '==', input.deviceId)),
    ])
    if (!deviceSnap.exists) throw new Error('linked computers: device not found')
    const device = deviceSnap.data() as LinkedDevice
    if (device.ownerUserId !== input.actorUserId) throw new Error('linked computers: device owner required')
    if (device.status === 'removed') throw new Error('linked computers: invalid status transition')
    const at = timestamp(options)
    tx.update(deviceRef, { status: 'removed', removedAt: at, revokedAt: device.revokedAt ?? at, updatedAt: at })
    if (credentialSnap.exists) tx.update(credentialRef, { revokedAt: at, previousCredentialHash: null, previousCredentialVersion: null, previousCredentialExpiresAt: null })
    for (const doc of mappings.docs) if (doc.data().status !== 'removed') tx.update(doc.ref, { status: 'removed', removedAt: at, updatedAt: at })
    for (const doc of grants.docs) if (doc.data().status !== 'revoked') tx.update(doc.ref, { status: 'revoked', revokedAt: at, updatedAt: at })
    tx.create(auditRef(db), { eventId: randomUUID(), action: 'device.status_changed', actorUserId: input.actorUserId, deviceId: input.deviceId, fromStatus: device.status, toStatus: 'removed', createdAt: at })
  })
}

export async function putDeviceGrant(input: {
  deviceId: string
  orgId: string
  actorUserId: string
  status: DeviceGrantStatus
  capabilities: LinkedDeviceCapability[]
  allowedUserIds?: string[]
}, options: StoreOptions = {}): Promise<void> {
  const db = options.db ?? (adminDb as unknown as DbLike)
  await db.runTransaction(async (tx) => {
    const deviceSnap = await tx.get(db.collection(DEVICES).doc(input.deviceId))
    if (!deviceSnap.exists) throw new Error('linked computers: device not found')
    const device = deviceSnap.data() as unknown as LinkedDevice
    const [actorSnap, ownerSnap] = await Promise.all([
      tx.get(db.collection(MEMBERS).doc(`${input.orgId}_${input.actorUserId}`)),
      tx.get(db.collection(MEMBERS).doc(`${input.orgId}_${device.ownerUserId}`)),
    ])
    assertGrantAdministrator(membershipFrom(actorSnap.data(), input.orgId, input.actorUserId), input.orgId, input.actorUserId)
    if (!membershipFrom(ownerSnap.data(), input.orgId, device.ownerUserId).active) throw new Error('linked computers: owner membership required')
    const ref = db.collection(GRANTS).doc(`${input.orgId}_${input.deviceId}`)
    const existing = await tx.get(ref)
    const fromStatus = existing.exists ? existing.data()?.status as DeviceGrantStatus : undefined
    if (fromStatus ? !GRANT_TRANSITIONS[fromStatus]?.includes(input.status) : input.status !== 'active') {
      throw new Error('linked computers: invalid grant status transition')
    }
    const at = timestamp(options)
    const statusAt = input.status === 'paused' ? { pausedAt: at } : input.status === 'revoked' ? { revokedAt: at } : {}
    tx.set(ref, {
      deviceId: input.deviceId, orgId: input.orgId, grantedByUserId: input.actorUserId,
      allowedUserIds: input.allowedUserIds ?? [], capabilities: input.capabilities, status: input.status,
      ...(!existing.exists ? { createdAt: at } : {}), updatedAt: at, ...statusAt,
    }, { merge: true })
    tx.create(auditRef(db), {
      eventId: randomUUID(), action: 'grant.changed', actorUserId: input.actorUserId,
      deviceId: input.deviceId, orgId: input.orgId, fromStatus: fromStatus ?? null, toStatus: input.status, createdAt: at,
    })
  })
}

export async function putWorkspaceMapping(input: {
  mappingId: string
  deviceId: string
  orgId: string
  workspaceId: string
  actorUserId: string
  label: string
  status: WorkspaceMappingStatus
}, options: StoreOptions = {}): Promise<void> {
  const db = options.db ?? (adminDb as unknown as DbLike)
  await db.runTransaction(async (tx) => {
    const [deviceSnap, grantSnap, memberSnap, workspaceSnap] = await Promise.all([
      tx.get(db.collection(DEVICES).doc(input.deviceId)),
      tx.get(db.collection(GRANTS).doc(`${input.orgId}_${input.deviceId}`)),
      tx.get(db.collection(MEMBERS).doc(`${input.orgId}_${input.actorUserId}`)),
      tx.get(db.collection(WORKSPACES).doc(input.workspaceId)),
    ])
    if (!deviceSnap.exists || !grantSnap.exists) throw new Error('linked computers: device grant not found')
    const workspace = workspaceSnap.data() ?? {}
    if (!workspaceSnap.exists || workspace.orgId !== input.orgId || workspace.status !== 'active') {
      throw new Error('linked computers: active canonical Workspace required for tenant')
    }
    const device = deviceSnap.data() as unknown as LinkedDevice
    const grant = grantSnap.data() as unknown as LinkedDeviceGrant
    assertDeviceOrgAccess({
      actorUserId: input.actorUserId, orgId: input.orgId, device, grant,
      membership: membershipFrom(memberSnap.data(), input.orgId, input.actorUserId),
    })
    const ref = db.collection(MAPPINGS).doc(required(input.mappingId, 'mappingId'))
    const existing = await tx.get(ref)
    if (existing.exists) {
      const old = existing.data() ?? {}
      if (old.deviceId !== input.deviceId || old.orgId !== input.orgId) throw new Error('linked computers: mapping tenant scope mismatch')
    }
    const fromStatus = existing.exists ? existing.data()?.status as WorkspaceMappingStatus : undefined
    if (fromStatus ? !MAPPING_TRANSITIONS[fromStatus]?.includes(input.status) : input.status !== 'active') {
      throw new Error('linked computers: invalid mapping status transition')
    }
    const at = timestamp(options)
    const statusAt = input.status === 'stale' ? { staleAt: at } : input.status === 'removed' ? { removedAt: at } : {}
    tx.set(ref, {
      mappingId: input.mappingId, deviceId: input.deviceId, orgId: input.orgId,
      workspaceId: required(input.workspaceId, 'workspaceId'), label: required(input.label, 'label'), status: input.status,
      ...(!existing.exists ? { createdAt: at } : {}), updatedAt: at, ...statusAt,
    }, { merge: true })
    tx.create(auditRef(db), {
      eventId: randomUUID(), action: 'mapping.changed', actorUserId: input.actorUserId,
      deviceId: input.deviceId, orgId: input.orgId, mappingId: input.mappingId,
      fromStatus: fromStatus ?? null, toStatus: input.status, createdAt: at,
    })
  })
}
