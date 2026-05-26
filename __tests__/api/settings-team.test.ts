import { NextRequest } from 'next/server'

const mockGet = jest.fn()
const mockSet = jest.fn()
const mockUpdate = jest.fn()
const mockDelete = jest.fn()
const mockDoc = jest.fn()
const mockWhere = jest.fn()
const mockCollection = jest.fn()
const mockBatch = jest.fn()
const mockBatchSet = jest.fn()
const mockBatchUpdate = jest.fn()
const mockBatchDelete = jest.fn()
const mockBatchCommit = jest.fn()

type MockPortalRoleHandler = (
  req: NextRequest,
  uid: string,
  orgId: string,
  role: string,
  ...args: unknown[]
) => Promise<Response> | Response

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
    batch: mockBatch,
  },
  adminAuth: {
    createUser: jest.fn(),
    getUserByEmail: jest.fn(),
    generatePasswordResetLink: jest.fn(),
  },
}))
jest.mock('@/lib/auth/portal-middleware', () => ({
  withPortalAuthAndRole: (_minRole: string, handler: MockPortalRoleHandler) =>
    (req: NextRequest, ...args: unknown[]) => handler(req, 'uid-owner', 'org-1', 'owner', ...args),
}))
jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => 'SERVER_TS',
    arrayUnion: (v: unknown) => ({ type: 'arrayUnion', v }),
    arrayRemove: (v: unknown) => ({ type: 'arrayRemove', v }),
  },
}))

beforeEach(() => {
  jest.clearAllMocks()
  const batchObj = { set: mockBatchSet, update: mockBatchUpdate, delete: mockBatchDelete, commit: mockBatchCommit }
  mockBatch.mockReturnValue(batchObj)
  mockBatchCommit.mockResolvedValue(undefined)
  mockDoc.mockReturnValue({ get: mockGet, set: mockSet, update: mockUpdate, delete: mockDelete })
  const queryObj = { where: mockWhere, get: mockGet }
  mockWhere.mockReturnValue(queryObj)
  mockCollection.mockReturnValue({ doc: mockDoc, where: mockWhere })
})

describe('GET /api/v1/portal/settings/team', () => {
  it('returns canonical organization members for the active org', async () => {
    mockGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          members: [
            { userId: 'uid-owner', role: 'owner' },
          ],
        }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ firstName: 'Peet', lastName: 'Stander', jobTitle: 'Founder', avatarUrl: '' }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ displayName: 'Peet Stander', photoURL: '' }),
      })

    const { GET } = await import('@/app/api/v1/portal/settings/team/route')
    const req = new NextRequest('http://localhost/api/v1/portal/settings/team', {
      headers: { Cookie: '__session=valid' },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.members).toHaveLength(1)
    expect(body.members[0].uid).toBe('uid-owner')
    expect(body.members[0].firstName).toBe('Peet')
    expect(body.members[0].role).toBe('owner')
    expect(mockWhere).not.toHaveBeenCalled()
  })

  it('falls back to orgMembers when organization members are missing', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ members: [] }),
    })
    mockGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'org-1_uid-1',
          data: () => ({ uid: 'uid-1', firstName: 'Peet', lastName: 'Stander', jobTitle: 'CEO', role: 'owner', avatarUrl: '' }),
        },
      ],
    })
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ displayName: 'Peet Stander', photoURL: '' }),
    })

    const { GET } = await import('@/app/api/v1/portal/settings/team/route')
    const req = new NextRequest('http://localhost/api/v1/portal/settings/team', {
      headers: { Cookie: '__session=valid' },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.members).toHaveLength(1)
    expect(body.members[0].firstName).toBe('Peet')
    expect(body.members[0].role).toBe('owner')
  })
})

describe('DELETE /api/v1/portal/settings/team/[uid]', () => {
  it('removes the member and returns success', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ members: [{ userId: 'uid-target', role: 'member' }] }),
    })
    mockBatchCommit.mockResolvedValue(undefined)

    const { DELETE } = await import('@/app/api/v1/portal/settings/team/[uid]/route')
    const req = new NextRequest('http://localhost/api/v1/portal/settings/team/uid-target', {
      method: 'DELETE',
      headers: { Cookie: '__session=valid' },
    })
    const res = await DELETE(req, { params: Promise.resolve({ uid: 'uid-target' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.removed).toBe('uid-target')
  })

  it('prevents removing self', async () => {
    const { DELETE } = await import('@/app/api/v1/portal/settings/team/[uid]/route')
    const req = new NextRequest('http://localhost/api/v1/portal/settings/team/uid-owner', {
      method: 'DELETE',
      headers: { Cookie: '__session=valid' },
    })
    const res = await DELETE(req, { params: Promise.resolve({ uid: 'uid-owner' }) })
    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/v1/portal/settings/team/[uid]/role', () => {
  it('updates the member role in orgMembers and org.members array', async () => {
    // First get: targetMemberDoc (non-owner, so check passes)
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ role: 'member' }),
    })
    // Second get: orgDoc for updating members array
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ members: [{ userId: 'uid-target', role: 'member' }] }),
    })
    mockSet.mockResolvedValue(undefined)
    mockUpdate.mockResolvedValue(undefined)

    const { PATCH } = await import('@/app/api/v1/portal/settings/team/[uid]/role/route')
    const req = new NextRequest('http://localhost/api/v1/portal/settings/team/uid-target/role', {
      method: 'PATCH',
      headers: { Cookie: '__session=valid', 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ uid: 'uid-target' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.role).toBe('admin')
  })

  it('returns 400 for invalid role', async () => {
    const { PATCH } = await import('@/app/api/v1/portal/settings/team/[uid]/role/route')
    const req = new NextRequest('http://localhost/api/v1/portal/settings/team/uid-target/role', {
      method: 'PATCH',
      headers: { Cookie: '__session=valid', 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'superadmin' }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ uid: 'uid-target' }) })
    expect(res.status).toBe(400)
  })
})
