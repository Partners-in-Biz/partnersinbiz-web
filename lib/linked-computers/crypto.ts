import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  verify,
} from 'node:crypto'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { projectLinkedOrgIds, scopedProjectReplicaId } from '@/lib/project-locations/model'
import { projectOrganizationDocId } from '@/lib/projects/collaboration'
import { isActiveOrgMembershipRow } from './policy'
import { AGENT_ID_RE } from '@/lib/agents/types'
import type {
  LinkedDeviceArchitecture,
  LinkedDeviceKind,
  LinkedDeviceOwnerType,
  LinkedDevicePlatform,
} from './types'

const CHALLENGES = 'linked_device_pairing_challenges'
const DEVICES = 'linked_devices'
const CREDENTIALS = 'linked_device_credentials'
const GRANTS = 'linked_device_grants'
const MAPPINGS = 'linked_device_workspace_mappings'
const MEMBERS = 'orgMembers'
const WORKSPACES = 'org_workspaces'
const PROJECT_LOCATIONS = 'project_execution_locations'
const PROJECT_REPLICAS = 'project_location_replicas'
const PROJECTS = 'projects'
const PROJECT_ORGANIZATIONS = 'projectOrganizations'
const PROJECT_SYNC_HEADS = 'project_sync_heads'
const PROJECT_SYNC_REQUESTS = 'project_sync_requests'
const PROJECT_SYNC_RUNTIME_JOBS = 'project_sync_runtime_jobs'
const AUDIT = 'linked_computer_audit_events'
const PAIRING_TTL_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 5
const MAX_ADOPTION_TRANSACTION_WRITES = 450

interface RefLike { id: string; path?: string }
interface SnapshotLike { exists: boolean; data(): Record<string, unknown> | undefined }
type QueryLike = object
interface QueryDocumentSnapshotLike extends SnapshotLike { id: string; ref: RefLike }
interface QuerySnapshotLike { docs: QueryDocumentSnapshotLike[] }
interface TransactionLike {
  get(ref: RefLike): Promise<SnapshotLike>
  get(query: QueryLike): Promise<QuerySnapshotLike>
  create(ref: RefLike, value: Record<string, unknown>): void
  update(ref: RefLike, value: Record<string, unknown>): void
}
export interface LinkedComputerPairingDb {
  collection(name: string): {
    doc(id: string): RefLike
    where(field: string, operator: string, value: unknown): QueryLike
  }
  runTransaction<T>(fn: (tx: TransactionLike) => Promise<T>): Promise<T>
}
interface Options {
  db?: LinkedComputerPairingDb
  now?: () => unknown
  nowMs?: () => number
  randomId?: () => string
  randomSecret?: () => string
  provisionDesiredAgents?: (input: {
    deviceId: string
    actorUserId: string
    orgId: string
    desired: Array<{ agentId: string; keepInSync: boolean }>
    enqueueJobs: boolean
  }) => Promise<unknown>
}

function required(value: unknown, field: string): string {
  const clean = typeof value === 'string' ? value.trim() : ''
  if (!clean) throw new Error(`linked computers: ${field} is required`)
  return clean
}

function safeIdentifier(value: unknown, field: string): string {
  const clean = required(value, field)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(clean)) {
    throw new Error(`linked computers: invalid ${field}`)
  }
  return clean
}

type AdoptionMapping = {
  mappingId: string
  orgId: string
  workspaceId: string
}

type AdoptionDescriptor = {
  locationId: string
  label: string
  kind: LinkedDeviceKind
  platform: LinkedDevicePlatform
  ownerType: LinkedDeviceOwnerType
  ownerUserId?: string
  ownerOrgId?: string
  visibility: 'private' | 'organization'
  mappings: AdoptionMapping[]
}

function adoptionDescriptor(
  row: Record<string, unknown>,
  expected: {
    locationId: string
    ownerUserId: string
    ownerType: LinkedDeviceOwnerType
    ownerOrgId: string | null
    deviceKind: LinkedDeviceKind
  },
): AdoptionDescriptor {
  if (row.locationId !== expected.locationId || row.status !== 'active'
    || row.replacedByLocationId || row.adoptedDeviceId
    || (typeof row.runtimeTargetId === 'string' && row.runtimeTargetId.startsWith('linked-device:'))) {
    throw new Error('linked computers: location is not adoptable')
  }
  const kind = row.kind === 'vps' ? 'vps' : row.kind === 'computer' ? 'computer' : null
  if (!kind || kind !== expected.deviceKind) throw new Error('linked computers: device kind mismatch')
  const platform = ['macos', 'windows', 'linux'].includes(String(row.platform))
    ? row.platform as LinkedDevicePlatform
    : null
  if (!platform || (kind === 'vps' && platform !== 'linux')) {
    throw new Error('linked computers: invalid location platform')
  }
  const owner = row.owner && typeof row.owner === 'object'
    ? row.owner as Record<string, unknown>
    : {}
  const ownerType = owner.type === 'organization' ? 'organization' : owner.type === 'user' ? 'user' : null
  const ownerMatches = ownerType === expected.ownerType
    && (ownerType === 'organization'
      ? owner.orgId === expected.ownerOrgId
      : owner.userId === expected.ownerUserId)
  const visibility = row.visibility === 'organization' ? 'organization' : row.visibility === 'private' ? 'private' : null
  if (!ownerMatches || (ownerType === 'organization' ? visibility !== 'organization' : visibility !== 'private')) {
    throw new Error('linked computers: location owner required')
  }
  const rawMappings = Array.isArray(row.mappings) ? row.mappings : []
  const mappings = rawMappings.flatMap((value): AdoptionMapping[] => {
    if (!value || typeof value !== 'object') return []
    const mapping = value as Record<string, unknown>
    if (mapping.status !== 'active') return []
    const mappingId = typeof mapping.mappingId === 'string' ? mapping.mappingId.trim() : ''
    const orgId = typeof mapping.orgId === 'string' ? mapping.orgId.trim() : ''
    const workspaceId = typeof mapping.workspaceId === 'string' ? mapping.workspaceId.trim() : ''
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(mappingId)
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(orgId)
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(workspaceId)) {
      throw new Error('linked computers: invalid location mapping')
    }
    return [{ mappingId, orgId, workspaceId }]
  })
  if (mappings.length === 0 || mappings.length > 50
    || new Set(mappings.map((mapping) => mapping.mappingId)).size !== mappings.length
    || new Set(mappings.map((mapping) => `${mapping.orgId}\0${mapping.workspaceId}`)).size !== mappings.length) {
    throw new Error('linked computers: invalid location mappings')
  }
  const allowedOrgIds = new Set(Array.isArray(row.allowedOrgIds)
    ? row.allowedOrgIds.filter((value): value is string => typeof value === 'string')
    : [])
  if (mappings.some((mapping) => !allowedOrgIds.has(mapping.orgId))) {
    throw new Error('linked computers: location mapping is outside its organisation scope')
  }
  if (ownerType === 'organization' && !mappings.some((mapping) => mapping.orgId === expected.ownerOrgId)) {
    throw new Error('linked computers: owning organisation mapping required')
  }
  return {
    locationId: expected.locationId,
    label: required(row.label, 'location label'),
    kind,
    platform,
    ownerType,
    ...(ownerType === 'user' ? { ownerUserId: expected.ownerUserId } : { ownerOrgId: expected.ownerOrgId! }),
    visibility: visibility!,
    mappings: mappings.sort((left, right) => left.mappingId.localeCompare(right.mappingId)),
  }
}

function adoptionBinding(descriptor: AdoptionDescriptor): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(descriptor)).digest('base64url')}`
}

function membershipMatches(
  row: Record<string, unknown> | undefined,
  orgId: string,
  userId: string,
  administratorRequired: boolean,
): boolean {
  const identityMatches = row?.uid === userId || row?.userId === userId
  const roleMatches = !administratorRequired || row?.role === 'owner' || row?.role === 'admin'
  return Boolean(isActiveOrgMembershipRow(row) && row?.orgId === orgId && identityMatches && roleMatches)
}

function workspaceMatches(row: Record<string, unknown> | undefined, orgId: string, workspaceId: string): boolean {
  return Boolean(row && row.orgId === orgId && row.status === 'active'
    && (row.workspaceId === workspaceId || row.id === workspaceId))
}

function deterministicAdoptionCredential(input: {
  challengeId: string
  secret: string
  deviceId: string
  publicKey: string
}): string {
  return createHash('sha256')
    .update('pib-linked-device-adoption-credential-v1\0')
    .update(pairingProofPayload(input))
    .digest('base64url')
}

export function projectLocationAdoptionWriteCount(input: {
  replicaCount: number
  mappingCount: number
  grantCount: number
  projectCount: number
}): number {
  const counts = [input.replicaCount, input.mappingCount, input.grantCount, input.projectCount]
  if (counts.some((count) => !Number.isSafeInteger(count) || count < 0)) {
    throw new Error('linked computers: invalid adoption write count')
  }
  // Device, credential, native location, legacy location, challenge, and two
  // audit events are fixed. Each replica is created under its native ID and
  // its legacy row is disabled; each affected project is patched once.
  return 7 + input.replicaCount * 2 + input.mappingCount + input.grantCount + input.projectCount
}

export function projectLocationAdoptionFitsTransaction(input: {
  replicaCount: number
  mappingCount: number
  grantCount: number
  projectCount: number
}): boolean {
  return projectLocationAdoptionWriteCount(input) <= MAX_ADOPTION_TRANSACTION_WRITES
}

function projectSyncHeadDocumentId(orgId: string, projectId: string): string {
  return `head_${createHash('sha256').update(`${orgId}\0${projectId}`).digest('hex').slice(0, 40)}`
}

function terminalProjectSyncStatus(status: unknown): boolean {
  return status === 'synced' || status === 'failed' || status === 'cancelled'
}

function activeAdoptionProject(row: Record<string, unknown> | undefined): boolean {
  if (!row || row.active === false || row.archived === true || row.deleted === true || row.deletedAt) return false
  const status = typeof row.status === 'string' ? row.status.trim().toLowerCase() : ''
  return !['archived', 'deleted', 'inactive', 'completed', 'complete', 'closed', 'cancelled'].includes(status)
}

function activeAdoptionProjectOrganization(
  row: Record<string, unknown> | undefined,
  exists: boolean,
  project: Record<string, unknown> | undefined,
  projectId: string,
  orgId: string,
): boolean {
  // Canonical collaboration state is authoritative, including pending/revoked
  // tombstones. Owner projects created before projectOrganizations was added
  // may fall back only when no canonical row exists and the active project
  // itself still names the organisation.
  if (exists) return Boolean(row && row.projectId === projectId && row.orgId === orgId && row.status === 'active')
  return Boolean(project && projectLinkedOrgIds(project).includes(orgId))
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

export async function createPairing(
  input: {
    actorUserId: string
    deviceKind?: LinkedDeviceKind
    ownerType?: LinkedDeviceOwnerType
    ownerOrgId?: string
    orgId?: string
    agentIds?: string[]
    adoptLocationId?: string
  },
  options: Options = {},
): Promise<{
  challengeId: string
  secret: string
  expiresAt: string
  adoption?: { sourceLocationId: string; state: 'awaiting_runtime_proof' }
}> {
  const db = options.db ?? (adminDb as unknown as LinkedComputerPairingDb)
  const ownerUserId = required(input.actorUserId, 'actorUserId')
  const deviceKind = input.deviceKind ?? 'computer'
  const ownerType = input.ownerType ?? 'user'
  if (!['computer', 'vps'].includes(deviceKind)) throw new Error('linked computers: invalid device kind')
  if (!['user', 'organization'].includes(ownerType)) throw new Error('linked computers: invalid owner type')
  const ownerOrgId = ownerType === 'organization' ? required(input.ownerOrgId, 'ownerOrgId') : null
  const provisionOrgId = typeof input.orgId === 'string' && input.orgId.trim()
    ? input.orgId.trim()
    : (ownerOrgId ?? '')
  const agentIds = parsePairingAgentIds(input.agentIds)
  const adoptLocationId = input.adoptLocationId == null || input.adoptLocationId === ''
    ? null
    : safeIdentifier(input.adoptLocationId, 'adoptLocationId')
  const challengeId = options.randomId?.() ?? randomUUID()
  const secret = options.randomSecret?.() ?? randomBytes(24).toString('base64url')
  const expiresAt = new Date((options.nowMs?.() ?? Date.now()) + PAIRING_TTL_MS).toISOString()
  const at = timestamp(options)
  await db.runTransaction(async (tx) => {
    const ref = db.collection(CHALLENGES).doc(challengeId)
    const locationRef = adoptLocationId ? db.collection(PROJECT_LOCATIONS).doc(adoptLocationId) : null
    const [existing, membership, locationSnapshot] = await Promise.all([
      tx.get(ref),
      ownerOrgId ? tx.get(db.collection(MEMBERS).doc(`${ownerOrgId}_${ownerUserId}`)) : Promise.resolve(null),
      locationRef ? tx.get(locationRef) : Promise.resolve(null),
    ])
    if (existing.exists) throw new Error('linked computers: pairing challenge already exists')
    if (ownerOrgId) {
      const row = membership?.data() ?? {}
      if (!membershipMatches(row, ownerOrgId, ownerUserId, true)) {
        throw new Error('linked computers: organisation administrator required')
      }
    }
    let descriptor: AdoptionDescriptor | null = null
    if (adoptLocationId) {
      if (!locationSnapshot?.exists) throw new Error('linked computers: location not found')
      descriptor = adoptionDescriptor(locationSnapshot.data() ?? {}, {
        locationId: adoptLocationId,
        ownerUserId,
        ownerType,
        ownerOrgId,
        deviceKind,
      })
      const [memberships, workspaces] = await Promise.all([
        Promise.all(descriptor.mappings.map((mapping) => (
          tx.get(db.collection(MEMBERS).doc(`${mapping.orgId}_${ownerUserId}`))
        ))),
        Promise.all(descriptor.mappings.map((mapping) => (
          tx.get(db.collection(WORKSPACES).doc(mapping.workspaceId))
        ))),
      ])
      descriptor.mappings.forEach((mapping, index) => {
        if (!membershipMatches(memberships[index].data(), mapping.orgId, ownerUserId, ownerType === 'organization')) {
          throw new Error(ownerType === 'organization'
            ? 'linked computers: organisation administrator required'
            : 'linked computers: active organisation membership required')
        }
        if (!workspaceMatches(workspaces[index].data(), mapping.orgId, mapping.workspaceId)) {
          throw new Error('linked computers: active canonical Workspace required for tenant')
        }
      })
    }
    tx.create(ref, {
      challengeId, ownerUserId, ownerType, ...(ownerOrgId ? { ownerOrgId } : {}), deviceKind,
      ...(provisionOrgId ? { orgId: provisionOrgId } : {}),
      ...(agentIds.length ? { agentIds } : {}),
      ...(descriptor ? {
        adoptLocationId: descriptor.locationId,
        adoptLocationBinding: adoptionBinding(descriptor),
      } : {}),
      secretHash: hashLinkedComputerSecret(secret), expiresAt,
      cleanupAt: Timestamp.fromMillis(Date.parse(expiresAt)),
      attempts: 0, maxAttempts: MAX_ATTEMPTS, createdAt: at,
    })
    tx.create(auditRef(db), {
      eventId: randomUUID(), action: 'pairing.created', actorUserId: ownerUserId,
      challengeId, ...(ownerOrgId ? { orgId: ownerOrgId } : {}), createdAt: at,
    })
  })
  return {
    challengeId,
    secret,
    expiresAt,
    ...(adoptLocationId ? {
      adoption: { sourceLocationId: adoptLocationId, state: 'awaiting_runtime_proof' as const },
    } : {}),
  }
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
  releaseChannel?: 'internal' | 'stable'
  agentIds?: string[]
}

function resolvedReleaseChannel(input: PairingExchangeInput): 'internal' | 'stable' {
  return input.releaseChannel === 'internal' ? 'internal' : 'stable'
}

function validExchangeProof(input: PairingExchangeInput, challenge: Record<string, unknown>): {
  valid: boolean
  deviceId: string
  publicKey: string
  ownerType: LinkedDeviceOwnerType
  ownerUserId: string
  ownerOrgId: string | null
  deviceKind: LinkedDeviceKind
} {
  const deviceId = typeof input.deviceId === 'string' ? input.deviceId.trim() : ''
  const deviceIdValid = /^[A-Za-z0-9_-]{1,128}$/.test(deviceId)
  // The first shipped runtime signed the PEM exactly as Node exported it,
  // including its trailing newline. Keep that submitted byte sequence for
  // verification while storing the canonical trimmed PEM on the device.
  const submittedPublicKey = typeof input.publicKey === 'string' ? input.publicKey : ''
  const publicKey = submittedPublicKey.trim()
  const ownerType = challenge.ownerType === 'organization' ? 'organization' : 'user'
  const ownerUserId = typeof challenge.ownerUserId === 'string' ? challenge.ownerUserId.trim() : ''
  const ownerOrgId = ownerType === 'organization' && typeof challenge.ownerOrgId === 'string'
    ? challenge.ownerOrgId.trim()
    : null
  const deviceKind = challenge.deviceKind === 'vps' ? 'vps' : 'computer'
  const shapeValid = Boolean(deviceIdValid && publicKey && input.proof && input.label && input.runtimeVersion
      && ownerUserId && (ownerType === 'user' || ownerOrgId))
    && ['macos', 'windows', 'linux'].includes(input.platform)
    && ['arm64', 'x64'].includes(input.architecture)
    && publicKey.length <= 8_192
    && input.proof.length <= 2_048
    && (deviceKind !== 'vps' || input.platform === 'linux')
  const secretValid = constantTimeSecretMatch(String(input.secret ?? ''), String(challenge.secretHash ?? ''))
  let proofValid = false
  try {
    if (!shapeValid || !secretValid) throw new Error('invalid exchange')
    proofValid = verify(
      null,
      Buffer.from(pairingProofPayload({ challengeId: String(challenge.challengeId), secret: input.secret, deviceId, publicKey })),
      publicKey,
      Buffer.from(input.proof, 'base64url'),
    )
    if (!proofValid && submittedPublicKey !== publicKey) {
      proofValid = verify(
        null,
        Buffer.from(pairingProofPayload({
          challengeId: String(challenge.challengeId), secret: input.secret, deviceId, publicKey: submittedPublicKey,
        })),
        publicKey,
        Buffer.from(input.proof, 'base64url'),
      )
    }
  } catch {
    proofValid = false
  }
  return {
    valid: Boolean(shapeValid && secretValid && proofValid),
    deviceId,
    publicKey,
    ownerType,
    ownerUserId,
    ownerOrgId,
    deviceKind,
  }
}

export async function exchangePairing(
  input: PairingExchangeInput,
  options: Options = {},
): Promise<{ deviceId: string; credential: string; credentialVersion: number; ownerUserId: string }> {
  const submitted = input as PairingExchangeInput & Record<string, unknown>
  if (submitted.runtimeEndpoint !== undefined || submitted.bootstrapTransport !== undefined || submitted.transportToken !== undefined) {
    throw new Error('linked computers: legacy transport fields are not accepted')
  }
  const db = options.db ?? (adminDb as unknown as LinkedComputerPairingDb)
  const challengeId = required(input.challengeId, 'challengeId')
  // Generated outside the transaction so a Firestore retry writes and returns
  // the same credential. Adoption credentials are derived separately so an
  // identical post-commit network retry can be answered without storing them.
  const regularCredential = options.randomSecret?.() ?? randomBytes(32).toString('base64url')

  type PairingProvision = { orgId: string; agentIds: string[]; actorUserId: string }
  const result = await db.runTransaction(async (tx): Promise<
    | { ok: true; deviceId: string; credential: string; credentialVersion: number; ownerUserId: string; provision?: PairingProvision }
    | { ok: false }
  > => {
    const challengeRef = db.collection(CHALLENGES).doc(challengeId)
    const challengeSnap = await tx.get(challengeRef)
    if (!challengeSnap.exists) throw new Error('linked computers: pairing challenge not found')
    const challenge = challengeSnap.data() ?? {}
    if ((options.nowMs?.() ?? Date.now()) >= Date.parse(String(challenge.expiresAt))) {
      throw new Error('linked computers: pairing challenge expired')
    }
    const attempts = Number(challenge.attempts ?? 0)
    if (attempts >= Number(challenge.maxAttempts ?? MAX_ATTEMPTS)) {
      throw new Error('linked computers: pairing attempts exhausted')
    }
    const exchange = validExchangeProof(input, challenge)
    const persistedDeviceId = exchange.deviceId || '__invalid_device__'
    const deviceRef = db.collection(DEVICES).doc(persistedDeviceId)
    const credentialRef = db.collection(CREDENTIALS).doc(persistedDeviceId)
    const [deviceSnap, credentialSnap] = await Promise.all([
      tx.get(deviceRef),
      tx.get(credentialRef),
    ])
    const existing = deviceSnap.data() ?? {}
    const adoptLocationId = typeof challenge.adoptLocationId === 'string'
      ? challenge.adoptLocationId
      : null
    const adoptionCredential = adoptLocationId ? deterministicAdoptionCredential({
      challengeId,
      secret: input.secret,
      deviceId: exchange.deviceId,
      publicKey: exchange.publicKey,
    }) : null

    // Only an adoption challenge supports idempotent exchange replay. Its
    // credential is reproducible from the still-secret one-time handoff, and
    // every persisted identity field must still match the original exchange.
    if (challenge.consumedAt) {
      const credentialVersion = Number(challenge.credentialVersion ?? 0)
      const retryValid = Boolean(adoptLocationId && adoptionCredential && exchange.valid
        && challenge.deviceId === exchange.deviceId
        && credentialVersion > 0
        && deviceSnap.exists && credentialSnap.exists
        && existing.deviceId === exchange.deviceId
        && existing.ownerType === exchange.ownerType
        && (exchange.ownerType === 'user'
          ? existing.ownerUserId === exchange.ownerUserId
          : existing.ownerOrgId === exchange.ownerOrgId)
        && existing.deviceKind === exchange.deviceKind
        && existing.platform === input.platform
        && existing.publicKey === exchange.publicKey
        && existing.adoptedFromLocationId === adoptLocationId
        && Number(existing.credentialVersion) === credentialVersion
        && credentialSnap.data()?.credentialHash === hashLinkedComputerSecret(adoptionCredential)
        && Number(credentialSnap.data()?.credentialVersion) === credentialVersion
        && !credentialSnap.data()?.revokedAt)
      if (retryValid) {
        return { ok: true, deviceId: exchange.deviceId, credential: adoptionCredential!, credentialVersion, ownerUserId: exchange.ownerUserId }
      }
      throw new Error('linked computers: pairing challenge already consumed')
    }

    if (adoptLocationId) {
      const locationRef = db.collection(PROJECT_LOCATIONS).doc(adoptLocationId)
      const locationSnapshot = await tx.get(locationRef)
      let descriptor: AdoptionDescriptor | null = null
      try {
        if (!locationSnapshot.exists) throw new Error('missing location')
        descriptor = adoptionDescriptor(locationSnapshot.data() ?? {}, {
          locationId: adoptLocationId,
          ownerUserId: exchange.ownerUserId,
          ownerType: exchange.ownerType,
          ownerOrgId: exchange.ownerOrgId,
          deviceKind: exchange.deviceKind,
        })
      } catch {
        descriptor = null
      }
      if (!descriptor || !exchange.valid || adoptionBinding(descriptor) !== challenge.adoptLocationBinding
        || descriptor.platform !== input.platform || deviceSnap.exists || credentialSnap.exists) {
        tx.update(challengeRef, { attempts: attempts + 1 })
        return { ok: false }
      }

      const [replicaSnapshot, runtimeJobSnapshot] = await Promise.all([
        tx.get(db.collection(PROJECT_REPLICAS).where('locationId', '==', adoptLocationId)),
        tx.get(db.collection(PROJECT_SYNC_RUNTIME_JOBS).where('locationId', '==', adoptLocationId)),
      ])
      const activeReplicas = replicaSnapshot.docs.filter((doc) => (doc.data() ?? {}).active === true)
      const orgIds = Array.from(new Set(descriptor.mappings.map((mapping) => mapping.orgId))).sort()
      const grantRefs = orgIds.map((orgId) => db.collection(GRANTS).doc(`${orgId}_${exchange.deviceId}`))
      const mappingRefs = descriptor.mappings.map((mapping) => db.collection(MAPPINGS).doc(mapping.mappingId))
      const membershipRefs = orgIds.map((orgId) => db.collection(MEMBERS).doc(`${orgId}_${exchange.ownerUserId}`))
      const workspaceRefs = descriptor.mappings.map((mapping) => db.collection(WORKSPACES).doc(mapping.workspaceId))
      const nativeLocationId = `linked-device:${exchange.deviceId}`
      const nativeLocationRef = db.collection(PROJECT_LOCATIONS).doc(nativeLocationId)
      let replacementRows: Array<{
        old: QueryDocumentSnapshotLike
        row: Record<string, unknown>
        newReplicaId: string
        newRef: RefLike
      }> = []
      try {
        replacementRows = activeReplicas.map((old) => {
          const row = old.data() ?? {}
          const projectId = safeIdentifier(row.projectId, 'projectId')
          const orgId = safeIdentifier(row.orgId, 'orgId')
          const workspaceId = safeIdentifier(row.workspaceId, 'workspaceId')
          const mappingId = safeIdentifier(row.mappingId, 'mappingId')
          if (!descriptor!.mappings.some((mapping) => mapping.mappingId === mappingId
            && mapping.orgId === orgId && mapping.workspaceId === workspaceId)) {
            throw new Error('replica mapping mismatch')
          }
          const newReplicaId = scopedProjectReplicaId({ projectId, orgId, workspaceId, locationId: nativeLocationId, mappingId })
          return { old, row, newReplicaId, newRef: db.collection(PROJECT_REPLICAS).doc(newReplicaId) }
        })
        if (new Set(replacementRows.map((row) => row.newReplicaId)).size !== replacementRows.length) {
          throw new Error('duplicate replacement replica')
        }
      } catch {
        tx.update(challengeRef, { attempts: attempts + 1 })
        return { ok: false }
      }
      const projectIds = Array.from(new Set(replacementRows.map(({ row }) => String(row.projectId)))).sort()
      if (!projectLocationAdoptionFitsTransaction({
        replicaCount: replacementRows.length,
        mappingCount: descriptor.mappings.length,
        grantCount: orgIds.length,
        projectCount: projectIds.length,
      })) {
        throw new Error('linked computers: project location adoption exceeds transaction limit')
      }
      const projectRefs = projectIds.map((projectId) => db.collection(PROJECTS).doc(projectId))
      const syncScopes = Array.from(new Map(replacementRows.map(({ row }) => {
        const orgId = String(row.orgId)
        const projectId = String(row.projectId)
        return [`${orgId}\0${projectId}`, { orgId, projectId }]
      })).values()).sort((left, right) => `${left.orgId}:${left.projectId}`.localeCompare(`${right.orgId}:${right.projectId}`))
      const projectOrganizationRefs = syncScopes.map(({ orgId, projectId }) => (
        db.collection(PROJECT_ORGANIZATIONS).doc(projectOrganizationDocId(projectId, orgId))
      ))
      const syncHeadRefs = syncScopes.map(({ orgId, projectId }) => (
        db.collection(PROJECT_SYNC_HEADS).doc(projectSyncHeadDocumentId(orgId, projectId))
      ))
      const [grantSnapshots, mappingSnapshots, membershipSnapshots, workspaceSnapshots, nativeLocationSnapshot, replacementSnapshots, projectSnapshots, projectOrganizationSnapshots, syncHeadSnapshots] = await Promise.all([
        Promise.all(grantRefs.map((ref) => tx.get(ref))),
        Promise.all(mappingRefs.map((ref) => tx.get(ref))),
        Promise.all(membershipRefs.map((ref) => tx.get(ref))),
        Promise.all(workspaceRefs.map((ref) => tx.get(ref))),
        tx.get(nativeLocationRef),
        Promise.all(replacementRows.map((row) => tx.get(row.newRef))),
        Promise.all(projectRefs.map((ref) => tx.get(ref))),
        Promise.all(projectOrganizationRefs.map((ref) => tx.get(ref))),
        Promise.all(syncHeadRefs.map((ref) => tx.get(ref))),
      ])
      const syncRequestIds = Array.from(new Set(syncHeadSnapshots.flatMap((snapshot) => {
        const requestId = snapshot.data()?.requestId
        return typeof requestId === 'string' && requestId ? [requestId] : []
      })))
      const syncRequestRefs = syncRequestIds.map((requestId) => db.collection(PROJECT_SYNC_REQUESTS).doc(requestId))
      const syncRequestSnapshots = await Promise.all(syncRequestRefs.map((ref) => tx.get(ref)))
      const syncRequestsById = new Map(syncRequestIds.map((requestId, index) => [requestId, syncRequestSnapshots[index]]))
      const activeSyncHead = syncHeadSnapshots.some((snapshot) => {
        if (!snapshot.exists) return false
        const row = snapshot.data() ?? {}
        const requestId = typeof row.requestId === 'string' ? row.requestId : ''
        const request = requestId ? syncRequestsById.get(requestId) : undefined
        return !terminalProjectSyncStatus(row.status)
          || Boolean(request?.exists && !terminalProjectSyncStatus(request.data()?.status))
          || Boolean(!request?.exists && !terminalProjectSyncStatus(row.status))
      })
      const activeRuntimeJob = runtimeJobSnapshot.docs.some((snapshot) => (
        (snapshot.data() ?? {}).status !== 'completed'
      ))
      if (activeSyncHead || activeRuntimeJob) {
        throw new Error('linked computers: project location has active sync work')
      }
      const authorizationValid = orgIds.every((orgId, index) => membershipMatches(
        membershipSnapshots[index].data(),
        orgId,
        exchange.ownerUserId,
        exchange.ownerType === 'organization',
      )) && descriptor.mappings.every((mapping, index) => workspaceMatches(
        workspaceSnapshots[index].data(),
        mapping.orgId,
        mapping.workspaceId,
      )) && projectSnapshots.every((snapshot) => snapshot.exists && activeAdoptionProject(snapshot.data()))
        && syncScopes.every(({ orgId, projectId }, index) => {
          const snapshot = projectOrganizationSnapshots[index]
          const project = projectSnapshots[projectIds.indexOf(projectId)]
          return activeAdoptionProjectOrganization(snapshot.data(), snapshot.exists, project?.data(), projectId, orgId)
        })
      if (!authorizationValid || nativeLocationSnapshot.exists
        || grantSnapshots.some((snapshot) => snapshot.exists)
        || mappingSnapshots.some((snapshot) => snapshot.exists)
        || replacementSnapshots.some((snapshot) => snapshot.exists)) {
        tx.update(challengeRef, { attempts: attempts + 1 })
        return { ok: false }
      }

      const at = timestamp(options)
      const credentialVersion = 1
      const fingerprint = `sha256:${createHash('sha256').update(exchange.publicKey).digest('base64url')}`
      const owner = exchange.ownerType === 'user'
        ? { type: 'user', userId: exchange.ownerUserId }
        : { type: 'organization', orgId: exchange.ownerOrgId! }
      tx.create(deviceRef, {
        deviceId: exchange.deviceId,
        deviceKind: exchange.deviceKind,
        ownerType: exchange.ownerType,
        ...(exchange.ownerType === 'user' ? { ownerUserId: exchange.ownerUserId } : { ownerOrgId: exchange.ownerOrgId }),
        createdByUserId: exchange.ownerUserId,
        runtimeTargetId: nativeLocationId,
        publicKey: exchange.publicKey,
        publicKeyFingerprint: fingerprint,
        label: required(input.label, 'label'),
        platform: input.platform,
        architecture: input.architecture,
        runtimeVersion: required(input.runtimeVersion, 'runtimeVersion'),
        releaseChannel: resolvedReleaseChannel(input),
        capabilities: ['workspace.execute', 'workspace.sync'],
        status: 'active',
        credentialVersion,
        adoptedFromLocationId: adoptLocationId,
        createdAt: at,
        updatedAt: at,
        lastSeenAt: null,
      })
      tx.create(credentialRef, {
        deviceId: exchange.deviceId,
        credentialHash: hashLinkedComputerSecret(adoptionCredential!),
        credentialVersion,
        issuedAt: at,
        revokedAt: null,
      })
      orgIds.forEach((orgId, index) => {
        tx.create(grantRefs[index], {
          deviceId: exchange.deviceId,
          orgId,
          grantedByUserId: exchange.ownerUserId,
          accessMode: exchange.ownerType === 'organization' ? 'organization' : 'owner',
          allowedUserIds: [],
          capabilities: ['workspace.execute', 'workspace.sync'],
          status: 'active',
          createdAt: at,
          updatedAt: at,
        })
      })
      descriptor.mappings.forEach((mapping, index) => {
        tx.create(mappingRefs[index], {
          mappingId: mapping.mappingId,
          deviceId: exchange.deviceId,
          orgId: mapping.orgId,
          workspaceId: mapping.workspaceId,
          label: descriptor!.label,
          // A legacy association does not prove the new runtime has registered
          // the local root. The existing mapping ID is preserved but stays
          // pending until the signed device confirmation endpoint sees it.
          status: 'pending',
          adoptedFromLocationId: adoptLocationId,
          createdAt: at,
          updatedAt: at,
        })
      })
      tx.create(nativeLocationRef, {
        locationId: nativeLocationId,
        label: descriptor.label,
        kind: descriptor.kind,
        platform: descriptor.platform,
        runtimeTargetId: nativeLocationId,
        owner,
        visibility: descriptor.visibility,
        allowedOrgIds: orgIds,
        status: 'active',
        availability: 'offline',
        verificationStatus: 'pending',
        mappings: descriptor.mappings.map((mapping) => ({ ...mapping, status: 'paused' })),
        nativeDeviceId: exchange.deviceId,
        adoptedFromLocationId: adoptLocationId,
        createdAt: at,
        updatedAt: at,
        lastSeenAt: null,
      })
      replacementRows.forEach(({ old, row, newReplicaId, newRef }) => {
        tx.create(newRef, {
          ...row,
          replicaId: newReplicaId,
          locationId: nativeLocationId,
          locationLabel: descriptor!.label,
          locationKind: descriptor!.kind,
          locationPlatform: descriptor!.platform,
          locationOwner: owner,
          locationVisibility: descriptor!.visibility,
          availability: 'offline',
          syncStatus: 'offline',
          active: true,
          adoptedFromReplicaId: old.id,
          adoptedFromLocationId: adoptLocationId,
          createdAt: at,
          updatedAt: at,
          unlinkedAt: null,
          unlinkedByUserId: null,
        })
        tx.update(old.ref, {
          active: false,
          availability: 'offline',
          syncStatus: 'offline',
          replacedByReplicaId: newReplicaId,
          unlinkedAt: at,
          unlinkedByUserId: exchange.ownerUserId,
          updatedAt: at,
        })
      })
      projectSnapshots.forEach((snapshot, index) => {
        const project = snapshot.data() ?? {}
        const existingLocationIds = Array.isArray(project.executionLocationIds)
          ? project.executionLocationIds.filter((value): value is string => typeof value === 'string' && value.length > 0)
          : []
        const executionLocationIds = Array.from(new Set([
          ...existingLocationIds.filter((locationId) => locationId !== adoptLocationId),
          nativeLocationId,
        ]))
        const projectId = projectIds[index]
        const legacyReplicaWasCanonical = replacementRows.some(({ row }) => (
          row.projectId === projectId && row.isCanonical === true
        ))
        tx.update(projectRefs[index], {
          executionLocationIds,
          canonicalLocationId: project.canonicalLocationId === adoptLocationId
            ? nativeLocationId
            : typeof project.canonicalLocationId === 'string' && project.canonicalLocationId
              ? project.canonicalLocationId
              : legacyReplicaWasCanonical ? nativeLocationId : null,
          setupState: 'sync_pending',
          updatedAt: at,
        })
      })
      tx.update(locationRef, {
        status: 'retired',
        availability: 'offline',
        replacedByLocationId: nativeLocationId,
        adoptedDeviceId: exchange.deviceId,
        retiredAt: at,
        retiredByUserId: exchange.ownerUserId,
        updatedAt: at,
      })
      tx.update(challengeRef, {
        consumedAt: at,
        deviceId: exchange.deviceId,
        credentialVersion,
        adoptedLocationId: nativeLocationId,
      })
      tx.create(auditRef(db), {
        eventId: randomUUID(), action: 'pairing.consumed', actorUserId: exchange.ownerUserId,
        challengeId, deviceId: exchange.deviceId, adoptedFromLocationId: adoptLocationId, createdAt: at,
      })
      tx.create(auditRef(db), {
        eventId: randomUUID(), action: 'device.paired', actorUserId: exchange.ownerUserId,
        deviceId: exchange.deviceId,
        ...(exchange.ownerOrgId ? { orgId: exchange.ownerOrgId } : {}),
        adoptedFromLocationId: adoptLocationId,
        createdAt: at,
      })
      return { ok: true, deviceId: exchange.deviceId, credential: adoptionCredential!, credentialVersion, ownerUserId: exchange.ownerUserId }
    }

    const grantRef = exchange.ownerOrgId
      ? db.collection(GRANTS).doc(`${exchange.ownerOrgId}_${persistedDeviceId}`)
      : null
    const challengeOrgId = typeof challenge.orgId === 'string' ? challenge.orgId.trim() : ''
    const provisionOrgId = challengeOrgId || exchange.ownerOrgId || ''
    let provisionAgentIds: string[] = []
    try {
      provisionAgentIds = parsePairingAgentIds(
        Array.isArray(challenge.agentIds) ? challenge.agentIds : input.agentIds,
      )
    } catch {
      provisionAgentIds = []
    }
    const provisionMemberRef = provisionOrgId
      ? db.collection(MEMBERS).doc(`${provisionOrgId}_${exchange.ownerUserId}`)
      : null
    const [grantSnap, provisionMemberSnap] = await Promise.all([
      grantRef ? tx.get(grantRef) : Promise.resolve(null),
      provisionMemberRef ? tx.get(provisionMemberRef) : Promise.resolve(null),
    ])
    const canProvision = Boolean(
      provisionOrgId
      && provisionAgentIds.length
      && membershipMatches(
        provisionMemberSnap?.data(),
        provisionOrgId,
        exchange.ownerUserId,
        false,
      ),
    )
    const existingOwnerType = existing.ownerType ?? (existing.ownerUserId ? 'user' : undefined)
    const existingDeviceValid = !deviceSnap.exists
      || (existingOwnerType === exchange.ownerType
        && (exchange.ownerType === 'user' ? existing.ownerUserId === exchange.ownerUserId : existing.ownerOrgId === exchange.ownerOrgId)
        && (existing.deviceKind ?? 'computer') === exchange.deviceKind
        && existing.status === 'active')
    if (!exchange.valid || !existingDeviceValid) {
      tx.update(challengeRef, { attempts: attempts + 1 })
      return { ok: false }
    }
    const credentialVersion = deviceSnap.exists ? Number(existing.credentialVersion ?? 0) + 1 : 1
    const at = timestamp(options)
    const fingerprint = `sha256:${createHash('sha256').update(exchange.publicKey).digest('base64url')}`
    const device = {
      deviceId: exchange.deviceId, deviceKind: exchange.deviceKind, ownerType: exchange.ownerType,
      ...(exchange.ownerType === 'user' ? { ownerUserId: exchange.ownerUserId } : { ownerOrgId: exchange.ownerOrgId }),
      createdByUserId: exchange.ownerUserId, runtimeTargetId: `linked-device:${exchange.deviceId}`,
      publicKey: exchange.publicKey, publicKeyFingerprint: fingerprint,
      label: required(input.label, 'label'), platform: input.platform, architecture: input.architecture,
      runtimeVersion: required(input.runtimeVersion, 'runtimeVersion'), releaseChannel: resolvedReleaseChannel(input),
      capabilities: ['workspace.execute', 'workspace.sync'],
      status: 'active', credentialVersion,
      ...(provisionOrgId && provisionAgentIds.length && !canProvision
        ? { provisioningSkippedReason: 'not_an_active_org_member' }
        : {}),
      ...(deviceSnap.exists ? { updatedAt: at } : { createdAt: at, updatedAt: at, lastSeenAt: null }),
    }
    if (deviceSnap.exists) tx.update(deviceRef, device)
    else tx.create(deviceRef, device)
    const credentialRow = {
      deviceId: exchange.deviceId, credentialHash: hashLinkedComputerSecret(regularCredential), credentialVersion,
      issuedAt: at, revokedAt: null,
    }
    if (credentialSnap.exists) tx.update(credentialRef, credentialRow)
    else tx.create(credentialRef, credentialRow)
    if (grantRef) {
      const grant = {
        deviceId: exchange.deviceId, orgId: exchange.ownerOrgId, grantedByUserId: exchange.ownerUserId,
        accessMode: 'organization', allowedUserIds: [], capabilities: ['workspace.execute', 'workspace.sync'],
        status: 'active', ...(!grantSnap?.exists ? { createdAt: at } : {}), updatedAt: at,
      }
      if (grantSnap?.exists) tx.update(grantRef, grant)
      else tx.create(grantRef, grant)
    }
    tx.update(challengeRef, { consumedAt: at, deviceId: exchange.deviceId, credentialVersion })
    tx.create(auditRef(db), {
      eventId: randomUUID(), action: 'pairing.consumed', actorUserId: exchange.ownerUserId,
      challengeId, deviceId: exchange.deviceId, createdAt: at,
    })
    tx.create(auditRef(db), {
      eventId: randomUUID(), action: 'device.paired', actorUserId: exchange.ownerUserId,
      deviceId: exchange.deviceId, ...(exchange.ownerOrgId ? { orgId: exchange.ownerOrgId } : {}), createdAt: at,
    })
    return {
      ok: true,
      deviceId: exchange.deviceId,
      credential: regularCredential,
      credentialVersion,
      ownerUserId: exchange.ownerUserId,
      ...(canProvision
        ? {
            provision: {
              orgId: provisionOrgId,
              agentIds: provisionAgentIds,
              actorUserId: exchange.ownerUserId,
            },
          }
        : {}),
    }
  })
  if (!result.ok) throw new Error('linked computers: pairing exchange denied')
  if (result.provision) {
    const provision = options.provisionDesiredAgents ?? (async (input) => {
      const { setDeviceDesiredAgents } = await import('./agent-host-service')
      return setDeviceDesiredAgents(input)
    })
    try {
      await provision({
        deviceId: result.deviceId,
        actorUserId: result.provision.actorUserId,
        orgId: result.provision.orgId,
        desired: result.provision.agentIds.map((agentId) => ({ agentId, keepInSync: true })),
        enqueueJobs: true,
      })
    } catch {
      // Pairing already committed; do not fail the exchange after the device exists.
    }
  }
  return { deviceId: result.deviceId, credential: result.credential, credentialVersion: result.credentialVersion, ownerUserId: result.ownerUserId }
}

/**
 * Adopt a legacy project_execution_location onto an already-paired linked device.
 * Used when the machine is authenticated but project replicas still point at partners-vps / peets-mac-mini.
 * Does not create credentials or consume a pairing challenge.
 */
export async function adoptLegacyLocationOntoLinkedDevice(
  input: {
    actorUserId: string
    deviceId: string
    adoptLocationId: string
  },
  options: Options = {},
): Promise<{
  deviceId: string
  nativeLocationId: string
  adoptedFromLocationId: string
  replicaCount: number
  alreadyAdopted?: boolean
}> {
  const db = options.db ?? (adminDb as unknown as LinkedComputerPairingDb)
  const actorUserId = required(input.actorUserId, 'actorUserId')
  const deviceId = safeIdentifier(input.deviceId, 'deviceId')
  const adoptLocationId = safeIdentifier(input.adoptLocationId, 'adoptLocationId')
  const nativeLocationId = `linked-device:${deviceId}`

  return db.runTransaction(async (tx) => {
    const deviceRef = db.collection(DEVICES).doc(deviceId)
    const locationRef = db.collection(PROJECT_LOCATIONS).doc(adoptLocationId)
    const nativeLocationRef = db.collection(PROJECT_LOCATIONS).doc(nativeLocationId)
    const [deviceSnap, locationSnap, nativeLocationSnap] = await Promise.all([
      tx.get(deviceRef),
      tx.get(locationRef),
      tx.get(nativeLocationRef),
    ])
    if (!deviceSnap.exists) throw new Error('linked computers: device not found')
    const device = deviceSnap.data() ?? {}
    if (device.status !== 'active') throw new Error('linked computers: device is not active')
    const ownerType = (device.ownerType === 'organization' ? 'organization' : 'user') as LinkedDeviceOwnerType
    const deviceKind = (device.deviceKind === 'vps' ? 'vps' : 'computer') as LinkedDeviceKind
    const ownerUserId = ownerType === 'user'
      ? required(device.ownerUserId ?? device.createdByUserId, 'ownerUserId')
      : actorUserId
    const ownerOrgId = ownerType === 'organization' ? required(device.ownerOrgId, 'ownerOrgId') : null
    if (ownerType === 'user' && ownerUserId !== actorUserId) {
      throw new Error('linked computers: device owner required')
    }
    if (ownerOrgId) {
      const membership = await tx.get(db.collection(MEMBERS).doc(`${ownerOrgId}_${actorUserId}`))
      if (!membershipMatches(membership.data(), ownerOrgId, actorUserId, true)) {
        throw new Error('linked computers: organisation administrator required')
      }
    }

    if (nativeLocationSnap.exists) {
      const native = nativeLocationSnap.data() ?? {}
      if (native.adoptedFromLocationId === adoptLocationId && native.nativeDeviceId === deviceId) {
        return {
          deviceId,
          nativeLocationId,
          adoptedFromLocationId: adoptLocationId,
          replicaCount: 0,
          alreadyAdopted: true,
        }
      }
      throw new Error('linked computers: device already has a native project location')
    }

    if (!locationSnap.exists) throw new Error('linked computers: location not found')
    const locationRow = locationSnap.data() ?? {}
    if (locationRow.status === 'retired' && locationRow.replacedByLocationId === nativeLocationId) {
      return {
        deviceId,
        nativeLocationId,
        adoptedFromLocationId: adoptLocationId,
        replicaCount: 0,
        alreadyAdopted: true,
      }
    }
    const descriptor = adoptionDescriptor(locationRow, {
      locationId: adoptLocationId,
      ownerUserId,
      ownerType,
      ownerOrgId,
      deviceKind,
    })
    if (descriptor.platform !== device.platform) {
      throw new Error('linked computers: device platform mismatch')
    }

    const [replicaSnapshot, runtimeJobSnapshot] = await Promise.all([
      tx.get(db.collection(PROJECT_REPLICAS).where('locationId', '==', adoptLocationId)),
      tx.get(db.collection(PROJECT_SYNC_RUNTIME_JOBS).where('locationId', '==', adoptLocationId)),
    ])
    const activeReplicas = replicaSnapshot.docs.filter((doc) => (doc.data() ?? {}).active === true)
    const orgIds = Array.from(new Set(descriptor.mappings.map((mapping) => mapping.orgId))).sort()
    const grantRefs = orgIds.map((orgId) => db.collection(GRANTS).doc(`${orgId}_${deviceId}`))
    const mappingRefs = descriptor.mappings.map((mapping) => db.collection(MAPPINGS).doc(mapping.mappingId))
    const membershipRefs = orgIds.map((orgId) => db.collection(MEMBERS).doc(`${orgId}_${ownerUserId}`))
    const workspaceRefs = descriptor.mappings.map((mapping) => db.collection(WORKSPACES).doc(mapping.workspaceId))

    const replacementRows = activeReplicas.map((old) => {
      const row = old.data() ?? {}
      const projectId = safeIdentifier(row.projectId, 'projectId')
      const orgId = safeIdentifier(row.orgId, 'orgId')
      const workspaceId = safeIdentifier(row.workspaceId, 'workspaceId')
      const mappingId = safeIdentifier(row.mappingId, 'mappingId')
      if (!descriptor.mappings.some((mapping) => mapping.mappingId === mappingId
        && mapping.orgId === orgId && mapping.workspaceId === workspaceId)) {
        throw new Error('linked computers: replica mapping mismatch')
      }
      const newReplicaId = scopedProjectReplicaId({
        projectId, orgId, workspaceId, locationId: nativeLocationId, mappingId,
      })
      return {
        old,
        row,
        newReplicaId,
        newRef: db.collection(PROJECT_REPLICAS).doc(newReplicaId),
      }
    })
    if (new Set(replacementRows.map((row) => row.newReplicaId)).size !== replacementRows.length) {
      throw new Error('linked computers: duplicate replacement replica')
    }

    const projectIds = Array.from(new Set(replacementRows.map(({ row }) => String(row.projectId)))).sort()
    if (!projectLocationAdoptionFitsTransaction({
      replicaCount: replacementRows.length,
      mappingCount: descriptor.mappings.length,
      grantCount: orgIds.length,
      projectCount: projectIds.length,
    })) {
      throw new Error('linked computers: project location adoption exceeds transaction limit')
    }

    const projectRefs = projectIds.map((projectId) => db.collection(PROJECTS).doc(projectId))
    const syncScopes = Array.from(new Map(replacementRows.map(({ row }) => {
      const orgId = String(row.orgId)
      const projectId = String(row.projectId)
      return [`${orgId}\0${projectId}`, { orgId, projectId }]
    })).values()).sort((left, right) => (
      `${left.orgId}:${left.projectId}`.localeCompare(`${right.orgId}:${right.projectId}`)
    ))
    const projectOrganizationRefs = syncScopes.map(({ orgId, projectId }) => (
      db.collection(PROJECT_ORGANIZATIONS).doc(projectOrganizationDocId(projectId, orgId))
    ))
    const syncHeadRefs = syncScopes.map(({ orgId, projectId }) => (
      db.collection(PROJECT_SYNC_HEADS).doc(projectSyncHeadDocumentId(orgId, projectId))
    ))

    const [
      grantSnapshots,
      mappingSnapshots,
      membershipSnapshots,
      workspaceSnapshots,
      replacementSnapshots,
      projectSnapshots,
      projectOrganizationSnapshots,
      syncHeadSnapshots,
    ] = await Promise.all([
      Promise.all(grantRefs.map((ref) => tx.get(ref))),
      Promise.all(mappingRefs.map((ref) => tx.get(ref))),
      Promise.all(membershipRefs.map((ref) => tx.get(ref))),
      Promise.all(workspaceRefs.map((ref) => tx.get(ref))),
      Promise.all(replacementRows.map((row) => tx.get(row.newRef))),
      Promise.all(projectRefs.map((ref) => tx.get(ref))),
      Promise.all(projectOrganizationRefs.map((ref) => tx.get(ref))),
      Promise.all(syncHeadRefs.map((ref) => tx.get(ref))),
    ])

    const syncRequestIds = Array.from(new Set(syncHeadSnapshots.flatMap((snapshot) => {
      const requestId = snapshot.data()?.requestId
      return typeof requestId === 'string' && requestId ? [requestId] : []
    })))
    const syncRequestRefs = syncRequestIds.map((requestId) => db.collection(PROJECT_SYNC_REQUESTS).doc(requestId))
    const syncRequestSnapshots = await Promise.all(syncRequestRefs.map((ref) => tx.get(ref)))
    const syncRequestsById = new Map(syncRequestIds.map((requestId, index) => [requestId, syncRequestSnapshots[index]]))
    const activeSyncHead = syncHeadSnapshots.some((snapshot) => {
      if (!snapshot.exists) return false
      const row = snapshot.data() ?? {}
      const requestId = typeof row.requestId === 'string' ? row.requestId : ''
      const request = requestId ? syncRequestsById.get(requestId) : undefined
      return !terminalProjectSyncStatus(row.status)
        || Boolean(request?.exists && !terminalProjectSyncStatus(request.data()?.status))
        || Boolean(!request?.exists && !terminalProjectSyncStatus(row.status))
    })
    const activeRuntimeJob = runtimeJobSnapshot.docs.some((snapshot) => (
      (snapshot.data() ?? {}).status !== 'completed'
    ))
    if (activeSyncHead || activeRuntimeJob) {
      throw new Error('linked computers: project location has active sync work')
    }

    const authorizationValid = orgIds.every((orgId, index) => membershipMatches(
      membershipSnapshots[index].data(),
      orgId,
      ownerUserId,
      ownerType === 'organization',
    )) && descriptor.mappings.every((mapping, index) => workspaceMatches(
      workspaceSnapshots[index].data(),
      mapping.orgId,
      mapping.workspaceId,
    )) && projectSnapshots.every((snapshot) => snapshot.exists && activeAdoptionProject(snapshot.data()))
      && syncScopes.every(({ orgId, projectId }, index) => {
        const snapshot = projectOrganizationSnapshots[index]
        const project = projectSnapshots[projectIds.indexOf(projectId)]
        return activeAdoptionProjectOrganization(snapshot.data(), snapshot.exists, project?.data(), projectId, orgId)
      })
    if (!authorizationValid) throw new Error('linked computers: adoption authorisation failed')
    if (replacementSnapshots.some((snapshot) => snapshot.exists)) {
      throw new Error('linked computers: native replica already exists')
    }
    for (const [index, snapshot] of mappingSnapshots.entries()) {
      if (!snapshot.exists) continue
      const row = snapshot.data() ?? {}
      if (row.deviceId !== deviceId) {
        throw new Error(`linked computers: mapping ${descriptor.mappings[index].mappingId} belongs to another device`)
      }
    }

    const at = timestamp(options)
    const owner = ownerType === 'user'
      ? { type: 'user', userId: ownerUserId }
      : { type: 'organization', orgId: ownerOrgId! }

    tx.create(nativeLocationRef, {
      locationId: nativeLocationId,
      label: descriptor.label,
      kind: descriptor.kind,
      platform: descriptor.platform,
      runtimeTargetId: nativeLocationId,
      owner,
      visibility: descriptor.visibility,
      allowedOrgIds: orgIds,
      status: 'active',
      availability: device.lastSeenAt ? 'online' : 'offline',
      verificationStatus: 'pending',
      mappings: descriptor.mappings.map((mapping) => ({ ...mapping, status: 'paused' })),
      nativeDeviceId: deviceId,
      adoptedFromLocationId: adoptLocationId,
      createdAt: at,
      updatedAt: at,
      lastSeenAt: device.lastSeenAt ?? null,
    })

    orgIds.forEach((orgId, index) => {
      if (grantSnapshots[index].exists) return
      tx.create(grantRefs[index], {
        deviceId,
        orgId,
        grantedByUserId: actorUserId,
        accessMode: ownerType === 'organization' ? 'organization' : 'owner',
        allowedUserIds: [],
        capabilities: ['workspace.execute', 'workspace.sync'],
        status: 'active',
        createdAt: at,
        updatedAt: at,
      })
    })

    descriptor.mappings.forEach((mapping, index) => {
      if (mappingSnapshots[index].exists) return
      tx.create(mappingRefs[index], {
        mappingId: mapping.mappingId,
        deviceId,
        orgId: mapping.orgId,
        workspaceId: mapping.workspaceId,
        label: descriptor.label,
        status: 'pending',
        adoptedFromLocationId: adoptLocationId,
        createdAt: at,
        updatedAt: at,
      })
    })

    replacementRows.forEach(({ old, row, newReplicaId, newRef }) => {
      tx.create(newRef, {
        ...row,
        replicaId: newReplicaId,
        locationId: nativeLocationId,
        locationLabel: descriptor.label,
        locationKind: descriptor.kind,
        locationPlatform: descriptor.platform,
        locationOwner: owner,
        locationVisibility: descriptor.visibility,
        availability: 'offline',
        syncStatus: 'offline',
        active: true,
        adoptedFromReplicaId: old.id,
        adoptedFromLocationId: adoptLocationId,
        createdAt: at,
        updatedAt: at,
        unlinkedAt: null,
        unlinkedByUserId: null,
      })
      tx.update(old.ref, {
        active: false,
        availability: 'offline',
        syncStatus: 'offline',
        replacedByReplicaId: newReplicaId,
        unlinkedAt: at,
        unlinkedByUserId: actorUserId,
        updatedAt: at,
      })
    })

    projectSnapshots.forEach((snapshot, index) => {
      const project = snapshot.data() ?? {}
      const existingLocationIds = Array.isArray(project.executionLocationIds)
        ? project.executionLocationIds.filter((value): value is string => typeof value === 'string' && value.length > 0)
        : []
      const executionLocationIds = Array.from(new Set([
        ...existingLocationIds.filter((locationId) => locationId !== adoptLocationId),
        nativeLocationId,
      ]))
      const projectId = projectIds[index]
      const legacyReplicaWasCanonical = replacementRows.some(({ row }) => (
        row.projectId === projectId && row.isCanonical === true
      ))
      tx.update(projectRefs[index], {
        executionLocationIds,
        canonicalLocationId: project.canonicalLocationId === adoptLocationId
          ? nativeLocationId
          : typeof project.canonicalLocationId === 'string' && project.canonicalLocationId
            ? project.canonicalLocationId
            : legacyReplicaWasCanonical ? nativeLocationId : null,
        setupState: 'sync_pending',
        updatedAt: at,
      })
    })

    tx.update(locationRef, {
      status: 'retired',
      availability: 'offline',
      replacedByLocationId: nativeLocationId,
      adoptedDeviceId: deviceId,
      retiredAt: at,
      retiredByUserId: actorUserId,
      updatedAt: at,
    })
    tx.update(deviceRef, {
      adoptedFromLocationId: adoptLocationId,
      updatedAt: at,
    })
    tx.create(auditRef(db), {
      eventId: randomUUID(),
      action: 'location.adopted',
      actorUserId,
      deviceId,
      adoptedFromLocationId: adoptLocationId,
      nativeLocationId,
      createdAt: at,
    })

    return {
      deviceId,
      nativeLocationId,
      adoptedFromLocationId: adoptLocationId,
      replicaCount: replacementRows.length,
    }
  })
}
