import { createHash } from 'node:crypto'
import {
  buildProjectReplica,
  projectLinkedOrgIds,
  projectReplicaId,
  type ProjectExecutionLocation,
  type ProjectLocationReplica,
} from './model'

export const PARTNERS_PROJECT_LOCATION_ORG_ID = 'pib-platform-owner'
export const PARTNERS_PROJECT_LOCATION_WORKSPACE_ID = 'partners'

export interface PartnersProjectLocationMigrationPlan {
  runId: string
  preflight: Record<string, unknown>
  locations: ProjectExecutionLocation[]
  replicas: ProjectLocationReplica[]
}

export interface ProjectLocationMigrationRepository {
  getLocation(locationId: string): Promise<ProjectExecutionLocation | null>
  getReplica(replicaId: string): Promise<ProjectLocationReplica | null>
  createLocation(location: ProjectExecutionLocation): Promise<void>
  patchLocationTransportIdentity(locationId: string, transportIdentity: string): Promise<void>
  createReplica(replica: ProjectLocationReplica): Promise<void>
  writeAudit(runId: string, audit: Record<string, unknown>): Promise<void>
}

export interface PartnersProjectLocationMigrationPreflight {
  organization: { id: string; exists: boolean; active?: boolean; deleted?: boolean }
  workspace: { id: string; exists: boolean; orgId?: string; status?: string }
  humanOwner: { uid: string; exists: boolean; role?: string; displayName?: string }
  membership: { exists: boolean; orgId?: string; userId?: string; uid?: string; role?: string; status?: string }
  legacyRuntimeTargetIds: string[]
  legacyRuntimeTargetIdentities: Record<string, string>
  projects: Array<{ id: string; data: Record<string, unknown> }>
}

export interface PartnersProjectLocationMigrationDependencies {
  loadPreflight(): Promise<PartnersProjectLocationMigrationPreflight>
  repository: ProjectLocationMigrationRepository
  now(): unknown
}

export function parseProjectLocationMigrationArgs(argv: string[]): { apply: boolean; confirmRunId: string | null } {
  let apply = false
  let dryRun = false
  let confirmRunId: string | null = null
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--apply') apply = true
    else if (arg === '--dry-run') dryRun = true
    else if (arg === '--confirm-run-id') confirmRunId = argv[++index] ?? null
    else throw new Error(`unknown argument: ${arg}`)
  }
  if (apply && dryRun) throw new Error('--apply and --dry-run cannot be combined')
  if (apply && (!confirmRunId || !/^[a-f0-9]{64}$/.test(confirmRunId))) {
    throw new Error('--apply requires --confirm-run-id with the immutable 64-character run id')
  }
  if (!apply && confirmRunId) throw new Error('--confirm-run-id is only valid with --apply')
  return { apply, confirmRunId }
}

export interface BuildPartnersMigrationInput {
  projectIds: string[]
  peetUserId: string
  legacyRuntimeTargetIds: string[]
  legacyRuntimeTargetIdentities: Record<string, string>
  now: unknown
}

export function buildPartnersProjectLocationMigrationPlan(input: BuildPartnersMigrationInput): PartnersProjectLocationMigrationPlan {
  const peetUserId = input.peetUserId.trim()
  if (!peetUserId || peetUserId === 'ai-agent' || peetUserId.startsWith('agent:')) {
    throw new Error('human Peet user ownership is required')
  }
  const legacyIds = new Set(input.legacyRuntimeTargetIds)
  if (!legacyIds.has('vps') || !legacyIds.has('local')) {
    throw new Error('legacy VPS and local runtime targets must both pass preflight')
  }
  const vpsTransportIdentity = input.legacyRuntimeTargetIdentities.vps?.trim()
  const localTransportIdentity = input.legacyRuntimeTargetIdentities.local?.trim()
  if (!vpsTransportIdentity || !localTransportIdentity) {
    throw new Error('legacy VPS and local transports must both have authoritative identities')
  }
  const orgId = PARTNERS_PROJECT_LOCATION_ORG_ID
  const workspaceId = PARTNERS_PROJECT_LOCATION_WORKSPACE_ID
  const locations: ProjectExecutionLocation[] = [
    {
      locationId: 'partners-vps', label: 'Partners VPS', kind: 'vps', platform: 'linux', runtimeTargetId: 'vps',
      transportIdentity: vpsTransportIdentity,
      owner: { type: 'organization', orgId }, visibility: 'organization', allowedOrgIds: [orgId], status: 'active',
      availability: 'unknown', verificationStatus: 'pending', legacyCompatibilityTargetId: 'vps',
      mappings: [{ mappingId: 'partners-vps-workspace', orgId, workspaceId, status: 'active' }],
      createdAt: input.now, updatedAt: input.now,
    },
    {
      locationId: 'peets-mac-mini', label: "Peet's Mac", kind: 'computer', platform: 'macos', runtimeTargetId: 'local',
      transportIdentity: localTransportIdentity,
      owner: { type: 'user', userId: peetUserId }, visibility: 'private', allowedOrgIds: [orgId], status: 'active',
      availability: 'unknown', verificationStatus: 'pending', legacyCompatibilityTargetId: 'local',
      mappings: [{ mappingId: 'partners-mac-workspace', orgId, workspaceId, status: 'active' }],
      createdAt: input.now, updatedAt: input.now,
    },
  ]
  const projectIds = Array.from(new Set(input.projectIds.map((id) => id.trim()).filter(Boolean))).sort()
  const replicas = projectIds.flatMap((projectId) => locations.map((location) => buildProjectReplica({
    replicaId: projectReplicaId(projectId, location.locationId),
    projectId, orgId, workspaceId, location,
    mappingId: location.mappings[0].mappingId,
    actorUserId: peetUserId,
    isCanonical: location.locationId === 'partners-vps',
    now: input.now,
  })))
  const stableIntent = JSON.stringify({
    version: 1, orgId, workspaceId, peetUserId, projectIds,
    locations: locations.map((location) => ({
      locationId: location.locationId, owner: location.owner, visibility: location.visibility,
      platform: location.platform, legacyCompatibilityTargetId: location.legacyCompatibilityTargetId,
      transportIdentity: location.transportIdentity,
    })),
    preserveLegacyRuntimeTargetIds: ['vps', 'local'],
  })
  const runId = createHash('sha256').update(stableIntent).digest('hex')
  return {
    runId,
    preflight: {
      orgId,
      workspaceId,
      ownerUserId: peetUserId,
      projectCount: projectIds.length,
      legacyRuntimeTargetsVerified: ['vps', 'local'],
      legacyRuntimeEntriesPreserved: true,
      applyRequiresExactRunId: runId,
    },
    locations,
    replicas,
  }
}

function activeProject(data: Record<string, unknown>): boolean {
  if (data.deleted === true || data.archived === true || data.active === false) return false
  const status = typeof data.status === 'string' ? data.status.trim().toLowerCase() : ''
  return !['archived', 'deleted', 'inactive'].includes(status)
}

export function preparePartnersProjectLocationMigration(
  preflight: PartnersProjectLocationMigrationPreflight,
  now: unknown,
): PartnersProjectLocationMigrationPlan {
  const orgId = PARTNERS_PROJECT_LOCATION_ORG_ID
  const workspaceId = PARTNERS_PROJECT_LOCATION_WORKSPACE_ID
  if (preflight.organization.id !== orgId || !preflight.organization.exists
    || preflight.organization.active === false || preflight.organization.deleted === true) {
    throw new Error('active Partners organisation is required')
  }
  if (preflight.workspace.id !== workspaceId || !preflight.workspace.exists
    || preflight.workspace.orgId !== orgId || preflight.workspace.status !== 'active') {
    throw new Error('active Partners Workspace is required')
  }
  const ownerUserId = preflight.humanOwner.uid.trim()
  if (!preflight.humanOwner.exists || preflight.humanOwner.role === 'ai'
    || !ownerUserId || ownerUserId === 'ai-agent' || ownerUserId.startsWith('agent:')) {
    throw new Error('human Peet user ownership is required')
  }
  const memberUserId = (preflight.membership.userId ?? preflight.membership.uid ?? '').trim()
  const memberRole = preflight.membership.role?.trim().toLowerCase()
  if (!preflight.membership.exists || preflight.membership.orgId !== orgId
    || memberUserId !== ownerUserId || preflight.membership.status === 'disabled'
    || (preflight.membership.status && preflight.membership.status !== 'active')
    || !memberRole || !['owner', 'admin'].includes(memberRole)) {
    throw new Error('active Peet organisation membership is required')
  }
  const projectIds = Array.from(new Set(preflight.projects
    .filter((project) => activeProject(project.data) && projectLinkedOrgIds(project.data).includes(orgId))
    .map((project) => project.id.trim())
    .filter(Boolean)))
    .sort()
  if (projectIds.length === 0) throw new Error('no active Partners projects passed preflight')

  const plan = buildPartnersProjectLocationMigrationPlan({
    projectIds,
    peetUserId: ownerUserId,
    legacyRuntimeTargetIds: preflight.legacyRuntimeTargetIds,
    legacyRuntimeTargetIdentities: preflight.legacyRuntimeTargetIdentities,
    now,
  })
  return {
    ...plan,
    preflight: {
      ...plan.preflight,
      organizationVerified: true,
      workspaceVerified: true,
      humanOwnerVerified: true,
      membershipVerified: true,
    },
  }
}

export async function runPartnersProjectLocationMigration(
  argv: string[],
  dependencies: PartnersProjectLocationMigrationDependencies,
): Promise<{ plan: PartnersProjectLocationMigrationPlan; result: Record<string, unknown> }> {
  const options = parseProjectLocationMigrationArgs(argv)
  const preflight = await dependencies.loadPreflight()
  const plan = preparePartnersProjectLocationMigration(preflight, dependencies.now())
  const result = await executePartnersProjectLocationMigration(plan, options, dependencies.repository)
  return { plan, result }
}

export async function executePartnersProjectLocationMigration(
  plan: PartnersProjectLocationMigrationPlan,
  options: { apply: boolean; confirmRunId: string | null },
  repository: ProjectLocationMigrationRepository,
): Promise<Record<string, unknown>> {
  if (options.apply && options.confirmRunId !== plan.runId) throw new Error('confirmed run id does not match migration plan')

  const missingLocations: ProjectExecutionLocation[] = []
  const transportIdentityBackfills: Array<{ locationId: string; transportIdentity: string }> = []
  const missingReplicas: ProjectLocationReplica[] = []
  let existingLocations = 0
  let existingReplicas = 0
  for (const expected of plan.locations) {
    const current = await repository.getLocation(expected.locationId)
    if (!current) missingLocations.push(expected)
    else if (sameLocationIdentity(current, expected)) existingLocations += 1
    else if (locationNeedsTransportIdentityBackfill(current, expected)) {
      existingLocations += 1
      transportIdentityBackfills.push({
        locationId: expected.locationId,
        transportIdentity: expected.transportIdentity!,
      })
    } else throw new Error(`existing project location conflicts with migration plan: ${expected.locationId}`)
  }
  for (const expected of plan.replicas) {
    const current = await repository.getReplica(expected.replicaId)
    if (!current) missingReplicas.push(expected)
    else if (!sameReplicaIdentity(current, expected)) throw new Error(`existing project replica conflicts with migration plan: ${expected.replicaId}`)
    else existingReplicas += 1
  }
  const summary = {
    runId: plan.runId,
    legacyRuntimeEntriesPreserved: true,
    existingLocations,
    existingReplicas,
    wouldCreateLocations: missingLocations.length,
    wouldBackfillTransportIdentities: transportIdentityBackfills.length,
    wouldCreateReplicas: missingReplicas.length,
  }
  if (!options.apply) return { mode: 'dry-run', ...summary, createdLocations: 0, createdReplicas: 0 }

  await repository.writeAudit(plan.runId, { ...summary, status: 'running', startedAt: new Date().toISOString() })
  try {
    for (const location of missingLocations) await repository.createLocation(location)
    for (const location of transportIdentityBackfills) {
      await repository.patchLocationTransportIdentity(location.locationId, location.transportIdentity)
    }
    for (const replica of missingReplicas) await repository.createReplica(replica)
    const result = {
      mode: 'apply', ...summary,
      createdLocations: missingLocations.length,
      backfilledTransportIdentities: transportIdentityBackfills.length,
      createdReplicas: missingReplicas.length,
    }
    await repository.writeAudit(plan.runId, { ...result, status: 'completed', completedAt: new Date().toISOString() })
    return result
  } catch (error) {
    await repository.writeAudit(plan.runId, {
      ...summary,
      status: 'failed',
      failedAt: new Date().toISOString(),
      error: 'Project location migration write failed; rerun with the same immutable plan after investigation.',
    }).catch(() => undefined)
    throw error
  }
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).sort().join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${key}:${stable(item)}`).join(',')}}`
  }
  return value === undefined ? 'undefined' : JSON.stringify(value)
}

function sameLocationIdentity(current: ProjectExecutionLocation, expected: ProjectExecutionLocation): boolean {
  return stable({
    locationId: current.locationId,
    platform: current.platform,
    kind: current.kind,
    runtimeTargetId: current.runtimeTargetId,
    transportIdentity: current.transportIdentity,
    owner: current.owner,
    visibility: current.visibility,
    allowedOrgIds: current.allowedOrgIds,
    legacyCompatibilityTargetId: current.legacyCompatibilityTargetId,
    mappings: current.mappings,
  }) === stable({
    locationId: expected.locationId,
    platform: expected.platform,
    kind: expected.kind,
    runtimeTargetId: expected.runtimeTargetId,
    transportIdentity: expected.transportIdentity,
    owner: expected.owner,
    visibility: expected.visibility,
    allowedOrgIds: expected.allowedOrgIds,
    legacyCompatibilityTargetId: expected.legacyCompatibilityTargetId,
    mappings: expected.mappings,
  })
}

/**
 * Records created before transport binding was introduced may be upgraded only
 * when every older immutable identity field still matches. A present but
 * different transport identity remains a hard conflict and is never rotated by
 * this migration.
 */
function locationNeedsTransportIdentityBackfill(
  current: ProjectExecutionLocation,
  expected: ProjectExecutionLocation,
): boolean {
  if (typeof current.transportIdentity === 'string' && current.transportIdentity.trim()) return false
  if (typeof expected.transportIdentity !== 'string' || !expected.transportIdentity.trim()) return false
  return sameLocationIdentity(
    { ...current, transportIdentity: expected.transportIdentity },
    expected,
  )
}

function sameReplicaIdentity(current: ProjectLocationReplica, expected: ProjectLocationReplica): boolean {
  return stable({
    replicaId: current.replicaId,
    projectId: current.projectId,
    orgId: current.orgId,
    workspaceId: current.workspaceId,
    locationId: current.locationId,
    mappingId: current.mappingId,
    relativePath: current.relativePath,
  }) === stable({
    replicaId: expected.replicaId,
    projectId: expected.projectId,
    orgId: expected.orgId,
    workspaceId: expected.workspaceId,
    locationId: expected.locationId,
    mappingId: expected.mappingId,
    relativePath: expected.relativePath,
  })
}
