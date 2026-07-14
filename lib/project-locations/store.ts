import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import {
  discoverAuthorizedProjectRuntimeTargets,
  type AuthorizedProjectRuntimeTarget,
} from '@/lib/linked-computers/runtime-targets'
import { buildProjectReplica, projectReplicaId, type ProjectExecutionLocation, type ProjectLocationReplica } from './model'

export const PROJECT_EXECUTION_LOCATIONS_COLLECTION = 'project_execution_locations'
export const PROJECT_LOCATION_REPLICAS_COLLECTION = 'project_location_replicas'

export type ProjectLocationStoreErrorCode =
  | 'location_inactive'
  | 'computer_unavailable'
  | 'location_forbidden'
  | 'private_owner_required'
  | 'location_not_found'
  | 'mapping_inactive'
  | 'replica_identity_conflict'
  | 'replica_not_found'

const STORE_ERROR_DETAILS: Record<ProjectLocationStoreErrorCode, { message: string; status: number }> = {
  location_inactive: { message: 'project location is not active', status: 409 },
  computer_unavailable: { message: 'Computer unavailable', status: 409 },
  location_forbidden: { message: 'project location is not available to this organisation', status: 403 },
  private_owner_required: { message: 'private location owner required', status: 403 },
  location_not_found: { message: 'project location not found', status: 404 },
  mapping_inactive: { message: 'location mapping is not active for this organisation and Workspace', status: 403 },
  replica_identity_conflict: { message: 'project replica identity conflict', status: 409 },
  replica_not_found: { message: 'project replica not found', status: 404 },
}

export class ProjectLocationStoreError extends Error {
  readonly status: number

  constructor(readonly code: ProjectLocationStoreErrorCode) {
    const detail = STORE_ERROR_DETAILS[code]
    super(detail.message)
    this.name = 'ProjectLocationStoreError'
    this.status = detail.status
  }
}

export interface ProjectLocationRepository {
  getLocation(locationId: string): Promise<ProjectExecutionLocation | null>
  listLocations(): Promise<ProjectExecutionLocation[]>
  getReplica(replicaId: string): Promise<ProjectLocationReplica | null>
  listReplicas(projectId: string): Promise<ProjectLocationReplica[]>
  putReplica(replica: ProjectLocationReplica): Promise<void>
  patchReplica(replicaId: string, patch: Partial<ProjectLocationReplica>): Promise<void>
}

export class FirestoreProjectLocationRepository implements ProjectLocationRepository {
  async getLocation(locationId: string): Promise<ProjectExecutionLocation | null> {
    const doc = await adminDb.collection(PROJECT_EXECUTION_LOCATIONS_COLLECTION).doc(locationId).get()
    return doc.exists ? doc.data() as ProjectExecutionLocation : null
  }

  async listLocations(): Promise<ProjectExecutionLocation[]> {
    const snapshot = await adminDb.collection(PROJECT_EXECUTION_LOCATIONS_COLLECTION).get()
    return snapshot.docs.map((doc) => doc.data() as ProjectExecutionLocation)
  }

  async getReplica(replicaId: string): Promise<ProjectLocationReplica | null> {
    const doc = await adminDb.collection(PROJECT_LOCATION_REPLICAS_COLLECTION).doc(replicaId).get()
    return doc.exists ? doc.data() as ProjectLocationReplica : null
  }

  async listReplicas(projectId: string): Promise<ProjectLocationReplica[]> {
    const snapshot = await adminDb.collection(PROJECT_LOCATION_REPLICAS_COLLECTION).where('projectId', '==', projectId).get()
    return snapshot.docs.map((doc) => doc.data() as ProjectLocationReplica)
  }

  async putReplica(replica: ProjectLocationReplica): Promise<void> {
    await adminDb.collection(PROJECT_LOCATION_REPLICAS_COLLECTION).doc(replica.replicaId).set(replica)
  }

  async patchReplica(replicaId: string, patch: Partial<ProjectLocationReplica>): Promise<void> {
    await adminDb.collection(PROJECT_LOCATION_REPLICAS_COLLECTION).doc(replicaId).set(patch, { merge: true })
  }
}

type DiscoverLinkedTargets = (input: {
  userId: string
  orgId: string
  workspaceId: string
}) => Promise<AuthorizedProjectRuntimeTarget[]>

export interface ProjectLocationStoreOptions {
  repository?: ProjectLocationRepository
  now?: () => unknown
  /** Test seam; production dynamically derives locations from linked-device authorization. */
  discoverLinkedTargets?: DiscoverLinkedTargets
}

export interface LinkProjectLocationInput {
  projectId: string
  orgId: string
  workspaceId: string
  locationId: string
  mappingId: string
  actorUserId: string
  relativePath?: string
  desiredRevision?: string | null
  currentRevision?: string | null
  isCanonical?: boolean
}

function repository(options: ProjectLocationStoreOptions): ProjectLocationRepository {
  return options.repository ?? new FirestoreProjectLocationRepository()
}

function assertLocationAccess(
  location: ProjectExecutionLocation,
  orgId: string,
  actorUserId: string,
  authorizedNative = false,
): void {
  if (location.status !== 'active') throw new ProjectLocationStoreError('location_inactive')
  if (location.availability !== 'online') throw new ProjectLocationStoreError('computer_unavailable')
  const orgAllowed = location.allowedOrgIds.includes(orgId)
    || (location.owner.type === 'organization' && location.owner.orgId === orgId)
  if (!orgAllowed) throw new ProjectLocationStoreError('location_forbidden')
  if (!authorizedNative && location.visibility === 'private'
    && (location.owner.type !== 'user' || location.owner.userId !== actorUserId)) {
    throw new ProjectLocationStoreError('private_owner_required')
  }
}

function nativeDiscovery(options: ProjectLocationStoreOptions): DiscoverLinkedTargets | null {
  if (options.discoverLinkedTargets) return options.discoverLinkedTargets
  // A custom repository is a unit/integration-test boundary. Do not silently
  // reach into production Firestore from tests that did not request discovery.
  if (options.repository) return null
  return (input) => discoverAuthorizedProjectRuntimeTargets(input)
}

function nativeProjectLocation(
  target: AuthorizedProjectRuntimeTarget,
  orgId: string,
): ProjectExecutionLocation {
  return {
    locationId: target.locationId,
    label: target.label,
    kind: target.deviceKind ?? 'computer',
    platform: target.platform,
    runtimeTargetId: target.id,
    owner: target.owner,
    visibility: target.accessMode === 'organization' ? 'organization' : 'private',
    allowedOrgIds: [orgId],
    status: 'active',
    availability: target.selectable ? 'online' : 'offline',
    // Pairing credential + active grant + confirmed Workspace mapping is the
    // native runtime's verification boundary. Freshness remains availability.
    verificationStatus: 'verified',
    mappings: [{
      mappingId: target.mappingId,
      orgId,
      workspaceId: target.workspaceId,
      status: 'active',
    }],
    lastSeenAt: target.lastSeenAt,
    createdAt: null,
    updatedAt: target.lastSeenAt,
  }
}

async function nativeLocationsForWorkspace(
  orgId: string,
  workspaceId: string,
  actorUserId: string,
  options: ProjectLocationStoreOptions,
): Promise<ProjectExecutionLocation[]> {
  const discover = nativeDiscovery(options)
  if (!discover) return []
  return (await discover({ userId: actorUserId, orgId, workspaceId }))
    .map((target) => nativeProjectLocation(target, orgId))
}

function sameReplicaIdentity(existing: ProjectLocationReplica, candidate: ProjectLocationReplica): boolean {
  return existing.projectId === candidate.projectId && existing.orgId === candidate.orgId
    && existing.locationId === candidate.locationId && existing.workspaceId === candidate.workspaceId
    && existing.mappingId === candidate.mappingId && existing.relativePath === candidate.relativePath
}

export async function linkProjectLocation(input: LinkProjectLocationInput, options: ProjectLocationStoreOptions = {}): Promise<ProjectLocationReplica> {
  const repo = repository(options)
  const nativeLocationId = input.locationId.startsWith('linked-device:')
  let location = nativeLocationId ? null : await repo.getLocation(input.locationId)
  let authorizedNative = false
  if (!location) {
    const nativeLocations = await nativeLocationsForWorkspace(input.orgId, input.workspaceId, input.actorUserId, options)
    location = nativeLocations.find((candidate) => (
      candidate.locationId === input.locationId || candidate.runtimeTargetId === input.locationId
    )) ?? null
    authorizedNative = Boolean(location)
  }
  if (!location) throw new ProjectLocationStoreError('location_not_found')
  assertLocationAccess(location, input.orgId, input.actorUserId, authorizedNative)
  const mapping = location.mappings.find((candidate) => (
    candidate.orgId === input.orgId
    && candidate.workspaceId === input.workspaceId
    && candidate.status === 'active'
  ))
  if (!mapping) throw new ProjectLocationStoreError('mapping_inactive')
  const now = options.now?.() ?? FieldValue.serverTimestamp()
  // Never trust a mapping supplied by a browser. The active mapping is derived
  // from the currently authorized server-side location view.
  const candidate = buildProjectReplica({ ...input, mappingId: mapping.mappingId, location, now })
  // Read the pre-scope migration key as a compatibility fallback. New rows use
  // the full org/Workspace/mapping identity so a shared project and machine can
  // be linked independently in more than one organisation.
  const scopedExisting = await repo.getReplica(candidate.replicaId)
  const legacyExisting = scopedExisting
    ? null
    : await repo.getReplica(projectReplicaId(input.projectId, location.locationId))
  const existing = legacyExisting && sameReplicaIdentity(legacyExisting, candidate)
    ? legacyExisting
    : scopedExisting
  if (existing) {
    if (!sameReplicaIdentity(existing, candidate)) throw new ProjectLocationStoreError('replica_identity_conflict')
    if (existing.active) {
      if (input.isCanonical === true && existing.isCanonical !== true) {
        const patch: Partial<ProjectLocationReplica> = { isCanonical: true, updatedAt: now }
        await repo.patchReplica(existing.replicaId, patch)
        return { ...existing, ...patch }
      }
      return existing
    }
    const patch: Partial<ProjectLocationReplica> = {
      active: true,
      availability: location.availability,
      syncStatus: location.availability === 'offline' ? 'offline' : 'pending',
      ...(input.isCanonical === true ? { isCanonical: true } : {}),
      unlinkedAt: null,
      unlinkedByUserId: null,
      updatedAt: now,
    }
    await repo.patchReplica(existing.replicaId, patch)
    return { ...existing, ...patch }
  }
  await repo.putReplica(candidate)
  return candidate
}

export async function listProjectLocations(
  projectId: string,
  orgId: string,
  actorUserId: string,
  options: ProjectLocationStoreOptions = {},
): Promise<ProjectLocationReplica[]> {
  const replicas = (await repository(options).listReplicas(projectId))
    .filter((replica) => replica.orgId === orgId && replica.active)
  const nativeWorkspaceIds = Array.from(new Set(replicas
    .filter((replica) => replica.locationId.startsWith('linked-device:'))
    .map((replica) => replica.workspaceId)))
  const nativeByLocationId = new Map<string, ProjectExecutionLocation>()
  await Promise.all(nativeWorkspaceIds.map(async (workspaceId) => {
    const locations = await nativeLocationsForWorkspace(orgId, workspaceId, actorUserId, options).catch(() => [])
    for (const location of locations) nativeByLocationId.set(location.locationId, location)
  }))

  return replicas
    .filter((replica) => replica.locationId.startsWith('linked-device:')
      ? nativeByLocationId.has(replica.locationId)
      : replica.locationVisibility !== 'private'
        || (replica.locationOwner.type === 'user' && replica.locationOwner.userId === actorUserId))
    .map((replica) => {
      const current = nativeByLocationId.get(replica.locationId)
      return current ? {
        ...replica,
        locationLabel: current.label,
        locationPlatform: current.platform,
        availability: current.availability,
      } : replica
    })
    .sort((left, right) => left.locationLabel.localeCompare(right.locationLabel))
}

export interface UnlinkProjectLocationInput {
  replicaId: string
  projectId: string
  orgId: string
  actorUserId: string
}

export async function unlinkProjectLocation(input: UnlinkProjectLocationInput, options: ProjectLocationStoreOptions = {}): Promise<ProjectLocationReplica> {
  const repo = repository(options)
  const replica = await repo.getReplica(input.replicaId)
  if (!replica || replica.projectId !== input.projectId || replica.orgId !== input.orgId) {
    throw new ProjectLocationStoreError('replica_not_found')
  }
  let authorizedNative = false
  if (replica.locationId.startsWith('linked-device:')) {
    const current = await nativeLocationsForWorkspace(
      input.orgId, replica.workspaceId, input.actorUserId, options,
    ).catch(() => [])
    authorizedNative = current.some((location) => location.locationId === replica.locationId)
  }
  if (!authorizedNative && replica.locationVisibility === 'private'
    && (replica.locationOwner.type !== 'user' || replica.locationOwner.userId !== input.actorUserId)) {
    throw new ProjectLocationStoreError('private_owner_required')
  }
  if (!replica.active) return replica
  const patch: Partial<ProjectLocationReplica> = {
    active: false,
    syncStatus: 'offline',
    unlinkedAt: options.now?.() ?? FieldValue.serverTimestamp(),
    unlinkedByUserId: input.actorUserId,
    updatedAt: options.now?.() ?? FieldValue.serverTimestamp(),
  }
  await repo.patchReplica(replica.replicaId, patch)
  return { ...replica, ...patch }
}

function locationAvailableToActor(
  location: ProjectExecutionLocation,
  orgId: string,
  workspaceId: string,
  actorUserId: string,
): boolean {
  if (location.status !== 'active') return false
  const allowed = location.allowedOrgIds.includes(orgId)
    || (location.owner.type === 'organization' && location.owner.orgId === orgId)
  if (!allowed) return false
  if (location.visibility === 'private'
    && (location.owner.type !== 'user' || location.owner.userId !== actorUserId)) return false
  return location.mappings.some((mapping) => mapping.orgId === orgId
    && mapping.workspaceId === workspaceId && mapping.status === 'active')
}

export async function listExecutionLocationsForWorkspace(
  orgId: string,
  workspaceId: string,
  actorUserId: string,
  options: ProjectLocationStoreOptions = {},
): Promise<ProjectExecutionLocation[]> {
  const stored = (await repository(options).listLocations())
    .filter((location) => !location.locationId.startsWith('linked-device:')
      && locationAvailableToActor(location, orgId, workspaceId, actorUserId))
  const native = await nativeLocationsForWorkspace(orgId, workspaceId, actorUserId, options)
  const storedRuntimeIds = new Set(stored.flatMap((location) => [
    location.runtimeTargetId,
    ...(location.legacyCompatibilityTargetId ? [location.legacyCompatibilityTargetId] : []),
  ]))
  const byLocationId = new Map(stored.map((location) => [location.locationId, location]))
  for (const location of native) {
    // A migrated first-class row wins over its linked transport adapter. This
    // keeps canonical Partners VPS/Mac location IDs stable during transition.
    if (storedRuntimeIds.has(location.runtimeTargetId) || byLocationId.has(location.locationId)) continue
    byLocationId.set(location.locationId, location)
  }
  return Array.from(byLocationId.values())
    .sort((left, right) => left.label.localeCompare(right.label))
}

export async function getExecutionLocationByRuntimeTarget(
  runtimeTargetId: string,
  orgId: string,
  workspaceId: string,
  actorUserId: string,
  options: ProjectLocationStoreOptions = {},
): Promise<ProjectExecutionLocation | null> {
  const target = runtimeTargetId.trim()
  if (!target) return null
  const locations = await listExecutionLocationsForWorkspace(orgId, workspaceId, actorUserId, options)
  return locations.find((location) => location.runtimeTargetId === target
    || location.legacyCompatibilityTargetId === target
    || location.locationId === target) ?? null
}
