import {
  projectRuntimeReplicaApiError,
  requireProjectRuntimeReplica,
} from '@/lib/project-locations/runtime-binding'

const replica = {
  replicaId: 'replica-mac',
  projectId: 'project-1',
  orgId: 'org-1',
  workspaceId: 'workspace-1',
  locationId: 'linked-device:device-mac',
  availability: 'online',
  syncStatus: 'synced',
  active: true,
}

describe('requireProjectRuntimeReplica', () => {
  it('accepts a native runtime only when that exact device location is linked to the project', async () => {
    const listLocations = jest.fn().mockResolvedValue([replica])

    await expect(requireProjectRuntimeReplica({
      projectId: 'project-1', orgId: 'org-1', workspaceId: 'workspace-1', actorUserId: 'user-1',
      runtime: { kind: 'linked-computer', deviceId: 'device-mac' },
    }, { listLocations })).resolves.toEqual(replica)

    await expect(requireProjectRuntimeReplica({
      projectId: 'project-1', orgId: 'org-1', workspaceId: 'workspace-1', actorUserId: 'user-1',
      runtime: { kind: 'linked-computer', deviceId: 'other-device' },
    }, { listLocations })).rejects.toThrow('Project is not linked to this computer')
  })

  it('accepts a persisted execution location and rejects a replica from another Workspace', async () => {
    const listLocations = jest.fn().mockResolvedValue([{
      ...replica, locationId: 'partners-vps', workspaceId: 'other-workspace',
    }])

    await expect(requireProjectRuntimeReplica({
      projectId: 'project-1', orgId: 'org-1', workspaceId: 'workspace-1', actorUserId: 'user-1',
      runtime: { kind: 'execution-location', locationId: 'partners-vps' },
    }, { listLocations })).rejects.toThrow('Project is not linked to this computer')
  })

  it.each(['pending', 'syncing', 'conflict', 'error'])(
    'rejects a legacy online replica while its project files are %s',
    async (syncStatus) => {
      const listLocations = jest.fn().mockResolvedValue([{
        ...replica,
        locationId: 'partners-vps',
        syncStatus,
      }])

      await expect(requireProjectRuntimeReplica({
        projectId: 'project-1', orgId: 'org-1', workspaceId: 'workspace-1', actorUserId: 'user-1',
        runtime: { kind: 'execution-location', locationId: 'partners-vps' },
      }, { listLocations })).rejects.toThrow('Project files are not ready on this computer')
    },
  )

  it('allows the online authoritative legacy location while secondary sync is pending', async () => {
    const canonical = {
      ...replica,
      locationId: 'partners-vps',
      syncStatus: 'pending',
      isCanonical: true,
    }
    const listLocations = jest.fn().mockResolvedValue([canonical])

    await expect(requireProjectRuntimeReplica({
      projectId: 'project-1', orgId: 'org-1', workspaceId: 'workspace-1', actorUserId: 'user-1',
      runtime: { kind: 'execution-location', locationId: 'partners-vps' },
    }, { listLocations })).resolves.toEqual(canonical)
  })

  it.each(['conflict', 'error', 'offline'])('blocks an authoritative legacy location in terminal %s state', async (syncStatus) => {
    const listLocations = jest.fn().mockResolvedValue([{
      ...replica, locationId: 'partners-vps', syncStatus, isCanonical: true,
    }])

    await expect(requireProjectRuntimeReplica({
      projectId: 'project-1', orgId: 'org-1', workspaceId: 'workspace-1', actorUserId: 'user-1',
      runtime: { kind: 'execution-location', locationId: 'partners-vps' },
    }, { listLocations })).rejects.toThrow('Project files are not ready on this computer')
  })

  it('keeps the exact Computer unavailable error for an offline legacy replica', async () => {
    const listLocations = jest.fn().mockResolvedValue([{
      ...replica,
      locationId: 'partners-vps',
      availability: 'offline',
      syncStatus: 'offline',
    }])

    await expect(requireProjectRuntimeReplica({
      projectId: 'project-1', orgId: 'org-1', workspaceId: 'workspace-1', actorUserId: 'user-1',
      runtime: { kind: 'execution-location', locationId: 'partners-vps' },
    }, { listLocations })).rejects.toThrow('Computer unavailable')
  })

  it('allows native linked-device chat when replica availability/sync rows are still stale offline', async () => {
    const stale = {
      ...replica,
      availability: 'offline' as const,
      syncStatus: 'offline' as const,
      isCanonical: true,
    }
    const listLocations = jest.fn().mockResolvedValue([stale])

    await expect(requireProjectRuntimeReplica({
      projectId: 'project-1', orgId: 'org-1', workspaceId: 'workspace-1', actorUserId: 'user-1',
      runtime: { kind: 'linked-computer', deviceId: 'device-mac' },
    }, { listLocations })).resolves.toEqual(stale)
  })
})

describe('projectRuntimeReplicaApiError', () => {
  it('preserves computer-unavailable and sync-pending messages', () => {
    expect(projectRuntimeReplicaApiError(new Error('Computer unavailable'))).toEqual({
      message: 'Computer unavailable',
      status: 409,
    })
    expect(projectRuntimeReplicaApiError(new Error('Project files are not ready on this computer'))).toEqual({
      message: 'Project files are not ready on this computer',
      status: 409,
    })
    expect(projectRuntimeReplicaApiError(new Error('boom'))).toEqual({
      message: 'Project is not linked to this computer',
      status: 409,
    })
  })
})
