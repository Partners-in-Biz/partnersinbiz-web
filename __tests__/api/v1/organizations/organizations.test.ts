// __tests__/api/v1/organizations/organizations.test.ts
import { NextRequest } from 'next/server'
import { GET, POST, handleOrganizationCreate } from '@/app/api/v1/organizations/route'
import { GET as getById, PUT, DELETE } from '@/app/api/v1/organizations/[id]/route'
import { POST as addMember, GET as listMembers } from '@/app/api/v1/organizations/[id]/members/route'
import { GET as searchClientMembers, POST as addClientMember } from '@/app/api/v1/organizations/[id]/members/client/route'
import { POST as createLogin } from '@/app/api/v1/organizations/[id]/create-login/route'
import { PATCH as patchMember, DELETE as removeMember } from '@/app/api/v1/organizations/[id]/members/[userId]/route'
import { POST as linkClient } from '@/app/api/v1/organizations/[id]/link-client/route'
import { GET as getOrgAccounts } from '@/app/api/v1/organizations/[id]/accounts/route'
import { provisionFullClientOnVps } from '@/lib/client-provisioning/vps'
import { upsertOrgWorkspace } from '@/lib/client-provisioning/workspace-context'
import { adminAuth } from '@/lib/firebase/admin'

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => '__SERVER_TS__',
    delete: () => '__DELETE_FIELD__',
  },
  Timestamp: {
    now: () => '__NOW_TS__',
  },
}))

const AI_KEY = 'test-ai-key'
process.env.AI_API_KEY = AI_KEY
process.env.SESSION_COOKIE_NAME = '__session'

const mockGet = jest.fn()
const mockAdd = jest.fn()
const mockSet = jest.fn()
const mockWhere = jest.fn()
const mockOrderBy = jest.fn()
const mockCollection = jest.fn()
const mockTrustedOrgCreate = jest.fn()
const mockTrustedOrgGet = jest.fn()
const mockTrustedOrgSet = jest.fn()

jest.mock('@/lib/client-provisioning/vps', () => ({
  provisionFullClientOnVps: jest.fn(),
}))

jest.mock('@/lib/client-provisioning/workspace-context', () => ({
  upsertOrgWorkspace: jest.fn(),
}))

jest.mock('@/lib/platform-owner/relationships', () => ({
  syncPlatformContactForOrgMember: jest.fn().mockResolvedValue({ companyId: 'company-1', contactId: 'contact-1' }),
  syncPlatformCompanyAgreementFieldsForOrg: jest.fn().mockResolvedValue({ companyId: 'company-1' }),
  markPlatformContactFormerOrgMember: jest.fn().mockResolvedValue({ contactId: 'contact-1' }),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: {
    verifyIdToken: jest.fn(),
    verifySessionCookie: jest.fn(),
    getUserByEmail: jest.fn(),
    createUser: jest.fn(),
    generatePasswordResetLink: jest.fn(),
  },
  adminDb: { collection: (...args: unknown[]) => mockCollection(...args) },
}))

function adminReq(method = 'GET', body?: unknown, url = 'http://localhost/api/v1/organizations') {
  return new NextRequest(url, {
    method,
    headers: { authorization: `Bearer ${AI_KEY}`, 'x-org-id': 'default' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

function routeCtx(params: Record<string, string> = { id: 'org-1' }) {
  return { params: Promise.resolve(params) }
}

describe('GET /api/v1/organizations', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGet.mockResolvedValue({
      docs: [
        { id: 'org-1', data: () => ({ name: 'Lumen', slug: 'lumen', active: true, members: [{ userId: 'ai-agent', role: 'owner' }], description: '', logoUrl: '', website: '', createdBy: 'ai-agent', linkedClientId: '' }) },
      ],
    })
    mockWhere.mockReturnValue({ orderBy: mockOrderBy, get: mockGet })
    mockOrderBy.mockReturnValue({ get: mockGet })
    mockCollection.mockReturnValue({ where: mockWhere, orderBy: mockOrderBy, get: mockGet })
  })

  it('returns list of orgs the user is a member of', async () => {
    const res = await GET(adminReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
  })

  it('returns 401 without auth', async () => {
    const req = new NextRequest('http://localhost/api/v1/organizations')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })
})

describe('POST /api/v1/organizations', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGet.mockResolvedValue({ empty: true, docs: [] })
    mockWhere.mockReturnValue({ get: mockGet })
    mockSet.mockResolvedValue(undefined)
    mockAdd.mockResolvedValue({ id: 'new-org-id', set: mockSet })
    mockCollection.mockReturnValue({ where: mockWhere, add: mockAdd, orderBy: mockOrderBy, get: mockGet })
    mockOrderBy.mockReturnValue({ get: mockGet })
    ;(provisionFullClientOnVps as jest.Mock).mockResolvedValue({
      profile: { agentId: 'velox' },
      workspace: { directoriesCreated: [] },
    })
    ;(upsertOrgWorkspace as jest.Mock).mockResolvedValue({ workspaceId: 'velox' })
  })

  it('creates an org and returns 201 without seeding AI/API-key users into the team', async () => {
    const res = await POST(adminReq('POST', { name: 'Velox', description: 'Test org' }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.id).toBe('new-org-id')
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      members: [],
      settings: expect.objectContaining({
        timezone: 'Africa/Johannesburg',
        currency: 'ZAR',
      }),
    }))
  })

  it('ignores the ordinary Next.js route context when creating an organisation through the public API', async () => {
    const res = await POST(
      adminReq('POST', { name: 'Humanaut AI', description: 'Client org', provisionWorkspace: false }),
      { params: Promise.resolve({}) },
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.id).toBe('new-org-id')
    expect(mockAdd).toHaveBeenCalledTimes(1)
  })

  it('uses and replays a trusted setup-derived organisation id without a second create', async () => {
    const memberSet = jest.fn().mockResolvedValue(undefined)
    mockTrustedOrgCreate.mockResolvedValue(undefined)
    mockTrustedOrgSet.mockResolvedValue(undefined)
    mockTrustedOrgGet
      .mockResolvedValueOnce({ exists: false, data: () => undefined })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          name: 'Durable Client',
          slug: 'durable-client',
          setupOperationId: 'setup_operation_1',
          provisioning: { status: 'skipped' },
        }),
      })
    mockCollection.mockImplementation((name: string) => {
      if (name === 'organizations') return {
        where: mockWhere,
        doc: (id: string) => ({
          id,
          get: mockTrustedOrgGet,
          create: mockTrustedOrgCreate,
          set: mockTrustedOrgSet,
        }),
      }
      if (name === 'orgMembers') return { doc: () => ({ set: memberSet }) }
      return { where: mockWhere, add: mockAdd, orderBy: mockOrderBy, get: mockGet }
    })
    const options = {
      documentId: 'setup_org_0123456789abcdef0123456789abcdef01234567',
      setupOperationId: 'setup_operation_1',
    }
    const user = { uid: 'admin-1', role: 'admin' as const, orgId: 'pib-platform-owner' }

    const first = await handleOrganizationCreate(
      adminReq('POST', { name: 'Durable Client', provisionWorkspace: false }), user, options,
    )
    const replay = await handleOrganizationCreate(
      adminReq('POST', { name: 'Durable Client', provisionWorkspace: false }), user, options,
    )

    expect(first.status).toBe(201)
    expect(replay.status).toBe(200)
    expect((await first.json()).data.id).toBe(options.documentId)
    expect((await replay.json()).data.id).toBe(options.documentId)
    expect(mockAdd).not.toHaveBeenCalled()
    expect(mockTrustedOrgCreate).toHaveBeenCalledTimes(1)
    expect(mockTrustedOrgCreate).toHaveBeenCalledWith(expect.objectContaining({
      setupOperationId: 'setup_operation_1',
    }))
  })

  it('creates the canonical owner membership for a human organisation creator', async () => {
    const memberSet = jest.fn().mockResolvedValue(undefined)
    const memberDoc = jest.fn().mockReturnValue({ set: memberSet })
    mockCollection.mockImplementation((name: string) => {
      if (name === 'orgMembers') return { doc: memberDoc }
      return { where: mockWhere, add: mockAdd, orderBy: mockOrderBy, get: mockGet }
    })

    const res = await handleOrganizationCreate(
      adminReq('POST', { name: 'Human-owned client', provisionWorkspace: false }),
      { uid: 'admin-1', role: 'admin', orgId: 'pib-platform-owner' },
    )

    expect(res.status).toBe(201)
    expect(memberDoc).toHaveBeenCalledWith('new-org-id_admin-1')
    expect(memberSet).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'new-org-id',
        uid: 'admin-1',
        role: 'owner',
        status: 'active',
        createdAt: '__SERVER_TS__',
        updatedAt: '__SERVER_TS__',
      }),
      { merge: true },
    )
  })

  it('requests full VPS client provisioning by default for client orgs', async () => {
    const res = await POST(adminReq('POST', { name: 'Velox', agentName: 'Vee' }))
    expect(res.status).toBe(201)
    expect(provisionFullClientOnVps).toHaveBeenCalledWith({
      clientName: 'Velox',
      domain: 'velox',
      orgId: 'new-org-id',
      orgSlug: 'velox',
      platformOwned: false,
      agentName: 'Vee',
      companyId: null,
      contactIds: [],
    })
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'velox__velox',
        workspaceManifest: expect.objectContaining({ workspaceId: 'velox__velox', sourceOfTruth: 'vps' }),
        provisioning: expect.objectContaining({ status: 'complete', domain: 'velox', agentName: 'Vee', workspaceId: 'velox' }),
      }),
      { merge: true },
    )
    expect(upsertOrgWorkspace).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'velox__velox' }))
  })

  it('uses a validated explicit client domain for the organisation slug and Workspace provisioning', async () => {
    const res = await POST(adminReq('POST', { name: 'Velox Holdings', domainSlug: 'velox' }))
    expect(res.status).toBe(201)
    expect((await res.json()).data.slug).toBe('velox')
    expect(mockWhere).toHaveBeenCalledWith('slug', '==', 'velox')
    expect(provisionFullClientOnVps).toHaveBeenCalledWith(expect.objectContaining({ domain: 'velox' }))
  })

  it('rejects an unsafe explicit client domain', async () => {
    const res = await POST(adminReq('POST', { name: 'Velox', domainSlug: '../velox' }))
    expect(res.status).toBe(400)
    expect(provisionFullClientOnVps).not.toHaveBeenCalled()
  })

  it('can skip workspace provisioning for Firebase-only org creation', async () => {
    const res = await POST(adminReq('POST', { name: 'Velox', provisionWorkspace: false }))
    const body = await res.json()
    expect(res.status).toBe(201)
    expect(body.data.provisioning.status).toBe('skipped')
    expect(provisionFullClientOnVps).not.toHaveBeenCalled()
  })

  it('returns 400 when name is missing', async () => {
    const res = await POST(adminReq('POST', { description: 'No name' }))
    expect(res.status).toBe(400)
  })

  it('returns 409 when slug already exists', async () => {
    mockGet.mockResolvedValue({ empty: false, docs: [{ id: 'existing-org' }] })
    mockWhere.mockReturnValue({ get: mockGet })
    mockCollection.mockReturnValue({ where: mockWhere, add: mockAdd, orderBy: mockOrderBy, get: mockGet })
    const res = await POST(adminReq('POST', { name: 'Velox' }))
    expect(res.status).toBe(409)
  })
})

describe('GET /api/v1/organizations/[id]', () => {
  const mockDocGet = jest.fn()
  const mockDoc = jest.fn()
  const mockUpdate = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'org-1',
      data: () => ({
        name: 'Lumen', slug: 'lumen', active: true,
        members: [{ userId: 'ai-agent', role: 'owner' }],
        description: '', logoUrl: '', website: '', createdBy: 'ai-agent', linkedClientId: '',
      }),
    })
    mockDoc.mockReturnValue({ get: mockDocGet, update: mockUpdate })
    mockCollection.mockReturnValue({ doc: mockDoc, where: mockWhere, orderBy: mockOrderBy, get: mockGet, add: mockAdd })
  })

  it('returns org details', async () => {
    const res = await getById(adminReq('GET'), routeCtx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.name).toBe('Lumen')
  })

  it('returns 404 when org does not exist', async () => {
    mockDocGet.mockResolvedValue({ exists: false })
    const res = await getById(adminReq('GET'), routeCtx())
    expect(res.status).toBe(404)
  })

  it('returns 403 for a client user who is not a member', async () => {
    // Simulate: session cookie resolves to a client user not in the members array
    ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValueOnce({ uid: 'client-user' })
    const userDocGet = jest.fn().mockResolvedValue({ exists: true, data: () => ({ role: 'client' }) })
    const orgDocGet = jest.fn().mockResolvedValue({
      exists: true,
      id: 'org-1',
      data: () => ({
        name: 'Lumen', slug: 'lumen', active: true,
        members: [{ userId: 'other-user', role: 'owner' }], // client-user is NOT a member
        description: '', logoUrl: '', website: '', createdBy: 'other-user', linkedClientId: '',
      }),
    })
    mockCollection.mockReturnValue({
      doc: jest.fn().mockReturnValue({ get: orgDocGet }),
    })
    // Override collection to return user doc for first call, org doc for second
    let callCount = 0
    mockCollection.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // auth.ts calls adminDb.collection('users').doc(uid).get()
        return { doc: jest.fn().mockReturnValue({ get: userDocGet }) }
      }
      return { doc: jest.fn().mockReturnValue({ get: orgDocGet }) }
    })

    const req = new NextRequest('http://localhost/api/v1/organizations/org-1', {
      headers: { cookie: '__session=fake-session-cookie' },
    })
    const res = await getById(req, routeCtx())
    expect(res.status).toBe(403)
  })
})

describe('PUT /api/v1/organizations/[id]', () => {
  const mockDocGet = jest.fn()
  const mockDoc = jest.fn()
  const mockUpdate = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    mockUpdate.mockResolvedValue(undefined)
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'org-1',
      data: () => ({
        name: 'Lumen', slug: 'lumen', active: true,
        members: [{ userId: 'ai-agent', role: 'owner' }],
        description: '', logoUrl: '', website: '', createdBy: 'ai-agent', linkedClientId: '',
      }),
    })
    mockDoc.mockReturnValue({ get: mockDocGet, update: mockUpdate })
    mockWhere.mockReturnValue({ get: jest.fn().mockResolvedValue({ empty: true }) })
    mockCollection.mockReturnValue({ doc: mockDoc, where: mockWhere, orderBy: mockOrderBy, get: mockGet })
  })

  it('updates org and returns 200', async () => {
    const res = await PUT(adminReq('PUT', { name: 'Lumen Updated' }), routeCtx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.updated).toBe(true)
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ updatedAt: expect.anything() }))
  })

  it('merges portal module settings without dropping unrelated settings or modules', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'org-1',
      data: () => ({
        name: 'Lumen',
        slug: 'lumen',
        active: true,
        members: [{ userId: 'ai-agent', role: 'owner' }],
        description: '',
        logoUrl: '',
        website: '',
        createdBy: 'ai-agent',
        linkedClientId: '',
        settings: {
          timezone: 'Africa/Johannesburg',
          currency: 'ZAR',
          preferredSendHourLocal: 8,
          portalModules: {
            youtubeStudio: false,
            betaReports: true,
          },
        },
      }),
    })

    const res = await PUT(adminReq('PUT', {
      settings: {
        notificationEmail: 'ops@lumen.test',
        portalModules: {
          mobileApps: false,
        },
      },
    }), routeCtx())

    expect(res.status).toBe(200)
    const update = mockUpdate.mock.calls[0][0]
    expect(update.settings).toEqual({
      timezone: 'Africa/Johannesburg',
      currency: 'ZAR',
      preferredSendHourLocal: 8,
      notificationEmail: 'ops@lumen.test',
      portalModules: {
        youtubeStudio: false,
        betaReports: true,
        mobileApps: false,
      },
    })
  })

  it('merges module policy settings without dropping other modules or actions', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'org-1',
      data: () => ({
        name: 'Lumen',
        slug: 'lumen',
        active: true,
        members: [{ userId: 'ai-agent', role: 'owner' }],
        description: '',
        logoUrl: '',
        website: '',
        createdBy: 'ai-agent',
        linkedClientId: '',
        settings: {
          timezone: 'Africa/Johannesburg',
          modulePolicies: {
            projects: {
              actions: {
                visibility: { owner: true, admin: true, member: true },
                create: { owner: true, admin: true, member: false },
              },
            },
            messages: {
              actions: {
                visibility: { owner: true, admin: true, member: true },
              },
            },
          },
        },
      }),
    })

    const res = await PUT(adminReq('PUT', {
      settings: {
        modulePolicies: {
          projects: {
            actions: {
              visibility: { owner: true, admin: true, member: false },
            },
            customItems: [{ id: 'retainer', label: 'Retainer', description: 'Recurring delivery workspace.' }],
          },
        },
      },
    }), routeCtx())

    expect(res.status).toBe(200)
    const update = mockUpdate.mock.calls[0][0]
    expect(update.settings.modulePolicies).toEqual({
      projects: {
        actions: {
          visibility: { owner: true, admin: true, member: false },
          create: { owner: true, admin: true, member: false },
        },
        customItems: [{ id: 'retainer', label: 'Retainer', description: 'Recurring delivery workspace.' }],
      },
      messages: {
        actions: {
          visibility: { owner: true, admin: true, member: true },
        },
      },
    })
  })

  it('deep-merges whitelisted agreement billing details without accepting unsafe nested fields', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'org-1',
      data: () => ({
        name: 'Lumen', slug: 'lumen', active: true,
        members: [{ userId: 'ai-agent', role: 'owner' }],
        description: '', logoUrl: '', website: '', createdBy: 'ai-agent', linkedClientId: '',
        billingDetails: {
          vatNumber: '4000000000',
          address: { line1: 'Old Road', city: 'Cape Town', postalCode: '8001', country: 'South Africa' },
          bankingDetails: { bankName: 'Existing Bank', accountNumber: '123' },
        },
      }),
    })

    const res = await PUT(adminReq('PUT', {
      billingDetails: {
        legalName: 'Lumen Legal Pty Ltd',
        tradingName: 'Lumen Trading',
        taxNumber: '9999999999',
        address: { line1: 'New Road' },
        accountsContact: { name: 'Accounts Lead', email: 'accounts@lumen.test' },
        authorizedSignatory: { name: 'Jane Director', title: 'Director', email: 'jane@lumen.test' },
        purchaseOrderRequired: true,
        purchaseOrderNumber: 'PO-123',
        invoiceInstructions: 'Use PO.',
        unknownNested: 'do-not-store',
      },
    }), routeCtx())

    expect(res.status).toBe(200)
    const update = mockUpdate.mock.calls[0][0]
    expect(update.billingDetails).toMatchObject({
      vatNumber: '4000000000',
      legalName: 'Lumen Legal Pty Ltd',
      tradingName: 'Lumen Trading',
      taxNumber: '9999999999',
      address: { line1: 'New Road', city: 'Cape Town', postalCode: '8001', country: 'South Africa' },
      bankingDetails: { bankName: 'Existing Bank', accountNumber: '123' },
      accountsContact: { name: 'Accounts Lead', email: 'accounts@lumen.test' },
      authorizedSignatory: { name: 'Jane Director', title: 'Director', email: 'jane@lumen.test' },
      purchaseOrderRequired: true,
      purchaseOrderNumber: 'PO-123',
      invoiceInstructions: 'Use PO.',
    })
    expect(update.billingDetails.unknownNested).toBeUndefined()
  })

  it('returns 404 when org does not exist', async () => {
    mockDocGet.mockResolvedValue({ exists: false })
    const res = await PUT(adminReq('PUT', { name: 'X' }), routeCtx())
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/v1/organizations/[id]', () => {
  const mockDocGet = jest.fn()
  const mockDoc = jest.fn()
  const mockUpdate = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    mockUpdate.mockResolvedValue(undefined)
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'org-1',
      data: () => ({
        name: 'Lumen', slug: 'lumen', active: true,
        members: [{ userId: 'ai-agent', role: 'owner' }],
        description: '', logoUrl: '', website: '', createdBy: 'ai-agent', linkedClientId: '',
      }),
    })
    mockDoc.mockReturnValue({ get: mockDocGet, update: mockUpdate })
    mockCollection.mockReturnValue({ doc: mockDoc })
  })

  it('soft-deletes org and returns 200', async () => {
    const res = await DELETE(adminReq('DELETE'), routeCtx())
    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ active: false }))
  })

  it('returns 404 when org does not exist', async () => {
    mockDocGet.mockResolvedValue({ exists: false })
    const res = await DELETE(adminReq('DELETE'), routeCtx())
    expect(res.status).toBe(404)
  })
})

describe('POST /api/v1/organizations/[id]/members', () => {
  const mockDocGet = jest.fn()
  const mockDoc = jest.fn()
  const mockUpdate = jest.fn()
  const mockUserQueryGet = jest.fn()
  const mockUserWhere = jest.fn()
  const mockUserDoc = jest.fn()
  const mockUserSet = jest.fn()
  const mockOrgMemberSet = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'org-1',
      data: () => ({
        name: 'Lumen', slug: 'lumen', active: true,
        members: [{ userId: 'ai-agent', role: 'owner' }],
        description: '', logoUrl: '', website: '', createdBy: 'ai-agent', linkedClientId: '',
      }),
    })
    mockUpdate.mockResolvedValue(undefined)
    mockDoc.mockReturnValue({ get: mockDocGet, update: mockUpdate })
    mockUserQueryGet.mockResolvedValue({
      empty: false,
      docs: [{ id: 'new-user', data: () => ({ displayName: 'New User', email: 'new@example.com', photoURL: null }) }],
    })
    mockUserWhere.mockReturnValue({ get: mockUserQueryGet })
    mockUserSet.mockResolvedValue(undefined)
    mockOrgMemberSet.mockResolvedValue(undefined)
    mockUserDoc.mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: true, data: () => ({}) }),
      set: mockUserSet,
    })
    mockCollection.mockImplementation((collName: string) => {
      if (collName === 'organizations') return { doc: mockDoc }
      if (collName === 'users') return { where: mockUserWhere, doc: mockUserDoc }
      if (collName === 'orgMembers') return { doc: jest.fn().mockReturnValue({ set: mockOrgMemberSet }) }
      throw new Error(`Unexpected collection: ${collName}`)
    })
  })

  it('adds a member and returns 201', async () => {
    const res = await addMember(
      adminReq('POST', {
        email: 'new@example.com',
        role: 'member',
        jobTitle: 'Operations Lead',
        department: 'Operations',
        accessScope: 'projects',
        accessNotes: 'Delivery contact',
      }),
      routeCtx(),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.userId).toBe('new-user')
    expect(body.data.email).toBe('new@example.com')
    expect(body.data.joinedAt).toBe('__NOW_TS__')
    expect(mockUserWhere).toHaveBeenCalledWith('email', '==', 'new@example.com')
    expect(body.data.userId).toBe('new-user')
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      members: expect.arrayContaining([
        expect.objectContaining({
          userId: 'new-user',
          jobTitle: 'Operations Lead',
          department: 'Operations',
          accessScope: 'projects',
          accessNotes: 'Delivery contact',
        }),
      ]),
      updatedAt: expect.anything(),
    }))
    expect(mockUserSet).toHaveBeenCalledWith(
      expect.objectContaining({
        orgIds: ['org-1'],
        orgId: 'org-1',
        updatedAt: '__SERVER_TS__',
      }),
      { merge: true },
    )
  })

  it('adds client portal access to existing platform staff without changing their primary org', async () => {
    mockUserQueryGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'staff-user',
          data: () => ({
            role: 'admin',
            orgId: 'pib-platform-owner',
            orgIds: ['existing-client'],
            displayName: 'Staff User',
            email: 'staff@example.com',
          }),
        },
      ],
    })

    const res = await addMember(
      adminReq('POST', { email: 'staff@example.com', role: 'admin' }),
      routeCtx(),
    )

    expect(res.status).toBe(201)
    expect(mockUserSet).toHaveBeenCalledWith(
      expect.objectContaining({
        orgIds: ['existing-client', 'org-1'],
        updatedAt: '__SERVER_TS__',
      }),
      { merge: true },
    )
    expect(mockUserSet.mock.calls[0][0]).not.toHaveProperty('orgId', 'org-1')
  })

  it('returns 409 when user is already a member', async () => {
    mockUserQueryGet.mockResolvedValue({
      empty: false,
      docs: [{ id: 'ai-agent', data: () => ({ displayName: 'Pip', email: 'owner@example.com' }) }],
    })
    const res = await addMember(
      adminReq('POST', { email: 'owner@example.com', role: 'member' }),
      routeCtx(),
    )
    expect(res.status).toBe(409)
  })

  it('returns 400 when email is missing', async () => {
    const res = await addMember(
      adminReq('POST', {}),
      routeCtx(),
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 when user email does not exist', async () => {
    mockUserQueryGet.mockResolvedValue({ empty: true, docs: [] })
    const res = await addMember(
      adminReq('POST', { email: 'ghost@example.com', role: 'member' }),
      routeCtx(),
    )
    expect(res.status).toBe(404)
  })

  it('returns 404 when org does not exist', async () => {
    mockDocGet.mockResolvedValue({ exists: false })
    const res = await addMember(
      adminReq('POST', { email: 'new@example.com' }),
      routeCtx(),
    )
    expect(res.status).toBe(404)
  })
})

describe('GET /api/v1/organizations/[id]/members — restricted admin scope', () => {
  const mockOrgGet = jest.fn()
  const mockUserDocGet = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    mockOrgGet.mockResolvedValue({
      exists: true,
      id: 'unassigned-org',
      data: () => ({
        name: 'Other Co', slug: 'other', active: true,
        members: [{ userId: 'member-1', role: 'member' }],
        description: '', logoUrl: '', website: '', createdBy: 'ai-agent', linkedClientId: '',
      }),
    })
    mockUserDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        role: 'admin',
        orgId: 'pib-platform-owner',
        allowedOrgIds: ['assigned-org'],
        displayName: 'Restricted Admin',
        email: 'restricted@example.com',
      }),
    })
    mockCollection.mockImplementation((collName: string) => {
      if (collName === 'users') return { doc: jest.fn().mockReturnValue({ get: mockUserDocGet }) }
      if (collName === 'organizations') return { doc: jest.fn().mockReturnValue({ get: mockOrgGet }) }
      throw new Error(`Unexpected collection: ${collName}`)
    })
  })

  function restrictedAdminReq(method = 'GET', url = 'http://localhost/api/v1/organizations/unassigned-org/members') {
    ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValueOnce({ uid: 'restricted-admin' })
    return new NextRequest(url, {
      method,
      headers: { cookie: '__session=fake-session-cookie' },
    })
  }

  it('denies member enumeration in an unassigned org (403)', async () => {
    const res = await listMembers(restrictedAdminReq('GET'), routeCtx({ id: 'unassigned-org' }))
    expect(res.status).toBe(403)
  })

  it('allows member enumeration in an assigned org (200)', async () => {
    const res = await listMembers(
      restrictedAdminReq('GET', 'http://localhost/api/v1/organizations/assigned-org/members'),
      routeCtx({ id: 'assigned-org' }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].userId).toBe('member-1')
  })
})

describe('POST /api/v1/organizations/[id]/members — restricted admin scope', () => {
  const mockOrgGet = jest.fn()
  const mockOrgUpdate = jest.fn()
  const mockUserDocGet = jest.fn()
  const mockUserQueryGet = jest.fn()
  const mockUserWhere = jest.fn()
  const mockUserDoc = jest.fn()
  const mockUserSet = jest.fn()
  const mockOrgMemberSet = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    mockOrgGet.mockResolvedValue({
      exists: true,
      id: 'unassigned-org',
      data: () => ({
        name: 'Other Co', slug: 'other', active: true,
        members: [{ userId: 'ai-agent', role: 'owner' }],
        description: '', logoUrl: '', website: '', createdBy: 'ai-agent', linkedClientId: '',
      }),
    })
    mockOrgUpdate.mockResolvedValue(undefined)
    mockUserDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        role: 'admin',
        orgId: 'pib-platform-owner',
        allowedOrgIds: ['assigned-org'],
        displayName: 'Restricted Admin',
        email: 'restricted@example.com',
      }),
    })
    mockUserQueryGet.mockResolvedValue({
      empty: false,
      docs: [{ id: 'new-user', data: () => ({ displayName: 'New User', email: 'new@example.com', photoURL: null }) }],
    })
    mockUserWhere.mockReturnValue({ get: mockUserQueryGet })
    mockUserSet.mockResolvedValue(undefined)
    mockOrgMemberSet.mockResolvedValue(undefined)
    mockUserDoc.mockReturnValue({
      get: mockUserDocGet,
      set: mockUserSet,
    })
    mockCollection.mockImplementation((collName: string) => {
      if (collName === 'users') return { where: mockUserWhere, doc: mockUserDoc }
      if (collName === 'organizations') return { doc: jest.fn().mockReturnValue({ get: mockOrgGet, update: mockOrgUpdate }) }
      if (collName === 'orgMembers') return { doc: jest.fn().mockReturnValue({ set: mockOrgMemberSet }) }
      throw new Error(`Unexpected collection: ${collName}`)
    })
  })

  function restrictedAdminReq(method = 'POST', body?: unknown, url = 'http://localhost/api/v1/organizations/unassigned-org/members') {
    ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValueOnce({ uid: 'restricted-admin' })
    return new NextRequest(url, {
      method,
      headers: { cookie: '__session=fake-session-cookie' },
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  it('denies member creation in an unassigned org without writing anything (403)', async () => {
    const res = await addMember(
      restrictedAdminReq('POST', { email: 'new@example.com', role: 'member' }),
      routeCtx({ id: 'unassigned-org' }),
    )
    expect(res.status).toBe(403)
    expect(mockOrgUpdate).not.toHaveBeenCalled()
    expect(mockUserSet).not.toHaveBeenCalled()
    expect(mockOrgMemberSet).not.toHaveBeenCalled()
    expect(mockUserWhere).not.toHaveBeenCalled()
  })

  it('allows member creation in an assigned org (201)', async () => {
    const res = await addMember(
      restrictedAdminReq('POST', { email: 'new@example.com', role: 'member' }, 'http://localhost/api/v1/organizations/assigned-org/members'),
      routeCtx({ id: 'assigned-org' }),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.userId).toBe('new-user')
    expect(mockOrgUpdate).toHaveBeenCalled()
  })

  it('still allows super admins (no allowedOrgIds) to add members', async () => {
    mockUserDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        role: 'admin',
        orgId: 'pib-platform-owner',
        displayName: 'Super Admin',
        email: 'super@example.com',
      }),
    })
    const res = await addMember(
      restrictedAdminReq('POST', { email: 'new@example.com', role: 'member' }, 'http://localhost/api/v1/organizations/unassigned-org/members'),
      routeCtx({ id: 'unassigned-org' }),
    )
    expect(res.status).toBe(201)
  })
})

describe('POST /api/v1/organizations/[id]/create-login — restricted admin scope', () => {
  const mockOrgGet = jest.fn()
  const mockUserDocGet = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    mockOrgGet.mockResolvedValue({
      exists: true,
      id: 'unassigned-org',
      data: () => ({
        name: 'Other Co', slug: 'other', active: true,
        members: [{ userId: 'ai-agent', role: 'owner' }],
        description: '', logoUrl: '', website: '', createdBy: 'ai-agent', linkedClientId: '',
      }),
    })
    mockUserDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        role: 'admin',
        orgId: 'pib-platform-owner',
        allowedOrgIds: ['assigned-org'],
        displayName: 'Restricted Admin',
        email: 'restricted@example.com',
      }),
    })
    mockCollection.mockImplementation((collName: string) => {
      if (collName === 'users') return { doc: jest.fn().mockReturnValue({ get: mockUserDocGet }) }
      if (collName === 'organizations') return { doc: jest.fn().mockReturnValue({ get: mockOrgGet }) }
      throw new Error(`Unexpected collection: ${collName}`)
    })
  })

  it('denies login creation in an unassigned org (403)', async () => {
    ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValueOnce({ uid: 'restricted-admin' })
    const req = new NextRequest('http://localhost/api/v1/organizations/unassigned-org/create-login', {
      method: 'POST',
      headers: { cookie: '__session=fake-session-cookie' },
      body: JSON.stringify({ email: 'client@example.com', name: 'Client User', role: 'member' }),
    })
    const res = await createLogin(req, routeCtx({ id: 'unassigned-org' }))
    expect(res.status).toBe(403)
  })
})

describe('GET /api/v1/organizations/[id]/members/client', () => {
  const mockOrgGet = jest.fn()
  const mockUsersGet = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    mockOrgGet.mockResolvedValue({
      exists: true,
      id: 'org-1',
      data: () => ({
        name: 'Lumen',
        slug: 'lumen',
        active: true,
        members: [{ userId: 'existing-client', role: 'member' }],
        description: '',
        logoUrl: '',
        website: '',
        createdBy: 'ai-agent',
        linkedClientId: '',
      }),
    })
    mockUsersGet.mockResolvedValue({
      docs: [
        { id: 'client-1', data: () => ({ role: 'client', displayName: 'Jane Client', email: 'jane@example.com' }) },
        { id: 'existing-client', data: () => ({ role: 'client', displayName: 'Existing Client', email: 'existing@example.com' }) },
      ],
    })
    mockWhere.mockReturnValue({ get: mockUsersGet })
    mockCollection.mockImplementation((collName: string) => {
      if (collName === 'organizations') return { doc: jest.fn().mockReturnValue({ get: mockOrgGet }) }
      if (collName === 'users') return { where: mockWhere }
      throw new Error(`Unexpected collection: ${collName}`)
    })
  })

  it('searches existing client users and excludes current org members', async () => {
    const req = adminReq('GET', undefined, 'http://localhost/api/v1/organizations/org-1/members/client?q=jane')
    const res = await searchClientMembers(req, routeCtx())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toEqual([
      expect.objectContaining({
        uid: 'client-1',
        email: 'jane@example.com',
        displayName: 'Jane Client',
      }),
    ])
    expect(mockWhere).toHaveBeenCalledWith('role', '==', 'client')
  })
})

describe('POST /api/v1/organizations/[id]/members/client', () => {
  const mockOrgGet = jest.fn()
  const mockOrgUpdate = jest.fn()
  const mockUserGet = jest.fn()
  const mockUserSet = jest.fn()
  const mockOrgMemberSet = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    mockOrgGet.mockResolvedValue({
      exists: true,
      id: 'org-1',
      data: () => ({
        name: 'Lumen',
        slug: 'lumen',
        active: true,
        members: [{ userId: 'ai-agent', role: 'owner' }],
        description: '',
        logoUrl: '',
        website: '',
        createdBy: 'ai-agent',
        linkedClientId: '',
      }),
    })
    mockOrgUpdate.mockResolvedValue(undefined)
    mockUserGet.mockResolvedValue({
      exists: true,
      id: 'client-1',
      data: () => ({ role: 'client', displayName: 'Jane Client', email: 'jane@example.com', orgIds: ['other-org'] }),
    })
    mockUserSet.mockResolvedValue(undefined)
    mockOrgMemberSet.mockResolvedValue(undefined)
    mockCollection.mockImplementation((collName: string) => {
      if (collName === 'organizations') {
        return { doc: jest.fn().mockReturnValue({ get: mockOrgGet, update: mockOrgUpdate }) }
      }
      if (collName === 'users') {
        return { doc: jest.fn().mockReturnValue({ get: mockUserGet, set: mockUserSet }) }
      }
      if (collName === 'orgMembers') {
        return { doc: jest.fn().mockReturnValue({ set: mockOrgMemberSet }) }
      }
      throw new Error(`Unexpected collection: ${collName}`)
    })
  })

  it('adds an existing client user as an org member with the selected role', async () => {
    const res = await addClientMember(
      adminReq('POST', {
        uid: 'client-1',
        role: 'viewer',
        jobTitle: 'Financial Manager',
        department: 'Finance',
        accessScope: 'billing',
        accessNotes: 'Reviews invoices and proposals',
      }, 'http://localhost/api/v1/organizations/org-1/members/client'),
      routeCtx(),
    )

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data).toEqual(expect.objectContaining({
      userId: 'client-1',
      role: 'viewer',
      email: 'jane@example.com',
      joinedAt: '__NOW_TS__',
      jobTitle: 'Financial Manager',
      department: 'Finance',
      accessScope: 'billing',
      accessNotes: 'Reviews invoices and proposals',
    }))
    expect(mockOrgUpdate).toHaveBeenCalledWith(expect.objectContaining({
      members: expect.arrayContaining([
        expect.objectContaining({
          userId: 'client-1',
          role: 'viewer',
          jobTitle: 'Financial Manager',
          department: 'Finance',
          accessScope: 'billing',
          accessNotes: 'Reviews invoices and proposals',
        }),
      ]),
      updatedAt: '__SERVER_TS__',
    }))
    expect(mockUserSet).toHaveBeenCalledWith(
      expect.objectContaining({
        orgIds: ['other-org', 'org-1'],
        orgId: 'org-1',
        updatedAt: '__SERVER_TS__',
      }),
      { merge: true },
    )
    expect(mockOrgMemberSet).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        uid: 'client-1',
        firstName: 'Jane',
        lastName: 'Client',
        role: 'viewer',
        jobTitle: 'Financial Manager',
        department: 'Finance',
        accessScope: 'billing',
        accessNotes: 'Reviews invoices and proposals',
        updatedAt: '__SERVER_TS__',
      }),
      { merge: true },
    )
  })

  it('defaults existing client additions to member role', async () => {
    const res = await addClientMember(
      adminReq('POST', { uid: 'client-1' }, 'http://localhost/api/v1/organizations/org-1/members/client'),
      routeCtx(),
    )

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.role).toBe('member')
  })

  it('rejects invalid existing client roles', async () => {
    const res = await addClientMember(
      adminReq('POST', { uid: 'client-1', role: 'owner' }, 'http://localhost/api/v1/organizations/org-1/members/client'),
      routeCtx(),
    )

    expect(res.status).toBe(400)
    expect(mockOrgUpdate).not.toHaveBeenCalled()
    expect(mockUserSet).not.toHaveBeenCalled()
    expect(mockOrgMemberSet).not.toHaveBeenCalled()
  })

  it('rejects non-client users', async () => {
    mockUserGet.mockResolvedValue({
      exists: true,
      id: 'admin-1',
      data: () => ({ role: 'admin', displayName: 'Staff User', email: 'staff@example.com' }),
    })

    const res = await addClientMember(
      adminReq('POST', { uid: 'admin-1' }, 'http://localhost/api/v1/organizations/org-1/members/client'),
      routeCtx(),
    )

    expect(res.status).toBe(400)
    expect(mockOrgUpdate).not.toHaveBeenCalled()
    expect(mockUserSet).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/organizations/[id]/create-login', () => {
  const mockOrgGet = jest.fn()
  const mockOrgUpdate = jest.fn()
  const mockOrgDoc = jest.fn()
  const mockUserSet = jest.fn()
  const mockUserDoc = jest.fn()
  const mockOrgMemberSet = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()

    mockOrgGet.mockResolvedValue({
      exists: true,
      id: 'org-1',
      data: () => ({
        name: 'Lumen', slug: 'lumen', active: true,
        members: [{ userId: 'ai-agent', role: 'owner' }],
        description: '', logoUrl: '', website: '', createdBy: 'ai-agent', linkedClientId: '',
      }),
    })
    mockOrgUpdate.mockResolvedValue(undefined)
    mockOrgDoc.mockReturnValue({ get: mockOrgGet, update: mockOrgUpdate })
    mockUserSet.mockResolvedValue(undefined)
    mockOrgMemberSet.mockResolvedValue(undefined)
    mockUserDoc.mockReturnValue({ set: mockUserSet, get: jest.fn().mockResolvedValue({ exists: false, data: () => undefined }) })

    ;(adminAuth.getUserByEmail as jest.Mock).mockRejectedValue({ code: 'auth/user-not-found' })
    ;(adminAuth.createUser as jest.Mock).mockResolvedValue({ uid: 'new-client-uid' })
    ;(adminAuth.generatePasswordResetLink as jest.Mock).mockResolvedValue('https://reset.example.com/link')

    mockCollection.mockImplementation((collName: string) => {
      if (collName === 'organizations') return { doc: mockOrgDoc }
      if (collName === 'users') return { doc: mockUserDoc }
      if (collName === 'orgMembers') return { doc: jest.fn().mockReturnValue({ set: mockOrgMemberSet }) }
      throw new Error(`Unexpected collection: ${collName}`)
    })
  })

  it('creates a client login, stores the user, and appends a member with a concrete timestamp', async () => {
    const res = await createLogin(
      adminReq('POST', {
        email: 'client@example.com',
        name: 'Client User',
        role: 'viewer',
        jobTitle: 'Owner',
        department: 'Leadership',
        accessScope: 'all',
        accessNotes: 'Primary client sponsor',
      }),
      routeCtx(),
    )

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.uid).toBe('new-client-uid')
    expect(body.data.email).toBe('client@example.com')
    expect(body.data.setupLink).toMatch(/\/auth\/reset\?link=/)
    expect(mockUserSet).toHaveBeenCalledWith(expect.objectContaining({
      email: 'client@example.com',
      displayName: 'Client User',
      role: 'client',
      createdAt: '__SERVER_TS__',
    }))
    expect(mockOrgUpdate).toHaveBeenCalledWith(expect.objectContaining({
      members: expect.arrayContaining([
        expect.objectContaining({
          userId: 'new-client-uid',
          role: 'viewer',
          joinedAt: '__NOW_TS__',
          invitedBy: 'ai-agent',
          jobTitle: 'Owner',
          department: 'Leadership',
          accessScope: 'all',
          accessNotes: 'Primary client sponsor',
        }),
      ]),
      updatedAt: '__SERVER_TS__',
    }))
  })

  it('returns 409 when the auth user already belongs to the organisation', async () => {
    mockOrgGet.mockResolvedValue({
      exists: true,
      id: 'org-1',
      data: () => ({
        name: 'Lumen', slug: 'lumen', active: true,
        members: [{ userId: 'existing-uid', role: 'owner' }],
        description: '', logoUrl: '', website: '', createdBy: 'ai-agent', linkedClientId: '',
      }),
    })
    ;(adminAuth.getUserByEmail as jest.Mock).mockResolvedValue({ uid: 'existing-uid' })

    const res = await createLogin(
      adminReq('POST', { email: 'owner@example.com', name: 'Existing User', role: 'member' }),
      routeCtx(),
    )

    expect(res.status).toBe(409)
  })
})

describe('PATCH /api/v1/organizations/[id]/members/[userId]', () => {
  const mockOrgGet = jest.fn()
  const mockUserGet = jest.fn()
  const mockOrgUpdate = jest.fn()
  const mockMemberSet = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    mockOrgGet.mockResolvedValue({
      exists: true,
      id: 'org-1',
      data: () => ({
        name: 'Lumen',
        slug: 'lumen',
        active: true,
        members: [
          { userId: 'ai-agent', role: 'owner' },
          {
            userId: 'stean-member',
            role: 'member',
            accessPolicy: {
              preset: 'custom',
              modules: { billing: true, crm: true },
              recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
            },
          },
        ],
        description: '',
        logoUrl: '',
        website: '',
        createdBy: 'ai-agent',
        linkedClientId: '',
      }),
    })
    mockUserGet.mockResolvedValue({
      exists: true,
      data: () => ({
        role: 'client',
        email: 'stean@example.com',
        displayName: 'Stean',
        orgId: 'org-1',
      }),
    })
    mockOrgUpdate.mockResolvedValue(undefined)
    mockMemberSet.mockResolvedValue(undefined)
    mockCollection.mockImplementation((collName: string) => {
      if (collName === 'organizations') {
        return { doc: jest.fn().mockReturnValue({ get: mockOrgGet, update: mockOrgUpdate }) }
      }
      if (collName === 'users') {
        return { doc: jest.fn().mockReturnValue({ get: mockUserGet, set: jest.fn() }) }
      }
      if (collName === 'orgMembers') {
        return { doc: jest.fn().mockReturnValue({ set: mockMemberSet }) }
      }
      throw new Error(`Unexpected collection: ${collName}`)
    })
  })

  it('persists explicit accessPolicy capabilities for a member', async () => {
    const res = await patchMember(
      adminReq('PATCH', {
        accessPolicy: {
          preset: 'custom',
          modules: { billing: true, crm: true, projects: true },
          recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
          capabilities: { invoices: true, quotes: true },
        },
      }, 'http://localhost/api/v1/organizations/org-1/members/stean-member'),
      routeCtx({ id: 'org-1', userId: 'stean-member' }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.accessPolicy.capabilities).toEqual({ invoices: true, quotes: true })
    expect(mockOrgUpdate).toHaveBeenCalled()
    expect(mockMemberSet).toHaveBeenCalledWith(
      expect.objectContaining({
        accessPolicy: expect.objectContaining({
          capabilities: { invoices: true, quotes: true },
        }),
      }),
      { merge: true },
    )
  })

  it('rejects sending both accessScope and accessPolicy', async () => {
    const res = await patchMember(
      adminReq('PATCH', {
        accessScope: 'billing',
        accessPolicy: { capabilities: { invoices: true } },
      }, 'http://localhost/api/v1/organizations/org-1/members/stean-member'),
      routeCtx({ id: 'org-1', userId: 'stean-member' }),
    )
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/v1/organizations/[id]/members/[userId]', () => {
  const mockOrgGet = jest.fn()
  const mockUserGet = jest.fn()
  const mockOrgUpdate = jest.fn()
  const mockUserSet = jest.fn()
  const mockMemberDelete = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    mockOrgGet.mockResolvedValue({
      exists: true,
      id: 'org-1',
      data: () => ({
        name: 'Lumen', slug: 'lumen', active: true,
        members: [
          { userId: 'ai-agent', role: 'owner' },
          { userId: 'member-to-remove', role: 'member' },
        ],
        description: '', logoUrl: '', website: '', createdBy: 'ai-agent', linkedClientId: '',
      }),
    })
    mockUserGet.mockResolvedValue({
      exists: true,
      data: () => ({
        role: 'client',
        orgId: 'org-1',
        activeOrgId: 'org-1',
        orgIds: ['org-1', 'org-2'],
      }),
    })
    mockOrgUpdate.mockResolvedValue(undefined)
    mockUserSet.mockResolvedValue(undefined)
    mockMemberDelete.mockResolvedValue(undefined)
    mockCollection.mockImplementation((collName: string) => {
      if (collName === 'organizations') {
        return { doc: jest.fn().mockReturnValue({ get: mockOrgGet, update: mockOrgUpdate }) }
      }
      if (collName === 'users') {
        return { doc: jest.fn().mockReturnValue({ get: mockUserGet, set: mockUserSet }) }
      }
      if (collName === 'orgMembers') {
        return { doc: jest.fn().mockReturnValue({ delete: mockMemberDelete }) }
      }
      throw new Error(`Unexpected collection: ${collName}`)
    })
  })

  it('removes a member and returns 200', async () => {
    const res = await removeMember(
      adminReq('DELETE'),
      routeCtx({ id: 'org-1', userId: 'member-to-remove' }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.removed).toBe(true)
    expect(mockOrgUpdate).toHaveBeenCalledWith(expect.objectContaining({
      members: expect.anything(),
      updatedAt: expect.anything(),
    }))
    expect(mockUserSet).toHaveBeenCalledWith(
      expect.objectContaining({
        orgIds: ['org-2'],
        orgId: 'org-2',
        activeOrgId: 'org-2',
        updatedAt: expect.anything(),
      }),
      { merge: true },
    )
    expect(mockMemberDelete).toHaveBeenCalled()
  })

  it('allows removing the historical ai-agent owner even when it is the last owner', async () => {
    mockOrgGet.mockResolvedValue({
      exists: true,
      id: 'org-1',
      data: () => ({
        name: 'Lumen', slug: 'lumen', active: true,
        members: [{ userId: 'ai-agent', role: 'owner' }],
        description: '', logoUrl: '', website: '', createdBy: 'ai-agent', linkedClientId: '',
      }),
    })
    mockUserGet.mockResolvedValue({ exists: false })

    const res = await removeMember(
      adminReq('DELETE'),
      routeCtx({ id: 'org-1', userId: 'ai-agent' }),
    )

    expect(res.status).toBe(200)
    expect(mockOrgUpdate).toHaveBeenCalledWith(expect.objectContaining({
      members: [],
      updatedAt: expect.anything(),
    }))
    expect(mockMemberDelete).toHaveBeenCalled()
  })

  it('cleans a stale user-org link when the embedded org member is already gone', async () => {
    const res = await removeMember(
      adminReq('DELETE'),
      routeCtx({ id: 'org-1', userId: 'non-member' }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.cleanedStaleLink).toBe(true)
    expect(mockOrgUpdate).not.toHaveBeenCalled()
    expect(mockUserSet).toHaveBeenCalledWith(
      expect.objectContaining({
        orgIds: ['org-2'],
        orgId: 'org-2',
        activeOrgId: 'org-2',
        updatedAt: expect.anything(),
      }),
      { merge: true },
    )
    expect(mockMemberDelete).toHaveBeenCalled()
  })

  it('returns 404 when user is not linked to the organisation anywhere', async () => {
    mockUserGet.mockResolvedValue({
      exists: true,
      data: () => ({
        role: 'client',
        orgId: 'org-2',
        activeOrgId: 'org-2',
        orgIds: ['org-2'],
      }),
    })
    const res = await removeMember(
      adminReq('DELETE'),
      routeCtx({ id: 'org-1', userId: 'non-member' }),
    )
    expect(res.status).toBe(404)
  })

  it('returns 404 when org does not exist', async () => {
    mockOrgGet.mockResolvedValue({ exists: false })
    const res = await removeMember(
      adminReq('DELETE'),
      routeCtx({ id: 'ghost', userId: 'anyone' }),
    )
    expect(res.status).toBe(404)
  })
})

describe('POST /api/v1/organizations/[id]/link-client', () => {
  const mockOrgGet = jest.fn()
  const mockClientGet = jest.fn()
  const mockUpdate = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    mockOrgGet.mockResolvedValue({
      exists: true,
      id: 'org-1',
      data: () => ({
        name: 'Lumen', slug: 'lumen', active: true,
        members: [{ userId: 'ai-agent', role: 'owner' }],
        description: '', logoUrl: '', website: '', createdBy: 'ai-agent', linkedClientId: '',
      }),
    })
    mockClientGet.mockResolvedValue({ exists: true, id: 'client-1', data: () => ({ name: 'Acme' }) })
    mockUpdate.mockResolvedValue(undefined)

    mockCollection.mockImplementation((collName: string) => {
      if (collName === 'organizations') return { doc: jest.fn().mockReturnValue({ get: mockOrgGet, update: mockUpdate }) }
      if (collName === 'clients') return { doc: jest.fn().mockReturnValue({ get: mockClientGet }) }
      throw new Error(`Unexpected collection: ${collName}`)
    })
  })

  it('links a client and returns 200', async () => {
    const res = await linkClient(
      adminReq('POST', { clientId: 'client-1' }),
      routeCtx(),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.linked).toBe(true)
    expect(body.data.clientId).toBe('client-1')
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ linkedClientId: 'client-1' }))
  })

  it('returns 400 when clientId is missing', async () => {
    const res = await linkClient(
      adminReq('POST', {}),
      routeCtx(),
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 when client does not exist', async () => {
    mockClientGet.mockResolvedValue({ exists: false })
    const res = await linkClient(
      adminReq('POST', { clientId: 'ghost-client' }),
      routeCtx(),
    )
    expect(res.status).toBe(404)
  })

  it('returns 404 when org does not exist', async () => {
    mockOrgGet.mockResolvedValue({ exists: false })
    const res = await linkClient(
      adminReq('POST', { clientId: 'client-1' }),
      routeCtx(),
    )
    expect(res.status).toBe(404)
  })

  it('returns 200 as no-op when same client is already linked', async () => {
    mockOrgGet.mockResolvedValue({
      exists: true,
      id: 'org-1',
      data: () => ({
        name: 'Lumen', slug: 'lumen', active: true,
        members: [{ userId: 'ai-agent', role: 'owner' }],
        description: '', logoUrl: '', website: '', createdBy: 'ai-agent', linkedClientId: 'client-1',
      }),
    })
    const res = await linkClient(
      adminReq('POST', { clientId: 'client-1' }),
      routeCtx(),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.linked).toBe(true)
  })

  it('returns 409 when org is already linked to a different client', async () => {
    mockOrgGet.mockResolvedValue({
      exists: true,
      id: 'org-1',
      data: () => ({
        name: 'Lumen', slug: 'lumen', active: true,
        members: [{ userId: 'ai-agent', role: 'owner' }],
        description: '', logoUrl: '', website: '', createdBy: 'ai-agent', linkedClientId: 'other-client',
      }),
    })
    const res = await linkClient(
      adminReq('POST', { clientId: 'client-1' }),
      routeCtx(),
    )
    expect(res.status).toBe(409)
  })
})

describe('GET /api/v1/organizations/[id]/accounts', () => {
  const mockOrgGet = jest.fn()
  const mockAccountsGet = jest.fn()
  const mockAccountsWhere = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    mockOrgGet.mockResolvedValue({
      exists: true,
      id: 'org-1',
      data: () => ({
        name: 'Lumen', slug: 'lumen', active: true,
        members: [{ userId: 'ai-agent', role: 'owner' }],
        description: '', logoUrl: '', website: '', createdBy: 'ai-agent', linkedClientId: '',
      }),
    })
    mockAccountsGet.mockResolvedValue({
      docs: [
        {
          id: 'acct-1',
          data: () => ({
            orgId: 'org-1', platform: 'twitter', displayName: 'Pip AI',
            encryptedTokens: { accessToken: 'secret' }, status: 'active',
          }),
        },
      ],
    })
    mockAccountsWhere.mockReturnValue({ get: mockAccountsGet })

    mockCollection.mockImplementation((collName: string) => {
      if (collName === 'organizations') return { doc: jest.fn().mockReturnValue({ get: mockOrgGet }) }
      if (collName === 'social_accounts') return { where: mockAccountsWhere }
      throw new Error(`Unexpected collection: ${collName}`)
    })
  })

  it('returns social accounts for the org and strips encryptedTokens', async () => {
    const res = await getOrgAccounts(
      adminReq('GET'),
      routeCtx(),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].id).toBe('acct-1')
    expect(body.data[0].encryptedTokens).toBeUndefined()
    expect(body.meta.total).toBe(1)
  })

  it('returns 404 when org does not exist', async () => {
    mockOrgGet.mockResolvedValue({ exists: false })
    const res = await getOrgAccounts(
      adminReq('GET'),
      routeCtx(),
    )
    expect(res.status).toBe(404)
  })

  it('returns empty array when org has no social accounts', async () => {
    mockAccountsGet.mockResolvedValue({ docs: [] })
    const res = await getOrgAccounts(
      adminReq('GET'),
      routeCtx(),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toHaveLength(0)
    expect(body.meta.total).toBe(0)
  })

  it('preserves platform and displayName fields while stripping encryptedTokens', async () => {
    const res = await getOrgAccounts(
      adminReq('GET'),
      routeCtx(),
    )
    const body = await res.json()
    expect(body.data[0].platform).toBe('twitter')
    expect(body.data[0].displayName).toBe('Pip AI')
    expect(body.data[0].encryptedTokens).toBeUndefined()
  })
})
