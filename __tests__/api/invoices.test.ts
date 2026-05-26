import { NextRequest } from 'next/server'

type MockUser = { uid: string; role: 'admin' | 'client'; orgId?: string; allowedOrgIds?: string[] }
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

const mockCollection = jest.fn()
const mockInvoiceWhere = jest.fn()
const mockInvoiceOrderBy = jest.fn()
const mockInvoiceLimit = jest.fn()
const mockInvoiceGet = jest.fn()
const mockInvoiceAdd = jest.fn()
const mockInvoiceDoc = jest.fn()
const mockInvoiceUpdate = jest.fn()
const mockUserDoc = jest.fn()
const mockUserGet = jest.fn()
const mockOrgDoc = jest.fn()
const mockClientOrgGet = jest.fn()
const mockOrgWhere = jest.fn()
const mockOrgLimit = jest.fn()
const mockPlatformOrgGet = jest.fn()
const mockCompanyDoc = jest.fn()
const mockCompanyGet = jest.fn()
const mockContactDoc = jest.fn()
const mockContactGet = jest.fn()
const mockEnsureClaimableRelationship = jest.fn()

let mockUser: MockUser = { uid: 'admin-1', role: 'admin' }

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => async (req: NextRequest, ctx?: unknown) =>
    handler(req, mockUser, ctx),
}))

jest.mock('@/lib/invoices/invoice-number', () => ({
  generateInvoiceNumber: jest.fn(async () => 'INV-001'),
}))

jest.mock('@/lib/webhooks/dispatch', () => ({
  dispatchWebhook: jest.fn(),
}))

jest.mock('@/lib/claimable-relationships/store', () => ({
  ensureClaimableRelationship: (input: unknown) => mockEnsureClaimableRelationship(input),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  },
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockUser = { uid: 'admin-1', role: 'admin' }

  const invoiceQuery = {
    where: mockInvoiceWhere,
    orderBy: mockInvoiceOrderBy,
    limit: mockInvoiceLimit,
    get: mockInvoiceGet,
    add: mockInvoiceAdd,
    doc: mockInvoiceDoc,
  }
  const orgQuery = {
    limit: mockOrgLimit,
    get: mockPlatformOrgGet,
  }

  mockInvoiceWhere.mockReturnValue(invoiceQuery)
  mockInvoiceOrderBy.mockReturnValue(invoiceQuery)
  mockInvoiceLimit.mockReturnValue(invoiceQuery)
  mockInvoiceAdd.mockResolvedValue({ id: 'invoice-1' })
  mockInvoiceDoc.mockReturnValue({ update: mockInvoiceUpdate })
  mockInvoiceUpdate.mockResolvedValue(undefined)
  mockUserDoc.mockReturnValue({ get: mockUserGet })
  mockOrgDoc.mockReturnValue({ get: mockClientOrgGet })
  mockOrgWhere.mockReturnValue(orgQuery)
  mockOrgLimit.mockReturnValue(orgQuery)
  mockPlatformOrgGet.mockResolvedValue({ empty: true, docs: [] })
  mockCompanyDoc.mockReturnValue({ get: mockCompanyGet })
  mockContactDoc.mockReturnValue({ get: mockContactGet })
  mockCompanyGet.mockResolvedValue({ exists: false, data: () => undefined })
  mockContactGet.mockResolvedValue({ exists: false, data: () => undefined })
  mockEnsureClaimableRelationship.mockResolvedValue({
    id: 'relationship-1',
    claimToken: 'claim-token-1',
    targetOrgId: undefined,
    targetUserId: undefined,
    status: 'pending',
  })

  mockCollection.mockImplementation((name: string) => {
    if (name === 'invoices') return invoiceQuery
    if (name === 'users') return { doc: mockUserDoc }
    if (name === 'organizations') return { doc: mockOrgDoc, where: mockOrgWhere }
    if (name === 'companies') return { doc: mockCompanyDoc }
    if (name === 'contacts') return { doc: mockContactDoc }
    throw new Error(`Unexpected collection: ${name}`)
  })
})

function hasUndefined(value: unknown): boolean {
  if (value === undefined) return true
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some((item) => hasUndefined(item))
  return Object.values(value).some((item) => hasUndefined(item))
}

describe('GET /api/v1/invoices', () => {
  it('lists org-scoped invoices without requiring a Firestore composite index', async () => {
    mockInvoiceGet.mockResolvedValue({
      docs: [
        { id: 'old', data: () => ({ invoiceNumber: 'OLD-001', createdAt: { seconds: 10 } }) },
        { id: 'new', data: () => ({ invoiceNumber: 'NEW-001', createdAt: { seconds: 20 } }) },
      ],
    })

    const { GET } = await import('@/app/api/v1/invoices/route')
    const req = new NextRequest('http://localhost/api/v1/invoices?orgId=org-1')
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(mockInvoiceWhere).toHaveBeenCalledWith('orgId', '==', 'org-1')
    expect(mockInvoiceOrderBy).not.toHaveBeenCalled()
    expect(mockInvoiceLimit).not.toHaveBeenCalled()

    const body = await res.json()
    expect(body.data.map((invoice: { id: string }) => invoice.id)).toEqual(['new', 'old'])
  })

  it('lists billing-org-scoped invoices without requiring a Firestore composite index', async () => {
    mockInvoiceGet.mockResolvedValue({
      docs: [
        { id: 'old', data: () => ({ invoiceNumber: 'OLD-001', createdAt: { _seconds: 10 } }) },
        { id: 'new', data: () => ({ invoiceNumber: 'NEW-001', createdAt: { _seconds: 20 } }) },
      ],
    })

    const { GET } = await import('@/app/api/v1/invoices/route')
    const req = new NextRequest('http://localhost/api/v1/invoices?billingOrgId=pib-platform-owner')
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(mockInvoiceWhere).toHaveBeenCalledWith('billingOrgId', '==', 'pib-platform-owner')
    expect(mockInvoiceOrderBy).not.toHaveBeenCalled()
    expect(mockInvoiceLimit).not.toHaveBeenCalled()

    const body = await res.json()
    expect(body.data.map((invoice: { id: string }) => invoice.id)).toEqual(['new', 'old'])
  })

  it('keeps combined org and billing filters index-free by applying billingOrgId in memory', async () => {
    mockInvoiceGet.mockResolvedValue({
      docs: [
        {
          id: 'wrong-biller',
          data: () => ({
            billingOrgId: 'other-platform',
            invoiceNumber: 'OLD-001',
            createdAt: { seconds: 30 },
          }),
        },
        {
          id: 'right-biller',
          data: () => ({
            billingOrgId: 'pib-platform-owner',
            invoiceNumber: 'NEW-001',
            createdAt: { seconds: 20 },
          }),
        },
      ],
    })

    const { GET } = await import('@/app/api/v1/invoices/route')
    const req = new NextRequest(
      'http://localhost/api/v1/invoices?orgId=org-1&billingOrgId=pib-platform-owner',
    )
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(mockInvoiceWhere).toHaveBeenCalledTimes(1)
    expect(mockInvoiceWhere).toHaveBeenCalledWith('orgId', '==', 'org-1')
    expect(mockInvoiceOrderBy).not.toHaveBeenCalled()

    const body = await res.json()
    expect(body.data.map((invoice: { id: string }) => invoice.id)).toEqual(['right-biller'])
  })

  it('limits restricted admins to assigned org invoices when no org filter is provided', async () => {
    mockUser = { uid: 'admin-1', role: 'admin', allowedOrgIds: ['org-1'] }
    mockInvoiceGet.mockResolvedValue({
      docs: [
        { id: 'allowed', data: () => ({ orgId: 'org-1', invoiceNumber: 'INV-001', createdAt: { seconds: 20 } }) },
      ],
    })

    const { GET } = await import('@/app/api/v1/invoices/route')
    const req = new NextRequest('http://localhost/api/v1/invoices')
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(mockInvoiceWhere).toHaveBeenCalledWith('orgId', 'in', ['org-1'])
    const body = await res.json()
    expect(body.data.map((invoice: { id: string }) => invoice.id)).toEqual(['allowed'])
  })

  it('rejects restricted admins when they request an unassigned org', async () => {
    mockUser = { uid: 'admin-1', role: 'admin', allowedOrgIds: ['org-1'] }

    const { GET } = await import('@/app/api/v1/invoices/route')
    const req = new NextRequest('http://localhost/api/v1/invoices?orgId=org-2')
    const res = await GET(req)

    expect(res.status).toBe(403)
    expect(mockInvoiceGet).not.toHaveBeenCalled()
  })

  it('lists received invoices for the signed-in client org', async () => {
    mockUser = { uid: 'client-1', role: 'client', orgId: 'recipient-org' }
    mockInvoiceGet.mockResolvedValue({
      docs: [
        { id: 'received', data: () => ({ recipientOrgId: 'recipient-org', invoiceNumber: 'INV-001', createdAt: { seconds: 20 } }) },
      ],
    })

    const { GET } = await import('@/app/api/v1/invoices/route')
    const req = new NextRequest('http://localhost/api/v1/invoices?view=received')
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(mockInvoiceWhere).toHaveBeenCalledWith('recipientOrgId', '==', 'recipient-org')
    const body = await res.json()
    expect(body.data.map((invoice: { id: string }) => invoice.id)).toEqual(['received'])
  })
})

describe('POST /api/v1/invoices', () => {
  it('strips undefined billing snapshot fields before writing to Firestore', async () => {
    mockOrgDoc.mockImplementation((orgId: string) => ({
      get: orgId === 'pib-platform-owner'
        ? jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({
              name: 'Partners in Biz',
            }),
          })
        : mockClientOrgGet,
    }))
    mockClientOrgGet.mockResolvedValue({
      exists: true,
      data: () => ({
        name: 'Bare Client',
        settings: { currency: 'ZAR' },
      }),
    })
    mockPlatformOrgGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'pib-platform-owner',
          data: () => ({
            name: 'Partners in Biz',
          }),
        },
      ],
    })

    const { POST } = await import('@/app/api/v1/invoices/route')
    const req = new NextRequest('http://localhost/api/v1/invoices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orgId: 'org-1',
        taxRate: 0,
        lineItems: [
          { description: 'Monthly hosting', quantity: 1, unitPrice: 650 },
        ],
      }),
    })

    const res = await POST(req)

    expect(res.status).toBe(201)
    const writtenInvoice = mockInvoiceAdd.mock.calls[0][0]
    expect(hasUndefined(writtenInvoice)).toBe(false)
    expect(writtenInvoice.fromDetails).toEqual({ companyName: 'Partners in Biz' })
    expect(writtenInvoice.clientDetails).toEqual({ name: 'Bare Client' })
  })

  it('rejects restricted admins creating invoices for unassigned orgs', async () => {
    mockUser = { uid: 'admin-1', role: 'admin', allowedOrgIds: ['org-1'] }

    const { POST } = await import('@/app/api/v1/invoices/route')
    const req = new NextRequest('http://localhost/api/v1/invoices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orgId: 'org-2',
        lineItems: [{ description: 'Hosting', quantity: 1, unitPrice: 650 }],
      }),
    })

    const res = await POST(req)

    expect(res.status).toBe(403)
    expect(mockClientOrgGet).not.toHaveBeenCalled()
    expect(mockInvoiceAdd).not.toHaveBeenCalled()
  })

  it('creates a CRM-targeted invoice with a claimable relationship', async () => {
    mockClientOrgGet.mockResolvedValue({
      exists: true,
      data: () => ({
        name: 'Sender Org',
        billingEmail: 'billing@sender.test',
        settings: { currency: 'ZAR' },
      }),
    })
    mockPlatformOrgGet.mockResolvedValue({ empty: true, docs: [] })
    mockCompanyGet.mockResolvedValue({
      exists: true,
      data: () => ({
        orgId: 'sender-org',
        name: 'Buyer Co',
        linkedOrgId: 'recipient-org',
      }),
    })
    mockContactGet.mockResolvedValue({
      exists: true,
      data: () => ({
        orgId: 'sender-org',
        name: 'Buyer One',
        email: 'Buyer@Example.com',
        linkedUserId: 'recipient-user',
      }),
    })
    mockEnsureClaimableRelationship.mockResolvedValue({
      id: 'relationship-1',
      claimToken: 'claim-token-1',
      targetOrgId: 'recipient-org',
      targetUserId: 'recipient-user',
      status: 'claimed',
    })

    const { POST } = await import('@/app/api/v1/invoices/route')
    const req = new NextRequest('http://localhost/api/v1/invoices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orgId: 'sender-org',
        companyId: 'company-1',
        contactId: 'contact-1',
        lineItems: [{ description: 'Consulting', quantity: 2, unitPrice: 500 }],
      }),
    })

    const res = await POST(req)

    expect(res.status).toBe(201)
    expect(mockEnsureClaimableRelationship).toHaveBeenCalledWith(expect.objectContaining({
      sourceOrgId: 'sender-org',
      sourceCompanyId: 'company-1',
      sourceContactId: 'contact-1',
      recipientEmail: 'buyer@example.com',
      recipientName: 'Buyer One',
      recipientCompanyName: 'Buyer Co',
      resourceType: 'invoice',
      resourceId: 'invoice-1',
    }))
    expect(mockInvoiceAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'sender-org',
      sourceOrgId: 'sender-org',
      issuerOrgId: 'sender-org',
      sourceCompanyId: 'company-1',
      sourceContactId: 'contact-1',
      recipientEmail: 'buyer@example.com',
      recipientCompanyName: 'Buyer Co',
      recipientOrgId: 'recipient-org',
      claimStatus: 'claimed',
    }))
    expect(mockInvoiceUpdate).toHaveBeenCalledWith(expect.objectContaining({
      claimableRelationshipId: 'relationship-1',
      claimToken: 'claim-token-1',
      claimStatus: 'claimed',
      recipientOrgId: 'recipient-org',
      recipientUserId: 'recipient-user',
    }))
    const body = await res.json()
    expect(body.data).toEqual(expect.objectContaining({
      id: 'invoice-1',
      claimToken: 'claim-token-1',
      claimStatus: 'claimed',
    }))
  })
})
