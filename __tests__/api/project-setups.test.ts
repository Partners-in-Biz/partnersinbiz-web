import { NextRequest, NextResponse } from 'next/server'

const mockHandleProjectCreate = jest.fn()
const mockHandleOrganizationCreate = jest.fn()
const mockGetOrgWorkspaceById = jest.fn()
const mockGetDefaultOrgWorkspace = jest.fn()
const mockGetCompanyWorkspaceByCompanyId = jest.fn()
const mockListExecutionLocationsForWorkspace = jest.fn()
const mockLinkProjectLocation = jest.fn()
const mockProvisionStandardProjectFolder = jest.fn()
const mockProjectSet = jest.fn()
const mockFolderSet = jest.fn()
const mockFolderGet = jest.fn()
const mockSetupOperationClaim = jest.fn()
const mockSetupOperationCheckpoint = jest.fn()
const mockSetupOperationHeartbeat = jest.fn()
const mockSetupOperationFinish = jest.fn()
const mockSetupOperationFail = jest.fn()
const mockGetAccessibleCompany = jest.fn()
const mockAddProjectToUserLibrary = jest.fn()
let mockExistingCompanyProjectDocs: Array<{ id: string; data: () => Record<string, unknown> }> = []

let mockUser = { uid: 'peet-user', role: 'admin' as 'admin' | 'client', orgId: 'pib-org', orgIds: ['pib-org'] }

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: Function) => (req: NextRequest) => handler(req, mockUser),
}))
jest.mock('@/app/api/v1/projects/route', () => ({
  handleProjectCreate: (...args: unknown[]) => mockHandleProjectCreate(...args),
}))
jest.mock('@/app/api/v1/organizations/route', () => ({
  handleOrganizationCreate: (...args: unknown[]) => mockHandleOrganizationCreate(...args),
}))
jest.mock('@/lib/client-provisioning/workspace-context', () => ({
  getOrgWorkspaceById: (...args: unknown[]) => mockGetOrgWorkspaceById(...args),
  getDefaultOrgWorkspace: (...args: unknown[]) => mockGetDefaultOrgWorkspace(...args),
  getCompanyWorkspaceByCompanyId: (...args: unknown[]) => mockGetCompanyWorkspaceByCompanyId(...args),
}))
jest.mock('@/lib/project-locations/store', () => ({
  listExecutionLocationsForWorkspace: (...args: unknown[]) => mockListExecutionLocationsForWorkspace(...args),
  linkProjectLocation: (...args: unknown[]) => mockLinkProjectLocation(...args),
}))
jest.mock('@/lib/project-locations/project-folder-provisioning', () => ({
  provisionStandardProjectFolder: (...args: unknown[]) => mockProvisionStandardProjectFolder(...args),
}))
jest.mock('@/lib/companies/api-access', () => ({
  getAccessibleCompanyForUser: (...args: unknown[]) => mockGetAccessibleCompany(...args),
}))
jest.mock('@/lib/projects/user-library', () => ({
  addProjectToUserLibrary: (...args: unknown[]) => mockAddProjectToUserLibrary(...args),
}))
jest.mock('@/lib/project-locations/project-setup-operations', () => {
  const actual = jest.requireActual('@/lib/project-locations/project-setup-operations')
  return {
    ...actual,
    createProjectSetupOperationRepository: () => ({
      claim: (...args: unknown[]) => mockSetupOperationClaim(...args),
      heartbeat: (...args: unknown[]) => mockSetupOperationHeartbeat(...args),
      checkpoint: (...args: unknown[]) => mockSetupOperationCheckpoint(...args),
      finish: (...args: unknown[]) => mockSetupOperationFinish(...args),
      fail: (...args: unknown[]) => mockSetupOperationFail(...args),
    }),
  }
})
jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__SERVER_TS__' },
}))
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => ({
      where: () => ({ get: async () => ({ docs: name === 'projects' ? mockExistingCompanyProjectDocs : [] }) }),
      doc: (_id: string) => name === 'workspace_folders'
        ? { get: mockFolderGet, set: mockFolderSet }
        : { set: mockProjectSet },
    }),
  },
}))

const vps = {
  locationId: 'partners-vps', label: 'Partners VPS', kind: 'vps', platform: 'linux', runtimeTargetId: 'vps',
  owner: { type: 'organization', orgId: 'pib-org' }, visibility: 'organization', allowedOrgIds: ['pib-org'],
  status: 'active', availability: 'online', verificationStatus: 'verified',
  mappings: [{ mappingId: 'vps-map', orgId: 'pib-org', workspaceId: 'partners', status: 'active' }],
  createdAt: 'now', updatedAt: 'now',
}

function request(body: Record<string, unknown>, idempotencyKey: string | null = 'wizard-attempt-test-123') {
  return new NextRequest('http://localhost/api/v1/project-setups', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockUser = { uid: 'peet-user', role: 'admin', orgId: 'pib-org', orgIds: ['pib-org'] }
  mockHandleProjectCreate.mockResolvedValue(NextResponse.json({ success: true, data: { id: 'project-1' } }, { status: 201 }))
  mockHandleOrganizationCreate.mockResolvedValue(NextResponse.json({
    success: true, data: { id: 'client-org', slug: 'acme', provisioning: { status: 'complete' } },
  }, { status: 201 }))
  const workspace = {
    workspaceId: 'partners', orgId: 'pib-org',
    vpsPath: '/var/lib/hermes/Cowork/partners/Partners in Biz',
    localPath: '/Users/peetstander/Cowork/partners/Partners in Biz',
  }
  mockGetOrgWorkspaceById.mockResolvedValue(workspace)
  mockGetDefaultOrgWorkspace.mockResolvedValue(workspace)
  mockGetCompanyWorkspaceByCompanyId.mockResolvedValue({
    ...workspace,
    workspaceId: 'acme-company',
    orgId: 'linked-client-org',
    vpsPath: '/var/lib/hermes/Cowork/partners/Acme',
    localPath: '/Users/peetstander/Cowork/partners/Acme',
  })
  mockListExecutionLocationsForWorkspace.mockResolvedValue([vps])
  mockProvisionStandardProjectFolder.mockResolvedValue({
    projectId: 'project-1', relativePath: 'projects/project-1', folderStatus: 'provisioned', syncStatus: 'pending',
    manifestWritten: true, manifestPreserved: false, directoriesCreated: [], directoriesPreserved: [],
  })
  mockLinkProjectLocation.mockResolvedValue({
    replicaId: 'replica-1', projectId: 'project-1', orgId: 'pib-org', workspaceId: 'partners',
    locationId: 'partners-vps', locationLabel: 'Partners VPS', locationKind: 'vps', locationPlatform: 'linux',
    locationOwner: { type: 'organization', orgId: 'pib-org' }, locationVisibility: 'organization', mappingId: 'vps-map',
    relativePath: 'projects/project-1', availability: 'online', desiredRevision: null, currentRevision: null,
    syncStatus: 'pending', lastSync: { checksum: 'private-checksum' },
    lastError: { message: 'private diagnostic' }, lastConflict: { path: 'private/conflict' }, active: true,
    linkedByUserId: 'peet-user', createdAt: 'now', updatedAt: 'now',
  })
  mockProjectSet.mockResolvedValue(undefined)
  mockFolderSet.mockResolvedValue(undefined)
  mockFolderGet.mockResolvedValue({ exists: false })
  mockSetupOperationClaim.mockResolvedValue({
    kind: 'claimed', operationId: 'setup_operation_test', leaseToken: 'lease-token', checkpoint: {},
  })
  mockSetupOperationCheckpoint.mockResolvedValue(undefined)
  mockSetupOperationHeartbeat.mockResolvedValue(undefined)
  mockSetupOperationFinish.mockResolvedValue(undefined)
  mockSetupOperationFail.mockResolvedValue(undefined)
  mockGetAccessibleCompany.mockResolvedValue({ id: 'company-1', orgId: 'pib-org', name: 'Acme' })
  mockAddProjectToUserLibrary.mockResolvedValue({ projectId: 'project-1', active: true })
  mockExistingCompanyProjectDocs = []
})

describe('POST /api/v1/project-setups', () => {
  it('binds setup to an accessible company and adds the result only to the current user sidebar', async () => {
    const { POST } = await import('@/app/api/v1/project-setups/route')
    const response = await POST(request({
      mode: 'standard', orgId: 'pib-org', companyId: 'company-1', projectName: 'Acme Cowork', workspaceId: 'partners',
      locationIds: ['partners-vps'],
    }))

    expect(response.status).toBe(202)
    expect(mockGetAccessibleCompany).toHaveBeenCalledWith('company-1', 'pib-org', mockUser)
    const internalRequest = mockHandleProjectCreate.mock.calls[0][0] as NextRequest
    expect(await internalRequest.json()).toEqual(expect.objectContaining({
      orgId: 'pib-org', sourceCompanyId: 'company-1', name: 'Acme Cowork',
    }))
    expect(mockAddProjectToUserLibrary).toHaveBeenCalledWith({
      orgId: 'pib-org', userId: 'peet-user', projectId: 'project-1', companyId: 'company-1',
    })
    expect(mockProvisionStandardProjectFolder).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'partners', workspacePath: '/var/lib/hermes/Cowork/partners/Acme',
    }))
  })

  it('rejects setup when the selected company is outside the user CRM access', async () => {
    mockGetAccessibleCompany.mockResolvedValue(null)
    const { POST } = await import('@/app/api/v1/project-setups/route')
    const response = await POST(request({
      mode: 'standard', orgId: 'pib-org', companyId: 'company-secret', projectName: 'Secret', workspaceId: 'partners',
      locationIds: ['partners-vps'],
    }))

    expect(response.status).toBe(403)
    expect(mockSetupOperationClaim).not.toHaveBeenCalled()
    expect(mockHandleProjectCreate).not.toHaveBeenCalled()
  })

  it.each(['standard', 'existing_folder'])('refuses to create a duplicate Cowork project for the same company and organisation in %s mode', async (mode) => {
    mockExistingCompanyProjectDocs = [{
      id: 'existing-company-project',
      data: () => ({ orgId: 'pib-org', sourceCompanyId: 'company-1', name: 'Acme Cowork', status: 'active' }),
    }]
    const { POST } = await import('@/app/api/v1/project-setups/route')
    const response = await POST(request({
      mode, orgId: 'pib-org', companyId: 'company-1', projectName: '  ACME   cowork ', workspaceId: 'partners',
      locationIds: ['partners-vps'],
    }))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual(expect.objectContaining({
      error: expect.stringMatching(/already exists/i),
    }))
    expect(mockSetupOperationClaim).not.toHaveBeenCalled()
    expect(mockHandleProjectCreate).not.toHaveBeenCalled()
  })

  it('allows multiple differently named projects for the same company', async () => {
    mockExistingCompanyProjectDocs = [{
      id: 'existing-company-project',
      data: () => ({ orgId: 'pib-org', sourceCompanyId: 'company-1', name: 'Website', status: 'active' }),
    }]
    const { POST } = await import('@/app/api/v1/project-setups/route')
    const response = await POST(request({
      mode: 'standard', orgId: 'pib-org', companyId: 'company-1', projectName: 'SEO Sprint',
      workspaceId: 'partners', locationIds: ['partners-vps'],
    }))

    expect(response.status).toBe(202)
    expect(mockHandleProjectCreate).toHaveBeenCalled()
  })

  it('executes standard setup through the existing project business handler', async () => {
    const { POST } = await import('@/app/api/v1/project-setups/route')
    const response = await POST(request({
      mode: 'standard', orgId: 'pib-org', projectName: 'Campaign', workspaceId: 'partners',
      locationIds: ['partners-vps'],
    }))

    expect(response.status).toBe(202)
    expect(mockHandleProjectCreate).toHaveBeenCalledWith(expect.any(NextRequest), mockUser, {
      documentId: expect.stringMatching(/^setup_project_[a-f0-9]{40}$/),
      setupOperationId: 'setup_operation_test',
    })
    expect(mockSetupOperationHeartbeat).toHaveBeenCalledWith({
      operationId: 'setup_operation_test', leaseToken: 'lease-token',
    })
    const body = await response.json()
    expect(body).toEqual({
      success: true,
      data: {
        projectId: 'project-1',
        locationIds: ['partners-vps'],
        project: { id: 'project-1', name: 'Campaign', orgId: 'pib-org', workspaceId: 'partners' },
        plan: {
          requestId: 'setup_operation_test', mode: 'standard', state: 'created_sync_pending',
          completed: false, syncCompleted: false,
          actions: [
            { type: 'create_project_record', status: 'completed' },
            { type: 'create_standard_project_folder', status: 'completed' },
            { type: 'link_project_location', status: 'completed' },
            { type: 'record_project_setup', status: 'completed' },
            { type: 'verify_initial_sync', status: 'pending' },
          ],
        },
      },
    })
    expect(body.data).not.toHaveProperty('folder')
    expect(body.data).not.toHaveProperty('replicas')
    expect(JSON.stringify(body)).not.toContain('vps-map')
    expect(JSON.stringify(body)).not.toContain('projects/project-1')
    expect(JSON.stringify(body)).not.toContain('peet-user')
    expect(JSON.stringify(body)).not.toContain('private diagnostic')
    expect(JSON.stringify(body)).not.toContain('relativePath')
    expect(JSON.stringify(body)).not.toContain('replicaId')
    expect(JSON.stringify(body)).not.toContain('workspaceFolderId')
    expect(JSON.stringify(body)).not.toContain('requiredEvidence')
  })

  it('reuses the deterministic project resource when checkpoint persistence fails after create', async () => {
    const physicallyCreatedIds = new Set<string>()
    let physicalCreates = 0
    mockHandleProjectCreate.mockImplementation(async (_req: NextRequest, _user: unknown, options: {
      documentId: string; setupOperationId: string
    }) => {
      if (!physicallyCreatedIds.has(options.documentId)) {
        physicallyCreatedIds.add(options.documentId)
        physicalCreates += 1
      }
      return NextResponse.json({ success: true, data: { id: options.documentId } }, { status: 201 })
    })
    mockSetupOperationCheckpoint
      .mockRejectedValueOnce(new Error('checkpoint write failed after project create'))
      .mockResolvedValue(undefined)
    const { POST } = await import('@/app/api/v1/project-setups/route')
    const payload = {
      mode: 'standard', orgId: 'pib-org', projectName: 'Crash-safe campaign', workspaceId: 'partners',
      locationIds: ['partners-vps'],
    }

    const first = await POST(request(payload, 'wizard-crash-safe-123'))
    const retry = await POST(request(payload, 'wizard-crash-safe-123'))

    expect(first.status).toBe(500)
    expect(retry.status).toBe(202)
    expect(mockHandleProjectCreate).toHaveBeenCalledTimes(2)
    expect(mockHandleProjectCreate.mock.calls[0][2]).toEqual(mockHandleProjectCreate.mock.calls[1][2])
    expect(physicalCreates).toBe(1)
  })

  it('loads an existing folder by id on the server and never uses a browser path', async () => {
    mockFolderGet.mockResolvedValue({
      exists: true,
      id: 'folder-1',
      data: () => ({
        orgId: 'pib-org', name: 'Registered folder', deleted: false, projectId: null,
        resourceType: 'client_workspace', resourceId: 'partners:registered', visibility: 'admin_agents_clients',
        permissions: { allowedAgentIds: [], allowedRoleIds: [], allowedUserIds: [], inheritParent: true },
        paths: { vpsPath: '/var/lib/hermes/Cowork/partners/Partners in Biz/campaigns/registered', localPathHint: null },
      }),
    })
    const { POST } = await import('@/app/api/v1/project-setups/route')
    const response = await POST(request({
      mode: 'existing_folder', orgId: 'pib-org', projectName: 'Registered', workspaceId: 'partners',
      workspaceFolderId: 'folder-1', locationIds: ['partners-vps'], relativePath: '../../evil', mappingId: 'evil',
    }))

    expect(response.status).toBe(202)
    expect(mockLinkProjectLocation).toHaveBeenCalledWith(expect.objectContaining({
      relativePath: 'campaigns/registered', mappingId: 'vps-map',
    }))
    expect(mockFolderSet).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'project-1' }), { merge: true })
    expect(mockFolderSet.mock.calls[0][0]).not.toHaveProperty('resourceType')
    expect(mockFolderSet.mock.calls[0][0]).not.toHaveProperty('resourceId')
    const body = await response.json()
    expect(body.data.locationIds).toEqual(['partners-vps'])
    expect(body.data).not.toHaveProperty('folder')
    expect(body.data).not.toHaveProperty('replicas')
    expect(JSON.stringify(body)).not.toContain('campaigns/registered')
    expect(JSON.stringify(body)).not.toContain('folder-1')
  })

  it('returns a partial 207 payload when an upstream machine link fails', async () => {
    mockLinkProjectLocation.mockRejectedValue(new Error('computer unavailable'))
    const { POST } = await import('@/app/api/v1/project-setups/route')
    const response = await POST(request({
      mode: 'standard', orgId: 'pib-org', projectName: 'Partial', workspaceId: 'partners',
      locationIds: ['partners-vps'],
    }))

    expect(response.status).toBe(207)
    const body = await response.json()
    expect(body).toMatchObject({
      success: true,
      data: {
        projectId: 'project-1', locationIds: [],
        plan: { state: 'partial', completed: false, syncCompleted: false },
      },
    })
    expect(JSON.stringify(body)).not.toContain('computer unavailable')
    expect(body.data.plan.actions).toContainEqual({ type: 'link_project_location', status: 'failed' })
    expect(body.data.plan.actions.every((action: Record<string, unknown>) => (
      Object.keys(action).every(key => key === 'type' || key === 'status')
    ))).toBe(true)
  })

  it('never auto-creates an organisation from company project setup', async () => {
    const { POST } = await import('@/app/api/v1/project-setups/route')
    const response = await POST(request({ mode: 'full_client', clientName: 'Acme', projectName: 'Launch' }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual(expect.objectContaining({
      error: expect.stringMatching(/Automatic organisation creation is disabled/i),
    }))
    expect(mockHandleOrganizationCreate).not.toHaveBeenCalled()
    expect(mockSetupOperationClaim).not.toHaveBeenCalled()
  })

  it('requires a caller idempotency key before any setup side effect', async () => {
    const { POST } = await import('@/app/api/v1/project-setups/route')
    const response = await POST(request({
      mode: 'standard', orgId: 'pib-org', projectName: 'No key', workspaceId: 'partners',
      locationIds: ['partners-vps'],
    }, null))

    expect(response.status).toBe(400)
    expect(mockSetupOperationClaim).not.toHaveBeenCalled()
    expect(mockHandleProjectCreate).not.toHaveBeenCalled()
  })

  it('does not create twice while the same caller key is already leased', async () => {
    mockSetupOperationClaim.mockResolvedValueOnce({ kind: 'in_progress', operationId: 'setup_operation_test' })
    const { POST } = await import('@/app/api/v1/project-setups/route')
    const response = await POST(request({
      mode: 'standard', orgId: 'pib-org', projectName: 'Concurrent', workspaceId: 'partners',
      locationIds: ['partners-vps'],
    }))

    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('Project setup is already in progress')
    expect(mockHandleProjectCreate).not.toHaveBeenCalled()
  })

  it('replays a completed operation through the same public-safe serializer', async () => {
    // Supply a complete internal replica shape without exposing it in the response.
    mockSetupOperationClaim.mockResolvedValueOnce({
      kind: 'replay', operationId: 'setup_operation_test',
      result: {
        status: 201, projectId: 'project-1',
        project: { id: 'project-1', name: 'Replay', orgId: 'pib-org', workspaceId: 'partners' },
        folder: { workspaceFolderId: 'private-folder', relativePaths: { vps: 'private/path' } },
        replicas: [{
          replicaId: 'private-replica', projectId: 'project-1', orgId: 'pib-org', workspaceId: 'partners',
          locationId: 'partners-vps', locationLabel: 'Partners VPS', locationKind: 'vps', locationPlatform: 'linux',
          locationOwner: { type: 'organization', orgId: 'pib-org' }, locationVisibility: 'organization',
          mappingId: 'private-map', relativePath: 'private/path', availability: 'online', desiredRevision: null,
          currentRevision: null, syncStatus: 'synced', isCanonical: true, lastSync: null, lastError: null,
          lastConflict: null, active: true, linkedByUserId: 'peet-user', createdAt: 'now', updatedAt: 'now',
        }],
        plan: {
          requestId: 'setup_operation_test', mode: 'standard', state: 'ready', completed: true, syncCompleted: true,
          actions: [{ type: 'link_project_location', status: 'completed', relativePath: 'private/path' }],
        },
      },
    })
    const { POST } = await import('@/app/api/v1/project-setups/route')
    const response = await POST(request({
      mode: 'standard', orgId: 'pib-org', projectName: 'Replay', workspaceId: 'partners',
      locationIds: ['partners-vps'],
    }))

    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.data).toEqual(expect.objectContaining({
      projectId: 'project-1', locationIds: ['partners-vps'],
      plan: expect.objectContaining({ requestId: 'setup_operation_test', state: 'ready' }),
    }))
    expect(JSON.stringify(body)).not.toContain('private-folder')
    expect(JSON.stringify(body)).not.toContain('private/path')
    expect(JSON.stringify(body)).not.toContain('private-map')
    expect(mockHandleProjectCreate).not.toHaveBeenCalled()
  })

  it('redacts upstream server diagnostics while preserving the 5xx status', async () => {
    mockHandleProjectCreate.mockResolvedValueOnce(NextResponse.json({
      success: false,
      error: 'OSError: /var/lib/hermes/Cowork/partners/Partners in Biz/private-client/.env failed',
    }, { status: 500 }))
    const { POST } = await import('@/app/api/v1/project-setups/route')
    const response = await POST(request({
      mode: 'standard', orgId: 'pib-org', projectName: 'Private path', workspaceId: 'partners',
      locationIds: ['partners-vps'],
    }))

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toBe('Project setup failed')
    expect(JSON.stringify(body)).not.toContain('/var/lib/hermes')
    expect(JSON.stringify(body)).not.toContain('OSError')
    expect(JSON.stringify(body)).not.toContain('.env')
  })
})
