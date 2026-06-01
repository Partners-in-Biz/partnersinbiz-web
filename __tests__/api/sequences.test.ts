// __tests__/api/sequences.test.ts
import { NextRequest } from 'next/server'

const mockGet = jest.fn()
const mockAdd = jest.fn()
const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockOrderBy = jest.fn()
const mockLimit = jest.fn()
const mockOffset = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
  },
}))

jest.mock('@/lib/auth/middleware', () => ({
  withAuth: (_role: string, handler: (...args: unknown[]) => unknown) => handler,
}))

process.env.AI_API_KEY = 'test-key'

const authHeader = { Authorization: 'Bearer test-key' }

beforeEach(() => {
  jest.clearAllMocks()
  const query = { where: mockWhere, orderBy: mockOrderBy, limit: mockLimit, offset: mockOffset, get: mockGet }
  mockWhere.mockReturnValue(query)
  mockOrderBy.mockReturnValue(query)
  mockLimit.mockReturnValue(query)
  mockOffset.mockReturnValue(query)
  mockCollection.mockReturnValue({ ...query, add: mockAdd })
})

describe('GET /api/v1/sequences', () => {
  it('returns list of sequences', async () => {
    mockGet.mockResolvedValue({
      docs: [{ id: 'seq1', data: () => ({ name: 'Welcome', status: 'active', steps: [] }) }],
    })
    const { GET } = await import('@/app/api/v1/sequences/route')
    const req = new NextRequest('http://localhost/api/v1/sequences?orgId=org-test', { headers: authHeader })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].id).toBe('seq1')
  })

  it('keeps legacy sequence listing index-safe by sorting in memory', async () => {
    mockGet.mockResolvedValue({
      docs: [
        { id: 'older', data: () => ({ orgId: 'org-test', name: 'Older', status: 'active', createdAt: { seconds: 1000 } }) },
        { id: 'newer', data: () => ({ orgId: 'org-test', name: 'Newer', status: 'draft', createdAt: { seconds: 2000 } }) },
        { id: 'deleted', data: () => ({ orgId: 'org-test', name: 'Deleted', status: 'active', deleted: true, createdAt: { seconds: 3000 } }) },
      ],
    })
    const { GET } = await import('@/app/api/v1/sequences/route')
    const req = new NextRequest('http://localhost/api/v1/sequences?orgId=org-test&limit=20', { headers: authHeader })

    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'org-test')
    expect(mockOrderBy).not.toHaveBeenCalled()
    const body = await res.json()
    expect(body.data.map((sequence: { id: string }) => sequence.id)).toEqual(['newer', 'older'])
  })
})

describe('POST /api/v1/sequences', () => {
  it('creates a sequence', async () => {
    mockAdd.mockResolvedValue({ id: 'new-seq' })
    const { POST } = await import('@/app/api/v1/sequences/route')
    const req = new NextRequest('http://localhost/api/v1/sequences', {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId: 'org-test', name: 'Onboarding', description: '', status: 'draft', steps: [] }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.id).toBe('new-seq')
  })

  it('uses the platform owner org for legacy unscoped sequence creation', async () => {
    mockAdd.mockResolvedValue({ id: 'new-seq' })
    const { POST } = await import('@/app/api/v1/sequences/route')
    const req = new NextRequest('http://localhost/api/v1/sequences', {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Onboarding', description: '', status: 'draft', steps: [] }),
    })

    const res = await POST(req)

    expect(res.status).toBe(201)
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'pib-platform-owner',
      name: 'Onboarding',
    }))
  })

  it('rejects missing name', async () => {
    const { POST } = await import('@/app/api/v1/sequences/route')
    const req = new NextRequest('http://localhost/api/v1/sequences', {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: '' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
