import { NextRequest } from 'next/server'

const mockGetProjectForUser = jest.fn()
const mockCollection = jest.fn()
const mockProjectMemberDoc = jest.fn()
const mockProjectMemberGet = jest.fn()
const mockProjectMemberSet = jest.fn()
const mockProjectMemberWhere = jest.fn()
const mockProjectMemberListGet = jest.fn()
const mockProjectOrgDoc = jest.fn()
const mockProjectOrgSet = jest.fn()
const mockProjectOrgWhere = jest.fn()
const mockProjectOrgListGet = jest.fn()
const mockProjectInviteDoc = jest.fn()
const mockProjectInviteSet = jest.fn()
const mockProjectInviteWhere = jest.fn()
const mockProjectInviteListGet = jest.fn()
const mockOrgMemberDoc = jest.fn()
const mockOrgMemberGet = jest.fn()
const mockOwnerOrgMemberWhere = jest.fn()
const mockOwnerOrgMemberListGet = jest.fn()
const mockUserDoc = jest.fn()
const mockUserGet = jest.fn()
const mockCompanyDoc = jest.fn()
const mockCompanyGet = jest.fn()
const mockContactDoc = jest.fn()
const mockContactGet = jest.fn()
const mockOrganizationDoc = jest.fn()
const mockOrganizationGet = jest.fn()
const mockProjectRootDoc = jest.fn()
const mockProjectRootCollection = jest.fn()
const mockProjectAuditAdd = jest.fn()
const mockEnsureClaimableRelationship = jest.fn()

type MockUser = {
  uid: string
  role: 'admin' | 'client'
  orgId?: string
  activeOrgId?: string
  orgIds?: string[]
  allowedOrgIds?: string[]
}

let mockUser: MockUser = { uid: 'owner-1', role: 'admin', orgId: 'owner-org' }

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

jest.mock('@/lib/claimable-relationships/store', () => ({
  ensureClaimableRelationship: (input: Record<string, unknown>) => mockEnsureClaimableRelationship(input),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  },
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockUser = { uid: 'owner-1', role: 'admin', orgId: 'owner-org' }
  mockGetProjectForUser.mockResolvedValue({
    ok: true,
    doc: {
      id: 'project-1',
      data: () => ({
        id: 'project-1',
        name: 'Shared build',
        ownerUid: 'owner-1',
        ownerOrgId: 'owner-org',
        orgId: 'owner-org',
        sourceOrgId: 'owner-org',
      }),
    },
    projectAccess: { role: 'owner', source: 'project_member', canViewInternal: true },
  })

  mockProjectMemberDoc.mockReturnValue({ get: mockProjectMemberGet, set: mockProjectMemberSet })
  mockProjectMemberGet.mockResolvedValue({ exists: false, data: () => undefined })
  mockProjectMemberSet.mockResolvedValue(undefined)
  mockProjectMemberWhere.mockReturnValue({ get: mockProjectMemberListGet })
  mockProjectMemberListGet.mockResolvedValue({ docs: [] })

  mockProjectOrgDoc.mockReturnValue({ set: mockProjectOrgSet })
  mockProjectOrgSet.mockResolvedValue(undefined)
  mockProjectOrgWhere.mockReturnValue({ get: mockProjectOrgListGet })
  mockProjectOrgListGet.mockResolvedValue({ docs: [] })

  mockProjectInviteDoc.mockReturnValue({ set: mockProjectInviteSet })
  mockProjectInviteSet.mockResolvedValue(undefined)
  mockProjectInviteWhere.mockReturnValue({ get: mockProjectInviteListGet })
  mockProjectInviteListGet.mockResolvedValue({ docs: [] })

  mockOrgMemberDoc.mockImplementation((id: string) => ({
    get: () => mockOrgMemberGet(id),
  }))
  mockOrgMemberGet.mockImplementation(async (id: string) => ({
    exists: id === 'owner-org_user-2',
    data: () => ({ uid: 'user-2', orgId: 'owner-org', role: 'member', status: 'active' }),
  }))
  mockOwnerOrgMemberWhere.mockReturnValue({ get: mockOwnerOrgMemberListGet })
  mockOwnerOrgMemberListGet.mockResolvedValue({
    docs: [
      { id: 'owner-org_owner-1', data: () => ({ uid: 'owner-1', orgId: 'owner-org', firstName: 'Peet', lastName: 'Stander', role: 'owner' }) },
      { id: 'owner-org_user-2', data: () => ({ uid: 'user-2', orgId: 'owner-org', firstName: 'User', lastName: 'Two', role: 'member' }) },
    ],
  })

  mockUserDoc.mockImplementation((id: string) => ({
    get: () => mockUserGet(id),
  }))
  mockUserGet.mockImplementation(async (id: string) => ({
    exists: true,
    data: () => id === 'owner-1'
      ? { displayName: 'Peet Stander', email: 'peet@partners.example' }
      : { displayName: 'User Two', email: 'user2@example.com' },
  }))

  mockCompanyDoc.mockImplementation((id: string) => ({
    get: () => mockCompanyGet(id),
  }))
  mockCompanyGet.mockImplementation(async (id: string) => ({
    exists: true,
    data: () => id === 'company-linked'
      ? { orgId: 'owner-org', name: 'Partner Co', linkedOrgId: 'partner-org' }
      : { orgId: 'owner-org', name: 'Pending Co' },
  }))

  mockContactDoc.mockImplementation((id: string) => ({
    get: () => mockContactGet(id),
  }))
  mockContactGet.mockImplementation(async (id: string) => ({
    exists: true,
    data: () => id === 'contact-linked'
      ? { orgId: 'owner-org', name: 'Linked Contact', email: 'linked@example.com', linkedUserId: 'contact-user' }
      : { orgId: 'owner-org', name: 'Pending Contact', email: 'pending@example.com' },
  }))
  mockOrganizationDoc.mockImplementation((id: string) => ({
    get: () => mockOrganizationGet(id),
  }))
  mockOrganizationGet.mockImplementation(async (id: string) => ({
    exists: id === 'client-org',
    data: () => id === 'client-org'
      ? { name: 'Client Organisation', active: true, status: 'active' }
      : undefined,
  }))
  mockProjectAuditAdd.mockResolvedValue({ id: 'audit-1' })
  mockProjectRootCollection.mockImplementation((name: string) => {
    if (name === 'audit') return { add: mockProjectAuditAdd }
    throw new Error(`Unexpected project subcollection ${name}`)
  })
  mockProjectRootDoc.mockReturnValue({ collection: mockProjectRootCollection })

  mockEnsureClaimableRelationship.mockImplementation(async (input: Record<string, unknown>) => ({
    id: `relationship-${input.sourceCompanyId}`,
    claimToken: `claim-${input.sourceCompanyId}`,
    targetOrgId: input.recipientOrgId,
    targetUserId: input.recipientUserId,
    status: input.recipientOrgId ? 'claimed' : 'pending',
  }))

  mockCollection.mockImplementation((name: string) => {
    if (name === 'projectMembers') return { doc: mockProjectMemberDoc, where: mockProjectMemberWhere }
    if (name === 'projectOrganizations') return { doc: mockProjectOrgDoc, where: mockProjectOrgWhere }
    if (name === 'projectInvites') return { doc: mockProjectInviteDoc, where: mockProjectInviteWhere }
    if (name === 'orgMembers') return { doc: mockOrgMemberDoc, where: mockOwnerOrgMemberWhere }
    if (name === 'users') return { doc: mockUserDoc }
    if (name === 'companies') return { doc: mockCompanyDoc }
    if (name === 'contacts') return { doc: mockContactDoc }
    if (name === 'organizations') return { doc: mockOrganizationDoc }
    if (name === 'projects') return { doc: mockProjectRootDoc }
    throw new Error(`Unexpected collection ${name}`)
  })
})

function request(body: unknown) {
  return new NextRequest('http://localhost/api/v1/projects/project-1/access', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function getRequest() {
  return new NextRequest('http://localhost/api/v1/projects/project-1/access', {
    method: 'GET',
  })
}

describe('project access API', () => {
  it('returns owner-org member candidates for project managers to add without raw user ids', async () => {
    const { GET } = await import('@/app/api/v1/projects/[projectId]/access/route')
    const res = await GET(getRequest(), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockOwnerOrgMemberWhere).toHaveBeenCalledWith('orgId', '==', 'owner-org')
    expect(body.data.memberCandidates).toEqual([
      expect.objectContaining({ uid: 'owner-1', displayName: 'Peet Stander', email: 'peet@partners.example', role: 'owner' }),
      expect.objectContaining({ uid: 'user-2', displayName: 'User Two', email: 'user2@example.com', role: 'member' }),
    ])
  })

  it('uses the selected organisation when access management is opened from Messages', async () => {
    const { GET } = await import('@/app/api/v1/projects/[projectId]/access/route')
    const res = await GET(new NextRequest(
      'http://localhost/api/v1/projects/project-1/access?orgId=owner-org',
    ), { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(res.status).toBe(200)
    expect(mockGetProjectForUser).toHaveBeenCalledWith('project-1', mockUser, 'owner-org')
  })

  it('does not expose the project access roster to roles below manager', async () => {
    mockGetProjectForUser.mockResolvedValueOnce({
      ok: true,
      doc: {
        id: 'project-1',
        data: () => ({ ownerOrgId: 'owner-org', orgId: 'owner-org' }),
      },
      projectAccess: { role: 'viewer', source: 'project_organization', canViewInternal: false },
    })
    const { GET } = await import('@/app/api/v1/projects/[projectId]/access/route')
    const res = await GET(getRequest(), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(403)
    expect(mockProjectMemberListGet).not.toHaveBeenCalled()
    expect(mockProjectOrgListGet).not.toHaveBeenCalled()
    expect(mockProjectInviteListGet).not.toHaveBeenCalled()
    expect(mockOwnerOrgMemberListGet).not.toHaveBeenCalled()
  })

  it('does not expose owner-organisation access administration to an external project manager', async () => {
    mockGetProjectForUser.mockResolvedValueOnce({
      ok: true,
      doc: {
        id: 'project-1',
        data: () => ({ ownerOrgId: 'owner-org', orgId: 'owner-org' }),
      },
      projectAccess: { role: 'manager', source: 'project_organization', canViewInternal: false },
    })
    const { GET } = await import('@/app/api/v1/projects/[projectId]/access/route')
    const res = await GET(getRequest(), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(403)
    expect(mockProjectMemberListGet).not.toHaveBeenCalled()
    expect(mockOwnerOrgMemberListGet).not.toHaveBeenCalled()
  })

  it('adds an owner-org member to a project with a project-scoped role', async () => {
    const { POST } = await import('@/app/api/v1/projects/[projectId]/access/route')
    const res = await POST(request({ action: 'add_member', uid: 'user-2', role: 'contributor' }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(201)
    expect(mockOrgMemberGet).toHaveBeenCalledWith('owner-org_user-2')
    expect(mockProjectMemberDoc).toHaveBeenCalledWith('project-1_user-2')
    expect(mockProjectMemberSet).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      uid: 'user-2',
      orgId: 'owner-org',
      role: 'contributor',
      status: 'active',
      memberType: 'internal',
    }), { merge: true })
    expect(mockProjectAuditAdd).toHaveBeenCalledWith(expect.objectContaining({
      type: 'audit',
      eventType: 'access_member_added',
      itemType: 'projectMember',
      itemId: 'user-2',
      actorUid: 'owner-1',
      uid: 'user-2',
      role: 'contributor',
      title: 'Added User Two as contributor',
    }))
  })

  it('rejects internal project members that do not belong to the owner org', async () => {
    const { POST } = await import('@/app/api/v1/projects/[projectId]/access/route')
    const res = await POST(request({ action: 'add_member', uid: 'outside-user', role: 'contributor' }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(400)
    expect(mockProjectMemberSet).not.toHaveBeenCalled()
  })

  it.each(['revoked', 'disabled', 'removed'])('rejects a %s owner-org membership tombstone when adding a project member', async (status) => {
    mockOrgMemberGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ uid: 'user-2', orgId: 'owner-org', status }),
    })
    const { POST } = await import('@/app/api/v1/projects/[projectId]/access/route')
    const res = await POST(request({ action: 'add_member', uid: 'user-2', role: 'contributor' }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(400)
    expect(mockProjectMemberSet).not.toHaveBeenCalled()
  })

  it('directly links an accessible existing organisation without requiring CRM or email records', async () => {
    const { POST } = await import('@/app/api/v1/projects/[projectId]/access/route')
    const res = await POST(request({
      action: 'link_organization',
      targetOrgId: 'client-org',
      role: 'reviewer',
    }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(201)
    expect(mockOrganizationDoc).toHaveBeenCalledWith('client-org')
    expect(mockProjectOrgDoc).toHaveBeenCalledWith('project-1_client-org')
    expect(mockProjectOrgSet).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      orgId: 'client-org',
      recipientCompanyName: 'Client Organisation',
      role: 'reviewer',
      status: 'active',
      linkedBy: 'owner-1',
    }), { merge: true })
    expect(mockProjectAuditAdd).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'access_org_linked',
      itemType: 'projectOrganization',
      itemId: 'client-org',
      orgId: 'client-org',
      role: 'reviewer',
      status: 'active',
      title: 'Linked Client Organisation as reviewer',
    }))
    expect(mockEnsureClaimableRelationship).not.toHaveBeenCalled()
    expect(mockProjectInviteSet).not.toHaveBeenCalled()
    expect(await res.json()).toEqual(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ orgId: 'client-org', status: 'active' }),
    }))
  })

  it('rejects direct organisation links from project roles below manager', async () => {
    mockGetProjectForUser.mockResolvedValueOnce({
      ok: true,
      doc: {
        id: 'project-1',
        data: () => ({ ownerOrgId: 'owner-org', orgId: 'owner-org' }),
      },
      projectAccess: { role: 'reviewer', source: 'project_member', canViewInternal: true },
    })
    const { POST } = await import('@/app/api/v1/projects/[projectId]/access/route')
    const res = await POST(request({
      action: 'link_organization',
      targetOrgId: 'client-org',
      role: 'reviewer',
    }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(403)
    expect(mockOrganizationGet).not.toHaveBeenCalled()
    expect(mockProjectOrgSet).not.toHaveBeenCalled()
  })

  it('rejects direct links to organisations outside the actor accessible organisation set', async () => {
    mockUser = {
      uid: 'owner-1',
      role: 'client',
      orgId: 'owner-org',
      orgIds: ['owner-org'],
    }
    const { POST } = await import('@/app/api/v1/projects/[projectId]/access/route')
    const res = await POST(request({
      action: 'link_organization',
      targetOrgId: 'client-org',
      role: 'reviewer',
    }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(403)
    expect(mockOrganizationGet).not.toHaveBeenCalled()
    expect(mockProjectOrgSet).not.toHaveBeenCalled()
  })

  it('allows a client to link an accessible organisation with an exact active membership row', async () => {
    mockUser = {
      uid: 'owner-1',
      role: 'client',
      orgId: 'owner-org',
      orgIds: ['owner-org', 'client-org'],
    }
    mockOrgMemberGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ orgId: 'client-org', uid: 'owner-1', status: 'active' }),
    })
    const { POST } = await import('@/app/api/v1/projects/[projectId]/access/route')
    const res = await POST(request({
      action: 'link_organization',
      targetOrgId: 'client-org',
      role: 'reviewer',
    }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(201)
    expect(mockOrgMemberGet).toHaveBeenCalledWith('client-org_owner-1')
    expect(mockProjectOrgSet).toHaveBeenCalled()
  })

  it.each(['revoked', 'disabled', 'removed'])('rejects direct links through a %s target membership tombstone', async (status) => {
    mockUser = {
      uid: 'owner-1',
      role: 'client',
      orgId: 'owner-org',
      orgIds: ['owner-org', 'client-org'],
    }
    mockOrgMemberGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ orgId: 'client-org', uid: 'owner-1', status }),
    })
    const { POST } = await import('@/app/api/v1/projects/[projectId]/access/route')
    const res = await POST(request({
      action: 'link_organization',
      targetOrgId: 'client-org',
      role: 'reviewer',
    }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(403)
    expect(mockOrganizationGet).not.toHaveBeenCalled()
    expect(mockProjectOrgSet).not.toHaveBeenCalled()
  })

  it('invites multiple CRM organisations and auto-links existing PiB orgs/users', async () => {
    const { POST } = await import('@/app/api/v1/projects/[projectId]/access/route')
    const res = await POST(request({
      action: 'invite_organizations',
      invites: [
        { companyId: 'company-linked', contactId: 'contact-linked', role: 'reviewer' },
        { companyId: 'company-pending', contactId: 'contact-pending', role: 'viewer' },
      ],
    }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(201)
    expect(mockProjectOrgDoc).toHaveBeenCalledWith('project-1_partner-org')
    expect(mockProjectOrgSet).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      orgId: 'partner-org',
      companyId: 'company-linked',
      role: 'reviewer',
      status: 'active',
    }), { merge: true })
    expect(mockProjectMemberDoc).toHaveBeenCalledWith('project-1_contact-user')
    expect(mockProjectMemberSet).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      uid: 'contact-user',
      orgId: 'partner-org',
      role: 'reviewer',
      status: 'active',
      memberType: 'external',
    }), { merge: true })
    expect(mockProjectOrgDoc).toHaveBeenCalledWith('project-1_company-pending')
    expect(mockProjectOrgSet).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      companyId: 'company-pending',
      role: 'viewer',
      status: 'pending',
    }), { merge: true })
    expect(mockProjectInviteSet).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      companyId: 'company-pending',
      contactId: 'contact-pending',
      recipientEmail: 'pending@example.com',
      status: 'pending',
      claimableRelationshipId: 'relationship-company-pending',
      claimToken: 'claim-company-pending',
    }), { merge: true })
    expect(mockProjectAuditAdd).toHaveBeenCalledWith(expect.objectContaining({
      type: 'audit',
      eventType: 'access_org_linked',
      itemType: 'projectOrganization',
      itemId: 'partner-org',
      actorUid: 'owner-1',
      companyId: 'company-linked',
      contactId: 'contact-linked',
      orgId: 'partner-org',
      uid: 'contact-user',
      role: 'reviewer',
      status: 'active',
      title: 'Linked Partner Co as reviewer',
    }))
    expect(mockProjectAuditAdd).toHaveBeenCalledWith(expect.objectContaining({
      type: 'audit',
      eventType: 'access_org_invited',
      itemType: 'projectOrganization',
      itemId: 'company-pending',
      actorUid: 'owner-1',
      companyId: 'company-pending',
      contactId: 'contact-pending',
      recipientEmail: 'pending@example.com',
      role: 'viewer',
      status: 'pending',
      title: 'Invited Pending Co as viewer',
    }))
  })
})
