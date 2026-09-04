import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { assertDeviceManager, assertDeviceOrgAccess, assertGrantAdministrator, effectiveGrantAccessMode, isActiveOrgMembershipRow, linkedDeviceActorUserId, linkedDeviceOwnerType } from './policy'
import type {
  ActiveOrgMembership,
  DeviceBrowserIdentity,
  DeviceGrantAccessMode,
  DeviceGrantStatus,
  LinkedDevice,
  LinkedDeviceArchitecture,
  LinkedDeviceCapability,
  LinkedDeviceGrant,
  LinkedDeviceHealthReason,
  LinkedDeviceKind,
  LinkedDeviceOwnerType,
  LinkedDevicePlatform,
  LinkedComputerAuditEvent,
  LinkedDeviceStatus,
  LinkedAvailableProfile,
  WorkspaceMappingStatus,
} from './types'
import { decryptLinkedSecret, encryptLinkedSecret } from './secret-envelope'
import { cancelLinkedRun } from './run-queue-store'
import { AGENT_ID_RE } from '@/lib/agents/types'

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
const ROTATION_DELIVERIES = 'linked_device_rotation_deliveries'
const LINKED_DEVICE_HEALTH_REASONS = new Set<LinkedDeviceHealthReason>([
  'hermes_unavailable',
  'hermes_binary_missing',
  'no_agents_available',
  'hermes_update_failed',
])

function asLinkedDeviceHealthReason(value: unknown): LinkedDeviceHealthReason | null {
  return typeof value === 'string' && LINKED_DEVICE_HEALTH_REASONS.has(value as LinkedDeviceHealthReason)
    ? value as LinkedDeviceHealthReason
    : null
}

interface RefLike { id: string; path?: string }
interface SnapshotLike { exists: boolean; data(): Record<string, unknown> | undefined }
interface CleanupDocLike extends RefLike { get(): Promise<SnapshotLike>; set(value: Record<string, unknown>, options?: { merge?: boolean }): Promise<unknown> }
interface CleanupQuerySnapshotLike { docs: Array<{ id: string; ref: CleanupDocLike; data(): Record<string, unknown> }> }
interface CleanupQueryLike { where(field: string, op: string, value: unknown): CleanupQueryLike; limit(value: number): CleanupQueryLike; get(): Promise<CleanupQuerySnapshotLike> }
interface CleanupCollectionLike extends CleanupQueryLike { doc(id: string): CleanupDocLike }
interface CleanupTransactionLike { get(ref: RefLike): Promise<SnapshotLike>; create(ref: RefLike, value: Record<string, unknown>): void; set(ref: RefLike, value: Record<string, unknown>, options?: { merge?: boolean }): void; update(ref: RefLike, value: Record<string, unknown>): void }
interface CleanupBatchLike { set(ref: RefLike, value: Record<string, unknown>, options?: { merge?: boolean }): void; commit(): Promise<unknown> }
interface CleanupDbLike { collection(name: string): CleanupCollectionLike; runTransaction<T>(fn: (tx: CleanupTransactionLike) => Promise<T>): Promise<T>; batch(): CleanupBatchLike }
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
interface ReadDocumentLike {
  id: string
  data(): Record<string, unknown>
}
interface ReadQuerySnapshotLike { docs: ReadDocumentLike[] }
interface ReadQueryLike {
  where(field: string, op: string, value: unknown): ReadQueryLike
  get(): Promise<ReadQuerySnapshotLike>
}
interface ReadDbLike { collection(name: string): ReadQueryLike }
interface StoreOptions { db?: DbLike; now?: () => unknown; nowMs?: () => number }

export interface SafeLinkedDeviceDto {
  deviceId: string; label: string; platform: LinkedDevicePlatform; architecture: LinkedDeviceArchitecture
  deviceKind: LinkedDeviceKind; ownerType: LinkedDeviceOwnerType
  runtimeVersion: string; capabilities: LinkedDeviceCapability[]; status: LinkedDeviceStatus
  availableAgentIds: string[]; hermesVersion: string | null; healthReason: LinkedDeviceHealthReason | null
  desiredAgents: Array<{
    agentId: string
    keepInSync: boolean
    desiredPolicyVersion: string | null
    appliedPolicyVersion: string | null
    status: string
    lastError: string | null
  }>
  credentialVersion: number; createdAt: unknown; updatedAt: unknown; lastSeenAt: unknown | null
  health: 'ok' | 'degraded' | null
  grants: Array<{
    orgId: string
    status: DeviceGrantStatus
    accessMode: DeviceGrantAccessMode
    browserIdentity?: { useRealProfile: boolean; realProfilePin: string | null; headed: boolean; autoclose: boolean }
  }>
  mappings: Array<{ mappingId: string; orgId: string; workspaceId: string; label: string; status: WorkspaceMappingStatus }>
}

export function toSafeLinkedDeviceDto(row: LinkedDevice): SafeLinkedDeviceDto {
  const { deviceId, label, platform, architecture, runtimeVersion, capabilities, status, credentialVersion, createdAt, updatedAt, lastSeenAt } = row
  const health = (row as LinkedDevice & { health?: unknown }).health
  const availableAgentIds = Array.isArray(row.availableAgentIds)
    ? row.availableAgentIds.filter((agentId): agentId is string => typeof agentId === 'string')
    : []
  const healthReason = asLinkedDeviceHealthReason(row.healthReason)
  const desiredAgents = Array.isArray((row as LinkedDevice & { desiredAgents?: unknown }).desiredAgents)
    ? ((row as LinkedDevice & { desiredAgents: unknown[] }).desiredAgents).flatMap((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
        const binding = entry as Record<string, unknown>
        if (typeof binding.agentId !== 'string') return []
        return [{
          agentId: binding.agentId,
          keepInSync: binding.keepInSync === true,
          desiredPolicyVersion: typeof binding.desiredPolicyVersion === 'string' ? binding.desiredPolicyVersion : null,
          appliedPolicyVersion: typeof binding.appliedPolicyVersion === 'string' ? binding.appliedPolicyVersion : null,
          status: typeof binding.status === 'string' ? binding.status : 'desired',
          lastError: typeof binding.lastError === 'string' ? binding.lastError : null,
        }]
      })
    : []
  return { deviceId, label, platform, architecture, deviceKind: row.deviceKind === 'vps' ? 'vps' : 'computer', ownerType: linkedDeviceOwnerType(row), runtimeVersion, availableAgentIds, hermesVersion: typeof row.hermesVersion === 'string' ? row.hermesVersion : null, healthReason, desiredAgents, capabilities, status, credentialVersion, createdAt, updatedAt, lastSeenAt,
    health: health === 'ok' || health === 'degraded' ? health : null, grants: [], mappings: [] }
}

export async function listOwnedDevices(actorUserId: string, options: StoreOptions = {}): Promise<SafeLinkedDeviceDto[]> {
  const db = (options.db ?? adminDb) as unknown as ReadDbLike
  const userId = required(actorUserId, 'actorUserId')
  const [owned, uidMemberships, userIdMemberships] = await Promise.all([
    db.collection(DEVICES).where('ownerUserId', '==', userId).get(),
    db.collection(MEMBERS).where('uid', '==', userId).get(),
    db.collection(MEMBERS).where('userId', '==', userId).get(),
  ])
  const manageableOrgIds = [...uidMemberships.docs, ...userIdMemberships.docs]
    .map((doc) => doc.data())
    .filter((row) => isActiveOrgMembershipRow(row) && (row.role === 'owner' || row.role === 'admin') && typeof row.orgId === 'string')
    .map((row) => row.orgId as string)
  const organizationSnapshots = await Promise.all([...new Set(manageableOrgIds)].map((orgId) => db.collection(DEVICES).where('ownerOrgId', '==', orgId).get()))
  const docs = [...owned.docs, ...organizationSnapshots.flatMap((snapshot) => snapshot.docs)]
    .filter((doc, index, all) => all.findIndex((candidate) => candidate.id === doc.id) === index)
  return Promise.all(docs.map(async (doc) => {
    const dto = toSafeLinkedDeviceDto(doc.data() as unknown as LinkedDevice)
    const [grants, mappings] = await Promise.all([
      db.collection(GRANTS).where('deviceId', '==', dto.deviceId).get(),
      db.collection(MAPPINGS).where('deviceId', '==', dto.deviceId).get(),
    ])
    dto.grants = grants.docs.map((grant) => {
      const row = grant.data()
      const identity = row.browserIdentity && typeof row.browserIdentity === 'object' && !Array.isArray(row.browserIdentity)
        ? row.browserIdentity as Record<string, unknown>
        : null
      return {
        orgId: String(row.orgId),
        status: row.status as DeviceGrantStatus,
        accessMode: effectiveGrantAccessMode({
          accessMode: typeof row.accessMode === 'string' ? row.accessMode as DeviceGrantAccessMode : undefined,
          allowedUserIds: Array.isArray(row.allowedUserIds) ? row.allowedUserIds : [],
        }),
        ...(identity ? {
          browserIdentity: {
            useRealProfile: identity.useRealProfile === true,
            realProfilePin: typeof identity.realProfilePin === 'string' ? identity.realProfilePin : null,
            headed: identity.headed === true,
            autoclose: identity.autoclose === true,
          },
        } : {}),
      }
    })
    dto.mappings = mappings.docs.map((mapping) => { const row = mapping.data(); return { mappingId: String(row.mappingId), orgId: String(row.orgId), workspaceId: String(row.workspaceId), label: String(row.label), status: row.status as WorkspaceMappingStatus } })
    return dto
  }))
}

export async function updateOwnedDevice(input: { deviceId: string; actorUserId: string; label?: string; status?: LinkedDeviceStatus }, options: StoreOptions = {}): Promise<void> {
  if (input.status) return transitionDeviceStatus({ deviceId: input.deviceId, actorUserId: input.actorUserId, status: input.status }, options)
  const db = options.db ?? (adminDb as unknown as DbLike)
  await db.runTransaction(async (tx) => {
    const ref = db.collection(DEVICES).doc(input.deviceId)
    const snap = await tx.get(ref)
    if (!snap.exists) throw new Error('linked computers: device not found')
    const device = snap.data() as unknown as LinkedDevice
    await assertStoreDeviceManager(tx, db, device, input.actorUserId)
    tx.update(ref, { label: required(input.label ?? '', 'label'), updatedAt: timestamp(options) })
  })
}

export async function recordDeviceHeartbeat(input: { deviceId: string; runtimeVersion: string; capabilities: LinkedDeviceCapability[]; health: 'ok' | 'degraded'; syncProtocolVersion?: 1 | null; availableAgentIds?: string[]; availableProfiles?: LinkedAvailableProfile[]; hermesVersion?: string | null; healthReason?: LinkedDeviceHealthReason | null }, options: StoreOptions = {}): Promise<{ ignoredProfiles: string[] }> {
  const db = options.db ?? (adminDb as unknown as DbLike)
  return db.runTransaction(async (tx) => {
    const ref = db.collection(DEVICES).doc(input.deviceId)
    const snap = await tx.get(ref)
    if (!snap.exists) throw new Error('linked computers: device not found')
    const device = snap.data() as unknown as LinkedDevice
    if (device.status !== 'active') throw new Error('linked computers: active device required')
    const at = timestamp(options)
    const ignoredProfiles: string[] = []
    const inventory = input.availableProfiles
      ? await filterAvailableProfilesByActiveGrants(tx, db, input.deviceId, input.availableProfiles, ignoredProfiles)
      : null
    tx.update(ref, {
      runtimeVersion: required(input.runtimeVersion, 'runtimeVersion'),
      availableAgentIds: input.availableAgentIds ?? [],
      hermesVersion: input.hermesVersion ?? null,
      healthReason: input.healthReason ?? null,
      capabilities: input.capabilities,
      syncProtocolVersion: input.syncProtocolVersion === 1 ? 1 : null,
      health: input.health,
      lastSeenAt: at,
      updatedAt: at,
      ...(inventory ? {
        availableAgents: inventory.availableAgents,
        profileSkillsDigests: inventory.profileSkillsDigests,
      } : {}),
    })
    return { ignoredProfiles }
  })
}

async function filterAvailableProfilesByActiveGrants(
  tx: TransactionLike,
  db: DbLike,
  deviceId: string,
  profiles: LinkedAvailableProfile[],
  ignoredProfiles: string[],
): Promise<{
  availableAgents: Array<{ orgId: string; agentId: string; profile: string; healthy: boolean }>
  profileSkillsDigests: Record<string, string | null>
}> {
  const orgIds = [...new Set(profiles
    .map((entry) => entry.orgId)
    .filter((orgId): orgId is string => typeof orgId === 'string' && orgId.length > 0))]
  const activeOrgIds = new Set<string>()
  await Promise.all(orgIds.map(async (orgId) => {
    const grantSnap = await tx.get(db.collection(GRANTS).doc(`${orgId}_${deviceId}`))
    const grant = grantSnap.exists ? grantSnap.data() as LinkedDeviceGrant | undefined : undefined
    if (grant?.status === 'active') activeOrgIds.add(orgId)
  }))
  const availableAgents: Array<{ orgId: string; agentId: string; profile: string; healthy: boolean }> = []
  const profileSkillsDigests: Record<string, string | null> = {}
  const seenProfiles = new Set<string>()
  for (const entry of profiles) {
    profileSkillsDigests[entry.profile] = entry.skillsDigest
    if (seenProfiles.has(entry.profile)) continue
    seenProfiles.add(entry.profile)
    if (!entry.orgId) continue
    if (!activeOrgIds.has(entry.orgId)) {
      ignoredProfiles.push(entry.profile)
      continue
    }
    availableAgents.push({
      orgId: entry.orgId,
      agentId: entry.agentId,
      profile: entry.profile,
      healthy: entry.healthy,
    })
  }
  return { availableAgents, profileSkillsDigests }
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

function auditRef(db: { collection(name: string): { doc(id: string): RefLike } }): RefLike {
  return db.collection(AUDIT).doc(randomUUID())
}

function membershipFrom(row: Record<string, unknown> | undefined, orgId: string, userId: string): ActiveOrgMembership {
  return {
    orgId,
    userId,
    active: isActiveOrgMembershipRow(row) && row?.orgId === orgId && (row.uid === userId || row.userId === userId),
    role: typeof row?.role === 'string' ? row.role : undefined,
    teamIds: Array.isArray(row?.teamIds) ? row.teamIds.filter((value): value is string => typeof value === 'string') : [],
  }
}

export function writeLinkedComputerAudit(
  tx: { create(ref: { id: string; path?: string }, value: Record<string, unknown>): void },
  db: { collection(name: string): { doc(id: string): { id: string; path?: string } } },
  event: Omit<LinkedComputerAuditEvent, 'eventId' | 'createdAt'>,
  at: unknown,
): void {
  tx.create(auditRef(db), {
    eventId: randomUUID(),
    action: event.action,
    actorUserId: event.actorUserId,
    deviceId: event.deviceId,
    orgId: event.orgId,
    mappingId: event.mappingId,
    challengeId: event.challengeId,
    fromStatus: event.fromStatus ?? null,
    toStatus: event.toStatus,
    createdAt: at,
  })
}

async function assertStoreDeviceManager(tx: TransactionLike, db: DbLike, device: LinkedDevice, actorUserId: string): Promise<void> {
  if (linkedDeviceOwnerType(device) === 'user') {
    assertDeviceManager({ actorUserId, device })
    return
  }
  const ownerOrgId = String(device.ownerOrgId)
  const membershipSnap = await tx.get(db.collection(MEMBERS).doc(`${ownerOrgId}_${actorUserId}`))
  assertDeviceManager({ actorUserId, device, ownerOrgMembership: membershipFrom(membershipSnap.data(), ownerOrgId, actorUserId) })
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
      ownerType: 'user',
      ownerUserId,
      createdByUserId: ownerUserId,
      runtimeTargetId: required(input.runtimeTargetId, 'runtimeTargetId'),
      publicKeyFingerprint: required(input.publicKeyFingerprint, 'publicKeyFingerprint'),
      label: required(input.label, 'label'),
      platform: input.platform,
      architecture: input.architecture,
      runtimeVersion: required(input.runtimeVersion, 'runtimeVersion'),
      releaseChannel: 'stable',
      capabilities: input.capabilities,
      status: 'active', credentialVersion: 1,
      createdAt: at, updatedAt: at, lastSeenAt: null,
    })
    tx.create(auditRef(db), {
      eventId: randomUUID(), action: 'device.paired', actorUserId: ownerUserId, deviceId, createdAt: at,
    })
  })
}

function parsePairingAgentIds(value: unknown): string[] {
  if (value == null) return []
  if (!Array.isArray(value)) throw new Error('linked computers: invalid agentIds')
  if (value.length > 6) throw new Error('linked computers: too many agentIds')
  const ids: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !AGENT_ID_RE.test(item.trim())) {
      throw new Error('linked computers: invalid agentIds')
    }
    const id = item.trim()
    if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

export async function createPairingChallenge(input: {
  challengeId: string
  actorUserId: string
  deviceId: string
  secret: string
  orgId?: string
  agentIds?: string[]
}, options: StoreOptions = {}): Promise<{ challengeId: string; expiresAt: string }> {
  const db = options.db ?? (adminDb as unknown as DbLike)
  required(input.secret, 'pairing secret')
  const actorUserId = required(input.actorUserId, 'actorUserId')
  const deviceId = required(input.deviceId, 'deviceId')
  const orgId = typeof input.orgId === 'string' ? input.orgId.trim() : ''
  const agentIds = parsePairingAgentIds(input.agentIds)
  const expiresAt = new Date((options.nowMs?.() ?? Date.now()) + PAIRING_TTL_MS).toISOString()
  const at = timestamp(options)
  await db.runTransaction(async (tx) => {
    const deviceSnap = await tx.get(db.collection(DEVICES).doc(deviceId))
    if (!deviceSnap.exists) throw new Error('linked computers: device not found')
    const device = deviceSnap.data() as unknown as LinkedDevice
    await assertStoreDeviceManager(tx, db, device, actorUserId)
    const deviceActorUserId = required(linkedDeviceActorUserId(device), 'device creator')
    const ref = db.collection(CHALLENGES).doc(required(input.challengeId, 'challengeId'))
    if ((await tx.get(ref)).exists) throw new Error('linked computers: pairing challenge already exists')
    tx.create(ref, {
      challengeId: input.challengeId, deviceId, ownerUserId: deviceActorUserId,
      ...(orgId ? { orgId } : {}),
      ...(agentIds.length ? { agentIds } : {}),
      secretHash: hashSecret(input.secret), expiresAt, cleanupAt: Timestamp.fromMillis(Date.parse(expiresAt)), attempts: 0,
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
    const deviceActorUserId = required(linkedDeviceActorUserId(device), 'device creator')
    if (row.ownerUserId !== deviceActorUserId) throw new Error('linked computers: persisted pairing owner mismatch')
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
      eventId: randomUUID(), action: 'pairing.consumed', actorUserId: deviceActorUserId,
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
  // Active-to-active is an intentional metadata update (for example changing
  // Only me to Everyone in organisation). Revoked remains terminal.
  active: ['active', 'paused', 'revoked'], paused: ['active', 'revoked'], revoked: [],
}
const MAPPING_TRANSITIONS: Record<WorkspaceMappingStatus, WorkspaceMappingStatus[]> = {
  pending: ['active','paused','removed'],
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
    const credentialRef = db.collection('linked_device_credentials').doc(input.deviceId)
    const deliveryRef = db.collection(ROTATION_DELIVERIES).doc(input.deviceId)
    const [snapshot, credentialSnap, deliverySnap] = await Promise.all([tx.get(ref), tx.get(credentialRef), tx.get(deliveryRef)])
    if (!snapshot.exists) throw new Error('linked computers: device not found')
    const device = snapshot.data() as unknown as LinkedDevice
    await assertStoreDeviceManager(tx, db, device, input.actorUserId)
    if (!TRANSITIONS[device.status].includes(input.status)) throw new Error('linked computers: invalid status transition')
    const at = timestamp(options)
    const statusAt = input.status === 'paused' ? { pausedAt: at }
      : input.status === 'revoked' ? { revokedAt: at }
        : input.status === 'removed' ? { removedAt: at } : {}
    tx.update(ref, { status: input.status, updatedAt: at, ...statusAt })
    if (input.status === 'revoked' || input.status === 'removed') {
      if (credentialSnap.exists) tx.update(credentialRef, { revokedAt: at, previousCredentialHash: null, previousCredentialVersion: null, previousCredentialExpiresAt: null })
      if (deliverySnap.exists) tx.update(deliveryRef, { encryptedCredential: null, terminalState: input.status, terminalAt: at, cleanupAt: Timestamp.fromMillis((options.nowMs?.() ?? Date.now()) + CREDENTIAL_ROTATION_OVERLAP_MS) })
      tx.set(db.collection('linked_device_cleanup_runs').doc(input.deviceId), { deviceId: input.deviceId, status: 'pending', phase: 'mappings', processed: 0, createdAt: at, updatedAt: at }, { merge: true })
    }
    tx.create(auditRef(db), {
      eventId: randomUUID(), action: 'device.status_changed', actorUserId: input.actorUserId,
      deviceId: input.deviceId, fromStatus: device.status, toStatus: input.status, createdAt: at,
    })
  })
}

export async function rotateDeviceCredential(input: {
  deviceId: string
  actorUserId: string
}, options: StoreOptions = {}): Promise<{ deviceId: string; status: 'pending'; credentialVersion: number; overlapExpiresAt: string }> {
  const db = options.db ?? (adminDb as unknown as DbLike)
  const credential = randomBytes(32).toString('base64url')
  const rotationDeliveryId = randomUUID()
  const overlapExpiresAt = new Date((options.nowMs?.() ?? Date.now()) + CREDENTIAL_ROTATION_OVERLAP_MS).toISOString()
  return db.runTransaction(async (tx) => {
    const deviceRef = db.collection(DEVICES).doc(input.deviceId)
    const credentialRef = db.collection('linked_device_credentials').doc(input.deviceId)
    const deliveryRef = db.collection(ROTATION_DELIVERIES).doc(input.deviceId)
    const [deviceSnap, credentialSnap] = await Promise.all([tx.get(deviceRef), tx.get(credentialRef)])
    if (!deviceSnap.exists || !credentialSnap.exists) throw new Error('linked computers: device credential not found')
    const device = deviceSnap.data() as unknown as LinkedDevice
    const old = credentialSnap.data() ?? {}
    await assertStoreDeviceManager(tx, db, device, input.actorUserId)
    if (device.status !== 'active') throw new Error('linked computers: active device required')
    if (old.revokedAt) throw new Error('linked computers: device credential revoked')
    const credentialVersion = Number(device.credentialVersion) + 1
    const at = timestamp(options)
    tx.update(deviceRef, { credentialVersion, updatedAt: at })
    tx.update(credentialRef, {
      credentialHash: hashSecret(credential), credentialVersion, issuedAt: at, revokedAt: null,
      previousCredentialHash: old.credentialHash, previousCredentialVersion: old.credentialVersion,
      previousCredentialExpiresAt: overlapExpiresAt,
    })
    tx.set(deliveryRef, {
      deviceId: input.deviceId, rotationDeliveryId, credentialVersion, previousCredentialVersion: Number(old.credentialVersion),
      encryptedCredential: encryptLinkedSecret(credential, `${input.deviceId}:rotation-credential`),
      expiresAt: overlapExpiresAt, cleanupAt: Timestamp.fromMillis(Date.parse(overlapExpiresAt) + CREDENTIAL_ROTATION_OVERLAP_MS), createdAt: at, deliveredAt: null, deliveryAttempts: 0, acknowledgedAt: null, terminalState: null,
    })
    tx.create(auditRef(db), { eventId: randomUUID(), action: 'credential.rotated', actorUserId: input.actorUserId, deviceId: input.deviceId, createdAt: at })
    return { deviceId: input.deviceId, status: 'pending', credentialVersion, overlapExpiresAt }
  })
}

export async function claimPendingDeviceRotation(input: { deviceId: string; authenticatedCredentialVersion: number }, options: StoreOptions = {}): Promise<{ rotationDeliveryId: string; credential: string; credentialVersion: number } | null> {
  const db = options.db ?? (adminDb as unknown as DbLike)
  return db.runTransaction(async (tx) => {
    const ref = db.collection(ROTATION_DELIVERIES).doc(input.deviceId)
    const snap = await tx.get(ref)
    if (!snap.exists) return null
    const row = snap.data() ?? {}
    if (row.acknowledgedAt || Number(row.previousCredentialVersion) !== input.authenticatedCredentialVersion) return null
    if ((options.nowMs?.() ?? Date.now()) >= Date.parse(String(row.expiresAt))) {
      tx.update(ref, { encryptedCredential: null, expiredAt: timestamp(options), terminalState: 'expired' })
      return null
    }
    const credential = decryptLinkedSecret(row.encryptedCredential as never, `${input.deviceId}:rotation-credential`)
    tx.update(ref, { deliveredAt: timestamp(options), deliveryAttempts: Number(row.deliveryAttempts ?? 0) + 1 })
    return { rotationDeliveryId: String(row.rotationDeliveryId), credential, credentialVersion: Number(row.credentialVersion) }
  })
}

export async function acknowledgeDeviceRotation(input: { deviceId: string; authenticatedCredentialVersion: number; rotationDeliveryId: string }, options: StoreOptions = {}): Promise<{ acknowledged: true; credentialVersion: number }> {
  const db = options.db ?? (adminDb as unknown as DbLike)
  return db.runTransaction(async (tx) => {
    const deviceRef = db.collection(DEVICES).doc(input.deviceId)
    const ref = db.collection(ROTATION_DELIVERIES).doc(input.deviceId)
    const [deviceSnap, snap] = await Promise.all([tx.get(deviceRef), tx.get(ref)])
    if (!deviceSnap.exists || !snap.exists) throw new Error('linked computers: rotation delivery not found')
    const device = deviceSnap.data() ?? {}; const row = snap.data() ?? {}
    if (row.acknowledgedAt) {
      if (row.rotationDeliveryId !== input.rotationDeliveryId || Number(row.credentialVersion) !== input.authenticatedCredentialVersion) throw new Error('linked computers: rotation delivery mismatch')
      return { acknowledged: true, credentialVersion: Number(row.credentialVersion) }
    }
    if (device.status !== 'active') throw new Error('linked computers: active device required')
    if (row.expiredAt || row.terminalState || !row.encryptedCredential || (options.nowMs?.() ?? Date.now()) >= Date.parse(String(row.expiresAt))) throw new Error('linked computers: rotation delivery expired')
    if (Number(device.credentialVersion) !== input.authenticatedCredentialVersion || Number(row.credentialVersion) !== input.authenticatedCredentialVersion) throw new Error('linked computers: new credential required')
    if (row.rotationDeliveryId !== input.rotationDeliveryId) throw new Error('linked computers: rotation delivery mismatch')
    tx.update(ref, { acknowledgedAt: timestamp(options), encryptedCredential: null, terminalState: 'acknowledged' })
    return { acknowledged: true, credentialVersion: Number(row.credentialVersion) }
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
    const deliveryRef = db.collection(ROTATION_DELIVERIES).doc(input.deviceId)
    const [deviceSnap, credentialSnap, deliverySnap] = await Promise.all([tx.get(deviceRef), tx.get(credentialRef), tx.get(deliveryRef)])
    if (!deviceSnap.exists || !credentialSnap.exists) throw new Error('linked computers: device credential not found')
    const device = deviceSnap.data() as unknown as LinkedDevice
    await assertStoreDeviceManager(tx, db, device, input.actorUserId)
    const at = timestamp(options)
    tx.update(deviceRef, { status: 'revoked', revokedAt: at, updatedAt: at })
    tx.update(credentialRef, { revokedAt: at, previousCredentialHash: null, previousCredentialVersion: null, previousCredentialExpiresAt: null })
    if (deliverySnap.exists) tx.update(deliveryRef, { encryptedCredential: null, revokedAt: at, terminalState: 'revoked', cleanupAt: Timestamp.fromMillis((options.nowMs?.() ?? Date.now()) + CREDENTIAL_ROTATION_OVERLAP_MS) })
    tx.set(db.collection('linked_device_cleanup_runs').doc(input.deviceId), { deviceId: input.deviceId, status: 'pending', phase: 'mappings', processed: 0, createdAt: at, updatedAt: at }, { merge: true })
    tx.create(auditRef(db), { eventId: randomUUID(), action: 'credential.revoked', actorUserId: input.actorUserId, deviceId: input.deviceId, createdAt: at })
  })
}

export async function removeOwnedDevice(input: { deviceId: string; actorUserId: string }, options: StoreOptions = {}): Promise<void> {
  const db = (options.db ?? adminDb) as unknown as CleanupDbLike
  await db.runTransaction(async (tx) => {
    const deviceRef = db.collection(DEVICES).doc(input.deviceId)
    const credentialRef = db.collection('linked_device_credentials').doc(input.deviceId)
    const deliveryRef = db.collection(ROTATION_DELIVERIES).doc(input.deviceId)
    const cleanupRef = db.collection('linked_device_cleanup_runs').doc(input.deviceId)
    const [deviceSnap, credentialSnap, deliverySnap] = await Promise.all([
      tx.get(deviceRef), tx.get(credentialRef),
      tx.get(deliveryRef),
    ])
    if (!deviceSnap.exists) throw new Error('linked computers: device not found')
    const device = deviceSnap.data() as unknown as LinkedDevice
    await assertStoreDeviceManager(tx as unknown as TransactionLike, db as unknown as DbLike, device, input.actorUserId)
    if (device.status === 'removed') throw new Error('linked computers: invalid status transition')
    const at = timestamp(options)
    tx.update(deviceRef, { status: 'removed', removedAt: at, revokedAt: device.revokedAt ?? at, updatedAt: at })
    if (credentialSnap.exists) {
      tx.update(credentialRef, { revokedAt: at, previousCredentialHash: null, previousCredentialVersion: null, previousCredentialExpiresAt: null })
      tx.create(auditRef(db as unknown as DbLike), { eventId: randomUUID(), action: 'credential.revoked', actorUserId: input.actorUserId, deviceId: input.deviceId, createdAt: at })
    }
    if (deliverySnap.exists) tx.update(deliveryRef, { encryptedCredential: null, removedAt: at, terminalState: 'removed', cleanupAt: Timestamp.fromMillis((options.nowMs?.() ?? Date.now()) + CREDENTIAL_ROTATION_OVERLAP_MS) })
    tx.set(cleanupRef, { deviceId: input.deviceId, status: 'pending', phase: 'mappings', processed: 0, createdAt: at, updatedAt: at }, { merge: true })
    tx.create(auditRef(db as unknown as DbLike), { eventId: randomUUID(), action: 'device.status_changed', actorUserId: input.actorUserId, deviceId: input.deviceId, fromStatus: device.status, toStatus: 'removed', createdAt: at })
  })
}

export class DeviceCleanupLeaseLostError extends Error { readonly code = 'linked_device_cleanup_lease_lost'; constructor() { super('linked computers: cleanup lease lost') } }

export async function mutateCleanupRunWithLease(db: CleanupDbLike, deviceId: string, workerId: string, leaseToken: string, patch: Record<string, unknown>, nowMs = Date.now()) {
  const ref = db.collection('linked_device_cleanup_runs').doc(deviceId)
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref); const row = snap.data() ?? {}; const lease = row.leaseExpiresAt as { toMillis?: () => number } | undefined; const expiry = lease?.toMillis?.() ?? Date.parse(String(row.leaseExpiresAt ?? ''))
    if (!snap.exists || row.status !== 'running' || row.leaseOwner !== workerId || row.leaseToken !== leaseToken || !Number.isFinite(expiry) || expiry <= nowMs) throw new DeviceCleanupLeaseLostError()
    if (Object.keys(patch).length) tx.set(ref, { ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    return row
  })
}

export async function processDeviceCleanupBatch(deviceId: string, options: { db?: CleanupDbLike; limit?: number; workerId?: string; leaseToken?: string; nowMs?: number } = {}): Promise<{ done: boolean; processed: number; phase: string }> {
  const db = options.db ?? (adminDb as unknown as CleanupDbLike)
  const limit = Math.min(Math.max(1, options.limit ?? 75), 100)
  if (!options.workerId || !options.leaseToken) throw new DeviceCleanupLeaseLostError()
  const cleanupRow = await mutateCleanupRunWithLease(db, deviceId, options.workerId, options.leaseToken, {}, options.nowMs)
  const phase = String(cleanupRow.phase ?? 'mappings')
  if (phase === 'mappings' || phase === 'grants') {
    const collection = phase === 'mappings' ? MAPPINGS : GRANTS
    const terminal = phase === 'mappings' ? 'removed' : 'revoked'
    const snap = await db.collection(collection).where('deviceId', '==', deviceId).where('status', '!=', terminal).limit(limit).get()
    const docs = snap.docs
    if (docs.length) {
      const batch = db.batch()
      for (const doc of docs) batch.set(doc.ref, { status: terminal, [`${terminal}At`]: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      await batch.commit()
      await mutateCleanupRunWithLease(db, deviceId, options.workerId, options.leaseToken, { processed: FieldValue.increment(docs.length) }, options.nowMs)
      return { done: false, processed: docs.length, phase }
    }
    await mutateCleanupRunWithLease(db, deviceId, options.workerId, options.leaseToken, { phase: phase === 'mappings' ? 'grants' : 'jobs' }, options.nowMs)
    return { done: false, processed: 0, phase }
  }
  if (phase === 'jobs') {
    const snap = await db.collection('linked_device_run_jobs').where('deviceId', '==', deviceId).where('status', 'in', ['queued', 'claimed', 'running']).limit(Math.min(limit, 50)).get()
    const docs = snap.docs
    for (const doc of docs) await cancelLinkedRun(doc.id, 'Linked computer access revoked')
    if (docs.length) { await mutateCleanupRunWithLease(db, deviceId, options.workerId, options.leaseToken, { processed: FieldValue.increment(docs.length) }, options.nowMs); return { done: false, processed: docs.length, phase } }
    await mutateCleanupRunWithLease(db, deviceId, options.workerId, options.leaseToken, { phase: 'complete', status: 'completed', completedAt: FieldValue.serverTimestamp(), leaseOwner: null, leaseToken: null, leaseExpiresAt: null }, options.nowMs)
    return { done: true, processed: 0, phase: 'complete' }
  }
  return { done: true, processed: 0, phase }
}

export async function claimDeviceCleanupLease(deviceId: string, db: CleanupDbLike, workerId: string, nowMs: number) {
  const ref = db.collection('linked_device_cleanup_runs').doc(deviceId); const leaseToken = randomBytes(24).toString('base64url')
  const won = await db.runTransaction(async (tx) => { const snap = await tx.get(ref); const row = snap.data() ?? {}; const leaseValue = row.leaseExpiresAt as { toMillis?: () => number } | undefined; const expiry = leaseValue?.toMillis?.() ?? Date.parse(String(row.leaseExpiresAt ?? '')); if (!snap.exists || row.status === 'completed' || (row.status === 'running' && Number.isFinite(expiry) && expiry > nowMs)) return false; tx.set(ref, { status: 'running', leaseOwner: workerId, leaseToken, leaseExpiresAt: Timestamp.fromMillis(nowMs + 60_000), attempts: Number(row.attempts ?? 0) + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true }); return true })
  return won ? leaseToken : null
}

export async function kickDeviceCleanup(deviceId: string, options: { db?: CleanupDbLike; nowMs?: number } = {}) {
  const db = options.db ?? (adminDb as unknown as CleanupDbLike); const workerId = `kick:${randomUUID()}`; const token = await claimDeviceCleanupLease(deviceId, db, workerId, options.nowMs ?? Date.now())
  if (!token) return { done: false, processed: 0, phase: 'leased' }
  const result = await processDeviceCleanupBatch(deviceId, { db, workerId, leaseToken: token, nowMs: options.nowMs })
  if (!result.done) await mutateCleanupRunWithLease(db, deviceId, workerId, token, { status: 'pending', leaseOwner: null, leaseToken: null, leaseExpiresAt: null }, options.nowMs)
  return result
}

export async function runDeviceCleanupWorker(options: { db?: CleanupDbLike; maxRuns?: number; nowMs?: number; workerId?: string } = {}) {
  const db = options.db ?? (adminDb as unknown as CleanupDbLike)
  const nowMs = options.nowMs ?? Date.now()
  const workerId = options.workerId ?? randomUUID()
  const maxRuns = Math.min(options.maxRuns ?? 5, 10)
  const [readySnap, runningSnap] = await Promise.all([db.collection('linked_device_cleanup_runs').where('status', 'in', ['pending', 'retryable']).limit(maxRuns).get(), db.collection('linked_device_cleanup_runs').where('status', '==', 'running').where('leaseExpiresAt', '<=', Timestamp.fromMillis(nowMs)).limit(maxRuns).get()])
  const docs = [...readySnap.docs, ...runningSnap.docs].filter((doc, index, all) => all.findIndex((item) => item.id === doc.id) === index).slice(0, maxRuns)
  const results: Array<{ deviceId: string; status: string }> = []
  for (const doc of docs) {
    const leaseToken = await claimDeviceCleanupLease(doc.id, db, workerId, nowMs)
    if (!leaseToken) continue
    try {
      const result = await processDeviceCleanupBatch(doc.id, { db, workerId, leaseToken, nowMs })
      if (!result.done) await mutateCleanupRunWithLease(db, doc.id, workerId, leaseToken, { status: 'pending', leaseOwner: null, leaseToken: null, leaseExpiresAt: null, nextAttemptAt: FieldValue.serverTimestamp() }, nowMs)
      results.push({ deviceId: doc.id, status: result.done ? 'completed' : 'pending' })
    } catch (error) {
      if (error instanceof DeviceCleanupLeaseLostError) { results.push({ deviceId: doc.id, status: 'lease_lost' }); continue }
      try { await mutateCleanupRunWithLease(db, doc.id, workerId, leaseToken, { status: 'retryable', leaseOwner: null, leaseToken: null, leaseExpiresAt: null, nextAttemptAt: Timestamp.fromMillis(nowMs + 60_000), lastError: 'Cleanup batch failed' }, nowMs) }
      catch (leaseError) { if (leaseError instanceof DeviceCleanupLeaseLostError) { results.push({ deviceId: doc.id, status: 'lease_lost' }); continue }; throw leaseError }
      results.push({ deviceId: doc.id, status: 'retryable' })
    }
  }
  return { scanned: docs.length, processed: results.length, results }
}

export async function putDeviceGrant(input: {
  deviceId: string
  orgId: string
  actorUserId: string
  status: DeviceGrantStatus
  capabilities: LinkedDeviceCapability[]
  allowedUserIds?: string[]
  allowedTeamIds?: string[]
  accessMode?: DeviceGrantAccessMode
}, options: StoreOptions = {}): Promise<{ browsingConsentDisabled: boolean }> {
  const db = options.db ?? (adminDb as unknown as DbLike)
  return db.runTransaction(async (tx) => {
    const deviceSnap = await tx.get(db.collection(DEVICES).doc(input.deviceId))
    if (!deviceSnap.exists) throw new Error('linked computers: device not found')
    const device = deviceSnap.data() as unknown as LinkedDevice
    const ownerType = linkedDeviceOwnerType(device)
    const ownerOrgId = ownerType === 'organization' ? String(device.ownerOrgId) : null
    const ref = db.collection(GRANTS).doc(`${input.orgId}_${input.deviceId}`)
    const [actorSnap, ownerOrgActorSnap, existing] = await Promise.all([
      tx.get(db.collection(MEMBERS).doc(`${input.orgId}_${input.actorUserId}`)),
      tx.get(db.collection(MEMBERS).doc(`${ownerOrgId ?? input.orgId}_${input.actorUserId}`)),
      tx.get(ref),
    ])
    const fromStatus = existing.exists ? existing.data()?.status as DeviceGrantStatus : undefined
    if (fromStatus ? !GRANT_TRANSITIONS[fromStatus]?.includes(input.status) : input.status !== 'active') {
      throw new Error('linked computers: invalid grant status transition')
    }
    const actorMembership = membershipFrom(actorSnap.data(), input.orgId, input.actorUserId)
    if (ownerType === 'organization') {
      assertGrantAdministrator(actorMembership, input.orgId, input.actorUserId)
      assertGrantAdministrator(membershipFrom(ownerOrgActorSnap.data(), ownerOrgId!, input.actorUserId), ownerOrgId!, input.actorUserId)
    } else if (input.status === 'active') {
      if (input.actorUserId !== device.ownerUserId) throw new Error('linked computers: device owner required')
      if (!actorMembership.active) {
        throw new Error('linked computers: owner membership required')
      }
    } else if (input.actorUserId !== device.ownerUserId) {
      // A current organisation administrator may contain an existing personal
      // device grant, while only the device owner may activate or broaden it.
      assertGrantAdministrator(actorMembership, input.orgId, input.actorUserId)
    }
    const at = timestamp(options)
    const existingGrant = existing.data() as Partial<LinkedDeviceGrant> | undefined
    const accessMode = input.accessMode
      ?? (input.allowedUserIds !== undefined ? 'selected_users' : existingGrant ? effectiveGrantAccessMode({ accessMode: existingGrant.accessMode, allowedUserIds: existingGrant.allowedUserIds ?? [] }) : 'owner')
    if (!['owner', 'organization', 'selected_users', 'teams'].includes(accessMode)) throw new Error('linked computers: invalid grant access mode')
    const selectedUserIds = [...new Set((input.allowedUserIds ?? existingGrant?.allowedUserIds ?? []).filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))]
    const selectedTeamIds = [...new Set((input.allowedTeamIds ?? existingGrant?.allowedTeamIds ?? []).filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))]
    const allowedUserIds = accessMode === 'selected_users' || accessMode === 'teams' ? selectedUserIds : []
    const allowedTeamIds = accessMode === 'teams' ? selectedTeamIds : []
    if (accessMode === 'teams') {
      if (allowedTeamIds.length === 0 && allowedUserIds.length === 0) {
        throw new Error('linked computers: teams mode needs allowedTeamIds or allowedUserIds')
      }
      for (const teamId of allowedTeamIds) {
        const teamSnap = await tx.get(db.collection('org_teams').doc(teamId))
        const team = teamSnap.data()
        if (!teamSnap.exists || team?.orgId !== input.orgId || team?.status !== 'active') {
          throw new Error('linked computers: unknown or archived team')
        }
      }
    }
    const statusAt = input.status === 'paused' ? { pausedAt: at } : input.status === 'revoked' ? { revokedAt: at } : {}
    const browsingConsentDisabled = accessMode !== 'owner' && existingGrant?.browserIdentity?.useRealProfile === true
    const nextBrowserIdentity = browsingConsentDisabled && existingGrant?.browserIdentity
      ? { ...existingGrant.browserIdentity, useRealProfile: false, updatedByUserId: input.actorUserId, updatedAt: at }
      : undefined
    tx.set(ref, {
      deviceId: input.deviceId, orgId: input.orgId, grantedByUserId: input.actorUserId,
      accessMode, allowedUserIds, allowedTeamIds, capabilities: input.capabilities, status: input.status,
      ...(!existing.exists ? { createdAt: at } : {}), updatedAt: at, ...statusAt,
      ...(nextBrowserIdentity ? { browserIdentity: nextBrowserIdentity } : {}),
    }, { merge: true })
    writeLinkedComputerAudit(tx, db, {
      action: 'grant.changed', actorUserId: input.actorUserId,
      deviceId: input.deviceId, orgId: input.orgId, fromStatus: fromStatus ?? undefined, toStatus: input.status,
    }, at)
    if (ownerType === 'user' && input.actorUserId === device.ownerUserId && input.status === 'active') {
      writeLinkedComputerAudit(tx, db, {
        action: 'grant.owner_shared', actorUserId: input.actorUserId,
        deviceId: input.deviceId, orgId: input.orgId, fromStatus: fromStatus ?? undefined, toStatus: input.status,
      }, at)
    }
    if (browsingConsentDisabled) {
      writeLinkedComputerAudit(tx, db, {
        action: 'browser.real_profile.disabled', actorUserId: input.actorUserId,
        deviceId: input.deviceId, orgId: input.orgId,
      }, at)
    }
    return { browsingConsentDisabled }
  })
}

export async function setDeviceGrantBrowserIdentity(input: {
  deviceId: string
  orgId: string
  actorUserId: string
  identity: Omit<DeviceBrowserIdentity, 'updatedByUserId' | 'updatedAt'>
}, options: StoreOptions = {}): Promise<DeviceBrowserIdentity> {
  const db = options.db ?? (adminDb as unknown as DbLike)
  const pin = input.identity.realProfilePin
  if (pin != null) {
    const clean = pin.trim()
    if (clean.length > 64 || /[\\/]/.test(clean)) throw new Error('linked computers: invalid browser profile pin')
  }
  return db.runTransaction(async (tx) => {
    const deviceSnap = await tx.get(db.collection(DEVICES).doc(input.deviceId))
    if (!deviceSnap.exists) throw new Error('linked computers: device not found')
    const device = deviceSnap.data() as unknown as LinkedDevice
    if (linkedDeviceOwnerType(device) !== 'user' || device.ownerUserId !== input.actorUserId) {
      throw new Error('linked computers: device owner required')
    }
    const grantRef = db.collection(GRANTS).doc(`${input.orgId}_${input.deviceId}`)
    const grantSnap = await tx.get(grantRef)
    if (!grantSnap.exists) throw new Error('linked computers: browsing as you requires an owner-only grant')
    const grant = grantSnap.data() as unknown as LinkedDeviceGrant
    if (grant.status !== 'active' || effectiveGrantAccessMode(grant) !== 'owner') {
      throw new Error('linked computers: browsing as you requires an owner-only grant')
    }
    const at = timestamp(options)
    const browserIdentity: DeviceBrowserIdentity = {
      useRealProfile: input.identity.useRealProfile,
      realProfilePin: input.identity.realProfilePin?.trim() || null,
      headed: input.identity.headed,
      autoclose: input.identity.autoclose,
      updatedByUserId: input.actorUserId,
      updatedAt: at,
    }
    tx.set(grantRef, { browserIdentity, updatedAt: at }, { merge: true })
    writeLinkedComputerAudit(tx, db, {
      action: input.identity.useRealProfile ? 'browser.real_profile.enabled' : 'browser.real_profile.disabled',
      actorUserId: input.actorUserId,
      deviceId: input.deviceId,
      orgId: input.orgId,
    }, at)
    return browserIdentity
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
    await assertStoreDeviceManager(tx, db, device, input.actorUserId)
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
    if (fromStatus && fromStatus !== input.status && !MAPPING_TRANSITIONS[fromStatus]?.includes(input.status)) {
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

export async function confirmDeviceMappingPresence(input: { deviceId: string; mappingId: string; ownerUserId: string; authenticatedCredentialVersion: number; present: boolean }, options: StoreOptions = {}): Promise<{ mappingId: string; status: 'active' | 'paused' }> {
  const db = options.db ?? (adminDb as unknown as DbLike)
  return db.runTransaction(async (tx) => {
    const deviceRef = db.collection(DEVICES).doc(input.deviceId)
    const mappingRef = db.collection(MAPPINGS).doc(input.mappingId)
    const credentialRef = db.collection('linked_device_credentials').doc(input.deviceId)
    const [deviceSnap, mappingSnap, credentialSnap] = await Promise.all([tx.get(deviceRef), tx.get(mappingRef), tx.get(credentialRef)])
    if (!deviceSnap.exists || !mappingSnap.exists || !credentialSnap.exists) throw new Error('linked computers: mapping not found')
    const device = deviceSnap.data() ?? {}; const mapping = mappingSnap.data() ?? {}; const credential = credentialSnap.data() ?? {}
    const deviceActorUserId = linkedDeviceActorUserId(device as unknown as LinkedDevice)
    const [grantSnap, memberSnap] = await Promise.all([
      tx.get(db.collection(GRANTS).doc(`${mapping.orgId}_${input.deviceId}`)),
      tx.get(db.collection(MEMBERS).doc(`${mapping.orgId}_${deviceActorUserId || '__organization_device__'}`)),
    ])
    const grant = grantSnap.data() ?? {}; const member = memberSnap.data() ?? {}
    const ownerType = linkedDeviceOwnerType(device as unknown as LinkedDevice)
    const validDeviceIdentity = deviceActorUserId === input.ownerUserId
    const validOwnerMembership = ownerType === 'organization' || (memberSnap.exists && isActiveOrgMembershipRow(member) && member.orgId === mapping.orgId
      && (member.uid === deviceActorUserId || member.userId === deviceActorUserId))
    if (device.deviceId !== input.deviceId || !validDeviceIdentity || !validOwnerMembership || device.status !== 'active'
      || Number(device.credentialVersion) !== input.authenticatedCredentialVersion || Number(credential.credentialVersion) !== input.authenticatedCredentialVersion || credential.revokedAt
      || mapping.deviceId !== input.deviceId || !mapping.workspaceId || !mapping.orgId || !grantSnap.exists || grant.status !== 'active'
      || !Array.isArray(grant.capabilities) || !grant.capabilities.includes('workspace.execute')) throw new Error('linked computers: mapping confirmation denied')
    if (mapping.status === 'removed') throw new Error('linked computers: mapping removed')
    const next = input.present ? 'active' : 'paused'
    if (!(input.present ? ['pending', 'paused', 'active'] : ['pending', 'active', 'paused']).includes(String(mapping.status))) throw new Error('linked computers: invalid mapping transition')
    if (mapping.status !== next) {
      const at = timestamp(options)
      tx.update(mappingRef, { status: next, updatedAt: at })
      tx.create(auditRef(db), { eventId: randomUUID(), action: 'mapping.changed', actorUserId: `device:${input.deviceId}`, deviceId: input.deviceId, orgId: mapping.orgId, mappingId: input.mappingId, fromStatus: mapping.status, toStatus: next, createdAt: at })
    }
    return { mappingId: input.mappingId, status: next }
  })
}
