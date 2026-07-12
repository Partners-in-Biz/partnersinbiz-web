import { adminDb } from '@/lib/firebase/admin'
import { timestampToMs } from '@/lib/agents/runtime-targets'
import type { LinkedDevice, LinkedDeviceGrant, LinkedDeviceWorkspaceMapping } from './types'

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
  deviceId: string
  label: string
  platform: 'macos' | 'windows'
  runtimeVersion: string
  mappingId: string
  kind: 'linked-computer'
  selectable: true
  lastSeenAt: string
}

export interface AuthorizedLinkedComputerDispatch {
  kind: 'linked-computer'
  deviceId: string
  runtimeTargetId: string
  machineLabel: string
  mappingId: string
  credentialVersion: number
  runtimeVersion: string
  platform: 'macos' | 'windows'
  lastSeenAt: string
}

export interface LinkedComputerExecutionReceipt {
  deviceId: string
  runtimeTargetId: string
  credentialVersion: number
  mappingId: string
  acceptedAt: string
  runtimeVersion: string
  outcome: string
  toolStartedAt?: string
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

function activeMembership(row: Record<string, unknown> | undefined, orgId: string, userId: string): boolean {
  return Boolean(row) && row?.orgId === orgId && (row.uid === userId || row.userId === userId) && row.status === 'active'
}

async function allRows<T>(db: DbLike, collection: string): Promise<T[]> {
  const snap = await db.collection(collection).get()
  return snap.docs.map((doc) => ({ ...(doc.data() ?? {}), ...(doc.id ? { __id: doc.id } : {}) }) as T)
}

async function membership(db: DbLike, orgId: string, userId: string): Promise<boolean> {
  const snap = await db.collection('orgMembers').doc(`${orgId}_${userId}`).get()
  return snap.exists && activeMembership(snap.data(), orgId, userId)
}

async function resolveCandidates(input: ResolveInput, options: ResolveOptions): Promise<AuthorizedLinkedComputerDispatch[]> {
  const db = options.db ?? (adminDb as unknown as DbLike)
  if (!await membership(db, input.orgId, input.userId)) throw new LinkedComputerDispatchError('linked_device_membership_required')
  const [devices, grants, mappings, credentials] = await Promise.all([
    allRows<LinkedDevice & { health?: string }>(db, 'linked_devices'),
    allRows<LinkedDeviceGrant>(db, 'linked_device_grants'),
    allRows<LinkedDeviceWorkspaceMapping>(db, 'linked_device_workspace_mappings'),
    allRows<Record<string, unknown>>(db, 'linked_device_credentials'),
  ])
  const credentialById = new Map(credentials.map((row) => [String(row.__id ?? row.deviceId ?? ''), row]))
  const now = options.nowMs?.() ?? Date.now()
  const candidates: AuthorizedLinkedComputerDispatch[] = []
  for (const device of devices) {
    const grant = grants.find((row) => row.deviceId === device.deviceId && row.orgId === input.orgId)
    const mapping = mappings.find((row) => row.deviceId === device.deviceId && row.orgId === input.orgId && row.workspaceId === input.workspaceId && row.status === 'active')
    const credential = credentialById.get(device.deviceId)
    const owner = device.ownerUserId === input.userId
    const shared = grant?.allowedUserIds?.includes(input.userId) === true
    if (!owner && !shared) continue
    if (!await membership(db, input.orgId, device.ownerUserId)) continue
    if (!grant || grant.status !== 'active' || !grant.capabilities.includes('workspace.execute')) continue
    if (device.status !== 'active' || device.health !== 'ok' || !device.capabilities.includes('workspace.execute')) continue
    const seen = timestampToMs(device.lastSeenAt)
    if (seen == null || now - seen > (options.staleAfterMs ?? DEVICE_STALE_AFTER_MS)) continue
    if (!mapping) continue
    if (!credential || credential.revokedAt || Number(credential.credentialVersion) !== device.credentialVersion) continue
    candidates.push({
      kind: 'linked-computer', deviceId: device.deviceId, runtimeTargetId: device.runtimeTargetId,
      machineLabel: device.label, mappingId: mapping.mappingId, credentialVersion: device.credentialVersion,
      runtimeVersion: device.runtimeVersion, platform: device.platform, lastSeenAt: new Date(seen).toISOString(),
    })
  }
  return candidates
}

export async function discoverAuthorizedRuntimeTargets(input: ResolveInput, options: ResolveOptions = {}): Promise<PublicAuthorizedRuntimeTarget[]> {
  const candidates = await resolveCandidates(input, options)
  return candidates.map((target) => ({
    id: target.runtimeTargetId, deviceId: target.deviceId, label: target.machineLabel,
    platform: target.platform, runtimeVersion: target.runtimeVersion, mappingId: target.mappingId,
    kind: 'linked-computer', selectable: true,
    lastSeenAt: target.lastSeenAt,
  }))
}

export async function authorizeLinkedComputerDispatch(input: ResolveInput & { runtimeTargetId: string }, options: ResolveOptions = {}): Promise<AuthorizedLinkedComputerDispatch> {
  const candidates = await resolveCandidates(input, options)
  const selected = candidates.find((target) => target.runtimeTargetId === input.runtimeTargetId || target.deviceId === input.runtimeTargetId)
  if (selected) return selected
  const db = options.db ?? (adminDb as unknown as DbLike)
  const devices = await allRows<LinkedDevice & { health?: string }>(db, 'linked_devices')
  const device = devices.find((row) => row.runtimeTargetId === input.runtimeTargetId || row.deviceId === input.runtimeTargetId)
  if (!device) throw new LinkedComputerDispatchError('linked_device_not_authorized')
  if (device.ownerUserId !== input.userId) {
    const ownerIsMember = await membership(db, input.orgId, device.ownerUserId)
    if (!ownerIsMember) throw new LinkedComputerDispatchError('linked_device_membership_required')
  }
  const seen = timestampToMs(device.lastSeenAt)
  if (seen == null || (options.nowMs?.() ?? Date.now()) - seen > (options.staleAfterMs ?? DEVICE_STALE_AFTER_MS)) throw new LinkedComputerDispatchError('linked_device_stale')
  const mappings = await allRows<LinkedDeviceWorkspaceMapping>(db, 'linked_device_workspace_mappings')
  if (!mappings.some((row) => row.deviceId === device.deviceId && row.orgId === input.orgId && row.workspaceId === input.workspaceId && row.status === 'active')) {
    throw new LinkedComputerDispatchError('linked_device_mapping_required')
  }
  throw new LinkedComputerDispatchError('linked_device_not_authorized')
}

export function requireMatchingExecutionReceipt(binding: AuthorizedLinkedComputerDispatch, receipt: LinkedComputerExecutionReceipt) {
  if (receipt.deviceId !== binding.deviceId || receipt.runtimeTargetId !== binding.runtimeTargetId
    || receipt.credentialVersion !== binding.credentialVersion || receipt.mappingId !== binding.mappingId) {
    throw new Error('linked computers: execution receipt mismatch')
  }
  if (!Number.isFinite(Date.parse(receipt.acceptedAt)) || !receipt.runtimeVersion || !receipt.outcome) {
    throw new Error('linked computers: invalid execution receipt')
  }
  return { deviceId: binding.deviceId, runtimeTargetId: binding.runtimeTargetId, machineLabel: binding.machineLabel, runtimeVersion: receipt.runtimeVersion, acceptedAt: receipt.acceptedAt, outcome: receipt.outcome }
}
