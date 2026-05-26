import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockLimit = jest.fn()
const mockGet = jest.fn()
const mockDoc = jest.fn()
const mockSet = jest.fn()
const mockUpdate = jest.fn()

const mockGetUserByEmail = jest.fn()
const mockCreateUser = jest.fn()
const mockVerifySessionCookie = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
  adminAuth: {
    getUserByEmail: (email: string) => mockGetUserByEmail(email),
    createUser: (input: unknown) => mockCreateUser(input),
    verifySessionCookie: (cookie: string) => mockVerifySessionCookie(cookie),
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
    arrayUnion: jest.fn((...items: unknown[]) => ({ op: 'arrayUnion', items })),
  },
  Timestamp: {
    now: jest.fn(() => 'NOW_TIMESTAMP'),
  },
}))

jest.mock('@/lib/claimable-relationships/store', () => ({
  applyClaimLinks: jest.fn(async () => undefined),
  createPlatformLeadForClaim: jest.fn(async () => ({ companyId: 'pib-company', contactId: 'pib-contact', dealId: 'pib-deal' })),
}))

function queryApi() {
  return { where: mockWhere, limit: mockLimit, get: mockGet, doc: mockDoc }
}

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()

  mockWhere.mockReturnValue(queryApi())
  mockLimit.mockReturnValue(queryApi())
  mockDoc.mockReturnValue({ set: mockSet, update: mockUpdate, get: mockGet })
  mockGet.mockResolvedValue({ empty: true, exists: false, docs: [] })
  mockSet.mockResolvedValue(undefined)
  mockUpdate.mockResolvedValue(undefined)
  mockCreateUser.mockResolvedValue({ uid: 'new-user-1' })
  mockGetUserByEmail.mockRejectedValue({ code: 'auth/user-not-found' })
  mockVerifySessionCookie.mockRejectedValue(new Error('no session'))

  mockCollection.mockImplementation((name: string) => {
    if ([
      'claimable_relationships',
      'organizations',
      'users',
      'orgMembers',
      'invoices',
      'projects',
    ].includes(name)) {
      return queryApi()
    }
    throw new Error(`Unexpected collection: ${name}`)
  })
})

async function readJson(res: Response) {
  return JSON.parse(await res.text())
}

describe('GET /api/v1/public/claims/[claimToken]', () => {
  it('returns a pending claim without authentication', async () => {
    mockGet.mockResolvedValueOnce({
      empty: false,
      docs: [{
        id: 'rel-1',
        data: () => ({
          status: 'pending',
          claimToken: 'claim-token-1',
          sourceOrgId: 'sender-org',
          recipientEmail: 'buyer@example.com',
          recipientCompanyName: 'Buyer Co',
          resourceType: 'invoice',
          resourceId: 'invoice-1',
        }),
      }],
    })
      .mockResolvedValueOnce({
        exists: true,
        id: 'invoice-1',
        data: () => ({
          invoiceNumber: 'INV-001',
          total: 1200,
          currency: 'ZAR',
        }),
      })

    const { GET } = await import('@/app/api/v1/public/claims/[claimToken]/route')
    const res = await GET(
      new NextRequest('http://localhost/api/v1/public/claims/claim-token-1'),
      { params: Promise.resolve({ claimToken: 'claim-token-1' }) },
    )

    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.data).toEqual(expect.objectContaining({
      id: 'rel-1',
      status: 'pending',
      recipientEmail: 'buyer@example.com',
      resourceType: 'invoice',
      resource: expect.objectContaining({
        id: 'invoice-1',
        invoiceNumber: 'INV-001',
        total: 1200,
      }),
    }))
  })
})

describe('POST /api/v1/public/claims/[claimToken]', () => {
  it('creates a recipient org and user, then links the sender CRM relationship', async () => {
    mockGet
      .mockResolvedValueOnce({
        empty: false,
        docs: [{
          id: 'rel-1',
          data: () => ({
            status: 'pending',
            claimToken: 'claim-token-1',
            sourceOrgId: 'sender-org',
            sourceCompanyId: 'company-1',
            sourceContactId: 'contact-1',
            recipientEmail: 'buyer@example.com',
            recipientCompanyName: 'Buyer Co',
            recipientName: 'Buyer One',
            resourceType: 'invoice',
            resourceId: 'invoice-1',
          }),
        }],
      })
      .mockResolvedValueOnce({ exists: false, data: () => undefined })
      .mockResolvedValueOnce({ empty: true, docs: [] })

    const { POST } = await import('@/app/api/v1/public/claims/[claimToken]/route')
    const res = await POST(
      new NextRequest('http://localhost/api/v1/public/claims/claim-token-1', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'buyer@example.com',
          displayName: 'Buyer One',
          businessName: 'Buyer Co',
          password: 'strong-password-123',
        }),
      }),
      { params: Promise.resolve({ claimToken: 'claim-token-1' }) },
    )

    expect(res.status).toBe(200)
    expect(mockCreateUser).toHaveBeenCalledWith({
      email: 'buyer@example.com',
      displayName: 'Buyer One',
      password: 'strong-password-123',
    })
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Buyer Co',
      type: 'client',
      source: 'claimable_relationship',
      createdFromRelationshipId: 'rel-1',
    }), { merge: true })
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      uid: 'new-user-1',
      role: 'client',
      orgIds: expect.arrayContaining([expect.stringMatching(/^claimed-/)]),
    }), { merge: true })

    const relationshipStore = await import('@/lib/claimable-relationships/store')
    expect(relationshipStore.applyClaimLinks).toHaveBeenCalledWith(expect.objectContaining({
      relationshipId: 'rel-1',
      sourceOrgId: 'sender-org',
      sourceCompanyId: 'company-1',
      sourceContactId: 'contact-1',
      targetUserId: 'new-user-1',
      resourceType: 'invoice',
      resourceId: 'invoice-1',
    }))
    expect(relationshipStore.createPlatformLeadForClaim).toHaveBeenCalled()
  })

  it('requires sign-in when the claim email already belongs to an existing user', async () => {
    mockGet.mockResolvedValueOnce({
      empty: false,
      docs: [{
        id: 'rel-1',
        data: () => ({
          status: 'pending',
          claimToken: 'claim-token-1',
          recipientEmail: 'buyer@example.com',
          recipientCompanyName: 'Buyer Co',
          resourceType: 'project',
          resourceId: 'project-1',
        }),
      }],
    })
    mockGetUserByEmail.mockResolvedValue({ uid: 'existing-user-1', email: 'buyer@example.com' })

    const { POST } = await import('@/app/api/v1/public/claims/[claimToken]/route')
    const res = await POST(
      new NextRequest('http://localhost/api/v1/public/claims/claim-token-1', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'buyer@example.com',
          displayName: 'Buyer One',
          businessName: 'Buyer Co',
          password: 'strong-password-123',
        }),
      }),
      { params: Promise.resolve({ claimToken: 'claim-token-1' }) },
    )

    expect(res.status).toBe(409)
    const body = await readJson(res)
    expect(body.requiresSignIn).toBe(true)
    expect(mockCreateUser).not.toHaveBeenCalled()
  })
})
