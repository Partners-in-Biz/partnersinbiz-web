import {
  authorizeProjectSyncWorker,
  projectSyncStorageLifecycleVerified,
  verifyProjectSyncExecutorEligibility,
  type ProjectSyncExecutorLookup,
} from '@/lib/project-sync/native-executor'
import type { ProjectSyncRequest, ProjectSyncWorkerBinding } from '@/lib/project-sync/model'

const binding: ProjectSyncWorkerBinding = {
  capability: 'workspace.sync',
  requestId: 'request-a',
  orgId: 'org-a',
  projectId: 'project-a',
  replicaId: 'replica-a',
  locationId: 'linked-device:device-a',
  mappingId: 'mapping-a',
}

function lookup(overrides: Partial<Record<'device' | 'credential' | 'grant' | 'mapping' | 'replica' | 'request' | 'project' | 'projectOrganization' | 'membership', Record<string, unknown> | null>> = {}): ProjectSyncExecutorLookup {
  const rows = {
    device: { deviceId: 'device-a', ownerType: 'user', ownerUserId: 'owner-a', platform: 'macos', status: 'active', credentialVersion: 4, capabilities: ['workspace.sync'], syncProtocolVersion: 1 },
    credential: { deviceId: 'device-a', credentialVersion: 4, revokedAt: null },
    grant: { deviceId: 'device-a', orgId: 'org-a', status: 'active', capabilities: ['workspace.sync'] },
    mapping: { mappingId: 'mapping-a', deviceId: 'device-a', orgId: 'org-a', workspaceId: 'workspace-a', status: 'active' },
    replica: {
      replicaId: 'replica-a', projectId: 'project-a', orgId: 'org-a', workspaceId: 'workspace-a',
      locationId: 'linked-device:device-a', mappingId: 'mapping-a', relativePath: 'projects/project-a', active: true,
      availability: 'online',
    },
    request: {
      requestId: 'request-a', orgId: 'org-a', projectId: 'project-a', continuousExecutorVerified: true,
      replicaStates: [{ replicaId: 'replica-a', locationId: 'linked-device:device-a', mappingId: 'mapping-a' }],
    },
    project: { status: 'active', active: true, archived: false, deleted: false },
    projectOrganization: { projectId: 'project-a', orgId: 'org-a', status: 'active' },
    membership: { orgId: 'org-a', uid: 'owner-a', status: 'active' },
    ...overrides,
  }
  return {
    getDevice: async () => rows.device,
    getCredential: async () => rows.credential,
    getGrant: async () => rows.grant,
    getMapping: async () => rows.mapping,
    getReplica: async () => rows.replica,
    getRequest: async () => rows.request as unknown as ProjectSyncRequest,
    getProject: async () => rows.project,
    getProjectOrganization: async () => rows.projectOrganization,
    getMembership: async () => rows.membership,
  }
}

describe('native project sync executor authorization', () => {
  it('authorizes workspace.sync independently of workspace.execute only for the exact device binding', async () => {
    await expect(authorizeProjectSyncWorker({
      identity: { deviceId: 'device-a', credentialVersion: 4 },
      binding,
    }, { lookup: lookup() })).resolves.toEqual(expect.objectContaining({
      replica: expect.objectContaining({ relativePath: 'projects/project-a', workspaceId: 'workspace-a' }),
    }))
  })

  it.each([
    ['revoked credential', { credential: { deviceId: 'device-a', credentialVersion: 4, revokedAt: '2026-07-14T00:00:00Z' } }],
    ['grant without sync capability', { grant: { deviceId: 'device-a', orgId: 'org-a', status: 'active', capabilities: ['workspace.execute'] } }],
    ['mapping mismatch', { mapping: { mappingId: 'mapping-a', deviceId: 'device-b', orgId: 'org-a', workspaceId: 'workspace-a', status: 'active' } }],
    ['replica mismatch', { replica: { replicaId: 'replica-a', projectId: 'project-b', orgId: 'org-a', workspaceId: 'workspace-a', locationId: 'linked-device:device-a', mappingId: 'mapping-a', active: true } }],
  ])('rejects %s on every claim, inventory, and receipt recheck', async (_label, overrides) => {
    await expect(authorizeProjectSyncWorker({
      identity: { deviceId: 'device-a', credentialVersion: 4 },
      binding,
    }, { lookup: lookup(overrides) })).rejects.toThrow('workspace.sync binding denied')
  })

  it.each([
    ['revoked project organisation link', { projectOrganization: { projectId: 'project-a', orgId: 'org-a', status: 'revoked' } }],
    ['archived project', { project: { status: 'active', active: true, archived: true, deleted: false } }],
    ['deleted project', { project: { status: 'active', active: true, archived: false, deleted: true } }],
    ['removed private-device owner', { membership: { orgId: 'org-a', uid: 'owner-a', status: 'removed' } }],
    ['mismatched private-device owner membership', { membership: { orgId: 'org-a', uid: 'another-user', status: 'active' } }],
  ])('rejects %s even when the old request, grant, and mapping remain active', async (_label, overrides) => {
    await expect(authorizeProjectSyncWorker({
      identity: { deviceId: 'device-a', credentialVersion: 4 },
      binding,
    }, { lookup: lookup(overrides) })).rejects.toThrow('workspace.sync binding denied')
  })

  it('allows an active legacy owner-org project only when no canonical organisation row exists', async () => {
    await expect(authorizeProjectSyncWorker({
      identity: { deviceId: 'device-a', credentialVersion: 4 }, binding,
    }, { lookup: lookup({
      project: { status: 'active', orgId: 'org-a' },
      projectOrganization: null,
    }) })).resolves.toEqual(expect.objectContaining({ request: expect.objectContaining({ requestId: 'request-a' }) }))
  })

  it('reports verified and started only when every native replica has a current sync-capable device, grant, and mapping', async () => {
    const replicas = [{
      replicaId: 'replica-a', projectId: 'project-a', orgId: 'org-a', workspaceId: 'workspace-a',
      locationId: 'linked-device:device-a', mappingId: 'mapping-a', availability: 'online', active: true,
    }]
    await expect(verifyProjectSyncExecutorEligibility(replicas, { lookup: lookup(), storageLifecycleVerified: true })).resolves.toEqual({
      verified: true,
      started: true,
      blockers: [],
    })
    await expect(verifyProjectSyncExecutorEligibility(
      [{ ...replicas[0], availability: 'offline' }],
      { lookup: lookup(), storageLifecycleVerified: true },
    )).resolves.toEqual({ verified: true, started: false, blockers: ['replica_offline:replica-a'] })
    await expect(verifyProjectSyncExecutorEligibility(
      replicas,
      { lookup: lookup({ grant: { deviceId: 'device-a', orgId: 'org-a', status: 'active', capabilities: ['workspace.execute'] } }), storageLifecycleVerified: true },
    )).resolves.toEqual({ verified: false, started: false, blockers: ['sync_capability_unavailable:replica-a'] })
    await expect(verifyProjectSyncExecutorEligibility(
      replicas,
      { lookup: lookup({ device: { deviceId: 'device-a', status: 'active', credentialVersion: 4, capabilities: ['workspace.sync'] } }), storageLifecycleVerified: true },
    )).resolves.toEqual({ verified: false, started: false, blockers: ['sync_executor_unavailable:replica-a'] })
  })

  it('fails executor verification until both bounded retention controls have been explicitly attested', async () => {
    const replicas = [{
      replicaId: 'replica-a', projectId: 'project-a', orgId: 'org-a', workspaceId: 'workspace-a',
      locationId: 'linked-device:device-a', mappingId: 'mapping-a', availability: 'online' as const, active: true,
    }]
    expect(projectSyncStorageLifecycleVerified({ PROJECT_SYNC_STORAGE_LIFECYCLE_VERIFIED: 'true' })).toBe(true)
    expect(projectSyncStorageLifecycleVerified({ PROJECT_SYNC_STORAGE_LIFECYCLE_VERIFIED: 'false' })).toBe(false)
    await expect(verifyProjectSyncExecutorEligibility(replicas, {
      lookup: lookup(), storageLifecycleVerified: false,
    })).resolves.toEqual({ verified: false, started: false, blockers: ['storage_lifecycle_unverified'] })
  })

  it('does not mark an executor verified after project access or private-owner membership is revoked', async () => {
    const replicas = [{
      replicaId: 'replica-a', projectId: 'project-a', orgId: 'org-a', workspaceId: 'workspace-a',
      locationId: 'linked-device:device-a', mappingId: 'mapping-a', availability: 'online' as const, active: true,
    }]
    await expect(verifyProjectSyncExecutorEligibility(replicas, {
      lookup: lookup({ projectOrganization: { projectId: 'project-a', orgId: 'org-a', status: 'revoked' } }),
      storageLifecycleVerified: true,
    })).resolves.toEqual({ verified: false, started: false, blockers: ['project_access_revoked:replica-a'] })
    await expect(verifyProjectSyncExecutorEligibility(replicas, {
      lookup: lookup({ membership: { orgId: 'org-a', uid: 'owner-a', status: 'removed' } }),
      storageLifecycleVerified: true,
    })).resolves.toEqual({ verified: false, started: false, blockers: ['device_owner_membership_revoked:replica-a'] })
    await expect(verifyProjectSyncExecutorEligibility(replicas, {
      lookup: lookup({ project: { status: 'active', orgId: 'org-a' }, projectOrganization: null }),
      storageLifecycleVerified: true,
    })).resolves.toEqual({ verified: true, started: true, blockers: [] })
  })
})
