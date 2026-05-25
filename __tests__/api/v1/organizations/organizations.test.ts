// __tests__/api/v1/organizations/organizations.test.ts
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/v1/organizations/route'
import { GET as getById, PUT, DELETE } from '@/app/api/v1/organizations/[id]/route'
import { POST as addMember } from '@/app/api/v1/organizations/[id]/members/route'
import { GET as searchClientMembers, POST as addClientMember } from '@/app/api/v1/organizations/[id]/members/client/route'
import { POST as createLogin } from '@/app/api/v1/organizations/[id]/create-login/route'
import { DELETE as removeMember } from '@/app/api/v1/organizations/[id]/members/[userId]/route'
import { POST as linkClient } from '@/app/api/v1/organizations/[id]/link-client/route'
import { GET as getOrgAccounts } from '@/app/api/v1/organizations/[id]/accounts/route'
import { provisionFullClientOnVps } from '@/lib/client-provisioning/vps'

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

jest.mock('@/lib/client-provisioning/vps', () => ({
  provisionFullClientOnVps: jest.fn(),
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
  })

  it('creates an org and returns 201 without seeding AI/API-key users into the team', async () => {
    const res = await POST(adminReq('POST', { name: 'Velox', description: 'Test org' }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.id).toBe('new-org-id')
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ members: [] }))
  })

  it('requests full VPS client provisioning by default for client orgs', async () => {
    const res = await POST(adminReq('POST', { name: 'Velox', agentName: 'Vee' }))
    expect(res.status).toBe(201)
    expect(provisionFullClientOnVps).toHaveBeenCalledWith({
      clientName: 'Velox',
      domain: 'velox',
      orgId: 'new-org-id',
      agentName: 'Vee',
    })
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        provisioning: expect.objectContaining({ status: 'complete', domain: 'velox', agentName: 'Vee' }),
      }),
      { merge: true },
    )
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
    const res = await getById(adminReq('GET'), { params: Promise.resolve({ id: 'org-1' }) } as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.name).toBe('Lumen')
  })

  it('returns 404 when org does not exist', async () => {
    mockDocGet.mockResolvedValue({ exists: false })
    const res = await getById(adminReq('GET'), { params: Promise.resolve({ id: 'ghost' }) } as any)
    expect(res.status).toBe(404)
  })

  it('returns 403 for a client user who is not a member', async () => {
    // Simulate: session cookie resolves to a client user not in the members array
    const { adminAuth, adminDb } = require('@/lib/firebase/admin')
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
    const res = await getById(req, { params: Promise.resolve({ id: 'org-1' }) } as any)
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
    const res = await PUT(adminReq('PUT', { name: 'Lumen Updated' }), { params: Promise.resolve({ id: 'org-1' }) } as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.updated).toBe(true)
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ updatedAt: expect.anything() }))
  })

  it('returns 404 when org does not exist', async () => {
    mockDocGet.mockResolvedValue({ exists: false })
    const res = await PUT(adminReq('PUT', { name: 'X' }), { params: Promise.resolve({ id: 'ghost' }) } as any)
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
    const res = await DELETE(adminReq('DELETE'), { params: Promise.resolve({ id: 'org-1' }) } as any)
    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ active: false }))
  })

  it('returns 404 when org does not exist', async () => {
    mockDocGet.mockResolvedValue({ exists: false })
    const res = await DELETE(adminReq('DELETE'), { params: Promise.resolve({ id: 'ghost' }) } as any)
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
      adminReq('POST', { email: 'new@example.com', role: 'member' }),
      { params: Promise.resolve({ id: 'org-1' }) } as any,
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.userId).toBe('new-user')
    expect(body.data.email).toBe('new@example.com')
    expect(body.data.joinedAt).toBe('__NOW_TS__')
    expect(mockUserWhere).toHaveBeenCalledWith('email', '==', 'new@example.com')
    expect(body.data.userId).toBe('new-user')
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      members: expect.anything(),
      updatedAt: expect.anything(),
    }))
  })

  it('returns 409 when user is already a member', async () => {
    mockUserQueryGet.mockResolvedValue({
      empty: false,
      docs: [{ id: 'ai-agent', data: () => ({ displayName: 'Pip', email: 'owner@example.com' }) }],
    })
    const res = await addMember(
      adminReq('POST', { email: 'owner@example.com', role: 'member' }),
      { params: Promise.resolve({ id: 'org-1' }) } as any,
    )
    expect(res.status).toBe(409)
  })

  it('returns 400 when email is missing', async () => {
    const res = await addMember(
      adminReq('POST', {}),
      { params: Promise.resolve({ id: 'org-1' }) } as any,
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 when user email does not exist', async () => {
    mockUserQueryGet.mockResolvedValue({ empty: true, docs: [] })
    const res = await addMember(
      adminReq('POST', { email: 'ghost@example.com', role: 'member' }),
      { params: Promise.resolve({ id: 'org-1' }) } as any,
    )
    expect(res.status).toBe(404)
  })

  it('returns 404 when org does not exist', async () => {
    mockDocGet.mockResolvedValue({ exists: false })
    const res = await addMember(
      adminReq('POST', { email: 'new@example.com' }),
      { params: Promise.resolve({ id: 'ghost' }) } as any,
    )
    expect(res.status).toBe(404)
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
    const res = await searchClientMembers(req, { params: Promise.resolve({ id: 'org-1' }) } as any)

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
    mockCollection.mockImplementation((collName: string) => {
      if (collName === 'organizations') {
        return { doc: jest.fn().mockReturnValue({ get: mockOrgGet, update: mockOrgUpdate }) }
      }
      if (collName === 'users') {
        return { doc: jest.fn().mockReturnValue({ get: mockUserGet, set: mockUserSet }) }
      }
      throw new Error(`Unexpected collection: ${collName}`)
    })
  })

  it('adds an existing client user as an org member', async () => {
    const res = await addClientMember(
      adminReq('POST', { uid: 'client-1' }, 'http://localhost/api/v1/organizations/org-1/members/client'),
      { params: Promise.resolve({ id: 'org-1' }) } as any,
    )

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data).toEqual(expect.objectContaining({
      userId: 'client-1',
      role: 'member',
      email: 'jane@example.com',
      joinedAt: '__NOW_TS__',
    }))
    expect(mockOrgUpdate).toHaveBeenCalledWith(expect.objectContaining({
      members: expect.arrayContaining([
        expect.objectContaining({ userId: 'client-1', role: 'member' }),
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
  })

  it('rejects non-client users', async () => {
    mockUserGet.mockResolvedValue({
      exists: true,
      id: 'admin-1',
      data: () => ({ role: 'admin', displayName: 'Staff User', email: 'staff@example.com' }),
    })

    const res = await addClientMember(
      adminReq('POST', { uid: 'admin-1' }, 'http://localhost/api/v1/organizations/org-1/members/client'),
      { params: Promise.resolve({ id: 'org-1' }) } as any,
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
    const { adminAuth } = require('@/lib/firebase/admin')

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
      adminReq('POST', { email: 'client@example.com', name: 'Client User', role: 'viewer' }),
      { params: Promise.resolve({ id: 'org-1' }) } as any,
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
        }),
      ]),
      updatedAt: '__SERVER_TS__',
    }))
  })

  it('returns 409 when the auth user already belongs to the organisation', async () => {
    const { adminAuth } = require('@/lib/firebase/admin')
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
      { params: Promise.resolve({ id: 'org-1' }) } as any,
    )

    expect(res.status).toBe(409)
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
      { params: Promise.resolve({ id: 'org-1', userId: 'member-to-remove' }) } as any,
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
      { params: Promise.resolve({ id: 'org-1', userId: 'ai-agent' }) } as any,
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
      { params: Promise.resolve({ id: 'org-1', userId: 'non-member' }) } as any,
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
      { params: Promise.resolve({ id: 'org-1', userId: 'non-member' }) } as any,
    )
    expect(res.status).toBe(404)
  })

  it('returns 404 when org does not exist', async () => {
    mockOrgGet.mockResolvedValue({ exists: false })
    const res = await removeMember(
      adminReq('DELETE'),
      { params: Promise.resolve({ id: 'ghost', userId: 'anyone' }) } as any,
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
      { params: Promise.resolve({ id: 'org-1' }) } as any,
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
      { params: Promise.resolve({ id: 'org-1' }) } as any,
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 when client does not exist', async () => {
    mockClientGet.mockResolvedValue({ exists: false })
    const res = await linkClient(
      adminReq('POST', { clientId: 'ghost-client' }),
      { params: Promise.resolve({ id: 'org-1' }) } as any,
    )
    expect(res.status).toBe(404)
  })

  it('returns 404 when org does not exist', async () => {
    mockOrgGet.mockResolvedValue({ exists: false })
    const res = await linkClient(
      adminReq('POST', { clientId: 'client-1' }),
      { params: Promise.resolve({ id: 'ghost' }) } as any,
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
      { params: Promise.resolve({ id: 'org-1' }) } as any,
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
      { params: Promise.resolve({ id: 'org-1' }) } as any,
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
      { params: Promise.resolve({ id: 'org-1' }) } as any,
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
      { params: Promise.resolve({ id: 'ghost' }) } as any,
    )
    expect(res.status).toBe(404)
  })

  it('returns empty array when org has no social accounts', async () => {
    mockAccountsGet.mockResolvedValue({ docs: [] })
    const res = await getOrgAccounts(
      adminReq('GET'),
      { params: Promise.resolve({ id: 'org-1' }) } as any,
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toHaveLength(0)
    expect(body.meta.total).toBe(0)
  })

  it('preserves platform and displayName fields while stripping encryptedTokens', async () => {
    const res = await getOrgAccounts(
      adminReq('GET'),
      { params: Promise.resolve({ id: 'org-1' }) } as any,
    )
    const body = await res.json()
    expect(body.data[0].platform).toBe('twitter')
    expect(body.data[0].displayName).toBe('Pip AI')
    expect(body.data[0].encryptedTokens).toBeUndefined()
  })
})
