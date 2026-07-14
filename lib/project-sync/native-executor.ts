import { adminDb } from '@/lib/firebase/admin'
import { isActiveOrgMembershipRow, linkedDeviceOwnerType } from '@/lib/linked-computers/policy'
import type { LinkedDevice } from '@/lib/linked-computers/types'
import { projectLinkedOrgIds } from '@/lib/project-locations/model'
import { projectOrganizationDocId } from '@/lib/projects/collaboration'
import type { ProjectSyncRequest, ProjectSyncWorkerBinding } from './model'

export const PROJECT_SYNC_PROTOCOL_VERSION = 1
/**
 * Compatibility name retained for existing deployments. A value of `true`
 * attests that an operator read back BOTH all five project-sync Firestore TTL
 * policies and the project-sync Cloud Storage lifecycle rule in this exact
 * environment. It must never be set from only one of those proofs.
 */
export const PROJECT_SYNC_STORAGE_LIFECYCLE_ENV = 'PROJECT_SYNC_STORAGE_LIFECYCLE_VERIFIED'

/** Returns the combined project-sync retention-controls attestation. */
export function projectSyncStorageLifecycleVerified(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.PROJECT_SYNC_STORAGE_LIFECYCLE_VERIFIED?.trim().toLowerCase() === 'true'
}

type Row = Record<string, unknown>

export interface ProjectSyncExecutorLookup {
  getDevice(deviceId: string): Promise<Row | null>
  getCredential(deviceId: string): Promise<Row | null>
  getGrant(orgId: string, deviceId: string): Promise<Row | null>
  getMapping(mappingId: string): Promise<Row | null>
  getReplica(replicaId: string): Promise<Row | null>
  getRequest(requestId: string): Promise<ProjectSyncRequest | null>
  getProject(projectId: string): Promise<Row | null>
  getProjectOrganization(projectId: string, orgId: string): Promise<Row | null>
  getMembership(orgId: string, userId: string): Promise<Row | null>
}

interface ReadSnapshot {
  exists: boolean
  data(): Row | undefined
}

interface ReadDb {
  collection(name: string): { doc(id: string): { get(): Promise<ReadSnapshot> } }
}

async function read(db: ReadDb, collection: string, id: string): Promise<Row | null> {
  const snapshot = await db.collection(collection).doc(id).get()
  return snapshot.exists ? snapshot.data() ?? null : null
}

export function createProjectSyncExecutorLookup(db = adminDb as unknown as ReadDb): ProjectSyncExecutorLookup {
  return {
    getDevice: (deviceId) => read(db, 'linked_devices', deviceId),
    getCredential: (deviceId) => read(db, 'linked_device_credentials', deviceId),
    getGrant: (orgId, deviceId) => read(db, 'linked_device_grants', `${orgId}_${deviceId}`),
    getMapping: (mappingId) => read(db, 'linked_device_workspace_mappings', mappingId),
    getReplica: (replicaId) => read(db, 'project_location_replicas', replicaId),
    getRequest: async (requestId) => await read(db, 'project_sync_requests', requestId) as unknown as ProjectSyncRequest | null,
    getProject: (projectId) => read(db, 'projects', projectId),
    getProjectOrganization: (projectId, orgId) => read(db, 'projectOrganizations', projectOrganizationDocId(projectId, orgId)),
    getMembership: (orgId, userId) => read(db, 'orgMembers', `${orgId}_${userId}`),
  }
}

function hasCapability(row: Row | null, capability: string): boolean {
  return Array.isArray(row?.capabilities) && row.capabilities.includes(capability)
}

function activeProject(row: Row | null): boolean {
  if (!row || row.active === false || row.archived === true || row.deleted === true || row.deletedAt) return false
  const status = typeof row.status === 'string' ? row.status.trim().toLowerCase() : ''
  return !['archived', 'deleted', 'inactive', 'completed', 'complete', 'closed', 'cancelled'].includes(status)
}

function activeProjectOrganization(row: Row | null, project: Row | null, projectId: string, orgId: string): boolean {
  // An exact canonical row is authoritative, including a revoked/pending
  // tombstone. Legacy project organisation fields remain the compatibility
  // fallback only when no canonical row exists yet.
  if (row) return row.projectId === projectId && row.orgId === orgId && row.status === 'active'
  return Boolean(project && projectLinkedOrgIds(project).includes(orgId))
}

function deviceOwner(device: Row | null): { valid: boolean; privateOwnerUserId?: string } {
  if (!device) return { valid: false }
  try {
    if (linkedDeviceOwnerType(device as unknown as LinkedDevice) === 'user') {
      const ownerUserId = typeof device.ownerUserId === 'string' ? device.ownerUserId.trim() : ''
      return ownerUserId ? { valid: true, privateOwnerUserId: ownerUserId } : { valid: false }
    }
    return { valid: true }
  } catch {
    return { valid: false }
  }
}

function activeOwnerMembership(row: Row | null, orgId: string, userId: string): boolean {
  const memberUserId = typeof row?.uid === 'string' ? row.uid : typeof row?.userId === 'string' ? row.userId : ''
  return row?.orgId === orgId && memberUserId === userId && isActiveOrgMembershipRow(row ?? undefined)
}

function deviceIdFromLocation(locationId: unknown): string | null {
  if (typeof locationId !== 'string' || !locationId.startsWith('linked-device:')) return null
  const deviceId = locationId.slice('linked-device:'.length)
  return /^[A-Za-z0-9_-]{1,128}$/.test(deviceId) ? deviceId : null
}

function activeExecutor(input: {
  deviceId: string
  orgId: string
  mappingId: string
  workspaceId: string
  credentialVersion?: number
  device: Row | null
  credential: Row | null
  grant: Row | null
  mapping: Row | null
}): boolean {
  return input.device?.deviceId === input.deviceId
    && input.device.status === 'active'
    && ['macos', 'linux'].includes(String(input.device.platform))
    && hasCapability(input.device, 'workspace.sync')
    && Number(input.device.syncProtocolVersion) >= PROJECT_SYNC_PROTOCOL_VERSION
    && input.credential?.deviceId === input.deviceId
    && !input.credential.revokedAt
    && Number(input.credential.credentialVersion) === Number(input.device.credentialVersion)
    && (input.credentialVersion === undefined || Number(input.device.credentialVersion) === input.credentialVersion)
    && input.grant?.deviceId === input.deviceId
    && input.grant.orgId === input.orgId
    && input.grant.status === 'active'
    && hasCapability(input.grant, 'workspace.sync')
    && input.mapping?.mappingId === input.mappingId
    && input.mapping.deviceId === input.deviceId
    && input.mapping.orgId === input.orgId
    && input.mapping.workspaceId === input.workspaceId
    && input.mapping.status === 'active'
}

export async function authorizeProjectSyncWorker(input: {
  identity: { deviceId: string; credentialVersion: number }
  binding: ProjectSyncWorkerBinding
}, options: { lookup?: ProjectSyncExecutorLookup } = {}): Promise<{
  device: Row
  grant: Row
  mapping: Row
  replica: Row
  request: ProjectSyncRequest
}> {
  const lookup = options.lookup ?? createProjectSyncExecutorLookup()
  const { binding, identity } = input
  const replica = await lookup.getReplica(binding.replicaId)
  const workspaceId = typeof replica?.workspaceId === 'string' ? replica.workspaceId : ''
  const expectedDeviceId = deviceIdFromLocation(binding.locationId)
  const [device, credential, grant, mapping, request, project, projectOrganization] = await Promise.all([
    lookup.getDevice(identity.deviceId),
    lookup.getCredential(identity.deviceId),
    lookup.getGrant(binding.orgId, identity.deviceId),
    lookup.getMapping(binding.mappingId),
    lookup.getRequest(binding.requestId),
    lookup.getProject(binding.projectId),
    lookup.getProjectOrganization(binding.projectId, binding.orgId),
  ])
  const owner = deviceOwner(device)
  const ownerMembership = owner.privateOwnerUserId
    ? await lookup.getMembership(binding.orgId, owner.privateOwnerUserId)
    : null
  const requestReplica = request?.replicaStates.find((candidate) => candidate.replicaId === binding.replicaId)
  const exactBinding = binding.capability === 'workspace.sync'
    && expectedDeviceId === identity.deviceId
    && replica?.replicaId === binding.replicaId
    && replica.active === true
    && replica.orgId === binding.orgId
    && replica.projectId === binding.projectId
    && replica.locationId === binding.locationId
    && replica.mappingId === binding.mappingId
    && request?.requestId === binding.requestId
    && request.orgId === binding.orgId
    && request.projectId === binding.projectId
    && request.continuousExecutorVerified === true
    && activeProject(project)
    && activeProjectOrganization(projectOrganization, project, binding.projectId, binding.orgId)
    && owner.valid
    && (!owner.privateOwnerUserId || activeOwnerMembership(ownerMembership, binding.orgId, owner.privateOwnerUserId))
    && requestReplica?.locationId === binding.locationId
    && requestReplica.mappingId === binding.mappingId
  if (!exactBinding || !workspaceId || !activeExecutor({
    deviceId: identity.deviceId,
    orgId: binding.orgId,
    mappingId: binding.mappingId,
    workspaceId,
    credentialVersion: identity.credentialVersion,
    device,
    credential,
    grant,
    mapping,
  })) {
    throw new Error('project sync workspace.sync binding denied')
  }
  return { device: device!, grant: grant!, mapping: mapping!, replica: replica!, request: request! }
}

export interface ExecutorEligibilityReplica {
  replicaId: string
  orgId: string
  projectId: string
  workspaceId: string
  locationId: string
  mappingId: string
  availability: 'online' | 'offline' | 'unknown'
  active: boolean
}

export async function verifyProjectSyncExecutorEligibility(
  replicas: ExecutorEligibilityReplica[],
  options: { lookup?: ProjectSyncExecutorLookup; storageLifecycleVerified?: boolean } = {},
): Promise<{ verified: boolean; started: boolean; blockers: string[] }> {
  const lookup = options.lookup ?? createProjectSyncExecutorLookup()
  const blockers: string[] = []
  if (!(options.storageLifecycleVerified ?? projectSyncStorageLifecycleVerified())) {
    blockers.push('storage_lifecycle_unverified')
  }
  for (const replica of replicas) {
    const deviceId = deviceIdFromLocation(replica.locationId)
    if (!replica.active || !deviceId) {
      blockers.push(`native_replica_required:${replica.replicaId}`)
      continue
    }
    const [device, credential, grant, mapping, project, projectOrganization] = await Promise.all([
      lookup.getDevice(deviceId),
      lookup.getCredential(deviceId),
      lookup.getGrant(replica.orgId, deviceId),
      lookup.getMapping(replica.mappingId),
      lookup.getProject(replica.projectId),
      lookup.getProjectOrganization(replica.projectId, replica.orgId),
    ])
    if (!hasCapability(device, 'workspace.sync') || !hasCapability(grant, 'workspace.sync')) {
      blockers.push(`sync_capability_unavailable:${replica.replicaId}`)
      continue
    }
    if (!(Number(device?.syncProtocolVersion) >= PROJECT_SYNC_PROTOCOL_VERSION)) {
      blockers.push(`sync_executor_unavailable:${replica.replicaId}`)
      continue
    }
    if (!activeProject(project) || !activeProjectOrganization(projectOrganization, project, replica.projectId, replica.orgId)) {
      blockers.push(`project_access_revoked:${replica.replicaId}`)
      continue
    }
    const owner = deviceOwner(device)
    if (!owner.valid) {
      blockers.push(`sync_binding_unavailable:${replica.replicaId}`)
      continue
    }
    if (owner.privateOwnerUserId) {
      const membership = await lookup.getMembership(replica.orgId, owner.privateOwnerUserId)
      if (!activeOwnerMembership(membership, replica.orgId, owner.privateOwnerUserId)) {
        blockers.push(`device_owner_membership_revoked:${replica.replicaId}`)
        continue
      }
    }
    if (!activeExecutor({
      deviceId,
      orgId: replica.orgId,
      mappingId: replica.mappingId,
      workspaceId: replica.workspaceId,
      device,
      credential,
      grant,
      mapping,
    })) {
      blockers.push(`sync_binding_unavailable:${replica.replicaId}`)
      continue
    }
    if (replica.availability !== 'online') blockers.push(`replica_offline:${replica.replicaId}`)
  }
  const hardBlockers = blockers.filter((blocker) => !blocker.startsWith('replica_offline:'))
  return { verified: hardBlockers.length === 0, started: blockers.length === 0, blockers }
}
