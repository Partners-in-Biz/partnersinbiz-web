import { NextRequest } from 'next/server'

type MockUser = { uid: string; role: 'admin' | 'client'; orgId: string; orgIds?: string[]; allowedOrgIds?: string[] }
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>
type ProjectResponse = { data: Array<{ id: string }> }

const mockAdd = jest.fn()
const mockProjectDoc = jest.fn()
const mockProjectUpdate = jest.fn()
const mockProjectGetById = jest.fn()
const mockProjectDelete = jest.fn()
const mockProjectCreate = jest.fn()
const mockProjectSet = jest.fn()
const mockProjectMemberDoc = jest.fn()
const mockProjectMemberSet = jest.fn()
const mockProjectMemberGet = jest.fn()
const mockProjectOrganizationDoc = jest.fn()
const mockProjectOrganizationGet = jest.fn()
const mockProjectOrganizationWhere = jest.fn()
const mockProjectOrganizationListGet = jest.fn()
const mockCollection = jest.fn()
const mockRecursiveDelete = jest.fn()
const mockActivityAdd = jest.fn()
const mockOrgWhere = jest.fn()
const mockOrgLimit = jest.fn()
const mockOrgGet = jest.fn()
const mockOrgDoc = jest.fn()
const mockOrgDocGet = jest.fn()
const mockOrgMemberDoc = jest.fn()
const mockOrgMemberGet = jest.fn()
const mockProjectWhere = jest.fn()
const mockProjectOrderBy = jest.fn()
const mockProjectGet = jest.fn()
const mockCompanyDoc = jest.fn()
const mockCompanyGet = jest.fn()
const mockContactDoc = jest.fn()
const mockContactGet = jest.fn()
const mockEnsureClaimableRelationship = jest.fn()
const mockResolvePlatformOwnerOrgId = jest.fn()
const mockEnsurePlatformCompanyForOrg = jest.fn()

let mockUser: MockUser = { uid: 'admin-1', role: 'admin', orgId: 'platform' }

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection, recursiveDelete: mockRecursiveDelete },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => async (req: NextRequest, ctx?: unknown) =>
    handler(req, mockUser, ctx),
}))

jest.mock('@/lib/claimable-relationships/store', () => ({
  ensureClaimableRelationship: (input: unknown) => mockEnsureClaimableRelationship(input),
}))

jest.mock('@/lib/platform-owner/relationships', () => ({
  resolvePlatformOwnerOrgId: () => mockResolvePlatformOwnerOrgId(),
  ensurePlatformCompanyForOrg: (input: unknown) => mockEnsurePlatformCompanyForOrg(input),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  },
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockUser = { uid: 'admin-1', role: 'admin', orgId: 'platform' }

  const orgQuery = {
    limit: mockOrgLimit,
    get: mockOrgGet,
  }
  mockOrgWhere.mockReturnValue(orgQuery)
  mockOrgLimit.mockReturnValue(orgQuery)
  mockOrgDoc.mockReturnValue({ get: mockOrgDocGet })
  mockOrgDocGet.mockResolvedValue({
    exists: true,
    data: () => ({ name: 'Covalonic' }),
  })
  mockOrgMemberDoc.mockReturnValue({ get: mockOrgMemberGet })
  mockOrgMemberGet.mockResolvedValue({ exists: false, data: () => undefined })

  const scopedProjectQuery = {
    get: mockProjectGet,
    orderBy: mockProjectOrderBy,
  }
  const projectCollection = {
    add: mockAdd,
    doc: mockProjectDoc,
    where: mockProjectWhere,
    orderBy: mockProjectOrderBy,
    get: mockProjectGet,
  }
  mockProjectWhere.mockReturnValue(scopedProjectQuery)
  mockProjectOrderBy.mockReturnValue(scopedProjectQuery)
  mockProjectDoc.mockReturnValue({
    get: mockProjectGetById,
    create: mockProjectCreate,
    set: mockProjectSet,
    update: mockProjectUpdate,
    delete: mockProjectDelete,
  })
  mockProjectGetById.mockResolvedValue({
    exists: true,
    data: () => ({ orgId: 'platform', name: 'Project to delete' }),
  })
  mockProjectDelete.mockResolvedValue(undefined)
  mockProjectCreate.mockResolvedValue(undefined)
  mockProjectSet.mockResolvedValue(undefined)
  mockRecursiveDelete.mockResolvedValue(undefined)
  mockActivityAdd.mockResolvedValue({ id: 'activity-1' })
  mockProjectUpdate.mockResolvedValue(undefined)
  mockProjectMemberDoc.mockReturnValue({ set: mockProjectMemberSet, get: mockProjectMemberGet })
  mockProjectMemberSet.mockResolvedValue(undefined)
  mockProjectMemberGet.mockResolvedValue({ exists: false, data: () => undefined })
  mockProjectOrganizationDoc.mockReturnValue({ get: mockProjectOrganizationGet })
  mockProjectOrganizationGet.mockResolvedValue({ exists: false, data: () => undefined })
  mockProjectOrganizationWhere.mockReturnValue({ get: mockProjectOrganizationListGet })
  mockProjectOrganizationListGet.mockResolvedValue({ docs: [] })
  mockCompanyDoc.mockReturnValue({ get: mockCompanyGet })
  mockContactDoc.mockReturnValue({ get: mockContactGet })
  mockCompanyGet.mockResolvedValue({ exists: false, data: () => undefined })
  mockContactGet.mockResolvedValue({ exists: false, data: () => undefined })
  mockEnsureClaimableRelationship.mockResolvedValue({
    id: 'relationship-1',
    claimToken: 'claim-token-1',
    targetOrgId: undefined,
    targetUserId: undefined,
    status: 'pending',
  })
  mockResolvePlatformOwnerOrgId.mockResolvedValue('pib-platform-owner')
  mockEnsurePlatformCompanyForOrg.mockResolvedValue({
    platformOrgId: 'pib-platform-owner',
    companyId: 'company-client',
    companyName: 'Covalonic',
  })

  mockCollection.mockImplementation((name: string) => {
    if (name === 'organizations') return { where: mockOrgWhere, doc: mockOrgDoc }
    if (name === 'orgMembers') return { doc: mockOrgMemberDoc }
    if (name === 'projects') return projectCollection
    if (name === 'projectMembers') return { doc: mockProjectMemberDoc }
    if (name === 'projectOrganizations') return { doc: mockProjectOrganizationDoc, where: mockProjectOrganizationWhere }
    if (name === 'companies') return { doc: mockCompanyDoc }
    if (name === 'contacts') return { doc: mockContactDoc }
    if (name === 'activity') return { add: mockActivityAdd }
    throw new Error(`Unexpected collection: ${name}`)
  })
})

describe('GET /api/v1/projects', () => {
  it('hides completed and archived projects from active received lists by default', async () => {
    mockUser = { uid: 'client-1', role: 'client', orgId: 'recipient-org' }
    mockProjectGet
      .mockResolvedValueOnce({
        docs: [
          { id: 'active', data: () => ({ name: 'Active Project', recipientOrgId: 'recipient-org', status: 'development', createdAt: { seconds: 30 } }) },
          { id: 'completed', data: () => ({ name: 'Signed Off', recipientOrgId: 'recipient-org', status: 'completed', createdAt: { seconds: 20 } }) },
          { id: 'archived-flag', data: () => ({ name: 'Archived Flag', recipientOrgId: 'recipient-org', archived: true, createdAt: { seconds: 10 } }) },
        ],
      })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [] })

    const { GET } = await import('@/app/api/v1/projects/route')
    const req = new NextRequest('http://localhost/api/v1/projects?view=received')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const body = await res.json() as ProjectResponse
    expect(body.data.map((project) => project.id)).toEqual(['active'])
  })

  it('returns completed and archived projects when the archive view is requested', async () => {
    mockUser = { uid: 'client-1', role: 'client', orgId: 'recipient-org' }
    mockProjectGet
      .mockResolvedValueOnce({
        docs: [
          { id: 'active', data: () => ({ name: 'Active Project', recipientOrgId: 'recipient-org', status: 'development', createdAt: { seconds: 30 } }) },
          { id: 'completed', data: () => ({ name: 'Signed Off', recipientOrgId: 'recipient-org', status: 'completed', createdAt: { seconds: 20 } }) },
          { id: 'archived-flag', data: () => ({ name: 'Archived Flag', recipientOrgId: 'recipient-org', archived: true, createdAt: { seconds: 10 } }) },
        ],
      })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [] })

    const { GET } = await import('@/app/api/v1/projects/route')
    const req = new NextRequest('http://localhost/api/v1/projects?view=received&archive=only')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const body = await res.json() as ProjectResponse
    expect(body.data.map((project) => project.id)).toEqual(['completed', 'archived-flag'])
  })

  it('lists client workspace projects by org slug without requiring a Firestore composite index', async () => {
    mockOrgGet.mockResolvedValue({
      empty: false,
      docs: [{ id: 'org-covalonic', data: () => ({ name: 'Covalonic' }) }],
    })
    mockProjectGet.mockResolvedValue({
      docs: [
        { id: 'old', data: () => ({ name: 'Older Project', createdAt: { seconds: 10 } }) },
        { id: 'new', data: () => ({ name: 'Newer Project', createdAt: { seconds: 20 } }) },
      ],
    })

    const { GET } = await import('@/app/api/v1/projects/route')
    const req = new NextRequest('http://localhost/api/v1/projects?orgSlug=covalonic')
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(mockProjectWhere).toHaveBeenCalledWith('orgId', '==', 'org-covalonic')
    expect(mockProjectOrderBy).not.toHaveBeenCalled()

    const body = await res.json() as ProjectResponse
    expect(body.data.map((project) => project.id)).toEqual(['new', 'old'])
  })

  it('lists received projects for the signed-in client org', async () => {
    mockUser = { uid: 'client-1', role: 'client', orgId: 'recipient-org' }
    mockProjectGet.mockResolvedValue({
      docs: [
        { id: 'received', data: () => ({ name: 'Shared Project', recipientOrgId: 'recipient-org', createdAt: { seconds: 20 } }) },
      ],
    })

    const { GET } = await import('@/app/api/v1/projects/route')
    const req = new NextRequest('http://localhost/api/v1/projects?view=received')
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(mockProjectWhere).toHaveBeenCalledWith('recipientOrgId', '==', 'recipient-org')
    const body = await res.json() as ProjectResponse
    expect(body.data.map((project) => project.id)).toEqual(['received'])
  })

  it('discovers an active canonical organisation share without legacy project link fields', async () => {
    mockUser = { uid: 'client-1', role: 'client', orgId: 'recipient-org' }
    mockProjectGet.mockResolvedValue({ docs: [] })
    mockProjectOrganizationListGet.mockResolvedValue({
      docs: [{
        id: 'direct-share_recipient-org',
        data: () => ({ projectId: 'direct-share', orgId: 'recipient-org', status: 'active' }),
      }],
    })
    mockProjectGetById.mockResolvedValue({
      exists: true,
      id: 'direct-share',
      data: () => ({ name: 'Direct share', orgId: 'source-org', createdAt: { seconds: 20 } }),
    })

    const { GET } = await import('@/app/api/v1/projects/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/projects?view=received'))

    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual([
      expect.objectContaining({ id: 'direct-share', name: 'Direct share' }),
    ])
  })

  it('does not resurrect a canonically revoked share through legacy project fields', async () => {
    mockUser = { uid: 'client-1', role: 'client', orgId: 'recipient-org' }
    const legacyProject = {
      id: 'revoked-share',
      data: () => ({ name: 'Revoked share', recipientOrgId: 'recipient-org' }),
    }
    mockProjectGet
      .mockResolvedValueOnce({ docs: [legacyProject] })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [] })
    mockProjectOrganizationListGet.mockResolvedValue({
      docs: [
        {
          id: 'revoked-share_legacy-company',
          data: () => ({ projectId: 'revoked-share', orgId: 'recipient-org', status: 'active' }),
        },
        {
          id: 'revoked-share_recipient-org',
          data: () => ({ projectId: 'revoked-share', orgId: 'recipient-org', status: 'revoked' }),
        },
      ],
    })

    const { GET } = await import('@/app/api/v1/projects/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/projects?view=received'))

    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual([])
  })

  it('does not expose claim credentials or filesystem/runtime bindings in project lists', async () => {
    mockUser = { uid: 'client-1', role: 'client', orgId: 'recipient-org' }
    mockProjectGet.mockResolvedValue({
      docs: [{
        id: 'safe-project',
        data: () => ({
          name: 'Safe project', recipientOrgId: 'recipient-org', claimToken: 'bearer-secret',
          projectFolderRelativePath: 'projects/safe-project', workspaceFolderId: 'folder-secret',
          executionLocationIds: ['partners-vps'], canonicalLocationId: 'partners-vps',
        }),
      }],
    })

    const { GET } = await import('@/app/api/v1/projects/route')
    const body = await (await GET(new NextRequest('http://localhost/api/v1/projects?view=received'))).json()

    expect(body.data).toEqual([expect.objectContaining({ id: 'safe-project', name: 'Safe project' })])
    expect(JSON.stringify(body)).not.toContain('bearer-secret')
    expect(JSON.stringify(body)).not.toContain('projects/safe-project')
    expect(JSON.stringify(body)).not.toContain('folder-secret')
    expect(JSON.stringify(body)).not.toContain('partners-vps')
  })

  it('lists received client workspace projects by org slug across new and legacy ownership fields', async () => {
    mockOrgGet.mockResolvedValue({
      empty: false,
      docs: [{ id: 'client-org', data: () => ({ name: 'Client Org' }) }],
    })
    mockProjectGet
      .mockResolvedValueOnce({
        docs: [
          { id: 'received', data: () => ({ name: 'Received Project', recipientOrgId: 'client-org', createdAt: { seconds: 20 } }) },
        ],
      })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({
        docs: [
          { id: 'legacy', data: () => ({ name: 'Legacy Project', orgId: 'client-org', createdAt: { seconds: 10 } }) },
        ],
      })

    const { GET } = await import('@/app/api/v1/projects/route')
    const req = new NextRequest('http://localhost/api/v1/projects?view=received&orgSlug=client-org')
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(mockProjectWhere).toHaveBeenCalledWith('recipientOrgId', '==', 'client-org')
    expect(mockProjectWhere).toHaveBeenCalledWith('targetOrgId', '==', 'client-org')
    expect(mockProjectWhere).toHaveBeenCalledWith('clientOrgId', '==', 'client-org')
    expect(mockProjectWhere).toHaveBeenCalledWith('orgId', '==', 'client-org')
    expect(mockProjectOrderBy).not.toHaveBeenCalled()

    const body = await res.json() as ProjectResponse
    expect(body.data.map((project) => project.id)).toEqual(['received', 'legacy'])
  })

  it('does not treat a restricted admin platform home org as received-project access', async () => {
    mockUser = {
      uid: 'admin-1',
      role: 'admin',
      orgId: 'pib-platform-owner',
      allowedOrgIds: ['client-org'],
    }
    mockProjectGet
      .mockResolvedValueOnce({
        docs: [
          { id: 'received', data: () => ({ name: 'Received Project', recipientOrgId: 'client-org', createdAt: { seconds: 20 } }) },
        ],
      })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [] })

    const { GET } = await import('@/app/api/v1/projects/route')
    const req = new NextRequest('http://localhost/api/v1/projects?view=received')
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(mockProjectWhere).toHaveBeenCalledTimes(4)
    expect(mockProjectWhere).toHaveBeenCalledWith('recipientOrgId', '==', 'client-org')
    expect(mockProjectWhere).not.toHaveBeenCalledWith('recipientOrgId', '==', 'pib-platform-owner')
    expect(mockProjectWhere).not.toHaveBeenCalledWith('orgId', '==', 'pib-platform-owner')
    const body = await res.json() as ProjectResponse
    expect(body.data.map((project) => project.id)).toEqual(['received'])
  })
})

describe('POST /api/v1/projects', () => {
  it('ignores the ordinary Next.js route context when creating a project through the public API', async () => {
    mockUser = { uid: 'admin-1', role: 'admin', orgId: 'pib-org', orgIds: ['pib-org'] }
    mockOrgDocGet.mockResolvedValue({ exists: true, data: () => ({ name: 'PiB' }) })
    mockAdd.mockResolvedValue({ id: 'project-1' })

    const { POST } = await import('@/app/api/v1/projects/route')
    const response = await POST(new NextRequest('http://localhost/api/v1/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Pip API project', orgId: 'pib-org' }),
    }), { params: Promise.resolve({}) })

    expect(response.status).toBe(201)
    expect((await response.json()).data.id).toBe('project-1')
    expect(mockAdd).toHaveBeenCalledTimes(1)
  })

  it('uses and replays a trusted setup-derived project id instead of creating duplicates', async () => {
    mockUser = { uid: 'admin-1', role: 'admin', orgId: 'pib-org', orgIds: ['pib-org'] }
    mockOrgDocGet.mockResolvedValue({ exists: true, data: () => ({ name: 'PiB' }) })
    mockProjectDoc.mockImplementation((id: string) => ({
      id,
      get: mockProjectGetById,
      create: mockProjectCreate,
      set: mockProjectSet,
      update: mockProjectUpdate,
      delete: mockProjectDelete,
    }))
    mockProjectGetById
      .mockResolvedValueOnce({ exists: false, data: () => undefined })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          name: 'Durable setup project',
          orgId: 'pib-org',
          setupOperationId: 'setup_operation_1',
          setupCreationStatus: 'complete',
        }),
      })
    const { handleProjectCreate } = await import('@/app/api/v1/projects/route')
    const makeRequest = () => new NextRequest('http://localhost/api/v1/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Durable setup project', orgId: 'pib-org' }),
    })
    const options = {
      documentId: 'setup_project_0123456789abcdef0123456789abcdef01234567',
      setupOperationId: 'setup_operation_1',
    }

    const first = await handleProjectCreate(makeRequest(), mockUser, options)
    const replay = await handleProjectCreate(makeRequest(), mockUser, options)

    expect(first.status).toBe(201)
    expect(replay.status).toBe(200)
    expect((await first.json()).data.id).toBe(options.documentId)
    expect((await replay.json()).data.id).toBe(options.documentId)
    expect(mockAdd).not.toHaveBeenCalled()
    expect(mockProjectCreate).toHaveBeenCalledTimes(1)
    expect(mockProjectCreate).toHaveBeenCalledWith(expect.objectContaining({
      setupOperationId: 'setup_operation_1',
      setupCreationStatus: 'creating',
    }))
  })

  it('blocks client project requests when organisation governance denies create for their role', async () => {
    mockUser = { uid: 'client-1', role: 'client', orgId: 'client-org' }
    mockOrgDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        name: 'Client Org',
        members: [{ userId: 'client-1', role: 'member' }],
        settings: {
          modulePolicies: {
            projects: {
              actions: {
                create: { owner: true, admin: true, member: false },
              },
            },
          },
        },
      }),
    })

    const { POST } = await import('@/app/api/v1/projects/route')
    const req = new NextRequest('http://localhost/api/v1/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Member requested project',
        status: 'discovery',
      }),
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/Project creation is disabled/i)
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('creates a PiB-sourced project for a selected client workspace', async () => {
    mockOrgGet.mockResolvedValue({
      empty: false,
      docs: [{ id: 'org-covalonic', data: () => ({ name: 'Covalonic' }) }],
    })
    mockAdd.mockResolvedValue({ id: 'project-1' })

    const { POST } = await import('@/app/api/v1/projects/route')
    const req = new NextRequest('http://localhost/api/v1/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Website rebuild',
        orgSlug: 'covalonic',
        status: 'discovery',
      }),
    })

    const res = await POST(req)

    expect(res.status).toBe(201)
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Website rebuild',
        ownerUid: 'admin-1',
        ownerOrgId: 'pib-platform-owner',
        orgId: 'pib-platform-owner',
        sourceOrgId: 'pib-platform-owner',
        issuerOrgId: 'pib-platform-owner',
        clientId: 'org-covalonic',
        clientOrgId: 'org-covalonic',
        recipientOrgId: 'org-covalonic',
        targetOrgId: 'org-covalonic',
        companyId: 'company-client',
      }),
    )
    expect(mockProjectMemberDoc).toHaveBeenCalledWith('project-1_admin-1')
    expect(mockProjectMemberSet).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      uid: 'admin-1',
      orgId: 'pib-platform-owner',
      role: 'owner',
      status: 'active',
      memberType: 'internal',
    }), { merge: true })
  })

  it('creates a CRM-targeted project share with a claimable relationship', async () => {
    mockOrgGet.mockResolvedValue({
      empty: false,
      docs: [{ id: 'sender-org', data: () => ({ name: 'Sender Org' }) }],
    })
    mockAdd.mockResolvedValue({ id: 'project-1' })
    mockCompanyGet.mockResolvedValue({
      exists: true,
      data: () => ({
        orgId: 'sender-org',
        name: 'Buyer Co',
        linkedOrgId: 'recipient-org',
      }),
    })
    mockContactGet.mockResolvedValue({
      exists: true,
      data: () => ({
        orgId: 'sender-org',
        name: 'Buyer One',
        email: 'Buyer@Example.com',
        linkedUserId: 'recipient-user',
      }),
    })
    mockEnsureClaimableRelationship.mockResolvedValue({
      id: 'relationship-1',
      claimToken: 'claim-token-1',
      targetOrgId: 'recipient-org',
      targetUserId: 'recipient-user',
      status: 'claimed',
    })

    const { POST } = await import('@/app/api/v1/projects/route')
    const req = new NextRequest('http://localhost/api/v1/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Shared implementation',
        orgSlug: 'sender-org',
        companyId: 'company-1',
        contactId: 'contact-1',
      }),
    })

    const res = await POST(req)

    expect(res.status).toBe(201)
    expect(mockEnsureClaimableRelationship).toHaveBeenCalledWith(expect.objectContaining({
      sourceOrgId: 'sender-org',
      sourceCompanyId: 'company-1',
      sourceContactId: 'contact-1',
      recipientEmail: 'buyer@example.com',
      recipientName: 'Buyer One',
      recipientCompanyName: 'Buyer Co',
      resourceType: 'project',
      resourceId: 'project-1',
    }))
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Shared implementation',
      orgId: 'sender-org',
      sourceOrgId: 'sender-org',
      sourceCompanyId: 'company-1',
      sourceContactId: 'contact-1',
      recipientEmail: 'buyer@example.com',
      recipientOrgId: 'recipient-org',
      claimStatus: 'claimed',
    }))
    expect(mockProjectUpdate).toHaveBeenCalledWith(expect.objectContaining({
      claimableRelationshipId: 'relationship-1',
      claimToken: 'claim-token-1',
      claimStatus: 'claimed',
      recipientOrgId: 'recipient-org',
      recipientUserId: 'recipient-user',
    }))
    const body = await res.json()
    expect(body.data).toEqual(expect.objectContaining({
      id: 'project-1',
      claimToken: 'claim-token-1',
      claimStatus: 'claimed',
    }))
  })

  it('keeps additional project CRM links as reverse-visibility links without claim invite fan-out', async () => {
    mockOrgGet.mockResolvedValue({
      empty: false,
      docs: [{ id: 'sender-org', data: () => ({ name: 'Sender Org' }) }],
    })
    mockAdd.mockResolvedValue({ id: 'project-1' })
    mockCompanyGet.mockResolvedValue({ exists: true, data: () => ({ orgId: 'sender-org', name: 'Linked company' }) })
    mockContactGet.mockResolvedValue({ exists: true, data: () => ({ orgId: 'sender-org', name: 'Linked contact', email: 'primary@example.com' }) })
    mockEnsureClaimableRelationship.mockResolvedValue({
      id: 'relationship-1',
      claimToken: 'claim-token-1',
      targetOrgId: undefined,
      targetUserId: undefined,
      status: 'pending',
    })

    const { POST } = await import('@/app/api/v1/projects/route')
    const req = new NextRequest('http://localhost/api/v1/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Shared implementation',
        orgSlug: 'sender-org',
        companyId: 'company-primary',
        contactId: 'contact-primary',
        companyIds: ['company-secondary'],
        contactIds: ['contact-secondary'],
      }),
    })

    const res = await POST(req)

    expect(res.status).toBe(201)
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 'company-primary',
      sourceCompanyId: 'company-primary',
      companyIds: ['company-primary', 'company-secondary'],
      sourceCompanyIds: ['company-primary'],
      contactId: 'contact-primary',
      sourceContactId: 'contact-primary',
      contactIds: ['contact-primary', 'contact-secondary'],
      sourceContactIds: ['contact-primary'],
    }))
    expect(mockEnsureClaimableRelationship).toHaveBeenCalledTimes(1)
    expect(mockEnsureClaimableRelationship).toHaveBeenCalledWith(expect.objectContaining({
      sourceCompanyId: 'company-primary',
      sourceContactId: 'contact-primary',
      recipientEmail: 'primary@example.com',
    }))
  })
})

describe('PATCH /api/v1/projects/[projectId]', () => {
  it('updates normalized project company/contact links without fanning out claim tokens', async () => {
    mockUser = { uid: 'admin-1', role: 'admin', orgId: 'platform' }
    mockProjectGetById.mockResolvedValue({
      exists: true,
      id: 'project-1',
      data: () => ({
        orgId: 'platform',
        sourceOrgId: 'platform',
        name: 'Shared implementation',
        sourceCompanyId: 'company-primary',
        sourceContactId: 'contact-primary',
        recipientOrgId: 'recipient-org',
        claimToken: 'claim-token-1',
      }),
    })
    mockCompanyGet.mockResolvedValue({ exists: true, data: () => ({ orgId: 'platform', name: 'Linked company' }) })
    mockContactGet.mockResolvedValue({ exists: true, data: () => ({ orgId: 'platform', name: 'Linked contact' }) })

    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/route')
    const req = new NextRequest('http://localhost/api/v1/projects/project-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sourceCompanyId: ' company-primary ',
        companyIds: ['company-secondary', 'company-primary'],
        sourceContactId: ' contact-primary ',
        contactIds: ['contact-secondary'],
      }),
    })

    const res = await PATCH(req, { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(res.status).toBe(200)
    expect(mockProjectUpdate).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 'company-primary',
      sourceCompanyId: 'company-primary',
      companyIds: ['company-primary', 'company-secondary'],
      sourceCompanyIds: ['company-primary'],
      contactId: 'contact-primary',
      sourceContactId: 'contact-primary',
      contactIds: ['contact-primary', 'contact-secondary'],
      sourceContactIds: ['contact-primary'],
    }))
    expect(mockEnsureClaimableRelationship).not.toHaveBeenCalled()
    expect(mockProjectUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ claimToken: expect.anything() }))
  })
})

describe('DELETE /api/v1/projects', () => {
  it('soft-archives the project without recursively deleting nested work', async () => {
    const projectRef = {
      get: mockProjectGetById,
      update: mockProjectUpdate,
      delete: mockProjectDelete,
    }
    mockProjectDoc.mockReturnValue(projectRef)

    const { DELETE } = await import('@/app/api/v1/projects/route')
    const req = new NextRequest('http://localhost/api/v1/projects?id=project-1', { method: 'DELETE' })
    const res = await DELETE(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true, data: { id: 'project-1', archived: true } })
    expect(mockProjectDoc).toHaveBeenCalledWith('project-1')
    expect(mockProjectUpdate).toHaveBeenCalledWith(expect.objectContaining({
      archived: true,
      archivedAt: 'SERVER_TIMESTAMP',
      archivedBy: 'admin-1',
      updatedAt: 'SERVER_TIMESTAMP',
    }))
    expect(mockRecursiveDelete).not.toHaveBeenCalled()
    expect(mockProjectDelete).not.toHaveBeenCalled()
  })
})
