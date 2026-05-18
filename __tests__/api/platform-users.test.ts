import { NextRequest } from 'next/server'

type MockUser = { uid: string; role: 'admin' | 'client' | 'ai'; orgId?: string; allowedOrgIds?: string[] }
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

const mockCollection = jest.fn()
const mockUsersWhere = jest.fn()
const mockUsersGet = jest.fn()
const mockUserDoc = jest.fn()
const mockUserGet = jest.fn()
const mockUserSet = jest.fn()
const mockUserDelete = jest.fn()

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
}))

jest.mock('@/lib/email/resend', () => ({
  getResendClient: jest.fn(() => ({ emails: { send: jest.fn().mockResolvedValue({}) } })),
  FROM_ADDRESS: 'no-reply@partnersinbiz.online',
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockUser = { uid: 'super-1', role: 'admin' }

  mockUserDoc.mockReturnValue({ get: mockUserGet, set: mockUserSet, delete: mockUserDelete })
  mockUsersWhere.mockReturnValue({ get: mockUsersGet })
  mockUserSet.mockResolvedValue(undefined)
  mockUserDelete.mockResolvedValue(undefined)

  mockCollection.mockImplementation((name: string) => {
    if (name === 'users') return { where: mockUsersWhere, doc: mockUserDoc }
    throw new Error(`Unexpected collection: ${name}`)
  })

  mockGenerateLink.mockResolvedValue('https://example.com/setup?oobCode=abc')
  mockGetUserByUid.mockResolvedValue({ metadata: { lastSignInTime: null } })
})

async function readJson(res: Response) {
  const text = await res.text()
  return JSON.parse(text)
}

// ── GET /api/v1/admin/platform-users ────────────────────────────────────────
describe('GET /api/v1/admin/platform-users', () => {
  it('lists platform admins for super admins', async () => {
    const { GET } = await import('@/app/api/v1/admin/platform-users/route')
    mockUsersGet.mockResolvedValue({
      docs: [
        {
          id: 'admin-1',
          data: () => ({
            email: 'a@example.com',
            displayName: 'Admin One',
            role: 'admin',
            orgId: 'pib-platform-owner',
            allowedOrgIds: [],
          }),
        },
        {
          id: 'admin-2',
          data: () => ({
            email: 'b@example.com',
            displayName: 'Admin Two',
            role: 'admin',
            orgId: 'pib-platform-owner',
            allowedOrgIds: ['org-a', 'org-b'],
          }),
        },
      ],
    })
    const req = new NextRequest('http://localhost/api/v1/admin/platform-users')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(2)
    const a1 = body.data.find((u: { uid: string }) => u.uid === 'admin-1')
    const a2 = body.data.find((u: { uid: string }) => u.uid === 'admin-2')
    expect(a1.isSuperAdmin).toBe(true)
    expect(a2.isSuperAdmin).toBe(false)
    expect(a2.allowedOrgIds).toEqual(['org-a', 'org-b'])
  })

  it('rejects restricted admins with 403', async () => {
    mockUser = { uid: 'restricted-1', role: 'admin', allowedOrgIds: ['org-a'] }
    const { GET } = await import('@/app/api/v1/admin/platform-users/route')
    const req = new NextRequest('http://localhost/api/v1/admin/platform-users')
    const res = await GET(req)
    expect(res.status).toBe(403)
  })

  it('rejects clients with 403', async () => {
    mockUser = { uid: 'client-1', role: 'client', orgId: 'org-a' }
    const { GET } = await import('@/app/api/v1/admin/platform-users/route')
    const req = new NextRequest('http://localhost/api/v1/admin/platform-users')
    const res = await GET(req)
    expect(res.status).toBe(403)
  })
})

// ── POST /api/v1/admin/platform-users ───────────────────────────────────────
describe('POST /api/v1/admin/platform-users', () => {
  it('creates a new restricted admin and writes user doc', async () => {
    const { POST } = await import('@/app/api/v1/admin/platform-users/route')
    mockGetUserByEmail.mockRejectedValue({ code: 'auth/user-not-found' })
    mockCreateUser.mockResolvedValue({ uid: 'new-uid' })
    mockUserGet.mockResolvedValue({ exists: false, data: () => undefined })

    const req = new NextRequest('http://localhost/api/v1/admin/platform-users', {
      method: 'POST',
      body: JSON.stringify({
        email: 'jane@partnersinbiz.online',
        name: 'Jane Doe',
        allowedOrgIds: ['org-a', 'org-b', 'org-a'], // dedupe
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = await readJson(res)
    expect(body.data.uid).toBe('new-uid')
    expect(body.data.allowedOrgIds).toEqual(['org-a', 'org-b'])
    expect(body.data.isSuperAdmin).toBe(false)

    // Confirm Firestore write
    expect(mockUserSet).toHaveBeenCalled()
    const setArgs = mockUserSet.mock.calls[0][0]
    expect(setArgs.role).toBe('admin')
    expect(setArgs.allowedOrgIds).toEqual(['org-a', 'org-b'])
    expect(setArgs.orgId).toBe('pib-platform-owner')
  })

  it('creates a super admin when allowedOrgIds is empty', async () => {
    const { POST } = await import('@/app/api/v1/admin/platform-users/route')
    mockGetUserByEmail.mockRejectedValue({ code: 'auth/user-not-found' })
    mockCreateUser.mockResolvedValue({ uid: 'new-uid' })
    mockUserGet.mockResolvedValue({ exists: false, data: () => undefined })

    const req = new NextRequest('http://localhost/api/v1/admin/platform-users', {
      method: 'POST',
      body: JSON.stringify({ email: 'super@x.com', name: 'Super', allowedOrgIds: [] }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = await readJson(res)
    expect(body.data.isSuperAdmin).toBe(true)
    expect(body.data.allowedOrgIds).toEqual([])
  })

  it('refuses to overwrite a non-admin user with the same email', async () => {
    const { POST } = await import('@/app/api/v1/admin/platform-users/route')
    mockGetUserByEmail.mockResolvedValue({ uid: 'existing-uid' })
    mockUserGet.mockResolvedValue({
      exists: true,
      data: () => ({ role: 'client', orgId: 'org-a' }),
    })
    const req = new NextRequest('http://localhost/api/v1/admin/platform-users', {
      method: 'POST',
      body: JSON.stringify({ email: 'jane@x.com', name: 'Jane', allowedOrgIds: ['org-a'] }),
    })
    const res = await POST(req)
    expect(res.status).toBe(409)
  })

  it('returns 400 when email is missing', async () => {
    const { POST } = await import('@/app/api/v1/admin/platform-users/route')
    const req = new NextRequest('http://localhost/api/v1/admin/platform-users', {
      method: 'POST',
      body: JSON.stringify({ name: 'Jane', allowedOrgIds: [] }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('rejects restricted admins (only super admins can create)', async () => {
    mockUser = { uid: 'restricted-1', role: 'admin', allowedOrgIds: ['org-a'] }
    const { POST } = await import('@/app/api/v1/admin/platform-users/route')
    const req = new NextRequest('http://localhost/api/v1/admin/platform-users', {
      method: 'POST',
      body: JSON.stringify({ email: 'jane@x.com', name: 'Jane', allowedOrgIds: ['org-a'] }),
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })
})

// ── PATCH /api/v1/admin/platform-users/[uid] ────────────────────────────────
describe('PATCH /api/v1/admin/platform-users/[uid]', () => {
  it('updates allowedOrgIds for an existing platform admin', async () => {
    const { PATCH } = await import('@/app/api/v1/admin/platform-users/[uid]/route')
    mockUserGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ role: 'admin', email: 'a@x.com', displayName: 'A', allowedOrgIds: [] }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ role: 'admin', email: 'a@x.com', displayName: 'A', allowedOrgIds: ['org-a'] }),
      })
    const req = new NextRequest('http://localhost/api/v1/admin/platform-users/admin-1', {
      method: 'PATCH',
      body: JSON.stringify({ allowedOrgIds: ['org-a'] }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ uid: 'admin-1' }) })
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.data.allowedOrgIds).toEqual(['org-a'])
    expect(body.data.isSuperAdmin).toBe(false)
  })

  it('refuses to restrict the caller\'s own account', async () => {
    const { PATCH } = await import('@/app/api/v1/admin/platform-users/[uid]/route')
    mockUserGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ role: 'admin', email: 'super@x.com', allowedOrgIds: [] }),
    })
    const req = new NextRequest('http://localhost/api/v1/admin/platform-users/super-1', {
      method: 'PATCH',
      body: JSON.stringify({ allowedOrgIds: ['org-a'] }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ uid: 'super-1' }) })
    expect(res.status).toBe(400)
  })

  it('returns 404 when target is not an admin', async () => {
    const { PATCH } = await import('@/app/api/v1/admin/platform-users/[uid]/route')
    mockUserGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ role: 'client', email: 'c@x.com' }),
    })
    const req = new NextRequest('http://localhost/api/v1/admin/platform-users/client-1', {
      method: 'PATCH',
      body: JSON.stringify({ allowedOrgIds: [] }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ uid: 'client-1' }) })
    expect(res.status).toBe(404)
  })
})

// ── POST /api/v1/admin/platform-users/[uid]/reset ───────────────────────────
describe('POST /api/v1/admin/platform-users/[uid]/reset', () => {
  it('creates a wrapped Firebase setup link for a platform admin', async () => {
    const { POST } = await import('@/app/api/v1/admin/platform-users/[uid]/reset/route')
    mockUserGet.mockResolvedValue({
      exists: true,
      data: () => ({ role: 'admin', email: 'admin@example.com' }),
    })

    const req = new NextRequest('http://localhost/api/v1/admin/platform-users/admin-1/reset', {
      method: 'POST',
    })
    const res = await POST(req, { params: Promise.resolve({ uid: 'admin-1' }) })
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(mockGenerateLink).toHaveBeenCalledWith('admin@example.com', {
      url: 'https://partnersinbiz.online/admin',
    })
    expect(body.data.setupLink).toContain('/auth/reset?link=')
  })

  it('rejects non-admin targets', async () => {
    const { POST } = await import('@/app/api/v1/admin/platform-users/[uid]/reset/route')
    mockUserGet.mockResolvedValue({
      exists: true,
      data: () => ({ role: 'client', email: 'client@example.com' }),
    })

    const req = new NextRequest('http://localhost/api/v1/admin/platform-users/client-1/reset', {
      method: 'POST',
    })
    const res = await POST(req, { params: Promise.resolve({ uid: 'client-1' }) })
    expect(res.status).toBe(404)
  })
})

// ── PATCH /api/v1/admin/platform-users/[uid]/password ───────────────────────
describe('PATCH /api/v1/admin/platform-users/[uid]/password', () => {
  it('sets a Firebase password for a platform admin', async () => {
    const { PATCH } = await import('@/app/api/v1/admin/platform-users/[uid]/password/route')
    mockUserGet.mockResolvedValue({
      exists: true,
      data: () => ({ role: 'admin', email: 'admin@example.com' }),
    })

    const req = new NextRequest('http://localhost/api/v1/admin/platform-users/admin-1/password', {
      method: 'PATCH',
      body: JSON.stringify({ password: 'new-password-123' }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ uid: 'admin-1' }) })
    expect(res.status).toBe(200)
    expect(mockUpdateUser).toHaveBeenCalledWith('admin-1', { password: 'new-password-123' })
    expect(mockUserSet).toHaveBeenCalledWith({ updatedAt: 'SERVER_TIMESTAMP' }, { merge: true })
  })

  it('rejects short passwords', async () => {
    const { PATCH } = await import('@/app/api/v1/admin/platform-users/[uid]/password/route')
    const req = new NextRequest('http://localhost/api/v1/admin/platform-users/admin-1/password', {
      method: 'PATCH',
      body: JSON.stringify({ password: 'short' }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ uid: 'admin-1' }) })
    expect(res.status).toBe(400)
  })
})

// ── DELETE /api/v1/admin/platform-users/[uid] ───────────────────────────────
describe('DELETE /api/v1/admin/platform-users/[uid]', () => {
  it('deletes Firebase auth + Firestore doc', async () => {
    const { DELETE } = await import('@/app/api/v1/admin/platform-users/[uid]/route')
    mockUserGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ role: 'admin', email: 'a@x.com' }),
    })
    mockDeleteUser.mockResolvedValue(undefined)

    const req = new NextRequest('http://localhost/api/v1/admin/platform-users/admin-1', {
      method: 'DELETE',
    })
    const res = await DELETE(req, { params: Promise.resolve({ uid: 'admin-1' }) })
    expect(res.status).toBe(200)
    expect(mockDeleteUser).toHaveBeenCalledWith('admin-1')
    expect(mockUserDelete).toHaveBeenCalled()
  })

  it('refuses to delete the caller\'s own account', async () => {
    const { DELETE } = await import('@/app/api/v1/admin/platform-users/[uid]/route')
    const req = new NextRequest('http://localhost/api/v1/admin/platform-users/super-1', {
      method: 'DELETE',
    })
    const res = await DELETE(req, { params: Promise.resolve({ uid: 'super-1' }) })
    expect(res.status).toBe(400)
  })

  it('rejects restricted admin callers with 403', async () => {
    mockUser = { uid: 'restricted-1', role: 'admin', allowedOrgIds: ['org-a'] }
    const { DELETE } = await import('@/app/api/v1/admin/platform-users/[uid]/route')
    const req = new NextRequest('http://localhost/api/v1/admin/platform-users/admin-1', {
      method: 'DELETE',
    })
    const res = await DELETE(req, { params: Promise.resolve({ uid: 'admin-1' }) })
    expect(res.status).toBe(403)
  })
})
