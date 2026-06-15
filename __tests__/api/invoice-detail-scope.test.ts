import { NextRequest } from 'next/server'

type MockUser = {
  uid: string
  role: 'admin' | 'client' | 'ai'
  orgId?: string
  activeOrgId?: string
  orgIds?: string[]
  allowedOrgIds?: string[]
}

type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

const mockCollection = jest.fn()
const mockInvoiceGet = jest.fn()
const mockInvoiceUpdate = jest.fn()
const mockLogActivity = jest.fn(() => Promise.resolve())
const mockNotifyInvoiceSent = jest.fn(() => Promise.resolve())
let mockUser: MockUser

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string | string[], handler: MockHandler) => (req: NextRequest, ctx?: unknown) =>
    handler(req, mockUser, ctx),
}))

jest.mock('@/lib/notifications/notify', () => ({
  notifyInvoiceSent: () => mockNotifyInvoiceSent(),
}))

jest.mock('@/lib/activity/log', () => ({
  logActivity: () => mockLogActivity(),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}))

function invoiceSnap(data: Record<string, unknown>) {
  return {
    exists: true,
    id: 'course-invoice-1',
    data: () => data,
  }
}

function routeCtx(id = 'course-invoice-1') {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  mockUser = {
    uid: 'client-1',
    role: 'client',
    orgId: 'home-org',
    activeOrgId: 'home-org',
    orgIds: ['home-org', 'course-digs'],
  }
  mockInvoiceGet.mockResolvedValue(invoiceSnap({
    orgId: 'pib-platform-owner',
    sourceOrgId: 'pib-platform-owner',
    recipientOrgId: 'course-digs',
    invoiceNumber: 'COU-003',
    status: 'draft',
    createdBy: 'client-1',
    lineItems: [{ description: 'Course Digs monthly', quantity: 1, unitPrice: 100, amount: 100 }],
    taxRate: 0,
  }))
  mockInvoiceUpdate.mockResolvedValue(undefined)
  mockCollection.mockImplementation((name: string) => {
    if (name === 'invoices') {
      return { doc: () => ({ get: mockInvoiceGet, update: mockInvoiceUpdate }) }
    }
    if (name === 'users') {
      return { doc: () => ({ get: jest.fn().mockResolvedValue({ data: () => ({ displayName: 'Client User' }) }) }) }
    }
    throw new Error(`Unexpected collection: ${name}`)
  })
})

describe('GET/PATCH /api/v1/invoices/[id] selected organisation scope', () => {
  it('allows a multi-org portal user to open a Course Digs invoice when orgId query selects Course Digs', async () => {
    const { GET } = await import('@/app/api/v1/invoices/[id]/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/invoices/course-invoice-1?orgId=course-digs'), routeCtx())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toEqual(expect.objectContaining({ id: 'course-invoice-1', recipientOrgId: 'course-digs' }))
  })

  it('rejects invoice detail access when the selected orgId does not match the invoice org scope', async () => {
    const { GET } = await import('@/app/api/v1/invoices/[id]/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/invoices/course-invoice-1?orgId=home-org'), routeCtx())

    expect(res.status).toBe(404)
  })

  it('keeps draft PATCH scoped to the selected Course Digs org', async () => {
    const { PATCH } = await import('@/app/api/v1/invoices/[id]/route')
    const res = await PATCH(new NextRequest('http://localhost/api/v1/invoices/course-invoice-1?orgId=course-digs', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notes: 'Scoped Course Digs update' }),
    }), routeCtx())

    expect(res.status).toBe(200)
    expect(mockInvoiceUpdate).toHaveBeenCalledWith(expect.objectContaining({ notes: 'Scoped Course Digs update' }))
  })
})
