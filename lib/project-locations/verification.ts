import { createHash } from 'node:crypto'
import {
  PARTNERS_PROJECT_LOCATION_ORG_ID,
  PARTNERS_PROJECT_LOCATION_WORKSPACE_ID,
} from './migration'
import { canonicalProjectRelativePath, type ProjectExecutionLocation, type ProjectLocationReplica } from './model'

export const PARTNERS_LOCATION_IDS = ['partners-vps', 'peets-mac-mini'] as const
export const PARTNERS_LOCATION_VERIFICATION_RUNS_COLLECTION = 'project_location_verification_runs'
export const DEFAULT_PEET_OWNER_USER_ID = 'zcpAJ4NXWQfjXWPXkl6nYwt7Gmm1'

const MAX_EVIDENCE_AGE_MS = 60_000
const MAX_CLOCK_SKEW_MS = 5_000

export interface PartnersLocationVerificationEvidence {
  locationId: string
  checkedAt: string
  runtimeHealth: {
    statusCode: number
    probe: 'authenticated-runtime-health'
    latencyMs?: number
  }
  folders: {
    probe: 'ssh-filesystem' | 'local-filesystem'
    workspaceRootMatches: boolean
    projectFolderIds: string[]
    nonEmptyProjectFolderCount: number
  }
}

export interface SanitizedPartnersLocationEvidence {
  locationId: string
  checkedAt: string
  healthProbe: 'authenticated-runtime-health'
  healthStatusCode: 200
  latencyMs?: number
  folderProbe: 'ssh-filesystem' | 'local-filesystem'
  workspaceRootVerified: true
  expectedProjectFolderCount: number
  verifiedProjectFolderCount: number
  nonEmptyProjectFolderCount: number
  initialSyncBaseline: 'empty-project-folders' | 'not-empty'
  continuousSyncExecutorVerified: false
  projectSetDigest: string
}

export interface PartnersLocationVerificationPlan {
  runId: string
  locationIds: string[]
  evidence: SanitizedPartnersLocationEvidence[]
  updates: Array<{ locationId: string; replicaIds: string[] }>
}

export interface ProjectLocationVerificationRepository {
  getLocation(locationId: string): Promise<ProjectExecutionLocation | null>
  listActiveReplicas(locationId: string): Promise<ProjectLocationReplica[]>
  commitVerification(commit: {
    updates: Array<{
      locationId: string
      locationPatch: Record<string, unknown>
      replicas: Array<{ replicaId: string; patch: Record<string, unknown> }>
    }>
    completedAudit: Record<string, unknown>
  }): Promise<void>
  writeAudit(runId: string, audit: Record<string, unknown>): Promise<void>
}

export interface PartnersLocationVerificationDependencies {
  repository: ProjectLocationVerificationRepository
  probe(
    location: ProjectExecutionLocation,
    replicas: ProjectLocationReplica[],
  ): Promise<PartnersLocationVerificationEvidence>
  ownerUserId?: string
  now(): Date
  databaseTimestamp(): unknown
}

export interface PartnersLocationVerificationOptions {
  apply: boolean
  confirmRunId: string | null
}

export function parsePartnersLocationVerificationArgs(argv: string[]): PartnersLocationVerificationOptions {
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

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${key}:${stable(item)}`).join(',')}}`
  }
  return value === undefined ? 'undefined' : JSON.stringify(value)
}

function digest(value: unknown): string {
  return createHash('sha256').update(stable(value)).digest('hex')
}

function projectSetDigest(projectIds: string[]): string {
  return createHash('sha256').update([...projectIds].sort().join('\n')).digest('hex')
}

function assertExpectedLocation(location: ProjectExecutionLocation, ownerUserId: string): void {
  const orgId = PARTNERS_PROJECT_LOCATION_ORG_ID
  const workspaceId = PARTNERS_PROJECT_LOCATION_WORKSPACE_ID
  const shared = location.locationId === 'partners-vps'
  const expected = shared
    ? {
        kind: 'vps', platform: 'linux', runtimeTargetId: 'vps', compatibilityTargetId: 'vps',
        owner: { type: 'organization', orgId }, visibility: 'organization', mappingId: 'partners-vps-workspace',
      }
    : {
        kind: 'computer', platform: 'macos', runtimeTargetId: 'local', compatibilityTargetId: 'local',
        owner: { type: 'user', userId: ownerUserId }, visibility: 'private', mappingId: 'partners-mac-workspace',
      }
  const mappingMatches = location.mappings.some((mapping) => mapping.mappingId === expected.mappingId
    && mapping.orgId === orgId && mapping.workspaceId === workspaceId && mapping.status === 'active')
  const identityMatches = location.kind === expected.kind
    && location.platform === expected.platform
    && location.runtimeTargetId === expected.runtimeTargetId
    && location.legacyCompatibilityTargetId === expected.compatibilityTargetId
    && stable(location.owner) === stable(expected.owner)
    && location.visibility === expected.visibility
    && location.status === 'active'
    && location.allowedOrgIds.includes(orgId)
    && mappingMatches
  if (!identityMatches) throw new Error(`${location.locationId} identity does not match the approved Partners location`)
}

function validateReplicas(location: ProjectExecutionLocation, replicas: ProjectLocationReplica[]): ProjectLocationReplica[] {
  if (replicas.length === 0) throw new Error(`${location.locationId} has no active project replicas to verify`)
  const seenProjects = new Set<string>()
  for (const replica of replicas) {
    const validIdentity = replica.active
      && replica.locationId === location.locationId
      && replica.orgId === PARTNERS_PROJECT_LOCATION_ORG_ID
      && replica.workspaceId === PARTNERS_PROJECT_LOCATION_WORKSPACE_ID
    if (!validIdentity) throw new Error(`${location.locationId} has a replica outside the approved Partners scope`)
    if (replica.relativePath !== canonicalProjectRelativePath(replica.projectId)) {
      throw new Error(`${location.locationId} replica must use its canonical project path`)
    }
    if (seenProjects.has(replica.projectId)) throw new Error(`${location.locationId} has duplicate project replicas`)
    seenProjects.add(replica.projectId)
  }
  return [...replicas].sort((left, right) => left.projectId.localeCompare(right.projectId))
}

function sanitizeEvidence(
  evidence: PartnersLocationVerificationEvidence,
  location: ProjectExecutionLocation,
  replicas: ProjectLocationReplica[],
  now: Date,
): SanitizedPartnersLocationEvidence {
  if (evidence.locationId !== location.locationId) throw new Error('verification evidence location does not match')
  const checkedAt = new Date(evidence.checkedAt)
  if (!Number.isFinite(checkedAt.getTime())
    || now.getTime() - checkedAt.getTime() > MAX_EVIDENCE_AGE_MS
    || checkedAt.getTime() - now.getTime() > MAX_CLOCK_SKEW_MS) {
    throw new Error(`${location.locationId} requires fresh verification evidence`)
  }
  if (evidence.runtimeHealth.probe !== 'authenticated-runtime-health'
    || evidence.runtimeHealth.statusCode !== 200) {
    throw new Error(`${location.locationId} runtime health must return HTTP 200`)
  }
  const latency = evidence.runtimeHealth.latencyMs
  if (latency !== undefined && (!Number.isFinite(latency) || latency < 0)) {
    throw new Error(`${location.locationId} runtime health latency is invalid`)
  }
  if (!evidence.folders.workspaceRootMatches) {
    throw new Error(`${location.locationId} must prove the exact workspace root`)
  }
  const expectedFolderProbe = location.locationId === 'partners-vps' ? 'ssh-filesystem' : 'local-filesystem'
  if (evidence.folders.probe !== expectedFolderProbe) {
    throw new Error(`${location.locationId} must use its approved folder probe`)
  }
  const expectedIds = replicas.map((replica) => replica.projectId).sort()
  const observedIds = evidence.folders.projectFolderIds.map((projectId) => projectId.trim()).sort()
  if (new Set(observedIds).size !== observedIds.length) {
    throw new Error(`${location.locationId} folder evidence contains duplicates`)
  }
  const missing = expectedIds.filter((projectId) => !observedIds.includes(projectId))
  const unexpected = observedIds.filter((projectId) => !expectedIds.includes(projectId))
  if (missing.length > 0) throw new Error(`${location.locationId} is missing expected project folders`)
  if (unexpected.length > 0) throw new Error(`${location.locationId} has unexpected project folders in verification evidence`)
  const nonEmptyCount = evidence.folders.nonEmptyProjectFolderCount
  if (!Number.isInteger(nonEmptyCount) || nonEmptyCount < 0 || nonEmptyCount > observedIds.length) {
    throw new Error(`${location.locationId} non-empty project folder count is invalid`)
  }
  return {
    locationId: location.locationId,
    checkedAt: checkedAt.toISOString(),
    healthProbe: 'authenticated-runtime-health',
    healthStatusCode: 200,
    ...(latency === undefined ? {} : { latencyMs: latency }),
    folderProbe: evidence.folders.probe,
    workspaceRootVerified: true,
    expectedProjectFolderCount: expectedIds.length,
    verifiedProjectFolderCount: observedIds.length,
    nonEmptyProjectFolderCount: nonEmptyCount,
    initialSyncBaseline: nonEmptyCount === 0 ? 'empty-project-folders' : 'not-empty',
    continuousSyncExecutorVerified: false,
    projectSetDigest: projectSetDigest(expectedIds),
  }
}

export async function buildPartnersLocationVerificationPlan(
  dependencies: PartnersLocationVerificationDependencies,
): Promise<PartnersLocationVerificationPlan> {
  const ownerUserId = (dependencies.ownerUserId ?? DEFAULT_PEET_OWNER_USER_ID).trim()
  if (!ownerUserId || ownerUserId === 'ai-agent' || ownerUserId.startsWith('agent:')) {
    throw new Error('human Peet user ownership is required')
  }
  const targets = await Promise.all(PARTNERS_LOCATION_IDS.map(async (locationId) => {
    const location = await dependencies.repository.getLocation(locationId)
    if (!location) throw new Error(`${locationId} project location does not exist`)
    assertExpectedLocation(location, ownerUserId)
    const replicas = validateReplicas(location, await dependencies.repository.listActiveReplicas(locationId))
    const evidence = sanitizeEvidence(
      await dependencies.probe(location, replicas),
      location,
      replicas,
      dependencies.now(),
    )
    return { location, replicas, evidence }
  }))
  const intent = targets.map(({ location, replicas, evidence }) => ({
    locationId: location.locationId,
    runtimeTargetId: location.runtimeTargetId,
    owner: location.owner,
    visibility: location.visibility,
    projectIds: replicas.map((replica) => replica.projectId),
    healthProbe: evidence.healthProbe,
    folderProbe: evidence.folderProbe,
    projectSetDigest: evidence.projectSetDigest,
    nonEmptyProjectFolderCount: evidence.nonEmptyProjectFolderCount,
    initialSyncBaseline: evidence.initialSyncBaseline,
    canonical: location.locationId === 'partners-vps',
  }))
  return {
    runId: digest({ version: 2, orgId: PARTNERS_PROJECT_LOCATION_ORG_ID, workspaceId: PARTNERS_PROJECT_LOCATION_WORKSPACE_ID, targets: intent }),
    locationIds: targets.map(({ location }) => location.locationId),
    evidence: targets.map(({ evidence }) => evidence),
    updates: targets.map(({ location, replicas }) => ({
      locationId: location.locationId,
      replicaIds: replicas.map((replica) => replica.replicaId),
    })),
  }
}

export async function executePartnersLocationVerification(
  plan: PartnersLocationVerificationPlan,
  options: PartnersLocationVerificationOptions,
  dependencies: PartnersLocationVerificationDependencies,
): Promise<Record<string, unknown>> {
  if (!options.apply) {
    return {
      mode: 'dry-run',
      runId: plan.runId,
      wouldVerifyLocations: plan.updates.length,
      wouldUpdateReplicas: plan.updates.reduce((count, update) => count + update.replicaIds.length, 0),
      verifiedLocations: 0,
      updatedReplicas: 0,
      evidence: plan.evidence,
    }
  }
  if (options.confirmRunId !== plan.runId) throw new Error('confirmed run id does not match verification plan')

  const currentPlan = await buildPartnersLocationVerificationPlan(dependencies)
  if (currentPlan.runId !== plan.runId) throw new Error('verification plan changed; run a fresh dry-run')
  const timestamp = dependencies.databaseTimestamp()
  const auditBase = {
    version: 2,
    scope: 'partners-project-locations',
    runId: plan.runId,
    locationIds: currentPlan.locationIds,
    evidence: currentPlan.evidence,
  }
  await dependencies.repository.writeAudit(plan.runId, { ...auditBase, status: 'running', startedAt: timestamp })
  try {
    const updates = currentPlan.updates.map((update, index) => {
      const evidence = currentPlan.evidence[index]
      return {
        locationId: update.locationId,
        locationPatch: {
          availability: 'online',
          verificationStatus: 'verified',
          lastSeenAt: timestamp,
          updatedAt: timestamp,
          verificationEvidence: evidence,
        },
        replicas: update.replicaIds.map((replicaId) => ({
          replicaId,
          patch: {
            availability: 'online',
            isCanonical: update.locationId === 'partners-vps',
            updatedAt: timestamp,
            ...(evidence.initialSyncBaseline === 'empty-project-folders' ? {
              initialSyncBaseline: {
                kind: 'empty-project-folders',
                observedAt: evidence.checkedAt,
                projectSetDigest: evidence.projectSetDigest,
                continuousSyncExecutorVerified: false,
              },
            } : {}),
          },
        })),
      }
    })
    const appliedResult = {
      mode: 'apply',
      runId: plan.runId,
      verifiedLocations: currentPlan.updates.length,
      updatedReplicas: currentPlan.updates.reduce((count, update) => count + update.replicaIds.length, 0),
    }
    await dependencies.repository.commitVerification({
      updates,
      completedAudit: { ...auditBase, ...appliedResult, status: 'applied_pending_readback', appliedAt: timestamp },
    })
    await assertVerificationReadback(currentPlan, dependencies.repository)
    const result = { ...appliedResult, readbackVerified: true }
    await dependencies.repository.writeAudit(plan.runId, {
      ...auditBase, ...result, status: 'completed', completedAt: timestamp,
    })
    return result
  } catch (error) {
    await dependencies.repository.writeAudit(plan.runId, {
      ...auditBase,
      status: 'failed',
      failedAt: timestamp,
      error: 'Project-location verification write failed; investigate and rerun a fresh dry-run.',
    }).catch(() => undefined)
    throw error
  }
}

async function assertVerificationReadback(
  plan: PartnersLocationVerificationPlan,
  repository: ProjectLocationVerificationRepository,
): Promise<void> {
  for (const update of plan.updates) {
    const location = await repository.getLocation(update.locationId)
    if (!location || location.availability !== 'online' || location.verificationStatus !== 'verified') {
      throw new Error('verification apply readback failed')
    }
    const replicas = await repository.listActiveReplicas(update.locationId)
    const expectedIds = [...update.replicaIds].sort()
    const actualIds = replicas.map((replica) => replica.replicaId).sort()
    const exactReplicaSet = expectedIds.length === actualIds.length
      && expectedIds.every((replicaId, index) => replicaId === actualIds[index])
    const expectedCanonical = update.locationId === 'partners-vps'
    if (!exactReplicaSet || replicas.some((replica) => replica.availability !== 'online'
      || replica.isCanonical !== expectedCanonical)) {
      throw new Error('verification apply readback failed')
    }
  }
}

export async function runPartnersLocationVerification(
  argv: string[],
  dependencies: PartnersLocationVerificationDependencies,
): Promise<{ plan: PartnersLocationVerificationPlan; result: Record<string, unknown> }> {
  const options = parsePartnersLocationVerificationArgs(argv)
  const plan = await buildPartnersLocationVerificationPlan(dependencies)
  return { plan, result: await executePartnersLocationVerification(plan, options, dependencies) }
}
