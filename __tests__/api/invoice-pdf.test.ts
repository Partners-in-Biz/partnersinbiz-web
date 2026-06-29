import { NextRequest } from 'next/server'

const mockInvoiceGet = jest.fn()
const mockOrgGet = jest.fn()
const mockCollection = jest.fn()
const mockRenderInvoicePdf = jest.fn()
const mockCheckAndIncrementRateLimit = jest.fn()
const mockResolveUser = jest.fn()
const mockCanAccessOrg = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
  },
}))

jest.mock('@/lib/invoices/pdf-generator', () => ({
  renderInvoicePdf: (...args: unknown[]) => mockRenderInvoicePdf(...args),
}))

jest.mock('@/lib/rateLimit', () => ({
  checkAndIncrementRateLimit: (...args: unknown[]) => mockCheckAndIncrementRateLimit(...args),
}))

jest.mock('@/lib/api/auth', () => ({
  resolveUser: (...args: unknown[]) => mockResolveUser(...args),
}))

jest.mock('@/lib/api/platformAdmin', () => ({
  canAccessOrg: (...args: unknown[]) => mockCanAccessOrg(...args),
}))

function makeReq(url: string, headers?: HeadersInit) {
  return new NextRequest(url, { headers })
}

function makeCtx(id = 'invoice-1') {
  return { params: Promise.resolve({ id }) }
}

function invoiceSnap(data: Record<string, unknown>) {
  return {
    exists: true,
    id: 'invoice-1',
    data: () => data,
  }
}

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  mockRenderInvoicePdf.mockResolvedValue(Buffer.from('%PDF-1.7 invoice pdf'))
  mockCheckAndIncrementRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 4,
    resetAt: new Date('2026-06-10T10:00:00.000Z'),
  })
  mockResolveUser.mockResolvedValue(null)
  mockCanAccessOrg.mockReturnValue(false)
  mockInvoiceGet.mockResolvedValue(invoiceSnap({
    invoiceNumber: 'INV-001',
    orgId: 'org-1',
    pdfShareToken: 'pdf-token-123',
  }))
  mockOrgGet.mockResolvedValue({
    exists: true,
    data: () => ({ name: 'Org One' }),
  })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'invoices') {
      return { doc: () => ({ get: mockInvoiceGet }) }
    }
    if (name === 'organizations') {
      return { doc: () => ({ get: mockOrgGet }) }
    }
    throw new Error(`Unexpected collection: ${name}`)
  })
})

describe('GET /api/v1/invoices/[id]/pdf', () => {
  it('returns 403 for anonymous requests without a valid PDF share token', async () => {
    const { GET } = await import('@/app/api/v1/invoices/[id]/pdf/route')
    const res = await GET(makeReq('http://localhost/api/v1/invoices/invoice-1/pdf'), makeCtx())

    expect(res.status).toBe(403)
    expect(mockRenderInvoicePdf).not.toHaveBeenCalled()
  })

  it('returns 403 for anonymous requests with the wrong PDF share token', async () => {
    const { GET } = await import('@/app/api/v1/invoices/[id]/pdf/route')
    const res = await GET(makeReq('http://localhost/api/v1/invoices/invoice-1/pdf?t=wrong'), makeCtx())

    expect(res.status).toBe(403)
    expect(mockRenderInvoicePdf).not.toHaveBeenCalled()
  })

  it('renders an actual PDF response for anonymous requests with the PDF share token', async () => {
    const { GET } = await import('@/app/api/v1/invoices/[id]/pdf/route')
    const req = makeReq('http://localhost/api/v1/invoices/invoice-1/pdf?t=pdf-token-123', {
      'x-forwarded-for': '203.0.113.10, 10.0.0.1',
    })
    const res = await GET(req, makeCtx())

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toBe('inline; filename="INV-001.pdf"')
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('%PDF-1.7 invoice pdf')
    expect(mockCheckAndIncrementRateLimit).toHaveBeenCalledWith({
      key: 'invoice_pdf:invoice-1:203.0.113.10',
      limit: 30,
      windowMs: 60 * 60 * 1000,
    })
    expect(mockRenderInvoicePdf).toHaveBeenCalledWith(expect.objectContaining({
      id: 'invoice-1',
      invoiceNumber: 'INV-001',
      pdfShareToken: 'pdf-token-123',
    }))
  })

  it('returns 429 when the anonymous PDF route rate limit is exceeded', async () => {
    mockCheckAndIncrementRateLimit.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: new Date('2026-06-10T10:00:00.000Z'),
    })

    const { GET } = await import('@/app/api/v1/invoices/[id]/pdf/route')
    const res = await GET(
      makeReq('http://localhost/api/v1/invoices/invoice-1/pdf?t=pdf-token-123', {
        'x-real-ip': '198.51.100.7',
      }),
      makeCtx(),
    )

    expect(res.status).toBe(429)
    expect(mockRenderInvoicePdf).not.toHaveBeenCalled()
  })

  it('keeps authenticated admin access working without a PDF share token', async () => {
    mockResolveUser.mockResolvedValueOnce({ uid: 'admin-1', role: 'admin' })
    mockCanAccessOrg.mockReturnValueOnce(true)

    const { GET } = await import('@/app/api/v1/invoices/[id]/pdf/route')
    const res = await GET(makeReq('http://localhost/api/v1/invoices/invoice-1/pdf'), makeCtx())

    expect(res.status).toBe(200)
    expect(mockCheckAndIncrementRateLimit).not.toHaveBeenCalled()
    expect(mockRenderInvoicePdf).toHaveBeenCalled()
  })

  it('keeps authenticated PDF access constrained to the selected orgId query', async () => {
    mockResolveUser.mockResolvedValueOnce({ uid: 'client-1', role: 'client', orgIds: ['home-org', 'course-digs'] })
    mockCanAccessOrg.mockImplementationOnce((_user, orgId) => orgId === 'course-digs')
    mockInvoiceGet.mockResolvedValueOnce(invoiceSnap({
      invoiceNumber: 'COU-003',
      orgId: 'pib-platform-owner',
      recipientOrgId: 'course-digs',
      pdfShareToken: 'pdf-token-123',
    }))

    const { GET } = await import('@/app/api/v1/invoices/[id]/pdf/route')
    const res = await GET(makeReq('http://localhost/api/v1/invoices/invoice-1/pdf?orgId=course-digs'), makeCtx())

    expect(res.status).toBe(200)
    expect(mockCheckAndIncrementRateLimit).not.toHaveBeenCalled()
  })

  it('rejects authenticated PDF access when selected orgId does not match the invoice scope', async () => {
    mockResolveUser.mockResolvedValueOnce({ uid: 'client-1', role: 'client', orgIds: ['home-org', 'course-digs'] })
    mockInvoiceGet.mockResolvedValueOnce(invoiceSnap({
      invoiceNumber: 'COU-003',
      orgId: 'pib-platform-owner',
      recipientOrgId: 'course-digs',
      pdfShareToken: 'pdf-token-123',
    }))

    const { GET } = await import('@/app/api/v1/invoices/[id]/pdf/route')
    const res = await GET(makeReq('http://localhost/api/v1/invoices/invoice-1/pdf?orgId=home-org'), makeCtx())

    expect(res.status).toBe(403)
    expect(mockRenderInvoicePdf).not.toHaveBeenCalled()
  })

  it('does not let a matching orgId query replace the required anonymous PDF share token', async () => {
    mockInvoiceGet.mockResolvedValueOnce(invoiceSnap({
      invoiceNumber: 'COU-003',
      orgId: 'pib-platform-owner',
      recipientOrgId: 'course-digs',
      pdfShareToken: 'pdf-token-123',
    }))

    const { GET } = await import('@/app/api/v1/invoices/[id]/pdf/route')
    const res = await GET(makeReq('http://localhost/api/v1/invoices/invoice-1/pdf?orgId=course-digs'), makeCtx())

    expect(res.status).toBe(403)
    expect(mockRenderInvoicePdf).not.toHaveBeenCalled()
  })
})
