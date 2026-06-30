import { NextRequest } from 'next/server'

const mockDocs: Array<{ id: string; data: Record<string, unknown> }> = []
const mockAdd = jest.fn(async () => ({ id: 'new-doc-id' }))
const mockDocGet = jest.fn()
const mockWhere = jest.fn()
const mockGet = jest.fn(async () => ({
  docs: mockDocs.map((doc) => ({
    id: doc.id,
    data: () => doc.data,
  })),
}))
const mockCollection = jest.fn((name: string) => ({
  add: mockAdd,
  doc: jest.fn(() => ({ get: mockDocGet })),
  where: mockWhere,
  get: mockGet,
  _name: name,
}))

mockWhere.mockReturnValue({
  where: mockWhere,
  get: mockGet,
})

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: any) => (req: NextRequest, ctx?: unknown) =>
    handler(req, { uid: 'user-1', role: 'client', orgId: 'org-1' }, ctx),
}))

jest.mock('@/lib/api/tenant', () => ({
  withTenant: (handler: any) => (req: NextRequest, user: any, ctx?: unknown) =>
    handler(req, user, 'org-1', ctx),
}))

jest.mock('@/lib/social/audit', () => ({
  logAudit: jest.fn(async () => undefined),
}))

jest.mock('@/lib/activity/log', () => ({
  logActivity: jest.fn(async () => undefined),
}))

jest.mock('@/lib/notifications/notify', () => ({
  notifyApprovalNeeded: jest.fn(async () => undefined),
}))

jest.mock('@/lib/social/validation', () => ({
  validatePostContent: jest.fn(() => ({ valid: true, errors: [] })),
}))

jest.mock('@/lib/social/approval', () => ({
  emptyApprovalState: jest.fn(() => ({})),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
  Timestamp: {
    fromDate: jest.fn((date: Date) => ({ seconds: Math.floor(date.getTime() / 1000), toDate: () => date })),
  },
}))

describe('personal social account scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDocs.length = 0
    mockWhere.mockReturnValue({
      where: mockWhere,
      get: mockGet,
    })
    mockGet.mockImplementation(async () => ({
      docs: mockDocs.map((doc) => ({
        id: doc.id,
        data: () => doc.data,
      })),
    }))
    mockAdd.mockResolvedValue({ id: 'new-doc-id' })
    mockDocGet.mockResolvedValue({ exists: false, data: () => undefined })
  })

  it('keeps personal accounts out of the default organisation account list', async () => {
    mockDocs.push(
      { id: 'org-account', data: { orgId: 'org-1', platform: 'linkedin', displayName: 'Company Page', status: 'active' } },
      { id: 'personal-account', data: { orgId: 'org-1', ownerUid: 'user-1', accountScope: 'personal', platform: 'linkedin', displayName: 'Peet Personal', status: 'active' } },
    )

    const { GET } = await import('@/app/api/v1/social/accounts/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/social/accounts'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.map((account: { id: string }) => account.id)).toEqual(['org-account'])
  })

  it('lists only the current user personal accounts for scope=personal', async () => {
    mockDocs.push(
      { id: 'own-personal', data: { orgId: 'org-1', ownerUid: 'user-1', accountScope: 'personal', platform: 'linkedin', displayName: 'Own Personal', status: 'active' } },
      { id: 'other-personal', data: { orgId: 'org-1', ownerUid: 'user-2', accountScope: 'personal', platform: 'linkedin', displayName: 'Other Personal', status: 'active' } },
      { id: 'org-account', data: { orgId: 'org-1', platform: 'linkedin', displayName: 'Company Page', status: 'active' } },
    )

    const { GET } = await import('@/app/api/v1/social/accounts/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/social/accounts?scope=personal'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.map((account: { id: string }) => account.id)).toEqual(['own-personal'])
  })

  it('writes owner fields when creating a personal account', async () => {
    const { POST } = await import('@/app/api/v1/social/accounts/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/social/accounts?scope=personal', {
      method: 'POST',
      body: JSON.stringify({
        platform: 'bluesky',
        displayName: 'Peet Personal',
        username: 'peet.bsky.social',
      }),
    }))

    expect(res.status).toBe(201)
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      ownerUid: 'user-1',
      accountScope: 'personal',
      displayName: 'Peet Personal',
    }))
  })
})

describe('personal social post scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDocs.length = 0
    mockWhere.mockReturnValue({
      where: mockWhere,
      get: mockGet,
    })
    mockGet.mockResolvedValue({ docs: [] })
    mockAdd.mockResolvedValue({ id: 'new-post-id' })
  })

  it('rejects personal posts that select an account owned by another user', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        orgId: 'org-1',
        ownerUid: 'user-2',
        accountScope: 'personal',
        platform: 'linkedin',
        status: 'active',
      }),
    })

    const { POST } = await import('@/app/api/v1/social/posts/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/social/posts?scope=personal', {
      method: 'POST',
      body: JSON.stringify({
        content: { text: 'Personal update' },
        platforms: ['linkedin'],
        accountIds: ['other-account'],
        status: 'draft',
      }),
    }))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/personal account/i)
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('writes owner fields when creating a personal post', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        orgId: 'org-1',
        ownerUid: 'user-1',
        accountScope: 'personal',
        platform: 'linkedin',
        status: 'active',
      }),
    })

    const { POST } = await import('@/app/api/v1/social/posts/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/social/posts?scope=personal', {
      method: 'POST',
      body: JSON.stringify({
        content: { text: 'Personal update' },
        platforms: ['linkedin'],
        accountIds: ['own-account'],
        status: 'draft',
      }),
    }))

    expect(res.status).toBe(201)
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      ownerUid: 'user-1',
      accountScope: 'personal',
      accountIds: ['own-account'],
    }))
  })
})


describe('personal social vault scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDocs.length = 0
    mockWhere.mockReturnValue({
      where: mockWhere,
      get: mockGet,
    })
    mockGet.mockImplementation(async () => ({
      docs: mockDocs.map((doc) => ({
        id: doc.id,
        data: () => doc.data,
      })),
    }))
  })

  it('keeps personal vault posts out of the default organisation vault', async () => {
    mockDocs.push(
      { id: 'org-vault-post', data: { orgId: 'org-1', status: 'approved', content: { text: 'Company' } } },
      { id: 'personal-vault-post', data: { orgId: 'org-1', ownerUid: 'user-1', accountScope: 'personal', status: 'approved', content: { text: 'Personal' } } },
    )

    const { GET } = await import('@/app/api/v1/social/vault/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/social/vault'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.map((post: { id: string }) => post.id)).toEqual(['org-vault-post'])
  })

  it('lists only the current user vault posts for scope=personal', async () => {
    mockDocs.push(
      { id: 'own-personal-vault-post', data: { orgId: 'org-1', ownerUid: 'user-1', accountScope: 'personal', status: 'approved', content: { text: 'Own personal' } } },
      { id: 'other-personal-vault-post', data: { orgId: 'org-1', ownerUid: 'user-2', accountScope: 'personal', status: 'approved', content: { text: 'Other personal' } } },
      { id: 'org-vault-post', data: { orgId: 'org-1', status: 'approved', content: { text: 'Company' } } },
    )

    const { GET } = await import('@/app/api/v1/social/vault/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/social/vault?scope=personal'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.map((post: { id: string }) => post.id)).toEqual(['own-personal-vault-post'])
  })
})
