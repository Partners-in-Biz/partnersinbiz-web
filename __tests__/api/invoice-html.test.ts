import { NextRequest } from 'next/server'

type MockUser = {
  uid: string
  role: 'admin' | 'client' | 'ai'
  orgId?: string
  activeOrgId?: string
  allowedOrgIds?: string[]
}

type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

const mockRequireInvoiceAccess = jest.fn()
const mockGenerateInvoiceHtml = jest.fn()
let mockUser: MockUser

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string | string[], handler: MockHandler) => (req: NextRequest, ctx?: unknown) =>
    handler(req, mockUser, ctx),
}))

jest.mock('@/lib/invoices/access', () => ({
  requireInvoiceAccess: (...args: unknown[]) => mockRequireInvoiceAccess(...args),
}))

jest.mock('@/lib/invoices/html-generator', () => ({
  generateInvoiceHtml: (...args: unknown[]) => mockGenerateInvoiceHtml(...args),
}))

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  mockUser = {
    uid: 'admin-1',
    role: 'admin',
    orgId: 'org-1',
    activeOrgId: 'org-1',
    allowedOrgIds: ['org-1'],
  }
  mockGenerateInvoiceHtml.mockReturnValue('<html><body>INV</body></html>')
  mockRequireInvoiceAccess.mockResolvedValue({
    ok: true,
    ref: {},
    snap: { id: 'inv-1' },
    data: {
      invoiceNumber: 'INV-001',
      orgId: 'org-1',
      lineItems: [{ description: 'Work', quantity: 1, unitPrice: 100, amount: 100 }],
      subtotal: 100,
      taxRate: 0,
      taxAmount: 0,
      total: 100,
      currency: 'ZAR',
    },
  })
})

it('returns invoice HTML for callers with invoice access', async () => {
  const { GET } = await import('@/app/api/v1/invoices/[id]/html/route')
  const res = await GET(
    new NextRequest('http://localhost/api/v1/invoices/inv-1/html'),
    { params: Promise.resolve({ id: 'inv-1' }) },
  )
  expect(res.status).toBe(200)
  expect(res.headers.get('Content-Type')).toContain('text/html')
  expect(await res.text()).toContain('INV')
  expect(mockGenerateInvoiceHtml).toHaveBeenCalled()
})

it('forwards access failures from requireInvoiceAccess', async () => {
  mockRequireInvoiceAccess.mockResolvedValue({
    ok: false,
    response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
  })
  const { GET } = await import('@/app/api/v1/invoices/[id]/html/route')
  const res = await GET(
    new NextRequest('http://localhost/api/v1/invoices/inv-1/html'),
    { params: Promise.resolve({ id: 'inv-1' }) },
  )
  expect(res.status).toBe(403)
})
