import { NextRequest } from 'next/server'

const mockUserGet = jest.fn()
const mockUserUpdate = jest.fn()
const mockUserDoc = jest.fn()
const mockMemberWhere = jest.fn()
const mockMemberGet = jest.fn()
const mockOrgDoc = jest.fn()
const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/auth/portal-middleware', () => ({
  withPortalAuth:
    (handler: (req: NextRequest, uid: string) => Promise<Response>) =>
      (req: NextRequest) => handler(req, 'admin-1'),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockUserDoc.mockReturnValue({ get: mockUserGet, update: mockUserUpdate })
  mockMemberWhere.mockReturnValue({ get: mockMemberGet })
  mockOrgDoc.mockImplementation((orgId: string) => ({
    get: jest.fn().mockResolvedValue({
      exists: orgId === 'client-org' || orgId === 'pib-platform-owner',
      data: () => ({ deleted: false }),
    }),
  }))
  mockCollection.mockImplementation((name: string) => {
    if (name === 'users') return { doc: mockUserDoc }
    if (name === 'orgMembers') return { where: mockMemberWhere }
    if (name === 'organizations') return { doc: mockOrgDoc }
    throw new Error(`Unexpected collection: ${name}`)
  })
})

function memberDocs(orgIds: string[]) {
  return orgIds.map((orgId) => ({
    id: `${orgId}_admin-1`,
    data: () => ({ orgId, uid: 'admin-1' }),
  }))
}

describe('/api/v1/portal/active-org', () => {
  it('resolves an admin active portal org from explicit orgMembers access', async () => {
    mockUserGet.mockResolvedValue({
      exists: true,
      data: () => ({ role: 'admin', orgId: 'pib-platform-owner', activeOrgId: 'client-org' }),
    })
    mockMemberGet.mockResolvedValue({ docs: memberDocs(['client-org']) })

    const { GET } = await import('@/app/api/v1/portal/active-org/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/portal/active-org'))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ orgId: 'client-org' })
    expect(mockMemberWhere).toHaveBeenCalledWith('uid', '==', 'admin-1')
  })

  it('lets an admin switch into a client org only when they are an org member', async () => {
    mockUserGet.mockResolvedValue({
      exists: true,
      data: () => ({ role: 'admin', orgId: 'pib-platform-owner' }),
    })
    mockMemberGet.mockResolvedValue({ docs: memberDocs(['client-org']) })
    mockUserUpdate.mockResolvedValue(undefined)

    const { POST } = await import('@/app/api/v1/portal/active-org/route')
    const req = new NextRequest('http://localhost/api/v1/portal/active-org', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'client-org' }),
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(mockUserUpdate).toHaveBeenCalledWith({
      activeOrgId: 'client-org',
      updatedAt: 'SERVER_TS',
    })
  })

  it('lets a platform admin switch into a linked company client org even without orgMembers membership', async () => {
    mockUserGet.mockResolvedValue({
      exists: true,
      data: () => ({
        role: 'admin',
        orgId: 'pib-platform-owner',
      }),
    })
    mockMemberGet.mockResolvedValue({ docs: [] })

    const { POST } = await import('@/app/api/v1/portal/active-org/route')
    const req = new NextRequest('http://localhost/api/v1/portal/active-org', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'client-org' }),
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(mockUserUpdate).toHaveBeenCalledWith({
      activeOrgId: 'client-org',
      updatedAt: 'SERVER_TS',
    })
  })

  it('keeps a CRM-selected client org active for admin portal pages without query params', async () => {
    mockUserGet.mockResolvedValue({
      exists: true,
      data: () => ({
        role: 'admin',
        orgId: 'pib-platform-owner',
        activeOrgId: 'client-org',
      }),
    })
    mockMemberGet.mockResolvedValue({ docs: [] })

    const { GET } = await import('@/app/api/v1/portal/active-org/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/portal/active-org'))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ orgId: 'client-org' })
  })

  it('does not treat allowedOrgIds as client portal membership for non-admin users', async () => {
    mockUserGet.mockResolvedValue({
      exists: true,
      data: () => ({
        role: 'client',
        orgId: 'pib-platform-owner',
        allowedOrgIds: ['client-org'],
      }),
    })
    mockMemberGet.mockResolvedValue({ docs: [] })

    const { POST } = await import('@/app/api/v1/portal/active-org/route')
    const req = new NextRequest('http://localhost/api/v1/portal/active-org', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'client-org' }),
    })
    const res = await POST(req)

    expect(res.status).toBe(403)
    expect(mockUserUpdate).not.toHaveBeenCalled()
  })

  it('allows an admin to use the platform-owner org as the PiB workspace', async () => {
    mockUserGet.mockResolvedValue({
      exists: true,
      data: () => ({ role: 'admin', orgId: 'pib-platform-owner' }),
    })
    mockMemberGet.mockResolvedValue({ docs: memberDocs(['pib-platform-owner', 'client-org']) })

    const { GET } = await import('@/app/api/v1/portal/active-org/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/portal/active-org'))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ orgId: 'pib-platform-owner' })
  })
})
