import { NextRequest } from 'next/server'

const mockGetProjectForUser = jest.fn()
const mockCollection = jest.fn()
const mockProjectDoc = jest.fn()
const mockProjectGet = jest.fn()
const mockProjectSet = jest.fn()
const mockProjectMemberDoc = jest.fn()
const mockProjectMemberGet = jest.fn()
const mockProjectOrgDoc = jest.fn()
const mockProjectOrgGet = jest.fn()
const mockProjectOrgSet = jest.fn()
const mockProjectOrgWhere = jest.fn()
const mockProjectOrgListGet = jest.fn()
const mockOrganizationDoc = jest.fn()
const mockOrganizationGet = jest.fn()
const mockProjectRootDoc = jest.fn()
const mockProjectRootCollection = jest.fn()
const mockProjectAuditAdd = jest.fn()

type MockUser = {
  uid: string
  role: 'admin' | 'client'
  orgId?: string
  activeOrgId?: string
  orgIds?: string[]
  allowedOrgIds?: string[]
}

let mockUser: MockUser = { uid: 'abc-owner', role: 'admin', orgId: 'agency-abc' }

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest, user: typeof mockUser, ctx?: unknown) => unknown) => async (req: NextRequest, ctx?: unknown) =>
    handler(req, mockUser, ctx),
}))

jest.mock('@/lib/projects/access', () => ({
  getProjectForUser: (...args: unknown[]) => mockGetProjectForUser(...args),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  },
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockUser = { uid: 'abc-owner', role: 'admin', orgId: 'agency-abc' }
  mockGetProjectForUser.mockResolvedValue({
    ok: true,
    doc: {
      id: 'project-white-label',
      data: () => ({
        id: 'project-white-label',
        name: 'Shipping ABC Website',
        ownerUid: 'abc-owner',
        ownerOrgId: 'agency-abc',
        sourceOrgId: 'agency-abc',
        vendorOrgIds: [],
      }),
    },
    projectAccess: { role: 'owner', source: 'project_member', canViewInternal: true },
  })

  mockProjectDoc.mockImplementation((id: string) => ({
    get: () => mockProjectGet(id),
    set: (data: unknown, options: unknown) => mockProjectSet(id, data, options),
  }))
  mockProjectGet.mockImplementation(async (id: string) => ({
    exists: id === 'project-white-label',
    data: () => ({
      id: 'project-white-label',
      name: 'Shipping ABC Website',
      ownerOrgId: 'agency-abc',
      sourceOrgId: 'agency-abc',
      vendorOrgIds: [],
    }),
  }))
  mockProjectSet.mockResolvedValue(undefined)

  mockProjectMemberDoc.mockImplementation((id: string) => ({
    get: () => mockProjectMemberGet(id),
  }))
  mockProjectMemberGet.mockImplementation(async (id: string) => ({
    exists: id === 'project-white-label_abc-owner',
    data: () => id === 'project-white-label_abc-owner'
      ? { uid: 'abc-owner', orgId: 'agency-abc', role: 'owner', status: 'active', memberType: 'internal' }
      : undefined,
  }))

  mockProjectOrgDoc.mockImplementation((id: string) => ({
    get: () => mockProjectOrgGet(id),
    set: (data: unknown, options: unknown) => mockProjectOrgSet(id, data, options),
  }))
  mockProjectOrgGet.mockResolvedValue({ exists: false, data: () => undefined })
  mockProjectOrgSet.mockResolvedValue(undefined)
  mockProjectOrgWhere.mockReturnValue({ get: mockProjectOrgListGet })
  mockProjectOrgListGet.mockResolvedValue({ docs: [] })

  mockOrganizationDoc.mockImplementation((id: string) => ({
    get: () => mockOrganizationGet(id),
  }))
  mockOrganizationGet.mockImplementation(async (id: string) => {
    const orgs: Record<string, { name: string; active: boolean }> = {
      'agency-abc': { name: 'ABC Agency', active: true },
      'pib-platform-owner': { name: 'Partners in Biz', active: true },
      'shipping-abc': { name: 'Shipping ABC', active: true },
    }
    return { exists: id in orgs, data: () => orgs[id] }
  })

  mockProjectAuditAdd.mockResolvedValue({ id: 'audit-1' })
  mockProjectRootCollection.mockImplementation((name: string) => {
    if (name === 'audit') return { add: mockProjectAuditAdd }
    throw new Error(`Unexpected project subcollection ${name}`)
  })
  mockProjectRootDoc.mockReturnValue({ collection: mockProjectRootCollection })

  mockCollection.mockImplementation((name: string) => {
    if (name === 'projectMembers') return { doc: mockProjectMemberDoc }
    if (name === 'projectOrganizations') return { doc: mockProjectOrgDoc, where: mockProjectOrgWhere }
    if (name === 'organizations') return { doc: mockOrganizationDoc }
    if (name === 'projects') return { doc: mockProjectDoc }
    throw new Error(`Unexpected collection ${name}`)
  })
})

function request(body: unknown) {
  return new NextRequest('http://localhost/api/v1/projects/project-white-label/access', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('project white-label vendor access', () => {
  it('links a vendor organisation with white-label visibility control', async () => {
    const { POST } = await import('@/app/api/v1/projects/[projectId]/access/route')
    const res = await POST(request({
      action: 'link_vendor_organization',
      vendorOrgId: 'pib-platform-owner',
      role: 'contributor',
      visibleToClient: false,
    }), {
      params: Promise.resolve({ projectId: 'project-white-label' }),
    })

    expect(res.status).toBe(201)
    expect(mockProjectOrgDoc).toHaveBeenCalledWith('project-white-label_pib-platform-owner')
    expect(mockProjectOrgSet).toHaveBeenCalledWith(
      'project-white-label_pib-platform-owner',
      expect.objectContaining({
        projectId: 'project-white-label',
        orgId: 'pib-platform-owner',
        ownerOrgId: 'agency-abc',
        role: 'contributor',
        status: 'active',
        organizationType: 'vendor',
        visibleToClient: false,
        recipientCompanyName: 'Partners in Biz',
        linkedBy: 'abc-owner',
      }),
      { merge: true },
    )
    expect(mockProjectSet).toHaveBeenCalledWith(
      'project-white-label',
      expect.objectContaining({
        vendorOrgIds: ['pib-platform-owner'],
      }),
      { merge: true },
    )
    expect(mockProjectAuditAdd).toHaveBeenCalledWith(expect.objectContaining({
      type: 'audit',
      eventType: 'access_vendor_linked',
      itemType: 'projectOrganization',
      itemId: 'pib-platform-owner',
      actorUid: 'abc-owner',
      orgId: 'pib-platform-owner',
      role: 'contributor',
      organizationType: 'vendor',
      visibleToClient: false,
      title: 'Linked Partners in Biz as vendor (contributor)',
    }))
  })

  it('prevents vendors from receiving owner/manager roles', async () => {
    const { POST } = await import('@/app/api/v1/projects/[projectId]/access/route')
    const res = await POST(request({
      action: 'link_vendor_organization',
      vendorOrgId: 'pib-platform-owner',
      role: 'owner',
      visibleToClient: false,
    }), {
      params: Promise.resolve({ projectId: 'project-white-label' }),
    })

    expect(res.status).toBe(201)
    expect(mockProjectOrgSet).toHaveBeenCalledWith(
      'project-white-label_pib-platform-owner',
      expect.objectContaining({
        role: 'manager',
      }),
      { merge: true },
    )
  })

  it('allows vendors to be visible to clients when explicitly requested', async () => {
    const { POST } = await import('@/app/api/v1/projects/[projectId]/access/route')
    const res = await POST(request({
      action: 'link_vendor_organization',
      vendorOrgId: 'pib-platform-owner',
      role: 'contributor',
      visibleToClient: true,
    }), {
      params: Promise.resolve({ projectId: 'project-white-label' }),
    })

    expect(res.status).toBe(201)
    expect(mockProjectOrgSet).toHaveBeenCalledWith(
      'project-white-label_pib-platform-owner',
      expect.objectContaining({
        organizationType: 'vendor',
        visibleToClient: true,
      }),
      { merge: true },
    )
  })

  it('rejects vendor links from non-admin users', async () => {
    mockUser = { uid: 'non-admin', role: 'client', orgId: 'agency-abc', orgIds: ['agency-abc'] }
    mockGetProjectForUser.mockResolvedValueOnce({
      ok: true,
      doc: {
        id: 'project-white-label',
        data: () => ({ ownerOrgId: 'agency-abc' }),
      },
      projectAccess: { role: 'contributor', source: 'project_member', canViewInternal: true },
    })

    const { POST } = await import('@/app/api/v1/projects/[projectId]/access/route')
    const res = await POST(request({
      action: 'link_vendor_organization',
      vendorOrgId: 'pib-platform-owner',
      role: 'contributor',
      visibleToClient: false,
    }), {
      params: Promise.resolve({ projectId: 'project-white-label' }),
    })

    expect(res.status).toBe(403)
    expect(mockProjectOrgSet).not.toHaveBeenCalled()
  })

  it('links a regular client organisation without vendor flags', async () => {
    const { POST } = await import('@/app/api/v1/projects/[projectId]/access/route')
    const res = await POST(request({
      action: 'link_organization',
      targetOrgId: 'shipping-abc',
      role: 'reviewer',
    }), {
      params: Promise.resolve({ projectId: 'project-white-label' }),
    })

    expect(res.status).toBe(201)
    expect(mockProjectOrgSet).toHaveBeenCalledWith(
      'project-white-label_shipping-abc',
      expect.not.objectContaining({
        organizationType: expect.anything(),
        visibleToClient: expect.anything(),
      }),
      { merge: true },
    )
  })
})
