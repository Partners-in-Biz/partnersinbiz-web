import {
  buildPartnersLocationVerificationPlan,
  executePartnersLocationVerification,
  parsePartnersLocationVerificationArgs,
  type PartnersLocationVerificationDependencies,
  type PartnersLocationVerificationEvidence,
  type ProjectLocationVerificationRepository,
} from '@/lib/project-locations/verification'
import { buildPartnersProjectLocationMigrationPlan } from '@/lib/project-locations/migration'
import type { ProjectExecutionLocation, ProjectLocationReplica } from '@/lib/project-locations/model'
import { createHash } from 'node:crypto'

const CHECKED_AT = '2026-07-13T20:00:00.000Z'
const NOW = new Date('2026-07-13T20:00:30.000Z')

function fixtures(): { locations: ProjectExecutionLocation[]; replicas: ProjectLocationReplica[] } {
  const migration = buildPartnersProjectLocationMigrationPlan({
    projectIds: ['project-a', 'project-b'],
    peetUserId: 'peet-uid',
    legacyRuntimeTargetIds: ['vps', 'local'],
    legacyRuntimeTargetIdentities: { vps: 'transport-vps', local: 'transport-local' },
    now: CHECKED_AT,
  })
  return { locations: migration.locations, replicas: migration.replicas }
}

function evidenceFor(locationId: string): PartnersLocationVerificationEvidence {
  return {
    locationId,
    checkedAt: CHECKED_AT,
    runtimeHealth: {
      statusCode: 200,
      probe: 'authenticated-runtime-health',
      latencyMs: 42,
    },
    folders: {
      probe: locationId === 'partners-vps' ? 'ssh-filesystem' : 'local-filesystem',
      workspaceRootMatches: true,
      projectFolderIds: ['project-b', 'project-a'],
      nonEmptyProjectFolderCount: 0,
    },
  }
}

function dependencies(
  overrides: Partial<PartnersLocationVerificationDependencies> = {},
): PartnersLocationVerificationDependencies & { writes: Array<Record<string, unknown>> } {
  const { locations, replicas } = fixtures()
  const writes: Array<Record<string, unknown>> = []
  const repository: ProjectLocationVerificationRepository = {
    getLocation: async (locationId) => locations.find((location) => location.locationId === locationId) ?? null,
    listActiveReplicas: async (locationId) => replicas.filter((replica) => replica.locationId === locationId && replica.active),
    commitVerification: async (commit) => {
      writes.push({ kind: 'commit', commit })
      for (const update of commit.updates) {
        const location = locations.find((row) => row.locationId === update.locationId)
        if (location) Object.assign(location, update.locationPatch)
        for (const replicaUpdate of update.replicas) {
          const replica = replicas.find((row) => row.replicaId === replicaUpdate.replicaId)
          if (replica) Object.assign(replica, replicaUpdate.patch)
        }
      }
    },
    writeAudit: async (runId, audit) => { writes.push({ kind: 'audit', runId, audit }) },
  }
  return {
    repository,
    probe: async (location) => evidenceFor(location.locationId),
    ownerUserId: 'peet-uid',
    now: () => NOW,
    databaseTimestamp: () => CHECKED_AT,
    writes,
    ...overrides,
  }
}

describe('Partners project-location verification', () => {
  it('is dry-run by default and requires an exact immutable run id for apply', () => {
    expect(parsePartnersLocationVerificationArgs([])).toEqual({ apply: false, confirmRunId: null })
    expect(parsePartnersLocationVerificationArgs(['--dry-run'])).toEqual({ apply: false, confirmRunId: null })
    expect(() => parsePartnersLocationVerificationArgs(['--apply'])).toThrow('--apply requires --confirm-run-id')
    expect(() => parsePartnersLocationVerificationArgs(['--apply', '--dry-run'])).toThrow('cannot be combined')
    expect(parsePartnersLocationVerificationArgs(['--apply', '--confirm-run-id', 'a'.repeat(64)])).toEqual({
      apply: true,
      confirmRunId: 'a'.repeat(64),
    })
  })

  it('builds a stable plan only from exact identity, HTTP 200, and every expected project folder', async () => {
    const deps = dependencies()
    const plan = await buildPartnersLocationVerificationPlan(deps)

    expect(plan.runId).toMatch(/^[a-f0-9]{64}$/)
    expect(plan.locationIds).toEqual(['partners-vps', 'peets-mac-mini'])
    expect(plan.evidence).toEqual([
      expect.objectContaining({
        locationId: 'partners-vps', healthStatusCode: 200, workspaceRootVerified: true,
        expectedProjectFolderCount: 2, verifiedProjectFolderCount: 2,
        nonEmptyProjectFolderCount: 0, initialSyncBaseline: 'empty-project-folders',
      }),
      expect.objectContaining({
        locationId: 'peets-mac-mini', healthStatusCode: 200, workspaceRootVerified: true,
        expectedProjectFolderCount: 2, verifiedProjectFolderCount: 2,
        nonEmptyProjectFolderCount: 0, initialSyncBaseline: 'empty-project-folders',
      }),
    ])
    expect(JSON.stringify(plan)).not.toContain('/var/lib')
    expect(JSON.stringify(plan)).not.toContain('/Users/')
    expect(JSON.stringify(plan)).not.toContain('apiKey')
    expect(plan.evidence[0].projectSetDigest).toBe(
      createHash('sha256').update('project-a\nproject-b').digest('hex'),
    )

    const reordered = dependencies({
      probe: async (location) => ({
        ...evidenceFor(location.locationId),
        folders: { ...evidenceFor(location.locationId).folders, projectFolderIds: ['project-a', 'project-b'] },
      }),
    })
    expect((await buildPartnersLocationVerificationPlan(reordered)).runId).toBe(plan.runId)

    const nonEmpty = dependencies({
      probe: async (location) => ({
        ...evidenceFor(location.locationId),
        folders: { ...evidenceFor(location.locationId).folders, nonEmptyProjectFolderCount: 1 },
      }),
    })
    expect((await buildPartnersLocationVerificationPlan(nonEmpty)).runId).not.toBe(plan.runId)
  })

  it.each([
    ['non-200 runtime health', (proof: PartnersLocationVerificationEvidence) => ({
      ...proof, runtimeHealth: { ...proof.runtimeHealth, statusCode: 204 },
    }), 'HTTP 200'],
    ['wrong workspace root', (proof: PartnersLocationVerificationEvidence) => ({
      ...proof, folders: { ...proof.folders, workspaceRootMatches: false },
    }), 'exact workspace root'],
    ['wrong folder probe transport', (proof: PartnersLocationVerificationEvidence) => ({
      ...proof, folders: { ...proof.folders, probe: proof.locationId === 'partners-vps' ? 'local-filesystem' as const : 'ssh-filesystem' as const },
    }), 'approved folder probe'],
    ['missing project folder', (proof: PartnersLocationVerificationEvidence) => ({
      ...proof, folders: { ...proof.folders, projectFolderIds: ['project-a'] },
    }), 'missing expected project folders'],
    ['unexpected project folder', (proof: PartnersLocationVerificationEvidence) => ({
      ...proof, folders: { ...proof.folders, projectFolderIds: ['project-a', 'project-b', 'other'] },
    }), 'unexpected project folders'],
    ['stale evidence', (proof: PartnersLocationVerificationEvidence) => ({
      ...proof, checkedAt: '2026-07-13T19:58:00.000Z',
    }), 'fresh verification evidence'],
  ])('fails closed for %s', async (_name, mutate, expected) => {
    const deps = dependencies({
      probe: async (location) => mutate(evidenceFor(location.locationId)),
    })
    await expect(buildPartnersLocationVerificationPlan(deps)).rejects.toThrow(expected)
  })

  it('rejects changed location identity and non-canonical replica paths', async () => {
    const { locations, replicas } = fixtures()
    const wrongOwner = { ...locations[0], owner: { type: 'user' as const, userId: 'peet-uid' } }
    await expect(buildPartnersLocationVerificationPlan(dependencies({
      repository: {
        ...dependencies().repository,
        getLocation: async (id) => id === 'partners-vps' ? wrongOwner : locations.find((row) => row.locationId === id) ?? null,
      },
    }))).rejects.toThrow('identity does not match')

    const wrongPath = replicas.map((replica) => replica.locationId === 'partners-vps' && replica.projectId === 'project-a'
      ? { ...replica, relativePath: 'elsewhere/project-a' }
      : replica)
    await expect(buildPartnersLocationVerificationPlan(dependencies({
      repository: {
        ...dependencies().repository,
        listActiveReplicas: async (id) => wrongPath.filter((row) => row.locationId === id),
      },
    }))).rejects.toThrow('canonical project path')
  })

  it('performs no writes in dry-run', async () => {
    const deps = dependencies()
    const plan = await buildPartnersLocationVerificationPlan(deps)
    const result = await executePartnersLocationVerification(
      plan,
      { apply: false, confirmRunId: null },
      deps,
    )
    expect(result).toEqual(expect.objectContaining({ mode: 'dry-run', verifiedLocations: 0, wouldVerifyLocations: 2 }))
    expect(deps.writes).toEqual([])
  })

  it('rechecks evidence and identity before applying only verified/online state with a sanitized audit', async () => {
    const deps = dependencies()
    const plan = await buildPartnersLocationVerificationPlan(deps)
    await expect(executePartnersLocationVerification(
      plan,
      { apply: true, confirmRunId: 'b'.repeat(64) },
      deps,
    )).rejects.toThrow('confirmed run id does not match')
    expect(deps.writes).toEqual([])

    const result = await executePartnersLocationVerification(
      plan,
      { apply: true, confirmRunId: plan.runId },
      deps,
    )
    expect(result).toEqual(expect.objectContaining({
      mode: 'apply', verifiedLocations: 2, updatedReplicas: 4, readbackVerified: true,
    }))
    const commit = deps.writes.find((write) => write.kind === 'commit')?.commit as {
      updates: Array<{
        locationPatch: Record<string, unknown>
        replicas: Array<{ replicaId: string; patch: Record<string, unknown> }>
      }>
      completedAudit: Record<string, unknown>
    }
    expect(commit.updates).toHaveLength(2)
    expect(commit.updates.flatMap((update) => update.replicas)).toHaveLength(4)
    for (const patch of [
      ...commit.updates.map((update) => update.locationPatch),
      ...commit.updates.flatMap((update) => update.replicas.map((replica) => replica.patch)),
    ]) {
      expect(patch).toEqual(expect.objectContaining({ availability: 'online', updatedAt: CHECKED_AT }))
      const write = { patch }
      expect(JSON.stringify(write)).not.toContain('/var/lib')
      expect(JSON.stringify(write)).not.toContain('/Users/')
      expect(JSON.stringify(write)).not.toContain('apiKey')
    }
    for (const update of commit.updates) {
      for (const replica of update.replicas) {
        expect(replica.patch).toEqual(expect.objectContaining({
          initialSyncBaseline: expect.objectContaining({
            kind: 'empty-project-folders',
            continuousSyncExecutorVerified: false,
          }),
        }))
        expect(replica.patch.syncStatus).toBeUndefined()
        expect(replica.patch.isCanonical).toBe(update.locationId === 'partners-vps')
      }
    }
    expect(commit.updates.some((update) => update.locationPatch.verificationStatus === 'verified')).toBe(true)
    const auditJson = JSON.stringify([
      ...deps.writes.filter((write) => write.kind === 'audit'),
      commit.completedAudit,
    ])
    expect(auditJson).toContain('completed')
    expect(auditJson).not.toContain('/var/lib')
    expect(auditJson).not.toContain('/Users/')
    expect(auditJson).not.toContain('apiKey')
  })

  it('fails closed and records a sanitized failure when applied state cannot be read back', async () => {
    const deps = dependencies()
    deps.repository.commitVerification = async (commit) => { deps.writes.push({ kind: 'commit', commit }) }
    const plan = await buildPartnersLocationVerificationPlan(deps)
    await expect(executePartnersLocationVerification(
      plan,
      { apply: true, confirmRunId: plan.runId },
      deps,
    )).rejects.toThrow('verification apply readback failed')
    expect(deps.writes.some((write) => write.kind === 'audit'
      && (write.audit as Record<string, unknown>).status === 'failed')).toBe(true)
  })
})
