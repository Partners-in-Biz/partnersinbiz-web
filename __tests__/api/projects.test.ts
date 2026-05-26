import { NextRequest } from 'next/server'

type MockUser = { uid: string; role: 'admin' | 'client'; orgId: string; orgIds?: string[] }
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>
type ProjectResponse = { data: Array<{ id: string }> }

const mockAdd = jest.fn()
const mockProjectDoc = jest.fn()
const mockProjectUpdate = jest.fn()
const mockCollection = jest.fn()
const mockOrgWhere = jest.fn()
const mockOrgLimit = jest.fn()
const mockOrgGet = jest.fn()
const mockProjectWhere = jest.fn()
const mockProjectOrderBy = jest.fn()
const mockProjectGet = jest.fn()
const mockCompanyDoc = jest.fn()
const mockCompanyGet = jest.fn()
const mockContactDoc = jest.fn()
const mockContactGet = jest.fn()
const mockEnsureClaimableRelationship = jest.fn()

let mockUser: MockUser = { uid: 'admin-1', role: 'admin', orgId: 'platform' }

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => async (req: NextRequest, ctx?: unknown) =>
    handler(req, mockUser, ctx),
}))

jest.mock('@/lib/claimable-relationships/store', () => ({
  ensureClaimableRelationship: (input: unknown) => mockEnsureClaimableRelationship(input),
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
  mockProjectDoc.mockReturnValue({ update: mockProjectUpdate })
  mockProjectUpdate.mockResolvedValue(undefined)
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

  mockCollection.mockImplementation((name: string) => {
    if (name === 'organizations') return { where: mockOrgWhere }
    if (name === 'projects') return projectCollection
    if (name === 'companies') return { doc: mockCompanyDoc }
    if (name === 'contacts') return { doc: mockContactDoc }
    throw new Error(`Unexpected collection: ${name}`)
  })
})

describe('GET /api/v1/projects', () => {
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
})

describe('POST /api/v1/projects', () => {
  it('links a project created inside a client workspace to that client org', async () => {
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
        orgId: 'org-covalonic',
        clientId: 'org-covalonic',
      }),
    )
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
})
