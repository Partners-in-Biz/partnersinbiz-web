import { NextRequest } from 'next/server'

type MockUser = { uid: string; role: 'admin' | 'client' | 'ai'; orgId?: string; allowedOrgIds?: string[] }
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

const mockCollection = jest.fn()
const mockUsersWhere = jest.fn()
const mockUsersGet = jest.fn()
const mockOrgsWhere = jest.fn()
const mockOrgsGet = jest.fn()
const mockUserDoc = jest.fn()
const mockUserGet = jest.fn()
const mockUserSet = jest.fn()
const mockOrgDoc = jest.fn()
const mockOrgGet = jest.fn()
const mockOrgUpdate = jest.fn()
const mockOrgMemberDoc = jest.fn()
const mockOrgMemberSet = jest.fn()

const mockGetUserByUid = jest.fn()
const mockGetUserByEmail = jest.fn()
const mockCreateUser = jest.fn()
const mockUpdateUser = jest.fn()
const mockDeleteUser = jest.fn()
const mockGenerateLink = jest.fn()

let mockUser: MockUser = { uid: 'super-1', role: 'admin' }

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
  adminAuth: {
    getUser: (uid: string) => mockGetUserByUid(uid),
    getUserByEmail: (email: string) => mockGetUserByEmail(email),
    createUser: (data: unknown) => mockCreateUser(data),
    updateUser: (uid: string, data: unknown) => mockUpdateUser(uid, data),
    deleteUser: (uid: string) => mockDeleteUser(uid),
    generatePasswordResetLink: (email: string, options?: unknown) => mockGenerateLink(email, options),
  },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => async (req: NextRequest, ctx?: unknown) =>
    handler(req, mockUser, ctx),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  },
  Timestamp: {
    now: jest.fn(() => 'NOW_TIMESTAMP'),
  },
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockUser = { uid: 'super-1', role: 'admin' }

  mockUsersWhere.mockReturnValue({ get: mockUsersGet })
  mockOrgsWhere.mockReturnValue({ get: mockOrgsGet })
  mockUserDoc.mockReturnValue({ get: mockUserGet, set: mockUserSet })
  mockOrgDoc.mockReturnValue({ get: mockOrgGet, update: mockOrgUpdate })
  mockOrgMemberDoc.mockReturnValue({ set: mockOrgMemberSet })
  mockUserSet.mockResolvedValue(undefined)
  mockOrgUpdate.mockResolvedValue(undefined)
  mockOrgMemberSet.mockResolvedValue(undefined)
  mockDeleteUser.mockResolvedValue(undefined)

  mockCollection.mockImplementation((name: string) => {
    if (name === 'users') return { where: mockUsersWhere, doc: mockUserDoc }
    if (name === 'organizations') return { where: mockOrgsWhere, doc: mockOrgDoc }
    if (name === 'orgMembers') return { doc: mockOrgMemberDoc }
    throw new Error(`Unexpected collection: ${name}`)
  })

  mockGetUserByUid.mockResolvedValue({
    email: 'client@example.com',
    displayName: 'Client One',
    disabled: false,
    emailVerified: true,
    metadata: { lastSignInTime: '2026-05-01T10:00:00.000Z' },
  })
  mockGenerateLink.mockResolvedValue('https://firebase.example/reset?oobCode=abc')
  mockGetUserByEmail.mockRejectedValue({ code: 'auth/user-not-found' })
  mockCreateUser.mockResolvedValue({ uid: 'new-client-1' })
})

async function readJson(res: Response) {
  const text = await res.text()
  return JSON.parse(text)
}

describe('GET /api/v1/admin/platform-members', () => {
  it('lists client users with organization links from membership and user orgIds', async () => {
    const { GET } = await import('@/app/api/v1/admin/platform-members/route')

    mockUsersGet.mockResolvedValue({
      docs: [
        {
          id: 'client-1',
          data: () => ({
            email: 'client@example.com',
            displayName: 'Client One',
            role: 'client',
            orgId: 'org-a',
            orgIds: ['org-a', 'org-b'],
          }),
        },
      ],
    })
    mockOrgsGet.mockResolvedValue({
      docs: [
        {
          id: 'org-a',
          data: () => ({
            name: 'Client A',
            slug: 'client-a',
            active: true,
            members: [{ userId: 'client-1', role: 'admin' }],
          }),
        },
        {
          id: 'org-b',
          data: () => ({
            name: 'Client B',
            slug: 'client-b',
            active: true,
            members: [],
          }),
        },
      ],
    })

    const req = new NextRequest('http://localhost/api/v1/admin/platform-members')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.data).toHaveLength(1)
    expect(body.data[0].authFound).toBe(true)
    expect(body.data[0].linkedOrgs).toEqual([
      { id: 'org-a', name: 'Client A', slug: 'client-a', role: 'admin', source: 'membership' },
      { id: 'org-b', name: 'Client B', slug: 'client-b', source: 'user' },
    ])
  })

  it('rejects restricted admins', async () => {
    mockUser = { uid: 'restricted-1', role: 'admin', allowedOrgIds: ['org-a'] }
    const { GET } = await import('@/app/api/v1/admin/platform-members/route')
    const req = new NextRequest('http://localhost/api/v1/admin/platform-members')
    const res = await GET(req)
    expect(res.status).toBe(403)
  })
})

describe('POST /api/v1/admin/platform-members', () => {
  it('creates a client auth user with the chosen password and links them to an organisation', async () => {
    const { POST } = await import('@/app/api/v1/admin/platform-members/route')
    mockOrgGet.mockResolvedValue({
      exists: true,
      data: () => ({
        name: 'Client A',
        slug: 'client-a',
        active: true,
        status: 'active',
        members: [],
      }),
    })
    mockUserGet.mockResolvedValue({ exists: false, data: () => undefined })

    const req = new NextRequest('http://localhost/api/v1/admin/platform-members', {
      method: 'POST',
      body: JSON.stringify({
        email: 'new@client.co.za',
        name: 'New Client',
        orgId: 'org-a',
        role: 'admin',
        password: 'chosen-password-123',
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = await readJson(res)
    expect(body.data.uid).toBe('new-client-1')
    expect(mockCreateUser).toHaveBeenCalledWith({
      email: 'new@client.co.za',
      displayName: 'New Client',
      password: 'chosen-password-123',
    })
    expect(mockUserSet).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: 'new-client-1',
        email: 'new@client.co.za',
        displayName: 'New Client',
        role: 'client',
        orgId: 'org-a',
        orgIds: ['org-a'],
      }),
      { merge: true },
    )
    expect(mockOrgUpdate).toHaveBeenCalledWith(expect.objectContaining({
      members: [
        expect.objectContaining({
          userId: 'new-client-1',
          role: 'admin',
          joinedAt: 'NOW_TIMESTAMP',
          invitedBy: 'super-1',
        }),
      ],
    }))
    expect(mockOrgMemberSet).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-a',
        uid: 'new-client-1',
        firstName: 'New',
        lastName: 'Client',
        role: 'admin',
      }),
      { merge: true },
    )
  })

  it('updates an existing client password and preserves their primary org', async () => {
    const { POST } = await import('@/app/api/v1/admin/platform-members/route')
    mockGetUserByEmail.mockResolvedValue({ uid: 'existing-client-1' })
    mockOrgGet.mockResolvedValue({
      exists: true,
      data: () => ({
        name: 'Client B',
        slug: 'client-b',
        active: true,
        status: 'active',
        members: [],
      }),
    })
    mockUserGet.mockResolvedValue({
      exists: true,
      data: () => ({
        role: 'client',
        orgId: 'org-a',
        orgIds: ['org-a'],
      }),
    })

    const req = new NextRequest('http://localhost/api/v1/admin/platform-members', {
      method: 'POST',
      body: JSON.stringify({
        email: 'existing@client.co.za',
        name: 'Existing Client',
        orgId: 'org-b',
        role: 'member',
        password: 'new-password-123',
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    expect(mockUpdateUser).toHaveBeenCalledWith('existing-client-1', {
      displayName: 'Existing Client',
      password: 'new-password-123',
    })
    expect(mockUserSet).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-a',
        orgIds: ['org-a', 'org-b'],
      }),
      { merge: true },
    )
  })

  it('rejects duplicate organisation memberships', async () => {
    const { POST } = await import('@/app/api/v1/admin/platform-members/route')
    mockGetUserByEmail.mockResolvedValue({ uid: 'existing-client-1' })
    mockOrgGet.mockResolvedValue({
      exists: true,
      data: () => ({
        name: 'Client A',
        slug: 'client-a',
        active: true,
        status: 'active',
        members: [{ userId: 'existing-client-1', role: 'viewer' }],
      }),
    })

    const req = new NextRequest('http://localhost/api/v1/admin/platform-members', {
      method: 'POST',
      body: JSON.stringify({
        email: 'existing@client.co.za',
        name: 'Existing Client',
        orgId: 'org-a',
        role: 'member',
        password: 'new-password-123',
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(409)
  })
})

describe('POST /api/v1/admin/platform-members/[uid]/reset', () => {
  it('creates a wrapped Firebase setup link for a client member', async () => {
    const { POST } = await import('@/app/api/v1/admin/platform-members/[uid]/reset/route')
    mockUserGet.mockResolvedValue({
      exists: true,
      data: () => ({ role: 'client', email: 'client@example.com' }),
    })

    const req = new NextRequest('http://localhost/api/v1/admin/platform-members/client-1/reset', {
      method: 'POST',
    })
    const res = await POST(req, { params: Promise.resolve({ uid: 'client-1' }) })
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(mockGenerateLink).toHaveBeenCalledWith('client@example.com', {
      url: 'https://partnersinbiz.online/login',
    })
    expect(body.data.setupLink).toContain('/auth/reset?link=')
  })
})

describe('PATCH /api/v1/admin/platform-members/[uid]/password', () => {
  it('sets a Firebase password for a client member', async () => {
    const { PATCH } = await import('@/app/api/v1/admin/platform-members/[uid]/password/route')
    mockUserGet.mockResolvedValue({
      exists: true,
      data: () => ({ role: 'client', email: 'client@example.com' }),
    })

    const req = new NextRequest('http://localhost/api/v1/admin/platform-members/client-1/password', {
      method: 'PATCH',
      body: JSON.stringify({ password: 'new-password-123' }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ uid: 'client-1' }) })
    expect(res.status).toBe(200)
    expect(mockUpdateUser).toHaveBeenCalledWith('client-1', { password: 'new-password-123' })
    expect(mockUserSet).toHaveBeenCalledWith({ updatedAt: 'SERVER_TIMESTAMP' }, { merge: true })
  })

  it('rejects short passwords', async () => {
    const { PATCH } = await import('@/app/api/v1/admin/platform-members/[uid]/password/route')
    const req = new NextRequest('http://localhost/api/v1/admin/platform-members/client-1/password', {
      method: 'PATCH',
      body: JSON.stringify({ password: 'short' }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ uid: 'client-1' }) })
    expect(res.status).toBe(400)
  })
})
