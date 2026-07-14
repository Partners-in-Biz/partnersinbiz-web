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

const DEVICE_STALE_AFTER_MS = 5 * 60 * 1000

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
  locationId: string
  deviceId: string
  label: string
  platform: LinkedDevicePlatform
  runtimeVersion: string
  mappingId: string
  workspaceId: string
  kind: 'linked-computer'
  deviceKind: LinkedDeviceKind
  ownerType: AuthorizedProjectRuntimeOwner['type']
  visibility: 'private' | 'organization'
  selectable: boolean
  updateRequired?: boolean
  unavailableReason?: LinkedRuntimeUnavailableReason
  lastSeenAt: string | null
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
  workspaceId: string
  owner: AuthorizedProjectRuntimeOwner
  accessMode: DeviceGrantAccessMode
  selectable: boolean
  unavailableReason?: LinkedRuntimeUnavailableReason
  lastSeenAt: string | null
}

export type LinkedRuntimeUnavailableReason = 'offline' | 'stale' | 'update_required'

export interface AuthorizedLinkedComputerDispatch {
  kind: 'linked-computer'
  locationId: string
  deviceId: string
  runtimeTargetId: string
  machineLabel: string
  mappingId: string
  workspaceId: string
  credentialVersion: number
  runtimeVersion: string
  platform: LinkedDevicePlatform
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

interface ResolveInput { userId: string; orgId: string; workspaceId: string; runtimeTargetId?: string }
interface ResolveOptions {
  db?: DbLike
  nowMs?: () => number
  staleAfterMs?: number
  compatibilityTargets?: CompatibilityRuntimeTarget[]
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
  unavailableReason?: LinkedRuntimeUnavailableReason
  owner: AuthorizedProjectRuntimeOwner
  accessMode: DeviceGrantAccessMode
  deviceKind: LinkedDeviceKind
}

export function linkedDeviceProjectLocationId(deviceId: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(deviceId)) throw new Error('linked computers: invalid device id')
  return `linked-device:${deviceId}`
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
  const credentialById = new Map(credentials.map((row) => [String(row.__id ?? row.deviceId ?? ''), row]))
  const now = options.nowMs?.() ?? Date.now()
  const candidates: ResolvedAuthorizedRuntimeTarget[] = []
  for (const device of devices) {
    const grant = grants.find((row) => row.deviceId === device.deviceId && row.orgId === input.orgId)
    const mapping = mappings
      .filter((row) => row.deviceId === device.deviceId && row.orgId === input.orgId && row.workspaceId === input.workspaceId && row.status === 'active')
      .sort((left, right) => left.mappingId.localeCompare(right.mappingId))[0]
    const credential = credentialById.get(device.deviceId)
    if (!grant || grant.status !== 'active' || !grant.capabilities.includes('workspace.execute')) continue
    if (device.status !== 'active' || !Array.isArray(device.capabilities) || !device.capabilities.includes('workspace.execute')) continue
    const ownerType = linkedDeviceOwnerType(device)
    if (ownerType === 'user') {
      const ownerMembership = await membership(db, input.orgId, String(device.ownerUserId))
      if (!ownerMembership.active) continue
    }
    try { assertDeviceOrgAccess({ actorUserId: input.userId, orgId: input.orgId, device, grant, membership: actorMembership }) }
    catch { continue }
    if (!mapping) continue
    if (!credential || credential.revokedAt || Number(credential.credentialVersion) !== device.credentialVersion) continue
    const seen = timestampToMs(device.lastSeenAt)
    const updateRequired = linkedRuntimeUpdateRequired(device.runtimeVersion)
    const unavailableReason: LinkedRuntimeUnavailableReason | undefined = device.health !== 'ok' || seen == null
      ? 'offline'
      : now - seen > (options.staleAfterMs ?? DEVICE_STALE_AFTER_MS)
        ? 'stale'
        : updateRequired ? 'update_required' : undefined
    candidates.push({
      kind: 'linked-computer', locationId: linkedDeviceProjectLocationId(device.deviceId),
      deviceId: device.deviceId, runtimeTargetId: device.runtimeTargetId,
      machineLabel: device.label, mappingId: mapping.mappingId, credentialVersion: device.credentialVersion,
      runtimeVersion: device.runtimeVersion, platform: device.platform, lastSeenAt: seen == null ? null : new Date(seen).toISOString(),
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
  return candidates
}

export async function discoverAuthorizedRuntimeTargets(input: ResolveInput, options: ResolveOptions = {}): Promise<PublicAuthorizedRuntimeTarget[]> {
  const candidates = await resolveCandidates(input, options)
  return candidates.map((target) => ({
    id: target.runtimeTargetId, locationId: target.locationId,
    deviceId: target.deviceId, label: target.machineLabel,
    platform: target.platform, runtimeVersion: target.runtimeVersion, mappingId: target.mappingId,
    workspaceId: target.workspaceId,
    kind: 'linked-computer',
    deviceKind: target.deviceKind,
    ownerType: target.owner.type,
    visibility: target.accessMode === 'organization' ? 'organization' : 'private',
    selectable: !target.unavailableReason,
    ...(target.updateRequired ? { updateRequired: true } : {}),
    ...(target.unavailableReason ? { unavailableReason: target.unavailableReason } : {}),
    lastSeenAt: target.lastSeenAt,
  }))
}

export async function discoverAuthorizedProjectRuntimeTargets(
  input: ResolveInput,
  options: ResolveOptions = {},
): Promise<AuthorizedProjectRuntimeTarget[]> {
  const candidates = await resolveCandidates(input, options)
  return candidates.map((target) => ({
    id: target.runtimeTargetId,
    locationId: target.locationId,
    deviceId: target.deviceId,
    label: target.machineLabel,
    platform: target.platform,
    deviceKind: target.deviceKind,
    mappingId: target.mappingId,
    workspaceId: target.workspaceId,
    owner: target.owner,
    accessMode: target.accessMode,
    selectable: !target.unavailableReason,
    ...(target.unavailableReason ? { unavailableReason: target.unavailableReason } : {}),
    lastSeenAt: target.lastSeenAt,
  }))
}

export async function authorizeLinkedComputerDispatch(input: ResolveInput & { runtimeTargetId: string }, options: ResolveOptions = {}): Promise<AuthorizedLinkedComputerDispatch> {
  const candidates = await resolveCandidates(input, options)
  const selected = candidates.find((target) => target.runtimeTargetId === input.runtimeTargetId || target.deviceId === input.runtimeTargetId)
  if (selected) {
    if (selected.unavailableReason) throw new LinkedComputerDispatchError(`linked_device_${selected.unavailableReason}`)
    return {
      kind: selected.kind, locationId: selected.locationId,
      deviceId: selected.deviceId, runtimeTargetId: selected.runtimeTargetId,
      machineLabel: selected.machineLabel, mappingId: selected.mappingId, workspaceId: selected.workspaceId,
      credentialVersion: selected.credentialVersion, runtimeVersion: selected.runtimeVersion, platform: selected.platform,
      lastSeenAt: selected.lastSeenAt!, publicKey: selected.publicKey,
      accessMode: selected.accessMode,
      ...(selected.updateRequired ? { updateRequired: true } : {}),
    }
  }
  const db = options.db ?? (adminDb as unknown as DbLike)
  const devices = await allRows<LinkedDevice & { health?: string }>(db, 'linked_devices')
  const device = devices.find((row) => row.runtimeTargetId === input.runtimeTargetId || row.deviceId === input.runtimeTargetId)
  if (!device) throw new LinkedComputerDispatchError('linked_device_not_authorized')
  const grants = await allRows<LinkedDeviceGrant>(db, 'linked_device_grants')
  const grant = grants.find((row) => row.deviceId === device.deviceId && row.orgId === input.orgId)
  if (!grant) throw new LinkedComputerDispatchError('linked_device_not_authorized')
  if (linkedDeviceOwnerType(device) === 'user') {
    const ownerMembership = await membership(db, input.orgId, String(device.ownerUserId))
    if (!ownerMembership.active) throw new LinkedComputerDispatchError('linked_device_membership_required')
  }
  const actorMembership = await membership(db, input.orgId, input.userId)
  try { assertDeviceOrgAccess({ actorUserId: input.userId, orgId: input.orgId, device, grant, membership: actorMembership }) }
  catch { throw new LinkedComputerDispatchError('linked_device_not_authorized') }
  const mappings = await allRows<LinkedDeviceWorkspaceMapping>(db, 'linked_device_workspace_mappings')
  if (!mappings.some((row) => row.deviceId === device.deviceId && row.orgId === input.orgId && row.workspaceId === input.workspaceId && row.status === 'active')) {
    throw new LinkedComputerDispatchError('linked_device_mapping_required')
  }
  const seen = timestampToMs(device.lastSeenAt)
  if (device.health !== 'ok' || seen == null) throw new LinkedComputerDispatchError('linked_device_offline')
  if ((options.nowMs?.() ?? Date.now()) - seen > (options.staleAfterMs ?? DEVICE_STALE_AFTER_MS)) throw new LinkedComputerDispatchError('linked_device_stale')
  if (linkedRuntimeUpdateRequired(device.runtimeVersion)) throw new LinkedComputerDispatchError('linked_device_update_required')
  throw new LinkedComputerDispatchError('linked_device_not_authorized')
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
