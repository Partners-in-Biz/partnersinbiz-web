import { NextRequest } from 'next/server'

const mockGetProjectForUser = jest.fn()
const mockListProjectLocations = jest.fn()
const mockStartProjectSync = jest.fn()
const mockCancelProjectSync = jest.fn()
const mockGetLatest = jest.fn()
const mockProjectLinkedToOrganization = jest.fn()
const mockVerifyProjectSyncExecutorEligibility = jest.fn()
const mockRepository = { getLatest: (...args: unknown[]) => mockGetLatest(...args) }
let mockUser = { uid: 'peet', role: 'client' as const, orgId: 'org-a', orgIds: ['org-a'] }

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: Function) => (req: NextRequest, ctx?: unknown) => handler(req, mockUser, ctx),
}))
jest.mock('@/lib/projects/access', () => ({ getProjectForUser: (...args: unknown[]) => mockGetProjectForUser(...args) }))
jest.mock('@/lib/project-locations/store', () => ({
  listProjectLocations: (...args: unknown[]) => mockListProjectLocations(...args),
  PROJECT_LOCATION_REPLICAS_COLLECTION: 'project_location_replicas',
}))
jest.mock('@/lib/project-sync/coordinator', () => ({
  startProjectSync: (...args: unknown[]) => mockStartProjectSync(...args),
  cancelProjectSync: (...args: unknown[]) => mockCancelProjectSync(...args),
}))
jest.mock('@/lib/project-sync/firestore', () => ({
  createProjectSyncFirestoreRepository: () => mockRepository,
}))
jest.mock('@/lib/project-sync/native-executor', () => ({
  verifyProjectSyncExecutorEligibility: (...args: unknown[]) => mockVerifyProjectSyncExecutorEligibility(...args),
}))
jest.mock('@/lib/firebase/admin', () => ({ adminDb: {} }))
jest.mock('@/lib/projects/organization-link', () => ({
  projectLinkedToOrganization: (...args: unknown[]) => mockProjectLinkedToOrganization(...args),
}))

const context = { params: Promise.resolve({ projectId: 'project-a' }) }
const replicas = [
  {
    replicaId: 'replica-vps', projectId: 'project-a', orgId: 'org-a', locationId: 'partners-vps',
    mappingId: 'map-vps', locationKind: 'vps', locationOwner: { type: 'organization', orgId: 'org-a' },
    locationVisibility: 'organization', availability: 'online', currentRevision: null, active: true,
  },
  {
    replicaId: 'replica-mac', projectId: 'project-a', orgId: 'org-a', locationId: 'peets-mac-mini',
    mappingId: 'map-mac', locationKind: 'computer', locationOwner: { type: 'user', userId: 'peet' },
    locationVisibility: 'private', availability: 'offline', currentRevision: null, active: true,
  },
]

beforeEach(() => {
  jest.clearAllMocks()
  mockGetProjectForUser.mockResolvedValue({
    ok: true,
    doc: { data: () => ({ orgId: 'source-org', clientOrgId: 'org-a' }) },
    projectAccess: { role: 'manager' },
  })
  mockListProjectLocations.mockResolvedValue(replicas)
  mockStartProjectSync.mockResolvedValue({
    created: true,
    request: {
      requestId: 'psync-request', status: 'waiting_for_locations', canonicalLocationId: 'partners-vps',
      continuousExecutorVerified: false, transferProtocol: 'firebase-storage-cas-v1',
    },
  })
  mockCancelProjectSync.mockResolvedValue({
    requestId: 'psync-request', status: 'cancelled', continuousExecutorVerified: true,
    stateVersion: 2, requestedAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:02.000Z',
    replicaStates: [], transfers: [], conflict: null,
  })
  mockGetLatest.mockResolvedValue({
    requestId: 'psync-request', status: 'waiting_for_locations', continuousExecutorVerified: false,
    stateVersion: 1, requestedAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:01.000Z',
    requestedByUserId: 'private-user', canonicalLocationId: 'partners-vps', canonicalRevision: 'private-revision',
    replicaStates: [{
      replicaId: 'private-replica', locationId: 'private-location', mappingId: 'private-mapping',
      availability: 'online', currentRevision: 'private-current',
    }],
    transfers: [], conflict: null,
  })
  mockProjectLinkedToOrganization.mockImplementation(async ({ project, orgId }: {
    project: Record<string, unknown>; orgId: string
  }) => [project.orgId, project.clientOrgId].includes(orgId))
  mockVerifyProjectSyncExecutorEligibility.mockResolvedValue({
    verified: false,
    started: false,
    blockers: ['native_replica_required:replica-vps'],
  })
})

describe('project sync request/status API', () => {
  it('records a manager-authorized request with the organisation VPS as canonical and no fake transfer claim', async () => {
    const { POST } = await import('@/app/api/v1/projects/[projectId]/sync/route')
    const response = await POST(new NextRequest('http://localhost/api/v1/projects/project-a/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'manual-sync-1' },
      body: JSON.stringify({ orgId: 'org-a' }),
    }), context)
    expect(response.status).toBe(202)
    expect(mockGetProjectForUser).toHaveBeenCalledWith('project-a', mockUser, 'org-a')
    expect(mockStartProjectSync).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-a', projectId: 'project-a', canonicalLocationId: 'partners-vps',
      requestedByUserId: 'peet', idempotencyKey: 'manual-sync-1',
      replicas: expect.arrayContaining([
        expect.objectContaining({ replicaId: 'replica-vps', availability: 'online' }),
        expect.objectContaining({ replicaId: 'replica-mac', availability: 'offline' }),
      ]),
    }), expect.any(Object))
    expect(await response.json()).toEqual(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        recorded: true, transferStarted: false, continuousExecutorVerified: false,
        blocker: 'native_sync_worker_unavailable',
      }),
    }))
  })

  it('reports the executor verified and started only after every replica proves the native sync protocol', async () => {
    mockVerifyProjectSyncExecutorEligibility.mockResolvedValueOnce({ verified: true, started: true, blockers: [] })
    mockStartProjectSync.mockResolvedValueOnce({
      created: true,
      request: {
        requestId: 'psync-native', status: 'pending_inventory', canonicalLocationId: 'partners-vps',
        continuousExecutorVerified: true, transferProtocol: 'firebase-storage-cas-v1',
      },
    })
    const { POST } = await import('@/app/api/v1/projects/[projectId]/sync/route')
    const response = await POST(new NextRequest('http://localhost/api/v1/projects/project-a/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'native-sync-1' },
      body: JSON.stringify({ orgId: 'org-a' }),
    }), context)

    expect(mockVerifyProjectSyncExecutorEligibility).toHaveBeenCalledWith(replicas)
    expect(mockStartProjectSync).toHaveBeenCalledWith(expect.objectContaining({
      continuousExecutorVerified: true,
    }), expect.any(Object))
    expect(await response.json()).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        continuousExecutorVerified: true,
        executorStarted: true,
        transferStarted: true,
        blocker: null,
      }),
    }))
  })

  it('keeps transfer disabled until both project-sync retention controls are proven', async () => {
    mockVerifyProjectSyncExecutorEligibility.mockResolvedValueOnce({
      verified: false, started: false, blockers: ['storage_lifecycle_unverified'],
    })
    const { POST } = await import('@/app/api/v1/projects/[projectId]/sync/route')
    const response = await POST(new NextRequest('http://localhost/api/v1/projects/project-a/sync', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orgId: 'org-a' }),
    }), context)

    expect(response.status).toBe(202)
    expect(mockStartProjectSync).toHaveBeenCalledWith(expect.objectContaining({
      continuousExecutorVerified: false,
    }), expect.any(Object))
    expect(await response.json()).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        transferStarted: false,
        continuousExecutorVerified: false,
        blocker: 'project_sync_storage_lifecycle_unverified',
        message: expect.stringMatching(/project-sync retention controls.*five Firestore TTL policies.*Storage lifecycle rule/i),
      }),
    }))
  })

  it('does not expose unexpected eligibility or persistence failures', async () => {
    mockVerifyProjectSyncExecutorEligibility.mockRejectedValueOnce(new Error('Firestore permission denied for secret/internal/path'))
    const { POST } = await import('@/app/api/v1/projects/[projectId]/sync/route')
    const response = await POST(new NextRequest('http://localhost/api/v1/projects/project-a/sync', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orgId: 'org-a' }),
    }), context)
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual(expect.objectContaining({ success: false, error: 'Project sync request failed' }))
    expect(JSON.stringify(body)).not.toContain('Firestore')
    expect(JSON.stringify(body)).not.toContain('secret/internal/path')
  })

  it('returns a controlled validation error for a known coordinator domain failure', async () => {
    mockStartProjectSync.mockRejectedValueOnce(new Error('project sync requires at least two active replicas'))
    const { POST } = await import('@/app/api/v1/projects/[projectId]/sync/route')
    const response = await POST(new NextRequest('http://localhost/api/v1/projects/project-a/sync', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orgId: 'org-a' }),
    }), context)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual(expect.objectContaining({
      success: false, error: 'Project sync requires at least two active replicas',
    }))
  })

  it('allows project members to read truthful sync status without exposing filesystem paths', async () => {
    const { GET } = await import('@/app/api/v1/projects/[projectId]/sync/route')
    const response = await GET(new NextRequest('http://localhost/api/v1/projects/project-a/sync?orgId=org-a'), context)
    expect(response.status).toBe(200)
    expect(mockGetProjectForUser).toHaveBeenCalledWith('project-a', mockUser, 'org-a')
    const body = await response.json()
    expect(body.data.request.status).toBe('waiting_for_locations')
    expect(body.data.request).toEqual(expect.objectContaining({ replicaCount: 1, onlineReplicaCount: 1 }))
    expect(JSON.stringify(body)).not.toContain('private-user')
    expect(JSON.stringify(body)).not.toContain('private-replica')
    expect(JSON.stringify(body)).not.toContain('private-location')
    expect(JSON.stringify(body)).not.toContain('private-mapping')
    expect(JSON.stringify(body)).not.toContain('private-revision')
  })

  it('revokes transfer availability on status reads if combined retention proof is absent', async () => {
    mockGetLatest.mockResolvedValueOnce({
      requestId: 'psync-native', status: 'pending_inventory', continuousExecutorVerified: true,
      stateVersion: 2, requestedAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:01.000Z',
      replicaStates: [], transfers: [], conflict: null,
    })
    mockVerifyProjectSyncExecutorEligibility.mockResolvedValueOnce({
      verified: false, started: false, blockers: ['storage_lifecycle_unverified'],
    })
    const { GET } = await import('@/app/api/v1/projects/[projectId]/sync/route')
    const response = await GET(new NextRequest('http://localhost/api/v1/projects/project-a/sync?orgId=org-a'), context)
    expect(await response.json()).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        continuousExecutorVerified: false,
        transferAvailable: false,
        blocker: 'project_sync_storage_lifecycle_unverified',
      }),
    }))
  })

  it('rejects a private computer as the canonical sync source', async () => {
    const { POST } = await import('@/app/api/v1/projects/[projectId]/sync/route')
    const response = await POST(new NextRequest('http://localhost/api/v1/projects/project-a/sync', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'org-a', canonicalLocationId: 'peets-mac-mini' }),
    }), context)

    expect(response.status).toBe(400)
    expect(mockStartProjectSync).not.toHaveBeenCalled()
  })

  it('rejects viewers before creating coordinator state', async () => {
    mockGetProjectForUser.mockResolvedValueOnce({
      ok: true,
      doc: { data: () => ({ clientOrgId: 'org-a' }) },
      projectAccess: { role: 'viewer' },
    })
    const { POST } = await import('@/app/api/v1/projects/[projectId]/sync/route')
    const response = await POST(new NextRequest('http://localhost/api/v1/projects/project-a/sync', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orgId: 'org-a' }),
    }), context)
    expect(response.status).toBe(403)
    expect(mockStartProjectSync).not.toHaveBeenCalled()
  })

  it('rejects an organisation not linked to the project before reading replicas', async () => {
    const { POST } = await import('@/app/api/v1/projects/[projectId]/sync/route')
    const response = await POST(new NextRequest('http://localhost/api/v1/projects/project-a/sync', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orgId: 'other-org' }),
    }), context)
    expect(response.status).toBe(403)
    expect(mockListProjectLocations).not.toHaveBeenCalled()
  })

  it('lets a project manager cancel a conflicted request before starting a clean inventory', async () => {
    mockGetLatest.mockResolvedValueOnce({
      requestId: 'psync-conflict', status: 'conflict', continuousExecutorVerified: true,
      stateVersion: 4, requestedAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:01.000Z',
      replicaStates: [], transfers: [], conflict: {
        kind: 'target_drift', status: 'open', detectedAt: '2026-07-13T00:00:01.000Z', revisions: [],
      },
    })
    mockCancelProjectSync.mockResolvedValueOnce({
      requestId: 'psync-conflict', status: 'cancelled', continuousExecutorVerified: true,
      stateVersion: 5, requestedAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:02.000Z',
      replicaStates: [], transfers: [], conflict: null,
    })
    const { DELETE } = await import('@/app/api/v1/projects/[projectId]/sync/route')
    const response = await DELETE(new NextRequest('http://localhost/api/v1/projects/project-a/sync', {
      method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orgId: 'org-a' }),
    }), context)

    expect(response.status).toBe(200)
    expect(mockCancelProjectSync).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'psync-conflict' }), expect.any(Object))
    expect(await response.json()).toEqual(expect.objectContaining({
      data: expect.objectContaining({ cancelled: true, request: expect.objectContaining({ status: 'cancelled' }) }),
    }))
  })
})
