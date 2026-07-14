import {
  authorizeExecutionLocationDispatch,
  discoverAuthorizedExecutionLocationTargets,
} from '@/lib/project-locations/discovery'
import type { PublicRuntimeTargetPresence } from '@/lib/agents/runtime-targets'
import type { ProjectExecutionLocation } from '@/lib/project-locations/model'

function fakeDb(rows: { locations: ProjectExecutionLocation[]; members: Record<string, Record<string, unknown>> }) {
  return {
    collection(name: string) {
      if (name === 'orgMembers') {
        return { doc: (id: string) => ({ get: async () => ({ exists: Boolean(rows.members[id]), data: () => rows.members[id] }) }) }
      }
      if (name === 'project_execution_locations') {
        return {
          where: (_field: string, _op: string, orgId: string) => ({
            get: async () => ({
              docs: rows.locations.filter((location) => location.allowedOrgIds.includes(orgId)).map((location) => ({ data: () => location })),
            }),
          }),
        }
      }
      throw new Error(`Unexpected collection ${name}`)
    },
  }
}

function location(overrides: Partial<ProjectExecutionLocation> = {}): ProjectExecutionLocation {
  return {
    locationId: 'partners-vps', label: 'Partners VPS', kind: 'vps', platform: 'linux', runtimeTargetId: 'vps',
    transportIdentity: 'transport-vps',
    owner: { type: 'organization', orgId: 'pib-platform-owner' }, visibility: 'organization',
    allowedOrgIds: ['pib-platform-owner'], status: 'active', availability: 'online', verificationStatus: 'verified',
    mappings: [{ mappingId: 'partners-vps-map', orgId: 'pib-platform-owner', workspaceId: 'partners', status: 'active' }],
    legacyCompatibilityTargetId: 'vps', createdAt: 'now', updatedAt: 'now', ...overrides,
  }
}

const presence: Array<PublicRuntimeTargetPresence & { transportIdentity: string }> = [
  { id: 'vps', label: 'VPS', transportIdentity: 'transport-vps', enabled: true, isLocal: false, isFresh: true, isHealthy: true, selectable: true, lastSeenAt: null, ageSeconds: null, lastHealthStatus: 'ok' },
  { id: 'local', label: "Peet's Mac", transportIdentity: 'transport-local', enabled: true, isLocal: true, isFresh: false, isHealthy: false, selectable: false, lastSeenAt: null, ageSeconds: null, lastHealthStatus: 'offline' },
]

const mac = location({
  locationId: 'peets-mac-mini', label: "Peet's Mac", kind: 'computer', platform: 'macos', runtimeTargetId: 'local',
  transportIdentity: 'transport-local',
  owner: { type: 'user', userId: 'peet' }, visibility: 'private', availability: 'offline',
  mappings: [{ mappingId: 'partners-mac-map', orgId: 'pib-platform-owner', workspaceId: 'partners', status: 'active' }],
  legacyCompatibilityTargetId: 'local',
})

describe('execution location discovery', () => {
  it('shows org VPS to a legacy active member but hides Peet-private Mac', async () => {
    const db = fakeDb({
      locations: [location(), mac],
      members: { 'pib-platform-owner_member-1': { orgId: 'pib-platform-owner', userId: 'member-1', role: 'member' } },
    })
    const targets = await discoverAuthorizedExecutionLocationTargets({
      userId: 'member-1', orgId: 'pib-platform-owner', workspaceId: 'partners', compatibilityTargets: presence,
    }, { db: db as never })
    expect(targets.map((target) => target.id)).toEqual(['vps'])
  })

  it('keeps Peet private offline Mac visible and non-selectable', async () => {
    const db = fakeDb({
      locations: [location(), mac],
      members: { 'pib-platform-owner_peet': { orgId: 'pib-platform-owner', uid: 'peet', role: 'owner', status: 'active' } },
    })
    const targets = await discoverAuthorizedExecutionLocationTargets({
      userId: 'peet', orgId: 'pib-platform-owner', workspaceId: 'partners', compatibilityTargets: presence,
    }, { db: db as never })
    expect(targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'vps', selectable: true }),
      expect.objectContaining({ id: 'local', label: "Peet's Mac", selectable: false, unavailableReason: 'computer_offline' }),
    ]))
  })

  it.each(['pending', 'invited', 'unknown', 'revoked'])('does not discover locations for a %s membership', async (status) => {
    const db = fakeDb({
      locations: [location()],
      members: {
        'pib-platform-owner_member-1': {
          orgId: 'pib-platform-owner', userId: 'member-1', role: 'member', status,
        },
      },
    })
    const targets = await discoverAuthorizedExecutionLocationTargets({
      userId: 'member-1', orgId: 'pib-platform-owner', workspaceId: 'partners', compatibilityTargets: presence,
    }, { db: db as never })

    expect(targets).toEqual([])
  })

  it('reauthorises dispatch and rejects offline, guessed, or cross-org locations', async () => {
    const db = fakeDb({
      locations: [location(), mac],
      members: { 'pib-platform-owner_peet': { orgId: 'pib-platform-owner', uid: 'peet', role: 'owner', status: 'active' } },
    })
    await expect(authorizeExecutionLocationDispatch({
      userId: 'peet', orgId: 'pib-platform-owner', workspaceId: 'partners', runtimeTargetId: 'vps', compatibilityTargets: presence,
    }, { db: db as never })).resolves.toEqual(expect.objectContaining({ locationId: 'partners-vps', runtimeTargetId: 'vps' }))
    await expect(authorizeExecutionLocationDispatch({
      userId: 'peet', orgId: 'pib-platform-owner', workspaceId: 'partners', runtimeTargetId: 'local', compatibilityTargets: presence,
    }, { db: db as never })).rejects.toThrow('Computer unavailable')
    await expect(authorizeExecutionLocationDispatch({
      userId: 'peet', orgId: 'pib-platform-owner', workspaceId: 'partners', runtimeTargetId: 'guessed', compatibilityTargets: presence,
    }, { db: db as never })).rejects.toThrow('Execution location not authorized')
  })

  it('rejects a reused target id when it points at a different physical transport', async () => {
    const boundLocation = {
      ...location(),
      transportIdentity: 'transport-host-a',
    } as ProjectExecutionLocation
    const wrongHostTargets = presence.map((target) => ({
      ...target,
      transportIdentity: target.id === 'vps' ? 'transport-host-b' : 'transport-local',
    })) as PublicRuntimeTargetPresence[]
    const db = fakeDb({
      locations: [boundLocation],
      members: { 'pib-platform-owner_peet': { orgId: 'pib-platform-owner', uid: 'peet', role: 'owner', status: 'active' } },
    })

    await expect(authorizeExecutionLocationDispatch({
      userId: 'peet',
      orgId: 'pib-platform-owner',
      workspaceId: 'partners',
      runtimeTargetId: 'vps',
      compatibilityTargets: wrongHostTargets,
    }, { db: db as never })).rejects.toThrow('Computer unavailable')
  })
})
