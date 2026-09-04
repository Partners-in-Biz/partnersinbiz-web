import { adminDb } from '@/lib/firebase/admin'
import { verify } from 'node:crypto'
import { timestampToMs } from '@/lib/agents/runtime-targets'
import { assertDeviceOrgAccess, effectiveGrantAccessMode, isActiveOrgMembershipRow, linkedDeviceOwnerType } from './policy'
import type {
  ActiveOrgMembership,
  DeviceGrantAccessMode,
  LinkedDevice,
  LinkedDeviceKind,
  LinkedDeviceGrant,
  LinkedDevicePlatform,
  LinkedDeviceWorkspaceMapping,
} from './types'
import { DEFAULT_RUNTIME_CHANNELS, getRuntimeChannelConfig, type RuntimeReleaseChannel } from './runtime-config'

const DEVICE_STALE_AFTER_MS = 5 * 60 * 1000
const SAFE_RUNTIME_ALIAS = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

interface Snapshot { exists: boolean; id?: string; data(): Record<string, unknown> | undefined }
interface DbLike {
  collection(name: string): {
    doc(id: string): { get(): Promise<Snapshot> }
    get(): Promise<{ docs: Snapshot[] }>
  }
}

export interface CompatibilityRuntimeTarget {
  id: string
  label: string
  kind: 'platform-vps' | 'operator-local'
  selectable?: boolean
}

export interface PublicAuthorizedRuntimeTarget {
  id: string
  /** Retired runtime IDs that were explicitly adopted by this linked computer. */
  legacyRuntimeTargetIds?: string[]
  locationId: string
  deviceId: string
  label: string
  platform: LinkedDevicePlatform
  runtimeVersion: string
  availableAgentIds: string[]
  mappingId: string
  /** User-facing Workspace mapping label (folder location), never a filesystem path. */
  mappingLabel: string
  workspaceId: string
  kind: 'linked-computer'
  deviceKind: LinkedDeviceKind
  ownerType: AuthorizedProjectRuntimeOwner['type']
  visibility: 'private' | 'organization'
  /** Safe live-state fields for the Messages catalogue; no endpoint or secret data. */
  enabled: boolean
  isLocal: boolean
  isFresh: boolean
  isHealthy: boolean
  selectable: boolean
  updateRequired?: boolean
  unavailableReason?: LinkedRuntimeUnavailableReason
  lastSeenAt: string | null
  ageSeconds: number | null
  lastHealthStatus: 'ok' | 'degraded' | 'offline'
}

export type AuthorizedProjectRuntimeOwner =
  | { type: 'user'; userId: string }
  | { type: 'organization'; orgId: string }

/**
 * Server-only view used to adapt a paired runtime into a project execution
 * location. Ownership is deliberately excluded from the public runtime DTO.
 */
export interface AuthorizedProjectRuntimeTarget {
  id: string
  locationId: string
  deviceId: string
  label: string
  platform: LinkedDevicePlatform
  deviceKind?: LinkedDeviceKind
  mappingId: string
  mappingLabel: string
  workspaceId: string
  owner: AuthorizedProjectRuntimeOwner
  accessMode: DeviceGrantAccessMode
  selectable: boolean
  unavailableReason?: LinkedRuntimeUnavailableReason
  lastSeenAt: string | null
}

export type LinkedRuntimeUnavailableReason = 'offline' | 'stale' | 'update_required' | 'hermes_update_required' | 'agent_unavailable'

export interface AuthorizedLinkedComputerDispatch {
  kind: 'linked-computer'
  locationId: string
  deviceId: string
  runtimeTargetId: string
  machineLabel: string
  mappingId: string
  mappingLabel: string
  workspaceId: string
  credentialVersion: number
  runtimeVersion: string
  availableAgentIds: string[]
  platform: LinkedDevicePlatform
  /** Exact machine class; never infer VPS routing from an OS name or label. */
  deviceKind: LinkedDeviceKind
  lastSeenAt: string
  publicKey: string
  accessMode: DeviceGrantAccessMode
  updateRequired?: boolean
}

export function parseLinkedRuntimeVersion(value: string): [number, number, number] | null {
  const match = value.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

export function linkedRuntimeUpdateRequired(version: string, minimum = process.env.LINKED_RUNTIME_MIN_VERSION): boolean {
  const current = parseLinkedRuntimeVersion(version)
  const required = minimum ? parseLinkedRuntimeVersion(minimum) : null
  if (!required) return process.env.NODE_ENV === 'production' || Boolean(minimum)
  if (!current) return true
  for (let i = 0; i < 3; i++) { if (current[i] !== required[i]) return current[i] < required[i] }
  return false
}

function compareLinkedRuntimeVersion(currentValue: string | undefined, minimum: string): boolean {
  if (!currentValue) return true
  const current = parseLinkedRuntimeVersion(currentValue)
  const required = parseLinkedRuntimeVersion(minimum)
  if (!current || !required) return true
  for (let i = 0; i < 3; i++) { if (current[i] !== required[i]) return current[i] < required[i] }
  return false
}

export function deviceReleaseChannel(device: Pick<LinkedDevice, 'releaseChannel'>): RuntimeReleaseChannel {
  return device.releaseChannel === 'internal' ? 'internal' : 'stable'
}

export function hermesUpdateRequired(
  device: Pick<LinkedDevice, 'hermesVersion' | 'releaseChannel'>,
  minVersion: string,
): boolean {
  return compareLinkedRuntimeVersion(device.hermesVersion, minVersion)
}

export interface LinkedComputerExecutionReceipt {
  deviceId: string
  runtimeTargetId: string
  credentialVersion: number
  mappingId: string
  acceptedAt: string
  runtimeVersion: string
  outcome: string
  toolStartedAt: string
  runId: string
  requestId: string
  signature: string
}

export class LinkedComputerDispatchError extends Error {
  constructor(readonly code: string) {
    super(`linked computers: ${code}`)
    this.name = 'LinkedComputerDispatchError'
  }
}

interface ResolveInput {
  userId: string
  orgId: string
  workspaceId: string
  runtimeTargetId?: string
  /** When set, only this Workspace mapping may authorize or appear as the preferred bind. */
  mappingId?: string
  agentId?: string
}

const SAFE_MAPPING_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
interface ResolveOptions {
  db?: DbLike
  nowMs?: () => number
  staleAfterMs?: number
  compatibilityTargets?: CompatibilityRuntimeTarget[]
  getRuntimeChannelConfig?: typeof getRuntimeChannelConfig
}

function membershipFrom(row: Record<string, unknown> | undefined, orgId: string, userId: string): ActiveOrgMembership {
  return {
    orgId,
    userId,
    active: isActiveOrgMembershipRow(row) && row?.orgId === orgId && (row.uid === userId || row.userId === userId),
    role: typeof row?.role === 'string' ? row.role : undefined,
  }
}

async function allRows<T>(db: DbLike, collection: string): Promise<T[]> {
  const snap = await db.collection(collection).get()
  return snap.docs.map((doc) => ({ ...(doc.data() ?? {}), ...(doc.id ? { __id: doc.id } : {}) }) as T)
}

async function membership(db: DbLike, orgId: string, userId: string): Promise<ActiveOrgMembership> {
  const snap = await db.collection('orgMembers').doc(`${orgId}_${userId}`).get()
  return membershipFrom(snap.exists ? snap.data() : undefined, orgId, userId)
}

type ResolvedAuthorizedRuntimeTarget = Omit<AuthorizedLinkedComputerDispatch, 'lastSeenAt'> & {
  lastSeenAt: string | null
  enabled: boolean
  isLocal: boolean
  isFresh: boolean
  isHealthy: boolean
  ageSeconds: number | null
  lastHealthStatus: 'ok' | 'degraded' | 'offline'
  legacyRuntimeTargetIds: string[]
  unavailableReason?: LinkedRuntimeUnavailableReason
  owner: AuthorizedProjectRuntimeOwner
  accessMode: DeviceGrantAccessMode
  deviceKind: LinkedDeviceKind
}

export function linkedDeviceProjectLocationId(deviceId: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(deviceId)) throw new Error('linked computers: invalid device id')
  return `linked-device:${deviceId}`
}

function adoptedLegacyRuntimeTargetIds(
  device: LinkedDevice,
  locations: Record<string, unknown>[],
): string[] {
  const nativeLocationId = linkedDeviceProjectLocationId(device.deviceId)
  const adoptedFromLocationId = typeof device.adoptedFromLocationId === 'string'
    ? device.adoptedFromLocationId.trim()
    : ''
  if (!SAFE_RUNTIME_ALIAS.test(adoptedFromLocationId)) return []
  const aliases = new Set<string>()

  for (const location of locations) {
    const locationId = String(location.locationId ?? location.__id ?? '').trim()
    const explicitReplacement = location.status === 'retired'
      && location.adoptedDeviceId === device.deviceId
      && location.replacedByLocationId === nativeLocationId
      && locationId === adoptedFromLocationId
    if (!explicitReplacement) continue
    for (const value of [location.runtimeTargetId, location.legacyCompatibilityTargetId]) {
      if (typeof value !== 'string') continue
      const alias = value.trim()
      if (alias !== device.runtimeTargetId && SAFE_RUNTIME_ALIAS.test(alias)) aliases.add(alias)
    }
  }
  return Array.from(aliases).sort()
}

async function resolveCandidates(input: ResolveInput, options: ResolveOptions): Promise<ResolvedAuthorizedRuntimeTarget[]> {
  const db = options.db ?? (adminDb as unknown as DbLike)
  const actorMembership = await membership(db, input.orgId, input.userId)
  if (!actorMembership.active) throw new LinkedComputerDispatchError('linked_device_membership_required')
  const [devices, grants, mappings, credentials] = await Promise.all([
    allRows<LinkedDevice & { health?: string }>(db, 'linked_devices'),
    allRows<LinkedDeviceGrant>(db, 'linked_device_grants'),
    allRows<LinkedDeviceWorkspaceMapping>(db, 'linked_device_workspace_mappings'),
    allRows<Record<string, unknown>>(db, 'linked_device_credentials'),
  ])
  const adoptedLocationIds = Array.from(new Set(devices
    .map((device) => typeof device.adoptedFromLocationId === 'string' ? device.adoptedFromLocationId.trim() : '')
    .filter((locationId) => SAFE_RUNTIME_ALIAS.test(locationId))))
  const adoptedLocationSnapshots = await Promise.all(adoptedLocationIds.map((locationId) => (
    db.collection('project_execution_locations').doc(locationId).get()
  )))
  const executionLocations = adoptedLocationSnapshots
    .filter((snapshot) => snapshot.exists)
    .map((snapshot) => ({ ...(snapshot.data() ?? {}), ...(snapshot.id ? { __id: snapshot.id } : {}) }))
  const credentialById = new Map(credentials.map((row) => [String(row.__id ?? row.deviceId ?? ''), row]))
  const now = options.nowMs?.() ?? Date.now()
  const loadChannel = options.getRuntimeChannelConfig ?? getRuntimeChannelConfig
  const [internalChannel, stableChannel] = await Promise.all([
    loadChannel('internal').catch(() => undefined),
    loadChannel('stable').catch(() => undefined),
  ])
  const candidates: ResolvedAuthorizedRuntimeTarget[] = []
  const preferredMappingId = typeof input.mappingId === 'string' && SAFE_MAPPING_ID.test(input.mappingId.trim())
    ? input.mappingId.trim()
    : ''
  for (const device of devices) {
    const grant = grants.find((row) => row.deviceId === device.deviceId && row.orgId === input.orgId)
    const deviceMappings = mappings
      .filter((row) => row.deviceId === device.deviceId && row.orgId === input.orgId && row.workspaceId === input.workspaceId && row.status === 'active')
      .sort((left, right) => left.mappingId.localeCompare(right.mappingId))
    const credential = credentialById.get(device.deviceId)
    if (!grant || grant.status !== 'active' || !grant.capabilities.includes('workspace.execute')) continue
    // A signed degraded heartbeat deliberately withdraws workspace.execute.
    // Keep that still-authorized, mapped machine in the catalogue so its exact
    // conversation can show a reconnecting state; dispatch remains denied
    // below until the capability is restored by a healthy heartbeat.
    if (device.status !== 'active') continue
    const ownerType = linkedDeviceOwnerType(device)
    if (ownerType === 'user') {
      const ownerMembership = await membership(db, input.orgId, String(device.ownerUserId))
      if (!ownerMembership.active) continue
    }
    try { assertDeviceOrgAccess({ actorUserId: input.userId, orgId: input.orgId, device, grant, membership: actorMembership }) }
    catch { continue }
    if (deviceMappings.length === 0) continue
    if (!credential || credential.revokedAt || Number(credential.credentialVersion) !== device.credentialVersion) continue
    const seen = timestampToMs(device.lastSeenAt)
    const ageMs = seen == null ? null : Math.max(0, now - seen)
    const isFresh = ageMs != null && ageMs <= (options.staleAfterMs ?? DEVICE_STALE_AFTER_MS)
    const canExecute = Array.isArray(device.capabilities) && device.capabilities.includes('workspace.execute')
    const isHealthy = device.health === 'ok' && canExecute
    const updateRequired = linkedRuntimeUpdateRequired(device.runtimeVersion)
    const channelName = deviceReleaseChannel(device)
    const channelConfig = channelName === 'internal' ? internalChannel : stableChannel
    const hermesRequired = hermesUpdateRequired(
      device,
      (channelConfig ?? DEFAULT_RUNTIME_CHANNELS[channelName]).hermes.minVersion,
    )
    const availableAgentIds = Array.isArray(device.availableAgentIds)
      ? device.availableAgentIds.filter((agentId): agentId is string => typeof agentId === 'string')
      : []
    const requestedAgentUnavailable = Boolean(input.agentId && availableAgentIds.length > 0 && !availableAgentIds.includes(input.agentId))
    const unavailableReason: LinkedRuntimeUnavailableReason | undefined = !canExecute || device.health !== 'ok' || seen == null
      ? 'offline'
      : now - seen > (options.staleAfterMs ?? DEVICE_STALE_AFTER_MS)
        ? 'stale'
        : updateRequired ? 'update_required'
          : hermesRequired ? 'hermes_update_required'
            : requestedAgentUnavailable ? 'agent_unavailable' : undefined
    const legacyRuntimeTargetIds = adoptedLegacyRuntimeTargetIds(device, executionLocations)
    for (const mapping of deviceMappings) {
      if (preferredMappingId && mapping.mappingId !== preferredMappingId) continue
      const mappingLabel = typeof mapping.label === 'string' && mapping.label.trim()
        ? mapping.label.trim()
        : mapping.mappingId
      candidates.push({
        kind: 'linked-computer', locationId: linkedDeviceProjectLocationId(device.deviceId),
        deviceId: device.deviceId, runtimeTargetId: device.runtimeTargetId,
        legacyRuntimeTargetIds,
        machineLabel: device.label, mappingId: mapping.mappingId, mappingLabel, credentialVersion: device.credentialVersion,
        runtimeVersion: device.runtimeVersion, platform: device.platform, lastSeenAt: seen == null ? null : new Date(seen).toISOString(),
        enabled: true,
        isLocal: device.deviceKind !== 'vps',
        isFresh,
        isHealthy,
        ageSeconds: ageMs == null ? null : Math.floor(ageMs / 1_000),
        lastHealthStatus: isHealthy ? 'ok' : (seen == null ? 'offline' : 'degraded'),
        availableAgentIds,
        deviceKind: device.deviceKind === 'vps' ? 'vps' : 'computer',
        workspaceId: mapping.workspaceId, publicKey: String((device as LinkedDevice & { publicKey?: string }).publicKey ?? ''),
        owner: ownerType === 'user'
          ? { type: 'user', userId: String(device.ownerUserId) }
          : { type: 'organization', orgId: String(device.ownerOrgId) },
        accessMode: effectiveGrantAccessMode(grant),
        ...(updateRequired ? { updateRequired: true } : {}),
        ...(unavailableReason ? { unavailableReason } : {}),
      })
    }
  }
  return candidates
}

export async function discoverAuthorizedRuntimeTargets(input: ResolveInput, options: ResolveOptions = {}): Promise<PublicAuthorizedRuntimeTarget[]> {
  const candidates = await resolveCandidates({ ...input, mappingId: undefined }, options)
  return candidates.map((target) => ({
    id: target.runtimeTargetId, locationId: target.locationId,
    ...(target.legacyRuntimeTargetIds.length > 0 ? { legacyRuntimeTargetIds: target.legacyRuntimeTargetIds } : {}),
    deviceId: target.deviceId, label: target.machineLabel,
    platform: target.platform, runtimeVersion: target.runtimeVersion, mappingId: target.mappingId,
    mappingLabel: target.mappingLabel,
    availableAgentIds: target.availableAgentIds,
    workspaceId: target.workspaceId,
    kind: 'linked-computer',
    deviceKind: target.deviceKind,
    ownerType: target.owner.type,
    visibility: target.accessMode === 'organization' ? 'organization' : 'private',
    enabled: target.enabled,
    isLocal: target.isLocal,
    isFresh: target.isFresh,
    isHealthy: target.isHealthy,
    selectable: !target.unavailableReason,
    ...(target.updateRequired ? { updateRequired: true } : {}),
    ...(target.unavailableReason ? { unavailableReason: target.unavailableReason } : {}),
    lastSeenAt: target.lastSeenAt,
    ageSeconds: target.ageSeconds,
    lastHealthStatus: target.lastHealthStatus,
  }))
}

export async function discoverAuthorizedProjectRuntimeTargets(
  input: ResolveInput,
  options: ResolveOptions = {},
): Promise<AuthorizedProjectRuntimeTarget[]> {
  const candidates = await resolveCandidates({ ...input, mappingId: undefined }, options)
  return candidates.map((target) => ({
    id: target.runtimeTargetId,
    locationId: target.locationId,
    deviceId: target.deviceId,
    label: target.machineLabel,
    platform: target.platform,
    deviceKind: target.deviceKind,
    mappingId: target.mappingId,
    mappingLabel: target.mappingLabel,
    workspaceId: target.workspaceId,
    owner: target.owner,
    accessMode: target.accessMode,
    selectable: !target.unavailableReason,
    ...(target.unavailableReason ? { unavailableReason: target.unavailableReason } : {}),
    lastSeenAt: target.lastSeenAt,
  }))
}

function authorizedLinkedComputerDispatchFrom(target: ResolvedAuthorizedRuntimeTarget): AuthorizedLinkedComputerDispatch {
  return {
    kind: target.kind,
    locationId: target.locationId,
    deviceId: target.deviceId,
    runtimeTargetId: target.runtimeTargetId,
    machineLabel: target.machineLabel,
    mappingId: target.mappingId,
    mappingLabel: target.mappingLabel,
    workspaceId: target.workspaceId,
    credentialVersion: target.credentialVersion,
    runtimeVersion: target.runtimeVersion,
    availableAgentIds: target.availableAgentIds,
    platform: target.platform,
    deviceKind: target.deviceKind,
    lastSeenAt: target.lastSeenAt!,
    publicKey: target.publicKey,
    accessMode: target.accessMode,
    ...(target.updateRequired ? { updateRequired: true } : {}),
  }
}

/**
 * Authorize a durable, same-computer recovery queue while a previously paired
 * runtime is temporarily offline. This is intentionally narrower than normal
 * dispatch: it preserves every ownership, grant, credential, and mapping
 * check, but permits only liveness loss that a restarted runtime can recover.
 */
export async function authorizeLinkedComputerRecoveryQueue(
  input: ResolveInput & { runtimeTargetId: string },
  options: ResolveOptions = {},
): Promise<AuthorizedLinkedComputerDispatch> {
  const candidates = await resolveCandidates(input, options)
  const matches = candidates.filter((target) => target.runtimeTargetId === input.runtimeTargetId
    || target.deviceId === input.runtimeTargetId
    || target.legacyRuntimeTargetIds.includes(input.runtimeTargetId))
  const preferredMappingId = typeof input.mappingId === 'string' ? input.mappingId.trim() : ''
  const selected = preferredMappingId
    ? matches.find((target) => target.mappingId === preferredMappingId)
    : matches[0]
  if (!selected) {
    // Preserve the normal fail-closed error for revoked credentials, paused
    // grants, membership loss, guessed targets, and missing mappings.
    return authorizeLinkedComputerDispatch(input, options)
  }
  // VPS-linked targets use their own direct gateway path; a recovery queue is
  // deliberately for the supervised desktop/runtime worker contract only.
  if (selected.deviceKind === 'vps') return authorizeLinkedComputerDispatch(input, options)
  if (selected.updateRequired) throw new LinkedComputerDispatchError('linked_device_update_required')
  if (input.agentId && selected.availableAgentIds.length > 0 && !selected.availableAgentIds.includes(input.agentId)) {
    throw new LinkedComputerDispatchError('linked_device_agent_unavailable')
  }
  if (selected.unavailableReason !== 'offline' && selected.unavailableReason !== 'stale') {
    if (selected.unavailableReason) throw new LinkedComputerDispatchError(`linked_device_${selected.unavailableReason}`)
    return authorizedLinkedComputerDispatchFrom(selected)
  }
  // A device that has never sent a heartbeat is not a reconnecting runtime.
  if (!selected.lastSeenAt) throw new LinkedComputerDispatchError('linked_device_offline')
  return authorizedLinkedComputerDispatchFrom(selected)
}

export async function authorizeLinkedComputerDispatch(input: ResolveInput & { runtimeTargetId: string }, options: ResolveOptions = {}): Promise<AuthorizedLinkedComputerDispatch> {
  const candidates = await resolveCandidates(input, options)
  const matches = candidates.filter((target) => target.runtimeTargetId === input.runtimeTargetId || target.deviceId === input.runtimeTargetId)
  const preferredMappingId = typeof input.mappingId === 'string' ? input.mappingId.trim() : ''
  const selected = preferredMappingId
    ? matches.find((target) => target.mappingId === preferredMappingId)
    : matches[0]
  if (selected) {
    if (selected.unavailableReason) throw new LinkedComputerDispatchError(`linked_device_${selected.unavailableReason}`)
    return authorizedLinkedComputerDispatchFrom(selected)
  }
  const db = options.db ?? (adminDb as unknown as DbLike)
  const [devices, credentials] = await Promise.all([
    allRows<LinkedDevice & { health?: string }>(db, 'linked_devices'),
    allRows<Record<string, unknown>>(db, 'linked_device_credentials'),
  ])
  const device = devices.find((row) => row.runtimeTargetId === input.runtimeTargetId || row.deviceId === input.runtimeTargetId)
  if (!device) throw new LinkedComputerDispatchError('linked_device_not_authorized')
  const grants = await allRows<LinkedDeviceGrant>(db, 'linked_device_grants')
  const grant = grants.find((row) => row.deviceId === device.deviceId && row.orgId === input.orgId)
  if (!grant) throw new LinkedComputerDispatchError('linked_device_not_authorized')
  const credential = credentials.find((row) => String(row.deviceId ?? row.__id ?? '') === device.deviceId)
  if (!credential || credential.revokedAt || Number(credential.credentialVersion) !== device.credentialVersion) {
    throw new LinkedComputerDispatchError('linked_device_not_authorized')
  }
  if (linkedDeviceOwnerType(device) === 'user') {
    const ownerMembership = await membership(db, input.orgId, String(device.ownerUserId))
    if (!ownerMembership.active) throw new LinkedComputerDispatchError('linked_device_membership_required')
  }
  const actorMembership = await membership(db, input.orgId, input.userId)
  try { assertDeviceOrgAccess({ actorUserId: input.userId, orgId: input.orgId, device, grant, membership: actorMembership }) }
  catch { throw new LinkedComputerDispatchError('linked_device_not_authorized') }
  const mappings = await allRows<LinkedDeviceWorkspaceMapping>(db, 'linked_device_workspace_mappings')
  if (!mappings.some((row) => row.deviceId === device.deviceId && row.orgId === input.orgId && row.workspaceId === input.workspaceId && row.status === 'active'
    && (!preferredMappingId || row.mappingId === preferredMappingId))) {
    throw new LinkedComputerDispatchError(preferredMappingId ? 'linked_device_mapping_not_authorized' : 'linked_device_mapping_required')
  }
  const seen = timestampToMs(device.lastSeenAt)
  if (device.health !== 'ok' || seen == null) throw new LinkedComputerDispatchError('linked_device_offline')
  if ((options.nowMs?.() ?? Date.now()) - seen > (options.staleAfterMs ?? DEVICE_STALE_AFTER_MS)) throw new LinkedComputerDispatchError('linked_device_stale')
  if (linkedRuntimeUpdateRequired(device.runtimeVersion)) throw new LinkedComputerDispatchError('linked_device_update_required')
  const channel = deviceReleaseChannel(device)
  const loadChannel = options.getRuntimeChannelConfig ?? getRuntimeChannelConfig
  const hermesMin = await loadChannel(channel)
    .then((config) => config.hermes.minVersion)
    .catch(() => DEFAULT_RUNTIME_CHANNELS[channel].hermes.minVersion)
  if (hermesUpdateRequired(device, hermesMin)) throw new LinkedComputerDispatchError('linked_device_hermes_update_required')
  const availableAgentIds = Array.isArray(device.availableAgentIds) ? device.availableAgentIds : []
  if (input.agentId && availableAgentIds.length > 0 && !availableAgentIds.includes(input.agentId)) {
    throw new LinkedComputerDispatchError('linked_device_agent_unavailable')
  }
  throw new LinkedComputerDispatchError('linked_device_not_authorized')
}

/**
 * Resolves only an explicitly adopted legacy runtime ID. Unlike the normal
 * dispatcher this cannot select a device by its current target or device ID,
 * so compatibility fallback cannot turn an arbitrary name collision into a
 * linked-computer dispatch.
 */
export async function authorizeAdoptedLinkedComputerDispatch(
  input: ResolveInput & { runtimeTargetId: string },
  options: ResolveOptions = {},
): Promise<AuthorizedLinkedComputerDispatch> {
  const candidates = await resolveCandidates(input, options)
  const matches = candidates.filter((target) => target.legacyRuntimeTargetIds.includes(input.runtimeTargetId))
  const preferredMappingId = typeof input.mappingId === 'string' ? input.mappingId.trim() : ''
  const selected = preferredMappingId
    ? matches.find((target) => target.mappingId === preferredMappingId)
    : matches[0]
  if (!selected) throw new LinkedComputerDispatchError('linked_device_not_authorized')
  if (selected.unavailableReason) throw new LinkedComputerDispatchError(`linked_device_${selected.unavailableReason}`)
  return {
    kind: selected.kind,
    locationId: selected.locationId,
    deviceId: selected.deviceId,
    runtimeTargetId: selected.runtimeTargetId,
    machineLabel: selected.machineLabel,
    mappingId: selected.mappingId,
    mappingLabel: selected.mappingLabel,
    workspaceId: selected.workspaceId,
    credentialVersion: selected.credentialVersion,
    runtimeVersion: selected.runtimeVersion,
    availableAgentIds: selected.availableAgentIds,
    platform: selected.platform,
    deviceKind: selected.deviceKind,
    lastSeenAt: selected.lastSeenAt!,
    publicKey: selected.publicKey,
    accessMode: selected.accessMode,
    ...(selected.updateRequired ? { updateRequired: true } : {}),
  }
}

export function linkedComputerReceiptPayload(receipt: Omit<LinkedComputerExecutionReceipt, 'signature'> | LinkedComputerExecutionReceipt): string {
  return [receipt.deviceId, receipt.runtimeTargetId, String(receipt.credentialVersion), receipt.mappingId,
    receipt.runtimeVersion, receipt.acceptedAt, receipt.toolStartedAt, receipt.outcome, receipt.runId, receipt.requestId].join('\n')
}

export function requireMatchingExecutionReceipt(
  binding: AuthorizedLinkedComputerDispatch,
  receipt: LinkedComputerExecutionReceipt,
  options: { publicKey?: string; runId: string; requestId: string; nowMs?: () => number },
) {
  if (receipt.deviceId !== binding.deviceId || receipt.runtimeTargetId !== binding.runtimeTargetId
    || receipt.credentialVersion !== binding.credentialVersion || receipt.mappingId !== binding.mappingId
    || receipt.runtimeVersion !== binding.runtimeVersion || receipt.runId !== options.runId || receipt.requestId !== options.requestId) {
    throw new Error('linked computers: execution receipt mismatch')
  }
  const acceptedMs = Date.parse(receipt.acceptedAt)
  const toolStartedMs = Date.parse(receipt.toolStartedAt)
  const now = options.nowMs?.() ?? Date.now()
  if (!Number.isFinite(acceptedMs) || !Number.isFinite(toolStartedMs) || acceptedMs > now + 60_000
    || acceptedMs < now - 10 * 60_000 || toolStartedMs < acceptedMs || toolStartedMs > acceptedMs + 10 * 60_000
    || !['accepted', 'started'].includes(receipt.outcome) || !/^[A-Za-z0-9_-]{16,1024}$/.test(receipt.signature)) {
    throw new Error('linked computers: invalid execution receipt')
  }
  let valid = false
  try { valid = verify(null, Buffer.from(linkedComputerReceiptPayload(receipt)), options.publicKey ?? binding.publicKey, Buffer.from(receipt.signature, 'base64url')) } catch { valid = false }
  if (!valid) throw new Error('linked computers: invalid execution receipt signature')
  return { deviceId: binding.deviceId, runtimeTargetId: binding.runtimeTargetId, machineLabel: binding.machineLabel, runtimeVersion: receipt.runtimeVersion, acceptedAt: receipt.acceptedAt, outcome: receipt.outcome }
}
