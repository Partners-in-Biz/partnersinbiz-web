import {
  getExecutionLocationByRuntimeTarget,
  linkProjectLocation,
  listExecutionLocationsForWorkspace,
  listProjectLocations,
  unlinkProjectLocation,
  type ProjectLocationRepository,
} from '@/lib/project-locations/store'
import type { ProjectExecutionLocation, ProjectLocationReplica } from '@/lib/project-locations/model'

function location(overrides: Partial<ProjectExecutionLocation> = {}): ProjectExecutionLocation {
  return {
    locationId: 'peets-mac-mini', label: "Peet's Mac", kind: 'computer', platform: 'macos',
    runtimeTargetId: 'linked-device:peets-mac-mini', legacyCompatibilityTargetId: 'local',
    owner: { type: 'user', userId: 'peet' },
    visibility: 'private', allowedOrgIds: ['pib-platform-owner'], status: 'active', availability: 'online',
    verificationStatus: 'verified',
    mappings: [{ mappingId: 'mac-partners', orgId: 'pib-platform-owner', workspaceId: 'partners', status: 'active' }],
    createdAt: 'now', updatedAt: 'now', ...overrides,
  }
}

function repository(seed: ProjectExecutionLocation) {
  const replicas = new Map<string, ProjectLocationReplica>()
  const repo: ProjectLocationRepository = {
    getLocation: async (id) => id === seed.locationId ? seed : null,
    listLocations: async () => [seed],
    getReplica: async (id) => replicas.get(id) ?? null,
    listReplicas: async (projectId) => Array.from(replicas.values()).filter((row) => row.projectId === projectId),
    putReplica: async (row) => { replicas.set(row.replicaId, row) },
    patchReplica: async (id, patch) => { replicas.set(id, { ...replicas.get(id)!, ...patch }) },
  }
  return { repo, replicas }
}

describe('project location store', () => {
  it('adapts authorized native linked computers into stable project locations without persisting a duplicate location row', async () => {
    const { repo } = repository(location())
    const discoverLinkedTargets = jest.fn(async () => [{
      id: 'runtime-office',
      locationId: 'linked-device:office-mac',
      deviceId: 'office-mac',
      label: 'Office Mac',
      platform: 'macos' as const,
      mappingId: 'map-office',
      workspaceId: 'partners',
      owner: { type: 'user' as const, userId: 'peet' },
      accessMode: 'owner' as const,
      selectable: true,
      lastSeenAt: '2026-07-13T20:00:00.000Z',
    }])

    const rows = await listExecutionLocationsForWorkspace(
      'pib-platform-owner', 'partners', 'peet', { repository: repo, discoverLinkedTargets },
    )

    expect(rows).toContainEqual(expect.objectContaining({
      locationId: 'linked-device:office-mac',
      runtimeTargetId: 'runtime-office',
      owner: { type: 'user', userId: 'peet' },
      visibility: 'private',
      availability: 'online',
      verificationStatus: 'verified',
      mappings: [{ mappingId: 'map-office', orgId: 'pib-platform-owner', workspaceId: 'partners', status: 'active' }],
    }))
    expect(repo.getLocation('linked-device:office-mac')).resolves.toBeNull()
  })

  it('derives a native mapping from current server authorization and keeps an offline computer non-linkable', async () => {
    const { repo } = repository(location())
    const target = {
      id: 'runtime-office',
      locationId: 'linked-device:office-mac',
      deviceId: 'office-mac',
      label: 'Office Mac',
      platform: 'macos' as const,
      mappingId: 'map-current',
      workspaceId: 'partners',
      owner: { type: 'user' as const, userId: 'peet' },
      accessMode: 'owner' as const,
      selectable: true,
      lastSeenAt: '2026-07-13T20:00:00.000Z',
    }
    const discoverLinkedTargets = jest.fn(async () => [target])

    const linked = await linkProjectLocation({
      projectId: 'project-native', orgId: 'pib-platform-owner', workspaceId: 'partners',
      locationId: target.locationId, mappingId: 'client-forged-mapping', actorUserId: 'peet',
    }, { repository: repo, discoverLinkedTargets, now: () => 'now' })
    expect(linked.mappingId).toBe('map-current')

    discoverLinkedTargets.mockResolvedValueOnce([{ ...target, selectable: false, unavailableReason: 'offline' as const }])
    await expect(linkProjectLocation({
      projectId: 'project-offline', orgId: 'pib-platform-owner', workspaceId: 'partners',
      locationId: target.locationId, mappingId: 'map-current', actorUserId: 'peet',
    }, { repository: repo, discoverLinkedTargets, now: () => 'now' })).rejects.toThrow('Computer unavailable')
  })

  it('uses the current organisation mapping and stops revealing a native replica after access is revoked', async () => {
    const { repo } = repository(location())
    let revoked = false
    const discoverLinkedTargets = jest.fn(async (input: { orgId: string; workspaceId: string }) => revoked ? [] : [{
      id: 'runtime-travel-mac',
      locationId: 'linked-device:travel-mac',
      deviceId: 'travel-mac',
      label: 'Travel Mac',
      platform: 'macos' as const,
      mappingId: input.orgId === 'org-a' ? 'map-org-a' : 'map-org-b',
      workspaceId: input.workspaceId,
      owner: { type: 'user' as const, userId: 'owner' },
      accessMode: 'organization' as const,
      selectable: true,
      lastSeenAt: '2026-07-13T20:00:00.000Z',
    }])

    const orgAReplica = await linkProjectLocation({
      projectId: 'shared-project', orgId: 'org-a', workspaceId: 'workspace-a',
      locationId: 'linked-device:travel-mac', mappingId: 'browser-value', actorUserId: 'member-a',
    }, { repository: repo, discoverLinkedTargets, now: () => 'now' })
    const orgBReplica = await linkProjectLocation({
      projectId: 'shared-project', orgId: 'org-b', workspaceId: 'workspace-b',
      locationId: 'linked-device:travel-mac', mappingId: 'browser-value', actorUserId: 'member-b',
    }, { repository: repo, discoverLinkedTargets, now: () => 'now' })

    expect(orgAReplica.mappingId).toBe('map-org-a')
    expect(orgBReplica.mappingId).toBe('map-org-b')
    expect(orgAReplica.replicaId).not.toBe(orgBReplica.replicaId)
    expect(await listProjectLocations(
      'shared-project', 'org-a', 'member-a', { repository: repo, discoverLinkedTargets },
    )).toHaveLength(1)

    revoked = true
    expect(await listProjectLocations(
      'shared-project', 'org-a', 'member-a', { repository: repo, discoverLinkedTargets },
    )).toEqual([])
  })

  it('never falls back to a mutable persisted row for a native linked-device location', async () => {
    const staleNativeRow = location({
      locationId: 'linked-device:revoked-mac',
      runtimeTargetId: 'runtime-revoked',
      owner: { type: 'user', userId: 'peet' },
      mappings: [{ mappingId: 'stale-map', orgId: 'pib-platform-owner', workspaceId: 'partners', status: 'active' }],
    })
    const { repo } = repository(staleNativeRow)
    const discoverLinkedTargets = jest.fn(async () => [])

    expect(await listExecutionLocationsForWorkspace(
      'pib-platform-owner', 'partners', 'peet', { repository: repo, discoverLinkedTargets },
    )).toEqual([])
    await expect(linkProjectLocation({
      projectId: 'project-revoked', orgId: 'pib-platform-owner', workspaceId: 'partners',
      locationId: staleNativeRow.locationId, mappingId: 'stale-map', actorUserId: 'peet',
    }, { repository: repo, discoverLinkedTargets, now: () => 'now' })).rejects.toThrow('project location not found')
  })

  it('links a private user-owned location only for its owner', async () => {
    const { repo } = repository(location())
    await expect(linkProjectLocation({
      projectId: 'project-1', orgId: 'pib-platform-owner', workspaceId: 'partners',
      locationId: 'peets-mac-mini', mappingId: 'mac-partners', actorUserId: 'other-member',
    }, { repository: repo, now: () => 'now' })).rejects.toThrow('private location owner required')

    const row = await linkProjectLocation({
      projectId: 'project-1', orgId: 'pib-platform-owner', workspaceId: 'partners',
      locationId: 'peets-mac-mini', mappingId: 'mac-partners', actorUserId: 'peet',
    }, { repository: repo, now: () => 'now' })
    expect(row.locationId).toBe('peets-mac-mini')
  })

  it('is idempotent and lists only active replicas in the requested organisation', async () => {
    const { repo, replicas } = repository(location())
    const input = {
      projectId: 'project-1', orgId: 'pib-platform-owner', workspaceId: 'partners',
      locationId: 'peets-mac-mini', mappingId: 'mac-partners', actorUserId: 'peet',
    }
    const first = await linkProjectLocation(input, { repository: repo, now: () => 'now' })
    const second = await linkProjectLocation(input, { repository: repo, now: () => 'later' })
    expect(second).toEqual(first)

    replicas.set('other-org-replica', { ...first, replicaId: 'other-org-replica', orgId: 'other-org' })
    expect(await listProjectLocations('project-1', 'pib-platform-owner', 'peet', { repository: repo })).toEqual([first])
  })

  it('soft-unlinks idempotently without claiming files were deleted or synchronised', async () => {
    const { repo } = repository(location())
    const linked = await linkProjectLocation({
      projectId: 'project-1', orgId: 'pib-platform-owner', workspaceId: 'partners',
      locationId: 'peets-mac-mini', mappingId: 'mac-partners', actorUserId: 'peet',
    }, { repository: repo, now: () => 'now' })

    const first = await unlinkProjectLocation({
      replicaId: linked.replicaId, projectId: 'project-1', orgId: 'pib-platform-owner', actorUserId: 'peet',
    }, { repository: repo, now: () => 'later' })
    const second = await unlinkProjectLocation({
      replicaId: linked.replicaId, projectId: 'project-1', orgId: 'pib-platform-owner', actorUserId: 'peet',
    }, { repository: repo, now: () => 'latest' })

    expect(first).toEqual(expect.objectContaining({ active: false, syncStatus: 'offline', unlinkedAt: 'later' }))
    expect(second).toEqual(first)
  })

  it('does not reveal or allow another organisation member to unlink a private user location', async () => {
    const { repo, replicas } = repository(location())
    const privateReplica = await linkProjectLocation({
      projectId: 'project-1', orgId: 'pib-platform-owner', workspaceId: 'partners',
      locationId: 'peets-mac-mini', mappingId: 'mac-partners', actorUserId: 'peet',
    }, { repository: repo, now: () => 'now' })
    const orgReplica: ProjectLocationReplica = {
      ...privateReplica,
      replicaId: 'org-replica',
      locationId: 'partners-vps',
      locationLabel: 'Partners VPS',
      locationVisibility: 'organization',
      locationOwner: { type: 'organization', orgId: 'pib-platform-owner' },
    }
    replicas.set(orgReplica.replicaId, orgReplica)

    expect(await listProjectLocations('project-1', 'pib-platform-owner', 'other-member', { repository: repo }))
      .toEqual([orgReplica])
    await expect(unlinkProjectLocation({
      replicaId: privateReplica.replicaId, projectId: 'project-1', orgId: 'pib-platform-owner', actorUserId: 'other-member',
    }, { repository: repo, now: () => 'later' })).rejects.toThrow('private location owner required')
  })

  it('lists organisation locations and only the requesting owner\'s private locations for a Workspace', async () => {
    const vps = location({
      locationId: 'partners-vps', label: 'Partners VPS', kind: 'vps', platform: 'linux', runtimeTargetId: 'vps',
      legacyCompatibilityTargetId: 'vps',
      owner: { type: 'organization', orgId: 'pib-platform-owner' }, visibility: 'organization',
      mappings: [{ mappingId: 'vps-partners', orgId: 'pib-platform-owner', workspaceId: 'partners', status: 'active' }],
    })
    const mac = location()
    const otherPrivate = location({
      locationId: 'other-mac', label: 'Other Mac', runtimeTargetId: 'linked-device:other-mac',
      owner: { type: 'user', userId: 'other-member' },
    })
    const repositoryWithLocations: ProjectLocationRepository = {
      ...repository(mac).repo,
      listLocations: async () => [vps, mac, otherPrivate],
    }

    const rows = await listExecutionLocationsForWorkspace(
      'pib-platform-owner', 'partners', 'peet', { repository: repositoryWithLocations },
    )
    expect(rows.map((row) => row.locationId)).toEqual(['partners-vps', 'peets-mac-mini'])
    expect(await getExecutionLocationByRuntimeTarget(
      'local', 'pib-platform-owner', 'partners', 'peet', { repository: repositoryWithLocations },
    )).toEqual(expect.objectContaining({ locationId: 'peets-mac-mini' }))
    expect(await getExecutionLocationByRuntimeTarget(
      'linked-device:other-mac', 'pib-platform-owner', 'partners', 'peet', { repository: repositoryWithLocations },
    )).toBeNull()
  })
})
