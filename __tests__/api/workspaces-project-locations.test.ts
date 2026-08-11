import { NextRequest } from 'next/server'
import { normalizeMemberAccessPolicy } from '@/lib/orgMembers/access-policy'

const mockDiscoverExecutionLocations = jest.fn()
const mockDiscoverLinkedTargets = jest.fn(async () => [])
let mockProjectDocs: Array<{ id: string; data: () => Record<string, unknown> }> = []
let mockProjectQueryDocs: Record<string, Array<{ id: string; data: () => Record<string, unknown> }>> | null = null
let mockProjectOrganizationDocs: Array<{ id: string; data: () => Record<string, unknown> }> = []
let mockProjectMemberDocs: Array<{ id: string; data: () => Record<string, unknown> }> = []
let mockProjectLibraryDocs: Array<{ id: string; data: () => Record<string, unknown> }> = []
let mockReplicaDocs: Array<{ id: string; data: () => Record<string, unknown> }> = []
let mockRuntimeAgentIds: string[] = []
let mockWorkspaceUser: Record<string, unknown> = {
  uid: 'peet', role: 'admin', orgId: 'pib-platform-owner', allowedOrgIds: [],
}

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: Function) => (req: NextRequest) => handler(req, mockWorkspaceUser),
}))
jest.mock('@/lib/project-locations/discovery', () => ({
  discoverAuthorizedExecutionLocationTargets: mockDiscoverExecutionLocations,
}))
jest.mock('@/lib/linked-computers/runtime-targets', () => ({
  discoverAuthorizedRuntimeTargets: mockDiscoverLinkedTargets,
}))
jest.mock('@/lib/api/orgScope', () => ({ resolveOrgScope: () => ({ ok: true, orgId: 'pib-platform-owner' }) }))
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn((name: string) => {
      if (name === 'org_workspaces') return {
        where: () => ({ where: () => ({ get: async () => ({ docs: [{ id: 'partners', data: () => ({
          id: 'partners', workspaceId: 'partners', orgId: 'pib-platform-owner', orgSlug: 'partners',
          orgName: 'Partners in Biz', agentDomain: 'partners', sourceOfTruth: 'vps', syncMode: 'hybrid',
          defaultRuntimeTarget: 'vps', folderVersion: 2, status: 'active', contactIds: [],
        }) }] }) }) }),
      }
      if (name === 'agent_dispatch_configs') return { doc: (agentId: string) => ({ get: async () => {
        mockRuntimeAgentIds.push(agentId)
        return { data: () => ({
        runtimeTargets: {
          vps: { id: 'vps', label: 'VPS', baseUrl: 'https://vps.example', apiKey: 'key', enabled: true },
          local: { id: 'local', label: "Peet's Mac", hostId: 'peets-mac-mini', baseUrl: 'https://mac.example', apiKey: 'key', enabled: true, capabilities: ['local-files'], lastSeenAt: new Date().toISOString() },
        },
      }) }
      } }) }
      if (name === 'projects') return {
        where: (field: string, operator: string) => ({
          get: async () => ({ docs: mockProjectQueryDocs?.[`${field}:${operator}`] ?? (mockProjectQueryDocs ? [] : mockProjectDocs) }),
        }),
        doc: (id: string) => ({
          get: async () => {
            const match = mockProjectDocs.find((doc) => doc.id === id)
            return { exists: Boolean(match), id, data: () => match?.data() }
          },
        }),
      }
      if (name === 'projectOrganizations') return {
        where: () => ({ get: async () => ({ docs: mockProjectOrganizationDocs }) }),
      }
      if (name === 'projectMembers') return {
        where: () => ({ get: async () => ({ docs: mockProjectMemberDocs }) }),
      }
      if (name === 'project_user_library') return {
        where: () => ({ where: () => ({ get: async () => ({ docs: mockProjectLibraryDocs }) }) }),
      }
      if (name === 'project_location_replicas') return { where: () => ({ get: async () => ({ docs: mockReplicaDocs }) }) }
      throw new Error(`Unexpected collection ${name}`)
    }),
  },
}))

describe('GET workspaces with scoped execution locations', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockProjectDocs = []
    mockProjectQueryDocs = null
    mockProjectOrganizationDocs = []
    mockProjectMemberDocs = []
    mockProjectLibraryDocs = []
    mockReplicaDocs = []
    mockRuntimeAgentIds = []
    mockWorkspaceUser = { uid: 'peet', role: 'admin', orgId: 'pib-platform-owner', allowedOrgIds: [] }
    mockDiscoverLinkedTargets.mockResolvedValue([])
    mockDiscoverExecutionLocations.mockResolvedValue([{
      id: 'vps', locationId: 'partners-vps', label: 'Partners VPS', kind: 'vps', platform: 'linux', ownerType: 'organization',
      enabled: true, isLocal: false, isFresh: true, isHealthy: true, selectable: true,
      lastSeenAt: null, ageSeconds: null, lastHealthStatus: 'ok',
    }])
  })

  it('returns only location-authorized compatibility targets instead of the global raw catalogue', async () => {
    const { GET } = await import('@/app/api/v1/workspaces/route')
    const response = await GET(new NextRequest('http://localhost/api/v1/workspaces?orgId=pib-platform-owner'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(mockDiscoverExecutionLocations).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'peet', orgId: 'pib-platform-owner', workspaceId: 'partners',
      compatibilityTargets: expect.arrayContaining([expect.objectContaining({ id: 'vps' }), expect.objectContaining({ id: 'local' })]),
    }), expect.objectContaining({ db: expect.any(Object) }))
    expect(body.data.runtimeTargetsByWorkspace.partners.map((target: { id: string }) => target.id)).toEqual(['vps'])
    expect(body.data.runtimeTargets.map((target: { id: string }) => target.id)).toEqual(['vps'])
  })

  it('builds runtime availability from the agent selected for the new session', async () => {
    const { GET } = await import('@/app/api/v1/workspaces/route')
    const response = await GET(new NextRequest('http://localhost/api/v1/workspaces?orgId=pib-platform-owner&agentId=theo'))

    expect(response.status).toBe(200)
    expect(mockRuntimeAgentIds).toEqual(['theo'])
  })

  it('keeps authorised projects out of the sidebar until this user adds them', async () => {
    mockProjectDocs = [{
      id: 'project-1',
      data: () => ({ orgId: 'pib-platform-owner', name: 'Discoverable project' }),
    }]

    const { GET } = await import('@/app/api/v1/workspaces/route')
    const hidden = await GET(new NextRequest('http://localhost/api/v1/workspaces?orgId=pib-platform-owner'))
    expect((await hidden.json()).data.projects).toEqual([])

    mockProjectLibraryDocs = [{
      id: 'link-1',
      data: () => ({
        linkId: 'link-1', orgId: 'pib-platform-owner', userId: 'peet', projectId: 'project-1', active: true,
      }),
    }, {
      id: 'link-other-user',
      data: () => ({
        linkId: 'link-other-user', orgId: 'pib-platform-owner', userId: 'someone-else', projectId: 'project-2', active: true,
      }),
    }]
    const visible = await GET(new NextRequest('http://localhost/api/v1/workspaces?orgId=pib-platform-owner'))
    expect((await visible.json()).data.projects).toEqual([{
      id: 'project-1', name: 'Discoverable project', locations: [],
    }])
  })

  it('preserves the execution location id when a linked-computer row shares the runtime id', async () => {
    mockDiscoverExecutionLocations.mockResolvedValueOnce([{
      id: 'vps', locationId: 'partners-vps', mappingId: 'linked-map-vps', label: 'Partners VPS', kind: 'vps', platform: 'linux', ownerType: 'organization',
      enabled: true, isLocal: false, isFresh: true, isHealthy: true, selectable: true,
      lastSeenAt: null, ageSeconds: null, lastHealthStatus: 'ok',
    }])
    mockDiscoverLinkedTargets.mockResolvedValue([{
      id: 'vps',
      deviceId: 'device-vps',
      label: 'Partners VPS runtime',
      platform: 'linux',
      runtimeVersion: '2.0.0',
      mappingId: 'linked-map-vps',
      workspaceId: 'partners',
      kind: 'linked-computer',
      enabled: true,
      isLocal: false,
      isFresh: true,
      isHealthy: true,
      selectable: true,
      lastSeenAt: '2026-07-13T20:00:00.000Z',
      ageSeconds: 4,
      lastHealthStatus: 'ok',
    }])

    const { GET } = await import('@/app/api/v1/workspaces/route')
    const response = await GET(new NextRequest('http://localhost/api/v1/workspaces?orgId=pib-platform-owner'))
    const target = (await response.json()).data.runtimeTargetsByWorkspace.partners[0]

    expect(target).toEqual(expect.objectContaining({
      id: 'vps',
      locationId: 'partners-vps',
      deviceId: 'device-vps',
      mappingId: 'linked-map-vps',
      isFresh: true,
      isHealthy: true,
      ageSeconds: 4,
      lastHealthStatus: 'ok',
    }))
  })

  it('exposes safe eligibility fields for a native-only organisation VPS', async () => {
    mockDiscoverExecutionLocations.mockResolvedValueOnce([])
    mockDiscoverLinkedTargets.mockResolvedValueOnce([{
      id: 'native-vps',
      locationId: 'linked-device:native-vps',
      deviceId: 'native-vps',
      label: 'Native organisation VPS',
      platform: 'linux',
      runtimeVersion: '2.0.0',
      mappingId: 'native-vps-map',
      workspaceId: 'partners',
      kind: 'linked-computer',
      deviceKind: 'vps',
      ownerType: 'organization',
      visibility: 'organization',
      selectable: true,
      lastSeenAt: '2026-07-13T20:00:00.000Z',
    }])

    const { GET } = await import('@/app/api/v1/workspaces/route')
    const response = await GET(new NextRequest('http://localhost/api/v1/workspaces?orgId=pib-platform-owner'))
    const target = (await response.json()).data.runtimeTargetsByWorkspace.partners[0]

    expect(target).toEqual(expect.objectContaining({
      kind: 'linked-computer',
      deviceKind: 'vps',
      ownerType: 'organization',
      visibility: 'organization',
      selectable: true,
    }))
    expect(target).not.toHaveProperty('owner')
    expect(target).not.toHaveProperty('ownerOrgId')
  })

  it('returns project-level machine badges without exposing another member private replica or paths', async () => {
    mockProjectDocs = [{
      id: 'project-1',
      data: () => ({ orgId: 'pib-platform-owner', name: 'Launch project' }),
    }]
    mockProjectLibraryDocs = [{ id: 'link-project-1', data: () => ({ orgId: 'pib-platform-owner', userId: 'peet', projectId: 'project-1', active: true }) }]
    mockReplicaDocs = [
      {
        id: 'replica-vps',
        data: () => ({
          replicaId: 'replica-vps', projectId: 'project-1', orgId: 'pib-platform-owner', workspaceId: 'partners',
          locationId: 'partners-vps', locationLabel: 'Partners VPS', locationKind: 'vps', locationPlatform: 'linux',
          locationOwner: { type: 'organization', orgId: 'pib-platform-owner' }, locationVisibility: 'organization',
          relativePath: 'projects/project-1', availability: 'online', syncStatus: 'pending', isCanonical: true, active: true,
        }),
      },
      {
        id: 'replica-private-other',
        data: () => ({
          replicaId: 'replica-private-other', projectId: 'project-1', orgId: 'pib-platform-owner', workspaceId: 'partners',
          locationId: 'other-mac', locationLabel: 'Other private Mac', locationKind: 'computer', locationPlatform: 'macos',
          locationOwner: { type: 'user', userId: 'someone-else' }, locationVisibility: 'private',
          relativePath: 'projects/project-1', availability: 'online', syncStatus: 'synced', active: true,
        }),
      },
    ]

    const { GET } = await import('@/app/api/v1/workspaces/route')
    const response = await GET(new NextRequest('http://localhost/api/v1/workspaces?orgId=pib-platform-owner'))
    const project = (await response.json()).data.projects[0]

    expect(project).toEqual({
      id: 'project-1',
      name: 'Launch project',
      locations: [{
        replicaId: 'replica-vps', locationId: 'partners-vps', label: 'Partners VPS', kind: 'vps', platform: 'linux',
        workspaceId: 'partners', runtimeTargetId: 'vps', availability: 'online', syncStatus: 'pending',
        canonical: true, selectable: true, authenticatedRuntime: false,
      }],
    })
    expect(JSON.stringify(project)).not.toContain('projects/project-1')
    expect(JSON.stringify(project)).not.toContain('Other private Mac')
  })

  it('marks a native Mac project location online from the live linked runtime even when the replica row is stale offline', async () => {
    mockDiscoverExecutionLocations.mockResolvedValue([])
    mockDiscoverLinkedTargets.mockResolvedValue([{
      id: '87554b49-31b1-4484-8a1f-7075d6fa30ca',
      locationId: 'linked-device:87554b49-31b1-4484-8a1f-7075d6fa30ca',
      deviceId: '87554b49-31b1-4484-8a1f-7075d6fa30ca',
      label: 'Peets-Mac-mini.local',
      platform: 'macos',
      mappingId: 'partners-mac-workspace',
      workspaceId: 'partners',
      kind: 'linked-computer',
      deviceKind: 'computer',
      selectable: true,
      lastSeenAt: '2026-07-22T18:00:00.000Z',
    }])
    mockProjectDocs = [{
      id: 'project-1',
      data: () => ({ orgId: 'pib-platform-owner', name: 'Launch project' }),
    }]
    mockProjectLibraryDocs = [{ id: 'link-project-1', data: () => ({ orgId: 'pib-platform-owner', userId: 'peet', projectId: 'project-1', active: true }) }]
    mockReplicaDocs = [{
      id: 'replica-mac',
      data: () => ({
        replicaId: 'replica-mac', projectId: 'project-1', orgId: 'pib-platform-owner', workspaceId: 'partners',
        locationId: 'linked-device:87554b49-31b1-4484-8a1f-7075d6fa30ca', locationLabel: "Peet's Mac",
        locationKind: 'computer', locationPlatform: 'macos',
        locationOwner: { type: 'user', userId: 'peet' }, locationVisibility: 'private',
        mappingId: 'partners-mac-workspace',
        relativePath: 'projects/project-1', availability: 'offline', syncStatus: 'offline', isCanonical: false, active: true,
      }),
    }]

    const { GET } = await import('@/app/api/v1/workspaces/route')
    const response = await GET(new NextRequest('http://localhost/api/v1/workspaces?orgId=pib-platform-owner'))
    const project = (await response.json()).data.projects[0]
    expect(project.locations).toEqual([expect.objectContaining({
      locationId: 'linked-device:87554b49-31b1-4484-8a1f-7075d6fa30ca',
      availability: 'online',
      selectable: true,
      authenticatedRuntime: true,
    })])
  })

  it('discovers library projects linked through multi-org arrays without org-wide project scans', async () => {
    const arrayProject = {
      id: 'project-array',
      data: () => ({ name: 'Multi-org project', clientOrgIds: ['pib-platform-owner'] }),
    }
    mockProjectDocs = [arrayProject]
    mockProjectLibraryDocs = [{ id: 'link-project-array', data: () => ({ orgId: 'pib-platform-owner', userId: 'peet', projectId: 'project-array', active: true }) }]
    // Library-first catalogue must resolve this via project doc get, not field fan-out.
    mockProjectQueryDocs = {}

    const { GET } = await import('@/app/api/v1/workspaces/route')
    const response = await GET(new NextRequest('http://localhost/api/v1/workspaces?orgId=pib-platform-owner'))

    expect((await response.json()).data.projects).toEqual([{
      id: 'project-array',
      name: 'Multi-org project',
      locations: [],
    }])
  })

  it('discovers projects shared through an active project-organisation access record', async () => {
    const sharedProject = {
      id: 'project-shared',
      data: () => ({ name: 'Shared project', orgId: 'another-org' }),
    }
    mockProjectDocs = [sharedProject]
    mockProjectLibraryDocs = [{ id: 'link-project-shared', data: () => ({ orgId: 'pib-platform-owner', userId: 'peet', projectId: 'project-shared', active: true }) }]
    mockProjectQueryDocs = {}
    mockProjectOrganizationDocs = [{
      id: 'project-shared_pib-platform-owner',
      data: () => ({ projectId: 'project-shared', orgId: 'pib-platform-owner', status: 'active' }),
    }]

    const { GET } = await import('@/app/api/v1/workspaces/route')
    const response = await GET(new NextRequest('http://localhost/api/v1/workspaces?orgId=pib-platform-owner'))

    expect((await response.json()).data.projects).toEqual([{
      id: 'project-shared',
      name: 'Shared project',
      locations: [],
    }])
  })

  it.each(['pending', 'revoked'])('does not rediscover a canonically %s project through legacy org fields', async (status) => {
    mockWorkspaceUser = {
      uid: 'client-1', role: 'client', orgId: 'pib-platform-owner', orgIds: ['pib-platform-owner'],
    }
    const legacyProject = {
      id: 'project-revoked',
      data: () => ({ name: 'Formerly shared project', clientOrgIds: ['pib-platform-owner'] }),
    }
    mockProjectDocs = [legacyProject]
    mockProjectQueryDocs = { 'clientOrgIds:array-contains': [legacyProject] }
    mockProjectOrganizationDocs = [{
      id: 'project-revoked_pib-platform-owner',
      data: () => ({ projectId: 'project-revoked', orgId: 'pib-platform-owner', status }),
    }, {
      id: 'project-revoked_legacy-company-alias',
      data: () => ({ projectId: 'project-revoked', orgId: 'pib-platform-owner', status: 'active' }),
    }]

    const { GET } = await import('@/app/api/v1/workspaces/route')
    const response = await GET(new NextRequest('http://localhost/api/v1/workspaces?orgId=pib-platform-owner'))

    expect((await response.json()).data.projects).toEqual([])
  })

  it('does not let a project-member row resurrect a canonically revoked organisation link', async () => {
    mockWorkspaceUser = {
      uid: 'client-1', role: 'client', orgId: 'pib-platform-owner', orgIds: ['pib-platform-owner'],
    }
    const legacyProject = {
      id: 'project-revoked',
      data: () => ({ name: 'Formerly shared project', clientOrgIds: ['pib-platform-owner'] }),
    }
    mockProjectDocs = [legacyProject]
    mockProjectQueryDocs = { 'clientOrgIds:array-contains': [legacyProject] }
    mockProjectOrganizationDocs = [{
      id: 'project-revoked_pib-platform-owner',
      data: () => ({ projectId: 'project-revoked', orgId: 'pib-platform-owner', status: 'revoked' }),
    }]
    mockProjectMemberDocs = [{
      id: 'project-revoked_client-1',
      data: () => ({ projectId: 'project-revoked', orgId: 'pib-platform-owner', uid: 'client-1', status: 'active' }),
    }]

    const { GET } = await import('@/app/api/v1/workspaces/route')
    const response = await GET(new NextRequest('http://localhost/api/v1/workspaces?orgId=pib-platform-owner'))

    expect((await response.json()).data.projects).toEqual([])
  })

  it('does not apply a project-member row from another organisation to this Workspace', async () => {
    mockWorkspaceUser = {
      uid: 'restricted-member', role: 'client', orgId: 'pib-platform-owner', orgIds: ['pib-platform-owner', 'another-org'],
      memberAccessPolicy: normalizeMemberAccessPolicy({
        preset: 'custom', modules: { projects: true, messages: true },
        recordScopes: { projects: 'owned_or_linked' },
      }),
    }
    const project = {
      id: 'project-other-membership',
      data: () => ({
        name: 'Wrong-scope member project',
        clientOrgIds: ['pib-platform-owner'],
        ownerUid: 'another-user',
      }),
    }
    mockProjectDocs = [project]
    mockProjectQueryDocs = { 'clientOrgIds:array-contains': [project] }
    mockProjectMemberDocs = [{
      id: 'project-other-membership_restricted-member',
      data: () => ({ projectId: 'project-other-membership', orgId: 'another-org', uid: 'restricted-member', status: 'active' }),
    }]

    const { GET } = await import('@/app/api/v1/workspaces/route')
    const response = await GET(new NextRequest('http://localhost/api/v1/workspaces?orgId=pib-platform-owner'))

    expect((await response.json()).data.projects).toEqual([])
  })

  it('hides unassigned projects from a member with owned-or-linked project scope', async () => {
    mockWorkspaceUser = {
      uid: 'restricted-member', role: 'client', orgId: 'pib-platform-owner', orgIds: ['pib-platform-owner'],
      memberAccessPolicy: normalizeMemberAccessPolicy({
        preset: 'custom', modules: { projects: true, messages: true },
        recordScopes: { projects: 'owned_or_linked' },
      }),
    }
    mockProjectDocs = [{
      id: 'project-unassigned',
      data: () => ({ orgId: 'pib-platform-owner', ownerUid: 'another-user', name: 'Unassigned project' }),
    }]

    const { GET } = await import('@/app/api/v1/workspaces/route')
    const response = await GET(new NextRequest('http://localhost/api/v1/workspaces?orgId=pib-platform-owner'))

    expect((await response.json()).data.projects).toEqual([])
  })
})
