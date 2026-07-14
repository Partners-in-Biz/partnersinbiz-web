import {
  buildPartnersProjectLocationMigrationPlan,
  executePartnersProjectLocationMigration,
  parseProjectLocationMigrationArgs,
  preparePartnersProjectLocationMigration,
  runPartnersProjectLocationMigration,
  type PartnersProjectLocationMigrationPreflight,
  type ProjectLocationMigrationRepository,
} from '@/lib/project-locations/migration'

const LEGACY_RUNTIME_TARGET_IDENTITIES = {
  vps: 'transport-vps',
  local: 'transport-local',
}

function validPreflight(overrides: Partial<PartnersProjectLocationMigrationPreflight> = {}): PartnersProjectLocationMigrationPreflight {
  return {
    organization: { id: 'pib-platform-owner', exists: true, active: true, deleted: false },
    workspace: { id: 'partners', exists: true, orgId: 'pib-platform-owner', status: 'active' },
    humanOwner: { uid: 'peet-uid', exists: true, role: 'admin', displayName: 'Peet Stander' },
    membership: { exists: true, orgId: 'pib-platform-owner', userId: 'peet-uid', role: 'owner', status: 'active' },
    legacyRuntimeTargetIds: ['vps', 'local'],
    legacyRuntimeTargetIdentities: LEGACY_RUNTIME_TARGET_IDENTITIES,
    projects: [
      { id: 'project-a', data: { orgId: 'pib-platform-owner', archived: false } },
      { id: 'project-b', data: { clientOrgIds: ['pib-platform-owner'], status: 'active' } },
      { id: 'other-project', data: { orgId: 'another-org' } },
      { id: 'archived-project', data: { orgId: 'pib-platform-owner', archived: true } },
    ],
    ...overrides,
  }
}

describe('Partners project-location migration', () => {
  it('is dry-run by default and requires the immutable run id for apply', () => {
    expect(parseProjectLocationMigrationArgs([])).toEqual({ apply: false, confirmRunId: null })
    expect(() => parseProjectLocationMigrationArgs(['--apply'])).toThrow('--apply requires --confirm-run-id')
    expect(parseProjectLocationMigrationArgs(['--apply', '--confirm-run-id', 'a'.repeat(64)])).toEqual({
      apply: true, confirmRunId: 'a'.repeat(64),
    })
  })

  it('plans an org-owned Linux VPS and Peet-owned private Mac without removing legacy targets', () => {
    const plan = buildPartnersProjectLocationMigrationPlan({
      projectIds: ['project-b', 'project-a'],
      peetUserId: 'peet-uid',
      legacyRuntimeTargetIds: ['vps', 'local'],
      legacyRuntimeTargetIdentities: LEGACY_RUNTIME_TARGET_IDENTITIES,
      now: '2026-07-13T20:00:00.000Z',
    })

    expect(plan.preflight).toEqual(expect.objectContaining({
      orgId: 'pib-platform-owner', workspaceId: 'partners', ownerUserId: 'peet-uid',
      legacyRuntimeTargetsVerified: ['vps', 'local'], legacyRuntimeEntriesPreserved: true,
    }))
    expect(plan.locations).toEqual(expect.arrayContaining([
      expect.objectContaining({ locationId: 'partners-vps', platform: 'linux', owner: { type: 'organization', orgId: 'pib-platform-owner' }, visibility: 'organization' }),
      expect.objectContaining({ locationId: 'peets-mac-mini', platform: 'macos', owner: { type: 'user', userId: 'peet-uid' }, visibility: 'private' }),
    ]))
    expect(plan.replicas).toHaveLength(4)
    expect(plan.replicas.every((replica) => replica.syncStatus === 'pending' && replica.currentRevision === null)).toBe(true)

    const reordered = buildPartnersProjectLocationMigrationPlan({
      projectIds: ['project-a', 'project-b'], peetUserId: 'peet-uid',
      legacyRuntimeTargetIds: ['local', 'vps'], now: '2026-07-13T20:00:00.000Z',
      legacyRuntimeTargetIdentities: LEGACY_RUNTIME_TARGET_IDENTITIES,
    })
    expect(reordered.runId).toBe(plan.runId)
  })

  it('refuses AI ownership and missing legacy preflight targets', () => {
    expect(() => buildPartnersProjectLocationMigrationPlan({
      projectIds: [], peetUserId: 'ai-agent', legacyRuntimeTargetIds: ['vps', 'local'],
      legacyRuntimeTargetIdentities: LEGACY_RUNTIME_TARGET_IDENTITIES, now: 'now',
    })).toThrow('human Peet user ownership is required')
    expect(() => buildPartnersProjectLocationMigrationPlan({
      projectIds: [], peetUserId: 'peet-uid', legacyRuntimeTargetIds: ['vps'],
      legacyRuntimeTargetIdentities: LEGACY_RUNTIME_TARGET_IDENTITIES, now: 'now',
    })).toThrow('legacy VPS and local runtime targets must both pass preflight')
  })

  it('performs no writes in dry-run and reports actionable create counts', async () => {
    const plan = buildPartnersProjectLocationMigrationPlan({
      projectIds: ['project-a'], peetUserId: 'peet-uid', legacyRuntimeTargetIds: ['vps', 'local'],
      legacyRuntimeTargetIdentities: LEGACY_RUNTIME_TARGET_IDENTITIES, now: 'now',
    })
    const writes: string[] = []
    const repository: ProjectLocationMigrationRepository = {
      getLocation: async () => null,
      getReplica: async () => null,
      createLocation: async (row) => { writes.push(`location:${row.locationId}`) },
      patchLocationTransportIdentity: async (locationId) => { writes.push(`transport:${locationId}`) },
      createReplica: async (row) => { writes.push(`replica:${row.replicaId}`) },
      writeAudit: async () => { writes.push('audit') },
    }
    const result = await executePartnersProjectLocationMigration(plan, { apply: false, confirmRunId: null }, repository)
    expect(writes).toEqual([])
    expect(result).toEqual(expect.objectContaining({
      mode: 'dry-run', wouldCreateLocations: 2, wouldCreateReplicas: 2,
      legacyRuntimeEntriesPreserved: true,
    }))
  })

  it('requires the exact run id for apply and idempotently skips existing records', async () => {
    const plan = buildPartnersProjectLocationMigrationPlan({
      projectIds: ['project-a'], peetUserId: 'peet-uid', legacyRuntimeTargetIds: ['vps', 'local'],
      legacyRuntimeTargetIdentities: LEGACY_RUNTIME_TARGET_IDENTITIES, now: 'now',
    })
    await expect(executePartnersProjectLocationMigration(
      plan, { apply: true, confirmRunId: 'b'.repeat(64) }, {} as ProjectLocationMigrationRepository,
    )).rejects.toThrow('confirmed run id does not match')

    const writes: string[] = []
    const repository: ProjectLocationMigrationRepository = {
      getLocation: async (id) => plan.locations.find((row) => row.locationId === id) ?? null,
      getReplica: async (id) => plan.replicas.find((row) => row.replicaId === id) ?? null,
      createLocation: async (row) => { writes.push(`location:${row.locationId}`) },
      patchLocationTransportIdentity: async (locationId) => { writes.push(`transport:${locationId}`) },
      createReplica: async (row) => { writes.push(`replica:${row.replicaId}`) },
      writeAudit: async (_runId, audit) => { writes.push(`audit:${audit.status}`) },
    }
    const result = await executePartnersProjectLocationMigration(
      plan, { apply: true, confirmRunId: plan.runId }, repository,
    )
    expect(writes).toEqual(['audit:running', 'audit:completed'])
    expect(result).toEqual(expect.objectContaining({
      mode: 'apply', createdLocations: 0, createdReplicas: 0, existingLocations: 2, existingReplicas: 2,
    }))
  })

  it('fails closed when an existing location identity conflicts with the plan', async () => {
    const plan = buildPartnersProjectLocationMigrationPlan({
      projectIds: [], peetUserId: 'peet-uid', legacyRuntimeTargetIds: ['vps', 'local'],
      legacyRuntimeTargetIdentities: LEGACY_RUNTIME_TARGET_IDENTITIES, now: 'now',
    })
    const repository: ProjectLocationMigrationRepository = {
      getLocation: async (id) => id === 'partners-vps' ? { ...plan.locations[0], runtimeTargetId: 'wrong-target' } : null,
      getReplica: async () => null,
      createLocation: async () => undefined,
      patchLocationTransportIdentity: async () => undefined,
      createReplica: async () => undefined,
      writeAudit: async () => undefined,
    }
    await expect(executePartnersProjectLocationMigration(
      plan, { apply: false, confirmRunId: null }, repository,
    )).rejects.toThrow('existing project location conflicts with migration plan')
  })

  it('backfills only a missing transport identity and still rejects a conflicting one', async () => {
    const plan = buildPartnersProjectLocationMigrationPlan({
      projectIds: [], peetUserId: 'peet-uid', legacyRuntimeTargetIds: ['vps', 'local'],
      legacyRuntimeTargetIdentities: LEGACY_RUNTIME_TARGET_IDENTITIES, now: 'now',
    })
    const currentLocations = new Map(plan.locations.map((location) => [
      location.locationId,
      { ...location, transportIdentity: undefined },
    ]))
    const writes: string[] = []
    const repository: ProjectLocationMigrationRepository = {
      getLocation: async (id) => currentLocations.get(id) ?? null,
      getReplica: async () => null,
      createLocation: async () => undefined,
      patchLocationTransportIdentity: async (id, transportIdentity) => {
        const current = currentLocations.get(id)
        if (current) currentLocations.set(id, { ...current, transportIdentity })
        writes.push(`transport:${id}`)
      },
      createReplica: async () => undefined,
      writeAudit: async (_runId, audit) => { writes.push(`audit:${audit.status}`) },
    }

    const dryRun = await executePartnersProjectLocationMigration(
      plan, { apply: false, confirmRunId: null }, repository,
    )
    expect(dryRun).toEqual(expect.objectContaining({
      existingLocations: 2,
      wouldBackfillTransportIdentities: 2,
    }))
    expect(writes).toEqual([])

    const applied = await executePartnersProjectLocationMigration(
      plan, { apply: true, confirmRunId: plan.runId }, repository,
    )
    expect(applied).toEqual(expect.objectContaining({ backfilledTransportIdentities: 2 }))
    expect(writes).toEqual([
      'audit:running',
      'transport:partners-vps',
      'transport:peets-mac-mini',
      'audit:completed',
    ])

    currentLocations.set('partners-vps', { ...plan.locations[0], transportIdentity: 'different-transport' })
    await expect(executePartnersProjectLocationMigration(
      plan, { apply: false, confirmRunId: null }, repository,
    )).rejects.toThrow('existing project location conflicts with migration plan')
  })

  it('turns verified live preflight evidence into a plan for only active linked projects', () => {
    const plan = preparePartnersProjectLocationMigration(validPreflight(), 'now')
    expect(plan.preflight).toEqual(expect.objectContaining({
      ownerUserId: 'peet-uid', projectCount: 2, humanOwnerVerified: true,
      organizationVerified: true, workspaceVerified: true, membershipVerified: true,
    }))
    expect(Array.from(new Set(plan.replicas.map((replica) => replica.projectId)))).toEqual(['project-a', 'project-b'])
  })

  it('fails preflight when ownership, membership, Workspace, or organisation evidence is unsafe', () => {
    expect(() => preparePartnersProjectLocationMigration(validPreflight({
      humanOwner: { uid: 'peet-uid', exists: true, role: 'ai' },
    }), 'now')).toThrow('human Peet user ownership is required')
    expect(() => preparePartnersProjectLocationMigration(validPreflight({
      membership: { exists: true, orgId: 'pib-platform-owner', userId: 'peet-uid', role: 'owner', status: 'disabled' },
    }), 'now')).toThrow('active Peet organisation membership is required')
    expect(() => preparePartnersProjectLocationMigration(validPreflight({
      workspace: { id: 'partners', exists: true, orgId: 'wrong-org', status: 'active' },
    }), 'now')).toThrow('active Partners Workspace is required')
    expect(() => preparePartnersProjectLocationMigration(validPreflight({
      organization: { id: 'pib-platform-owner', exists: true, active: false },
    }), 'now')).toThrow('active Partners organisation is required')
  })

  it('runs the checked preflight in dry-run mode without writing migration records', async () => {
    const writes: string[] = []
    const repository: ProjectLocationMigrationRepository = {
      getLocation: async () => null,
      getReplica: async () => null,
      createLocation: async (row) => { writes.push(`location:${row.locationId}`) },
      patchLocationTransportIdentity: async (locationId) => { writes.push(`transport:${locationId}`) },
      createReplica: async (row) => { writes.push(`replica:${row.replicaId}`) },
      writeAudit: async () => { writes.push('audit') },
    }
    const output = await runPartnersProjectLocationMigration([], {
      loadPreflight: async () => validPreflight(), repository, now: () => 'now',
    })
    expect(output.result).toEqual(expect.objectContaining({ mode: 'dry-run', wouldCreateLocations: 2, wouldCreateReplicas: 4 }))
    expect(output.plan.runId).toMatch(/^[a-f0-9]{64}$/)
    expect(writes).toEqual([])
  })
})
