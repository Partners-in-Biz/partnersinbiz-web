import { NextRequest } from 'next/server'

const mockGetProjectForUser = jest.fn()
const mockListProjectLocations = jest.fn()
const mockLinkProjectLocation = jest.fn()
const mockUnlinkProjectLocation = jest.fn()
const mockListExecutionLocationsForWorkspace = jest.fn()
const mockProjectLinkedToOrganization = jest.fn()
let mockUser = { uid: 'client-1', role: 'client' as const, orgId: 'client-org', orgIds: ['client-org'] }

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: Function) => (req: NextRequest, ctx?: unknown) => handler(req, mockUser, ctx),
}))
jest.mock('@/lib/projects/access', () => ({ getProjectForUser: (...args: unknown[]) => mockGetProjectForUser(...args) }))
jest.mock('@/lib/project-locations/store', () => ({
  ...jest.requireActual('@/lib/project-locations/store'),
  listProjectLocations: (...args: unknown[]) => mockListProjectLocations(...args),
  listExecutionLocationsForWorkspace: (...args: unknown[]) => mockListExecutionLocationsForWorkspace(...args),
  linkProjectLocation: (...args: unknown[]) => mockLinkProjectLocation(...args),
  unlinkProjectLocation: (...args: unknown[]) => mockUnlinkProjectLocation(...args),
}))
jest.mock('@/lib/projects/organization-link', () => ({
  projectLinkedToOrganization: (...args: unknown[]) => mockProjectLinkedToOrganization(...args),
}))

const context = { params: Promise.resolve({ projectId: 'project-1' }) }

beforeEach(() => {
  jest.clearAllMocks()
  mockUser = { uid: 'client-1', role: 'client', orgId: 'client-org', orgIds: ['client-org'] }
  mockGetProjectForUser.mockResolvedValue({
    ok: true,
    doc: { id: 'project-1', data: () => ({
      orgId: 'source-org', clientOrgId: 'client-org', projectFolderRelativePath: 'projects/project-1',
    }) },
    projectAccess: { role: 'manager' },
  })
  mockListProjectLocations.mockResolvedValue([{
    replicaId: 'replica-1', projectId: 'project-1', orgId: 'client-org', workspaceId: 'client-workspace',
    locationId: 'client-vps', locationLabel: 'Client VPS', locationKind: 'vps', locationPlatform: 'linux',
    locationOwner: { type: 'organization', orgId: 'client-org' }, locationVisibility: 'organization',
    mappingId: 'secret-mapping', relativePath: 'clients/secret/project', availability: 'online',
    syncStatus: 'pending', lastError: { message: 'private detail' }, active: true,
  }])
  mockLinkProjectLocation.mockResolvedValue({
    replicaId: 'replica-1', projectId: 'project-1', orgId: 'client-org', workspaceId: 'client-workspace',
    locationId: 'client-vps', locationLabel: 'Client VPS', locationKind: 'vps', locationPlatform: 'linux',
    locationOwner: { type: 'organization', orgId: 'client-org' }, locationVisibility: 'organization',
    mappingId: 'client-map', relativePath: 'projects/project-1', availability: 'online',
    syncStatus: 'pending', isCanonical: false, active: true,
  })
  mockUnlinkProjectLocation.mockResolvedValue({
    replicaId: 'replica-1', projectId: 'project-1', orgId: 'client-org', workspaceId: 'client-workspace',
    locationId: 'client-vps', locationLabel: 'Client VPS', locationKind: 'vps', locationPlatform: 'linux',
    locationOwner: { type: 'organization', orgId: 'client-org' }, locationVisibility: 'organization',
    mappingId: 'unlink-secret-mapping', relativePath: 'clients/private/unlinked-project', availability: 'offline',
    desiredRevision: 'desired-secret', currentRevision: 'current-secret', syncStatus: 'offline', isCanonical: false,
    lastSync: { checksum: 'private-checksum' }, lastError: { message: 'private diagnostic' },
    lastConflict: { path: 'private/conflict' }, active: false, linkedByUserId: 'private-linker',
    createdAt: 'now', updatedAt: 'now', unlinkedAt: 'now', unlinkedByUserId: 'client-1',
  })
  mockListExecutionLocationsForWorkspace.mockResolvedValue([{
    locationId: 'client-vps',
    runtimeTargetId: 'vps',
    mappings: [{ mappingId: 'client-map', orgId: 'client-org', workspaceId: 'client-workspace', status: 'active' }],
  }])
  mockProjectLinkedToOrganization.mockImplementation(async ({ project, orgId }: {
    project: Record<string, unknown>; orgId: string
  }) => [project.orgId, project.clientOrgId].includes(orgId))
})

describe('project locations API', () => {
  it('lists locations for a client-linked project in that client organisation', async () => {
    const { GET } = await import('@/app/api/v1/projects/[projectId]/locations/route')
    const response = await GET(new NextRequest('http://localhost/api/v1/projects/project-1/locations?orgId=client-org'), context)
    expect(response.status).toBe(200)
    const locations = (await response.json()).data.locations
    expect(locations).toEqual([{
      replicaId: 'replica-1', locationId: 'client-vps', label: 'Client VPS', kind: 'vps', platform: 'linux',
      workspaceId: 'client-workspace', availability: 'online', syncStatus: 'pending',
      visibility: 'organization', canonical: false, selectable: false, authenticatedRuntime: false,
      unavailableReason: 'project_sync_pending',
    }])
    expect(JSON.stringify(locations)).not.toContain('secret-mapping')
    expect(JSON.stringify(locations)).not.toContain('clients/secret')
    expect(JSON.stringify(locations)).not.toContain('private detail')
    expect(mockGetProjectForUser).toHaveBeenCalledWith('project-1', mockUser, 'client-org')
    expect(mockListProjectLocations).toHaveBeenCalledWith('project-1', 'client-org', 'client-1')
  })

  it('lists locations shared through canonical project-organisation access', async () => {
    mockGetProjectForUser.mockResolvedValueOnce({
      ok: true,
      doc: { id: 'project-1', data: () => ({ orgId: 'source-org' }) },
      projectAccess: { role: 'contributor', source: 'project_organization' },
    })
    mockProjectLinkedToOrganization.mockResolvedValueOnce(true)
    const { GET } = await import('@/app/api/v1/projects/[projectId]/locations/route')
    const response = await GET(new NextRequest('http://localhost/api/v1/projects/project-1/locations?orgId=client-org'), context)

    expect(response.status).toBe(200)
    expect(mockListProjectLocations).toHaveBeenCalledWith('project-1', 'client-org', 'client-1')
  })

  it('keeps an online synced replica selectable', async () => {
    mockListProjectLocations.mockResolvedValueOnce([{
      replicaId: 'replica-1', projectId: 'project-1', orgId: 'client-org', workspaceId: 'client-workspace',
      locationId: 'client-vps', locationLabel: 'Client VPS', locationKind: 'vps', locationPlatform: 'linux',
      locationOwner: { type: 'organization', orgId: 'client-org' }, locationVisibility: 'organization',
      mappingId: 'secret-mapping', relativePath: 'clients/secret/project', availability: 'online',
      syncStatus: 'synced', active: true,
    }])

    const { GET } = await import('@/app/api/v1/projects/[projectId]/locations/route')
    const response = await GET(new NextRequest('http://localhost/api/v1/projects/project-1/locations?orgId=client-org'), context)

    expect((await response.json()).data.locations[0]).toEqual(expect.objectContaining({
      availability: 'online', syncStatus: 'synced', selectable: true,
    }))
  })

  it('returns controlled JSON when location discovery has an infrastructure failure', async () => {
    mockListProjectLocations.mockRejectedValueOnce(new Error('Firestore INTERNAL /private/read/path'))
    const { GET } = await import('@/app/api/v1/projects/[projectId]/locations/route')
    const response = await GET(new NextRequest('http://localhost/api/v1/projects/project-1/locations?orgId=client-org'), context)

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toBe('Project locations unavailable')
    expect(JSON.stringify(body)).not.toContain('Firestore')
    expect(JSON.stringify(body)).not.toContain('/private/read/path')
  })

  it('denies an organisation that is not linked to the project before reading replicas', async () => {
    const { GET } = await import('@/app/api/v1/projects/[projectId]/locations/route')
    const response = await GET(new NextRequest('http://localhost/api/v1/projects/project-1/locations?orgId=other-org'), context)
    expect(response.status).toBe(403)
    expect(mockListProjectLocations).not.toHaveBeenCalled()
  })

  it('links a location with the authenticated actor and canonical project scope', async () => {
    const { POST } = await import('@/app/api/v1/projects/[projectId]/locations/route')
    const response = await POST(new NextRequest('http://localhost/api/v1/projects/project-1/locations', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'client-org', workspaceId: 'client-workspace', locationId: 'client-vps', mappingId: 'client-map' }),
    }), context)
    expect(response.status).toBe(201)
    expect(mockLinkProjectLocation).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1', orgId: 'client-org', actorUserId: 'client-1', locationId: 'client-vps',
    }))
  })

  it('derives the active Workspace mapping server-side when chat only sends a location id', async () => {
    const { POST } = await import('@/app/api/v1/projects/[projectId]/locations/route')
    const response = await POST(new NextRequest('http://localhost/api/v1/projects/project-1/locations', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'client-org', workspaceId: 'client-workspace', locationId: 'client-vps' }),
    }), context)

    expect(response.status).toBe(201)
    expect(mockListExecutionLocationsForWorkspace).toHaveBeenCalledWith('client-org', 'client-workspace', 'client-1')
    expect(mockLinkProjectLocation).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1', locationId: 'client-vps', mappingId: 'client-map', actorUserId: 'client-1',
    }))
  })

  it('derives the project path server-side and ignores browser revision claims', async () => {
    const { POST } = await import('@/app/api/v1/projects/[projectId]/locations/route')
    const response = await POST(new NextRequest('http://localhost/api/v1/projects/project-1/locations', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orgId: 'client-org', workspaceId: 'client-workspace', locationId: 'client-vps',
        relativePath: 'projects/other-project', desiredRevision: 'forged-desired', currentRevision: 'forged-current',
      }),
    }), context)

    expect(response.status).toBe(201)
    expect(mockLinkProjectLocation).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1', relativePath: 'projects/project-1', mappingId: 'client-map',
    }))
    const linkInput = mockLinkProjectLocation.mock.calls[0][0]
    expect(linkInput).not.toHaveProperty('desiredRevision')
    expect(linkInput).not.toHaveProperty('currentRevision')
    const responseBody = JSON.stringify(await response.json())
    expect(responseBody).not.toContain('projects/project-1')
    expect(responseBody).not.toContain('client-map')
  })

  it('keeps location management restricted to project managers', async () => {
    mockGetProjectForUser.mockResolvedValueOnce({
      ok: true,
      doc: { id: 'project-1', data: () => ({ orgId: 'source-org', clientOrgId: 'client-org' }) },
      projectAccess: { role: 'viewer' },
    })
    const { POST } = await import('@/app/api/v1/projects/[projectId]/locations/route')
    const response = await POST(new NextRequest('http://localhost/api/v1/projects/project-1/locations', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'client-org', workspaceId: 'client-workspace', locationId: 'client-vps' }),
    }), context)

    expect(response.status).toBe(403)
    expect(mockListExecutionLocationsForWorkspace).not.toHaveBeenCalled()
    expect(mockLinkProjectLocation).not.toHaveBeenCalled()
  })

  it('does not expose unexpected location-store diagnostics from a link failure', async () => {
    mockLinkProjectLocation.mockRejectedValueOnce(new Error('Firestore INTERNAL at /private/project/path'))
    const { POST } = await import('@/app/api/v1/projects/[projectId]/locations/route')
    const response = await POST(new NextRequest('http://localhost/api/v1/projects/project-1/locations', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'client-org', workspaceId: 'client-workspace', locationId: 'client-vps' }),
    }), context)

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toBe('Project location request failed')
    expect(JSON.stringify(body)).not.toContain('Firestore')
    expect(JSON.stringify(body)).not.toContain('/private/project/path')
  })

  it('soft-unlinks only within the requested linked organisation', async () => {
    const { DELETE } = await import('@/app/api/v1/projects/[projectId]/locations/[replicaId]/route')
    const response = await DELETE(new NextRequest('http://localhost/api/v1/projects/project-1/locations/replica-1?orgId=client-org', { method: 'DELETE' }), {
      params: Promise.resolve({ projectId: 'project-1', replicaId: 'replica-1' }),
    })
    expect(response.status).toBe(200)
    expect(mockGetProjectForUser).toHaveBeenCalledWith('project-1', mockUser, 'client-org')
    expect(mockUnlinkProjectLocation).toHaveBeenCalledWith({
      projectId: 'project-1', replicaId: 'replica-1', orgId: 'client-org', actorUserId: 'client-1',
    })
    const body = await response.json()
    expect(body.data.replica).toEqual({
      replicaId: 'replica-1', locationId: 'client-vps', label: 'Client VPS', kind: 'vps', platform: 'linux',
      workspaceId: 'client-workspace', availability: 'offline', syncStatus: 'offline',
      visibility: 'organization', canonical: false, selectable: false, authenticatedRuntime: false,
      unavailableReason: 'computer_offline',
    })
    expect(JSON.stringify(body)).not.toContain('unlink-secret-mapping')
    expect(JSON.stringify(body)).not.toContain('clients/private')
    expect(JSON.stringify(body)).not.toContain('private-linker')
    expect(JSON.stringify(body)).not.toContain('private diagnostic')
  })

  it('prevents a project viewer from unlinking an organisation machine', async () => {
    mockGetProjectForUser.mockResolvedValueOnce({
      ok: true,
      doc: { id: 'project-1', data: () => ({ orgId: 'source-org', clientOrgId: 'client-org' }) },
      projectAccess: { role: 'viewer' },
    })
    const { DELETE } = await import('@/app/api/v1/projects/[projectId]/locations/[replicaId]/route')
    const response = await DELETE(new NextRequest('http://localhost/api/v1/projects/project-1/locations/replica-1?orgId=client-org', { method: 'DELETE' }), {
      params: Promise.resolve({ projectId: 'project-1', replicaId: 'replica-1' }),
    })

    expect(response.status).toBe(403)
    expect(mockUnlinkProjectLocation).not.toHaveBeenCalled()
  })

  it('does not expose unexpected location-store diagnostics from an unlink failure', async () => {
    mockUnlinkProjectLocation.mockRejectedValueOnce(new Error('permission denied for /private/replica/path'))
    const { DELETE } = await import('@/app/api/v1/projects/[projectId]/locations/[replicaId]/route')
    const response = await DELETE(new NextRequest('http://localhost/api/v1/projects/project-1/locations/replica-1?orgId=client-org', { method: 'DELETE' }), {
      params: Promise.resolve({ projectId: 'project-1', replicaId: 'replica-1' }),
    })

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toBe('Project location request failed')
    expect(JSON.stringify(body)).not.toContain('permission denied')
    expect(JSON.stringify(body)).not.toContain('/private/replica/path')
  })

  it('preserves the explicit safe not-found contract for a missing project location link', async () => {
    const { ProjectLocationStoreError } = await import('@/lib/project-locations/store')
    mockUnlinkProjectLocation.mockRejectedValueOnce(new ProjectLocationStoreError('replica_not_found'))
    const { DELETE } = await import('@/app/api/v1/projects/[projectId]/locations/[replicaId]/route')
    const response = await DELETE(new NextRequest('http://localhost/api/v1/projects/project-1/locations/missing?orgId=client-org', { method: 'DELETE' }), {
      params: Promise.resolve({ projectId: 'project-1', replicaId: 'missing' }),
    })

    expect(response.status).toBe(404)
    expect((await response.json()).error).toBe('project replica not found')
  })
})
