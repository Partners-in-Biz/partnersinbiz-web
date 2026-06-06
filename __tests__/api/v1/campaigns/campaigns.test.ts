import { NextRequest } from 'next/server'

const mockAdd = jest.fn()
const mockGet = jest.fn()
const mockUpdate = jest.fn()
const mockDoc = jest.fn()
const mockWhere = jest.fn()
const mockOrderBy = jest.fn()
const mockLimit = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn(() => ({
      where: mockWhere,
      orderBy: mockOrderBy,
      get: mockGet,
      add: mockAdd,
      doc: mockDoc,
    })),
  },
}))

jest.mock('@/lib/api/auth', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  withAuth: (_role: string, handler: any) => handler,
}))

process.env.AI_API_KEY = 'test-key'
const authHeader = { Authorization: 'Bearer test-key' }

beforeEach(() => {
  jest.clearAllMocks()
  const query = { where: mockWhere, orderBy: mockOrderBy, get: mockGet, limit: mockLimit }
  mockWhere.mockReturnValue(query)
  mockOrderBy.mockReturnValue(query)
  mockLimit.mockReturnValue(query)
  mockDoc.mockReturnValue({ get: mockGet, update: mockUpdate })
})

describe('POST /api/v1/campaigns', () => {
  it('rejects missing orgId', async () => {
    const { POST } = await import('@/app/api/v1/campaigns/route')
    const req = new NextRequest('http://localhost/api/v1/campaigns', {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X' }),
    })
    const res = await POST(req, { uid: 'u1', role: 'admin' })
    expect(res.status).toBe(400)
  })

  it('rejects missing name', async () => {
    const { POST } = await import('@/app/api/v1/campaigns/route')
    const req = new NextRequest('http://localhost/api/v1/campaigns', {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId: 'o1' }),
    })
    const res = await POST(req, { uid: 'u1', role: 'admin' })
    expect(res.status).toBe(400)
  })

  it('rejects sequenceId from a different org', async () => {
    mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ orgId: 'other-org' }) })
    const { POST } = await import('@/app/api/v1/campaigns/route')
    const req = new NextRequest('http://localhost/api/v1/campaigns', {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId: 'o1', name: 'C', sequenceId: 'seq-x' }),
    })
    const res = await POST(req, { uid: 'u1', role: 'admin' })
    expect(res.status).toBe(403)
  })

  it('creates a campaign with default stats', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ orgId: 'o1' }) })
    mockAdd.mockResolvedValue({ id: 'camp-1' })
    const { POST } = await import('@/app/api/v1/campaigns/route')
    const req = new NextRequest('http://localhost/api/v1/campaigns', {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId: 'o1', name: 'Welcome', sequenceId: 'seq-1' }),
    })
    const res = await POST(req, { uid: 'u1', role: 'admin' })
    expect(res.status).toBe(201)
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'o1',
        name: 'Welcome',
        status: 'draft',
        sequenceId: 'seq-1',
        stats: expect.objectContaining({ enrolled: 0, sent: 0 }),
      })
    )
  })

  it('normalizes relationship links on campaign create without launching side effects', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ orgId: 'o1' }) })
    mockAdd.mockResolvedValue({ id: 'camp-1' })
    const { POST } = await import('@/app/api/v1/campaigns/route')
    const req = new NextRequest('http://localhost/api/v1/campaigns', {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId: 'o1',
        name: 'Welcome',
        companyId: 'company-1',
        companyIds: ['company-2', 'company-1'],
        contactId: 'stakeholder-contact',
        contactIds: ['audience-contact'],
        contextRefs: [{ type: 'contacts', id: 'stakeholder-contact' }],
      }),
    })
    const res = await POST(req, { uid: 'u1', role: 'admin' })
    expect(res.status).toBe(201)
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'draft',
        companyId: 'company-1',
        companyIds: ['company-1', 'company-2'],
        contactIds: ['audience-contact'],
        contextRefs: [{ type: 'contacts', id: 'stakeholder-contact' }],
      })
    )
    expect(mockAdd).toHaveBeenCalledWith(
      expect.not.objectContaining({
        contactId: 'stakeholder-contact',
      })
    )
  })
})

describe('PUT /api/v1/campaigns/[id]', () => {
  it('normalizes relationship links on draft campaign update', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ orgId: 'o1', status: 'draft', contactIds: [] }),
      ref: { update: mockUpdate },
    })
    const { PUT } = await import('@/app/api/v1/campaigns/[id]/route')
    const req = new NextRequest('http://localhost/api/v1/campaigns/camp-1', {
      method: 'PUT',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Updated',
        companyId: 'company-1',
        companyIds: ['company-2'],
        contextRefs: [{ type: 'contacts', id: 'contact-1' }],
      }),
    })
    const res = await PUT(req, { uid: 'u1', role: 'admin' }, { params: Promise.resolve({ id: 'camp-1' }) })
    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Updated',
      companyId: 'company-1',
      companyIds: ['company-1', 'company-2'],
      contextRefs: [{ type: 'contacts', id: 'contact-1' }],
    }))
  })
})

describe('GET /api/v1/campaigns', () => {
  it('rejects missing orgId', async () => {
    const { GET } = await import('@/app/api/v1/campaigns/route')
    const req = new NextRequest('http://localhost/api/v1/campaigns', { headers: authHeader })
    const res = await GET(req, { uid: 'u1', role: 'admin' })
    expect(res.status).toBe(400)
  })

  it('filters by orgId', async () => {
    mockGet.mockResolvedValue({
      docs: [{ id: 'c1', data: () => ({ orgId: 'o1', name: 'A', deleted: false }) }],
    })
    const { GET } = await import('@/app/api/v1/campaigns/route')
    const req = new NextRequest('http://localhost/api/v1/campaigns?orgId=o1', { headers: authHeader })
    const res = await GET(req, { uid: 'u1', role: 'admin' })
    expect(res.status).toBe(200)
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'o1')
  })
})
