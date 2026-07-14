import {
  authorizeWorkspaceRuntime,
  workspaceRuntimeSupportsOrganizationSharing,
} from '@/lib/workspaces/runtime-authorization'

const input = { userId: 'peet', orgId: 'pib-platform-owner', workspaceId: 'partners', runtimeTargetId: 'vps' }

describe('Workspace runtime authorization', () => {
  it('loads compatibility transport identity for the agent that will receive the run', async () => {
    const loadCompatibilityTargets = jest.fn(async (_agentId?: string) => [{
      id: 'vps', label: 'Maya VPS', enabled: true, isLocal: false, isFresh: true,
      isHealthy: true, selectable: true, lastSeenAt: null, ageSeconds: null,
      lastHealthStatus: 'ok', transportIdentity: 'maya-host-identity',
    }])
    const authorizeExecution = jest.fn(async () => ({
      locationId: 'partners-vps', runtimeTargetId: 'vps', machineLabel: 'Partners VPS', kind: 'vps' as const,
      organizationAccessible: true,
    }))
    const perAgentInput = { ...input, agentId: 'maya' }

    const result = await authorizeWorkspaceRuntime(perAgentInput, {
      loadCompatibilityTargets,
      authorizeExecution,
      authorizeLinked: jest.fn(),
    })

    expect(loadCompatibilityTargets).toHaveBeenCalledWith('maya')
    expect(result).toEqual(expect.objectContaining({
      runtimeTargetId: 'vps',
      transportIdentity: 'maya-host-identity',
    }))
  })

  it('authorizes configured compatibility transport through its scoped execution location', async () => {
    const authorizeExecution = jest.fn(async () => ({
      locationId: 'partners-vps', runtimeTargetId: 'vps', machineLabel: 'Partners VPS', kind: 'vps' as const,
      organizationAccessible: true,
    }))
    const authorizeLinked = jest.fn()
    const result = await authorizeWorkspaceRuntime(input, {
      loadCompatibilityTargets: async () => [{ id: 'vps', label: 'VPS', enabled: true, isLocal: false, isFresh: true, isHealthy: true, selectable: true, lastSeenAt: null, ageSeconds: null, lastHealthStatus: 'ok' }],
      authorizeExecution,
      authorizeLinked,
    })
    expect(result).toEqual(expect.objectContaining({
      kind: 'execution-location', locationId: 'partners-vps', machineLabel: 'Partners VPS',
      organizationAccessible: true,
    }))
    expect(workspaceRuntimeSupportsOrganizationSharing(result)).toBe(true)
    expect(authorizeLinked).not.toHaveBeenCalled()
  })

  it('uses linked-computer authorization only when the target is not a compatibility transport', async () => {
    const linked = {
      kind: 'linked-computer' as const, deviceId: 'device-a', runtimeTargetId: 'linked-device:device-a',
      machineLabel: 'Office Mac', accessMode: 'owner' as const,
    }
    const authorizeExecution = jest.fn()
    const authorizeLinked = jest.fn(async () => linked)
    await expect(authorizeWorkspaceRuntime({ ...input, runtimeTargetId: linked.runtimeTargetId }, {
      loadCompatibilityTargets: async () => [], authorizeExecution, authorizeLinked,
    })).resolves.toBe(linked)
    expect(workspaceRuntimeSupportsOrganizationSharing(linked as never)).toBe(false)
    expect(authorizeExecution).not.toHaveBeenCalled()
  })

  it('allows organisation sharing only for organisation-accessible runtimes', () => {
    expect(workspaceRuntimeSupportsOrganizationSharing({
      kind: 'linked-computer', accessMode: 'organization',
    } as never)).toBe(true)
    expect(workspaceRuntimeSupportsOrganizationSharing({
      kind: 'execution-location', organizationAccessible: false,
    } as never)).toBe(false)
  })

  it('never falls back to linked authorization when a configured compatibility target is denied', async () => {
    const authorizeLinked = jest.fn()
    await expect(authorizeWorkspaceRuntime(input, {
      loadCompatibilityTargets: async () => [{ id: 'vps', label: 'VPS', enabled: true, isLocal: false, isFresh: true, isHealthy: true, selectable: true, lastSeenAt: null, ageSeconds: null, lastHealthStatus: 'ok' }],
      authorizeExecution: async () => { throw new Error('Execution location not authorized') },
      authorizeLinked,
    })).rejects.toThrow('Execution location not authorized')
    expect(authorizeLinked).not.toHaveBeenCalled()
  })
})
