const mockGet = jest.fn()
const mockCommit = jest.fn().mockResolvedValue(undefined)
const mockBatchUpdate = jest.fn()
const mockBatchSet = jest.fn()
const mockBatchDelete = jest.fn()
const mockBatch = {
  update: mockBatchUpdate,
  set: mockBatchSet,
  delete: mockBatchDelete,
  commit: mockCommit,
}

const mockWhereFn: any = jest.fn()
const mockLimitFn = jest.fn()
const mockDocRef = { id: 'new-doc-id' }
const mockDocFn = jest.fn(() => ({ get: mockGet, ...mockDocRef }))
const mockCollection = jest.fn(() => ({
  doc: mockDocFn,
  where: mockWhereFn,
}))

// Set up where chain: .where().where().where().limit().get() all resolve via mockGet
mockWhereFn.mockReturnValue({
  where: mockWhereFn,
  limit: mockLimitFn,
  get: mockGet,
})
mockLimitFn.mockReturnValue({ get: mockGet })

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    get collection() { return mockCollection },
    get batch() { return () => mockBatch },
  },
}))
jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: any) => (req: any, ctx: any) =>
    handler(req, { uid: 'user-1', role: 'client' }, ctx),
}))
jest.mock('@/lib/api/tenant', () => ({
  withTenant: (handler: any) => (req: any, _user: any, ctx: any) =>
    handler(req, _user, 'org-1', ctx),
}))
jest.mock('@/lib/api/response', () => ({
  apiSuccess: (data: any, status = 200) => ({ json: () => ({ data }), status }),
  apiError: (msg: string, code = 400) => ({ json: () => ({ error: msg }), status: code }),
}))
jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
  Timestamp: { fromDate: jest.fn((d: Date) => d) },
}))

import { GET } from '@/app/api/v1/social/oauth/pending/[nonce]/route'
import { POST } from '@/app/api/v1/social/accounts/confirm/route'

function makeCtx(nonce: string) {
  return { params: Promise.resolve({ nonce }) } as { params: Promise<{ nonce: string }> }
}

describe('GET /api/v1/social/oauth/pending/[nonce]', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 404 when doc does not exist', async () => {
    mockGet.mockResolvedValue({ exists: false })
    const res = await GET({} as any, makeCtx('abc'))
    expect(res.status).toBe(404)
  })

  it('returns 404 when orgId does not match', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        orgId: 'other-org',
        expiresAt: { toDate: () => new Date(Date.now() + 60000) },
        platform: 'linkedin',
        options: [],
      }),
    })
    const res = await GET({} as any, makeCtx('abc'))
    expect(res.status).toBe(404)
  })

  it('returns 404 when expired', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        orgId: 'org-1',
        expiresAt: { toDate: () => new Date(Date.now() - 1000) },
        platform: 'linkedin',
        options: [],
      }),
    })
    const res = await GET({} as any, makeCtx('abc'))
    expect(res.status).toBe(404)
  })

  it('returns 404 when a personal pending selection belongs to another user', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        orgId: 'org-1',
        accountScope: 'personal',
        ownerUid: 'user-2',
        expiresAt: { toDate: () => new Date(Date.now() + 60000) },
        platform: 'linkedin',
        options: [],
      }),
    })
    const res = await GET({} as any, makeCtx('abc'))
    expect(res.status).toBe(404)
  })

  it('returns options without encryptedTokens', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        orgId: 'org-1',
        expiresAt: { toDate: () => new Date(Date.now() + 60000) },
        platform: 'linkedin',
        options: [
          {
            index: 0,
            displayName: 'Peet Stander',
            username: 'peetstander',
            avatarUrl: 'https://example.com/avatar.jpg',
            profileUrl: 'https://linkedin.com/in/peetstander',
            accountType: 'personal',
            platformAccountId: 'li-123456',
            platformMeta: { headline: 'CEO at Partners in Biz' },
            encryptedTokens: { accessToken: 'secret', iv: 'iv', tag: 'tag' },
          },
        ],
      }),
    })
    const res = await GET({} as any, makeCtx('abc'))
    expect(res.status).toBe(200)
    const body = res.json()
    expect(body.data.options[0].encryptedTokens).toBeUndefined()
    expect(body.data.options[0].displayName).toBe('Peet Stander')
    expect(body.data.platform).toBe('linkedin')
    expect(body.data.options[0].username).toBe('peetstander')
    expect(body.data.options[0].avatarUrl).toBe('https://example.com/avatar.jpg')
    expect(body.data.options[0].profileUrl).toBe('https://linkedin.com/in/peetstander')
    expect(body.data.options[0].platformAccountId).toBe('li-123456')
    expect(body.data.options[0].platformMeta).toEqual({ headline: 'CEO at Partners in Biz' })
  })
})

// --- confirm tests ---

const pendingDocData = {
  orgId: 'org-1',
  platform: 'linkedin',
  expiresAt: { toDate: () => new Date(Date.now() + 60000) },
  options: [
    {
      index: 0,
      displayName: 'Peet',
      username: 'peet@test.com',
      avatarUrl: '',
      profileUrl: '',
      accountType: 'personal',
      platformAccountId: 'urn:li:person:abc',
      encryptedTokens: { accessToken: 'enc', refreshToken: null, tokenType: 'Bearer', expiresAt: null, iv: 'iv', tag: 'tag' },
      platformMeta: {},
      scopes: ['openid'],
    },
  ],
}

describe('POST /api/v1/social/accounts/confirm', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCommit.mockResolvedValue(undefined)
    // Re-wire where chain after clearAllMocks
    mockWhereFn.mockReturnValue({
      where: mockWhereFn,
      limit: mockLimitFn,
      get: mockGet,
    })
    mockLimitFn.mockReturnValue({ get: mockGet })
    // Default: pending doc exists
    mockGet.mockResolvedValue({
      exists: true,
      ref: { delete: jest.fn() },
      data: () => pendingDocData,
    })
  })

  it('returns 404 for unknown nonce', async () => {
    mockGet.mockResolvedValue({ exists: false })
    const req = { json: async () => ({ nonce: 'bad', selections: [{ index: 0, isDefault: true }] }) } as any
    const res = await POST(req, undefined as any)
    expect(res.status).toBe(404)
  })

  it('returns 400 when selections is empty', async () => {
    const req = { json: async () => ({ nonce: 'nonce-1', selections: [] }) } as any
    const res = await POST(req, undefined as any)
    expect(res.status).toBe(400)
  })

  it('returns 400 when more than one isDefault selection', async () => {
    // For this test, where queries return empty docs so batch doesn't error
    mockGet
      .mockResolvedValueOnce({
        exists: true,
        ref: { delete: jest.fn() },
        data: () => pendingDocData,
      })
      .mockResolvedValue({ docs: [] })
    const req = {
      json: async () => ({
        nonce: 'nonce-1',
        selections: [
          { index: 0, isDefault: true },
          { index: 0, isDefault: true },
        ],
      }),
    } as any
    const res = await POST(req, undefined as any)
    expect(res.status).toBe(400)
  })

  it('returns 201 with accountIds on valid selection', async () => {
    // Universal result satisfies all get() call shapes in the confirm route
    const universalResult = {
      exists: true,
      empty: true,
      docs: [],
      ref: { delete: jest.fn() },
      data: () => pendingDocData,
    }
    mockGet.mockResolvedValue(universalResult)

    const req = {
      json: async () => ({
        nonce: 'nonce-1',
        selections: [{ index: 0, isDefault: true }],
      }),
    } as any
    const res = await POST(req, undefined as any)
    expect(res.status).toBe(201)
    const body = res.json()
    expect(Array.isArray(body.data.accountIds)).toBe(true)
    expect(body.data.accountIds.length).toBeGreaterThan(0)
  })

  it('does not update a personal account when confirming an org/company selection with the same platform account id', async () => {
    const personalRef = { id: 'personal-ref' }
    const orgRef = { id: 'org-ref' }
    mockGet
      .mockResolvedValueOnce({
        exists: true,
        ref: { delete: jest.fn() },
        data: () => pendingDocData,
      })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({
        docs: [
          { id: 'personal-account', ref: personalRef, data: () => ({ accountScope: 'personal', ownerUid: 'user-1' }) },
          { id: 'org-account', ref: orgRef, data: () => ({ accountScope: 'org', ownerUid: null }) },
        ],
      })

    const req = {
      json: async () => ({ nonce: 'nonce-1', selections: [{ index: 0, isDefault: true }] }),
    } as any
    const res = await POST(req, undefined as any)

    expect(res.status).toBe(201)
    expect(mockLimitFn).toHaveBeenCalledWith(10)
    expect(mockBatchUpdate).toHaveBeenCalledWith(orgRef, expect.objectContaining({
      accountScope: 'org',
      ownerUid: null,
    }))
    expect(mockBatchUpdate).not.toHaveBeenCalledWith(personalRef, expect.anything())
  })
})
