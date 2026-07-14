import { createHash } from 'node:crypto'

export type ProjectLocationKind = 'vps' | 'computer'
export type ProjectLocationPlatform = 'linux' | 'macos' | 'windows'
export type ProjectLocationVisibility = 'private' | 'organization'
export type ProjectLocationAvailability = 'online' | 'offline' | 'unknown'
export type ProjectReplicaSyncStatus = 'pending' | 'syncing' | 'synced' | 'conflict' | 'offline' | 'error'

export type ProjectLocationOwner =
  | { type: 'organization'; orgId: string }
  | { type: 'user'; userId: string }

export interface ProjectLocationMapping {
  mappingId: string
  orgId: string
  workspaceId: string
  status: 'active' | 'paused' | 'removed'
}

export interface ProjectExecutionLocation {
  locationId: string
  label: string
  kind: ProjectLocationKind
  platform: ProjectLocationPlatform
  runtimeTargetId: string
  /** Opaque identity of the concrete host/endpoint that this location was linked to. */
  transportIdentity?: string
  owner: ProjectLocationOwner
  visibility: ProjectLocationVisibility
  allowedOrgIds: string[]
  status: 'active' | 'paused' | 'retired'
  availability: ProjectLocationAvailability
  verificationStatus: 'pending' | 'verified' | 'failed'
  mappings: ProjectLocationMapping[]
  legacyCompatibilityTargetId?: string
  lastSeenAt?: unknown | null
  createdAt: unknown
  updatedAt: unknown
}

export interface ProjectLocationReplica {
  replicaId: string
  projectId: string
  orgId: string
  workspaceId: string
  locationId: string
  locationLabel: string
  locationKind: ProjectLocationKind
  locationPlatform: ProjectLocationPlatform
  locationOwner: ProjectLocationOwner
  locationVisibility: ProjectLocationVisibility
  mappingId: string
  relativePath: string
  availability: ProjectLocationAvailability
  desiredRevision: string | null
  currentRevision: string | null
  syncStatus: ProjectReplicaSyncStatus
  /** The authoritative location may execute while secondary replicas wait for their first verified sync. */
  isCanonical?: boolean
  lastSync: Record<string, unknown> | null
  lastError: Record<string, unknown> | null
  lastConflict: Record<string, unknown> | null
  active: boolean
  linkedByUserId: string
  createdAt: unknown
  updatedAt: unknown
  unlinkedAt?: unknown | null
  unlinkedByUserId?: string | null
}

export type ProjectReplicaRuntimeUnavailableReason = 'computer_offline' | 'project_sync_pending'

/**
 * A heartbeat only proves that the machine can receive work. The authoritative
 * location is immediately dispatchable; every secondary replica must first
 * reach a verified synced revision.
 */
export function projectReplicaRuntimeUnavailableReason(
  replica: Pick<ProjectLocationReplica, 'availability' | 'syncStatus' | 'isCanonical'>,
): ProjectReplicaRuntimeUnavailableReason | undefined {
  if (replica.availability !== 'online') return 'computer_offline'
  if (replica.syncStatus !== 'synced') {
    const authoritativeWorkInProgress = replica.isCanonical === true
      && (replica.syncStatus === 'pending' || replica.syncStatus === 'syncing')
    if (!authoritativeWorkInProgress) return 'project_sync_pending'
  }
  return undefined
}

export function projectReplicaRuntimeReady(
  replica: Pick<ProjectLocationReplica, 'availability' | 'syncStatus' | 'isCanonical'>,
): boolean {
  return projectReplicaRuntimeUnavailableReason(replica) === undefined
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

function requiredId(value: string, field: string): string {
  const clean = value.trim()
  if (!SAFE_ID.test(clean)) throw new Error(`${field} is invalid`)
  return clean
}

function nullableRevision(value: unknown): string | null {
  if (value == null) return null
  if (typeof value !== 'string') throw new Error('revision must be a string or null')
  const clean = value.trim()
  if (!clean) return null
  if (clean.length > 256 || /[\u0000-\u001f]/.test(clean)) throw new Error('revision is invalid')
  return clean
}

export function canonicalProjectRelativePath(projectId: string, value?: string): string {
  const fallback = `projects/${requiredId(projectId, 'projectId')}`
  const raw = (value ?? fallback).trim()
  if (!raw || raw.startsWith('/') || raw.startsWith('~') || /^[A-Za-z]:[\\/]/.test(raw) || raw.includes('\\')) {
    throw new Error('relativePath must be relative')
  }
  if (raw.length > 512 || /[\u0000-\u001f]/.test(raw)) throw new Error('relativePath is invalid')
  const segments = raw.split('/').filter(Boolean)
  if (!segments.length || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('relativePath contains unsafe segments')
  }
  return segments.join('/')
}

export function projectReplicaId(projectId: string, locationId: string): string {
  const project = requiredId(projectId, 'projectId')
  const location = requiredId(locationId, 'locationId')
  return `replica_${createHash('sha256').update(`${project}\0${location}`).digest('hex').slice(0, 32)}`
}

export function scopedProjectReplicaId(input: {
  projectId: string
  orgId: string
  workspaceId: string
  locationId: string
  mappingId: string
}): string {
  const identity = [
    requiredId(input.projectId, 'projectId'),
    requiredId(input.orgId, 'orgId'),
    requiredId(input.workspaceId, 'workspaceId'),
    requiredId(input.locationId, 'locationId'),
    requiredId(input.mappingId, 'mappingId'),
  ]
  return `replica_${createHash('sha256').update(identity.join('\0')).digest('hex').slice(0, 32)}`
}

export interface BuildProjectReplicaInput {
  /** Explicit legacy ID is reserved for deterministic migration compatibility. */
  replicaId?: string
  projectId: string
  orgId: string
  workspaceId: string
  location: ProjectExecutionLocation
  mappingId: string
  actorUserId: string
  relativePath?: string
  desiredRevision?: string | null
  currentRevision?: string | null
  isCanonical?: boolean
  now: unknown
}

export function buildProjectReplica(input: BuildProjectReplicaInput): ProjectLocationReplica {
  const projectId = requiredId(input.projectId, 'projectId')
  const orgId = requiredId(input.orgId, 'orgId')
  const workspaceId = requiredId(input.workspaceId, 'workspaceId')
  const mappingId = requiredId(input.mappingId, 'mappingId')
  const locationId = requiredId(input.location.locationId, 'locationId')
  const mapping = input.location.mappings.find((candidate) => candidate.mappingId === mappingId
    && candidate.orgId === orgId && candidate.workspaceId === workspaceId && candidate.status === 'active')
  if (!mapping) throw new Error('location mapping is not active for this organisation and Workspace')
  const availability = input.location.availability
  return {
    replicaId: input.replicaId
      ? requiredId(input.replicaId, 'replicaId')
      : scopedProjectReplicaId({ projectId, orgId, workspaceId, locationId, mappingId }),
    projectId,
    orgId,
    workspaceId,
    locationId,
    locationLabel: input.location.label,
    locationKind: input.location.kind,
    locationPlatform: input.location.platform,
    locationOwner: input.location.owner,
    locationVisibility: input.location.visibility,
    mappingId,
    relativePath: canonicalProjectRelativePath(projectId, input.relativePath),
    availability,
    desiredRevision: nullableRevision(input.desiredRevision),
    currentRevision: nullableRevision(input.currentRevision),
    syncStatus: availability === 'offline' ? 'offline' : 'pending',
    isCanonical: input.isCanonical === true,
    lastSync: null,
    lastError: null,
    lastConflict: null,
    active: true,
    linkedByUserId: requiredId(input.actorUserId, 'actorUserId'),
    createdAt: input.now,
    updatedAt: input.now,
    unlinkedAt: null,
    unlinkedByUserId: null,
  }
}

function strings(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
}

export function projectLinkedOrgIds(project: Record<string, unknown>): string[] {
  const fields = [
    'orgId', 'sourceOrgId', 'ownerOrgId', 'issuerOrgId', 'clientId', 'clientOrgId',
    'recipientOrgId', 'targetOrgId', 'sourceOrgIds', 'ownerOrgIds', 'issuerOrgIds',
    'clientOrgIds', 'recipientOrgIds', 'targetOrgIds', 'linkedOrgIds',
  ]
  return Array.from(new Set(fields.flatMap((field) => strings(project[field]))))
}

export function resolveProjectOrgScope(project: Record<string, unknown>, orgId: string): string {
  const clean = requiredId(orgId, 'orgId')
  if (!projectLinkedOrgIds(project).includes(clean)) throw new Error('project is not linked to this organisation')
  return clean
}
