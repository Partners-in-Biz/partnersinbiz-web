import { PATCH } from '@/app/api/v1/ads/google/connections/[id]/customer/route'

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: any) => handler,
}))

const mockGet = jest.fn()
const mockUpdateConnection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({ get: mockGet }),
    }),
  },
}))

jest.mock('@/lib/ads/connections/store', () => ({
  updateConnection: (...args: any[]) => mockUpdateConnection(...args),
}))

function makeReq(body: any, orgId = 'org-1'): any {
  return {
    headers: { get: (k: string) => (k === 'X-Org-Id' ? orgId : null) },
    json: async () => body,
  }
}

describe('PATCH /api/v1/ads/google/connections/[id]/customer', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockUpdateConnection.mockReset()
  })

  it('updates defaultAdAccountId on the matching connection', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ id: 'c1', orgId: 'org-1', platform: 'google', meta: {} }),
    })
    mockUpdateConnection.mockResolvedValue(undefined)

    const req = makeReq({ customerId: '1234567890', loginCustomerId: '9876543210' })
    const res: any = await PATCH(req, null as any, { params: Promise.resolve({ id: 'c1' }) } as any)
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(body.data.customerId).toBe('1234567890')
    expect(body.data.loginCustomerId).toBe('9876543210')
    expect(mockUpdateConnection).toHaveBeenCalledWith('c1', expect.objectContaining({
      defaultAdAccountId: '1234567890',
      meta: expect.objectContaining({ google: expect.objectContaining({ loginCustomerId: '9876543210' }) }),
    }))
  })

  it('strips dashes from the customer id (XXX-XXX-XXXX form)', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ id: 'c1', orgId: 'org-1', platform: 'google', meta: {} }),
    })
    mockUpdateConnection.mockResolvedValue(undefined)

    const req = makeReq({ customerId: '123-456-7890' })
    const res: any = await PATCH(req, null as any, { params: Promise.resolve({ id: 'c1' }) } as any)
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(body.data.customerId).toBe('1234567890')
  })

  it('returns 404 when connection belongs to another org', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ id: 'c1', orgId: 'other-org', platform: 'google', meta: {} }),
    })

    const req = makeReq({ customerId: '1234567890' }, 'org-1')
    const res: any = await PATCH(req, null as any, { params: Promise.resolve({ id: 'c1' }) } as any)
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.success).toBe(false)
    expect(mockUpdateConnection).not.toHaveBeenCalled()
  })

  it('returns 400 on invalid customerId shape', async () => {
    const req = makeReq({ customerId: 'not-numeric' })
    const res: any = await PATCH(req, null as any, { params: Promise.resolve({ id: 'c1' }) } as any)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.success).toBe(false)
  })

  it('returns 400 on missing X-Org-Id header', async () => {
    const req = {
      headers: { get: () => null },
      json: async () => ({ customerId: '1234567890' }),
    }
    const res: any = await PATCH(req as any, null as any, { params: Promise.resolve({ id: 'c1' }) } as any)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.success).toBe(false)
  })
})
