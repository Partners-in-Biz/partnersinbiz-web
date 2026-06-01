// __tests__/api/sequence-enrollments.test.ts
import { NextRequest } from 'next/server'

const mockGet = jest.fn()
const mockAdd = jest.fn()
const mockUpdate = jest.fn()
const mockDoc = jest.fn()
const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockOrderBy = jest.fn()
const mockLimit = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))
jest.mock('@/lib/auth/middleware', () => ({
  withAuth: (_role: string, handler: (...args: unknown[]) => unknown) => handler,
}))

process.env.AI_API_KEY = 'test-key'
const authHeader = { Authorization: 'Bearer test-key' }

beforeEach(() => {
  jest.clearAllMocks()
  const query = { where: mockWhere, orderBy: mockOrderBy, limit: mockLimit, get: mockGet }
  mockWhere.mockReturnValue(query)
  mockOrderBy.mockReturnValue(query)
  mockLimit.mockReturnValue(query)
  mockDoc.mockReturnValue({ get: mockGet, update: mockUpdate })
  mockCollection.mockImplementation(() => ({
    where: mockWhere,
    orderBy: mockOrderBy,
    get: mockGet,
    add: mockAdd,
    doc: mockDoc,
  }))
})

describe('POST /api/v1/sequences/[id]/enroll', () => {
  it('enrolls contacts into an active sequence', async () => {
    const seqData = { orgId: 'org-test', name: 'Welcome', status: 'active', steps: [{ stepNumber: 1, delayDays: 0, subject: 'Hi', bodyHtml: '<p>Hi</p>', bodyText: 'Hi' }], deleted: false }
    const contactData = { orgId: 'org-test', name: 'Alice', email: 'alice@example.com', deleted: false }

    mockGet
      .mockResolvedValueOnce({ exists: true, id: 'seq1', data: () => seqData })
      .mockResolvedValueOnce({ exists: true, id: 'c1', data: () => contactData })
      .mockResolvedValueOnce({ docs: [] })
    mockAdd.mockResolvedValue({ id: 'enroll1' })

    const { POST } = await import('@/app/api/v1/sequences/[id]/enroll/route')
    const req = new NextRequest('http://localhost/api/v1/sequences/seq1/enroll', {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactIds: ['c1'] }),
    })
    const params = { params: Promise.resolve({ id: 'seq1' }) }
    const res = await POST(req, params)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.enrolled).toHaveLength(1)
  })

  it('returns an existing active enrollment instead of creating a duplicate', async () => {
    const seqData = { orgId: 'org-test', name: 'Welcome', status: 'active', steps: [{ stepNumber: 1, delayDays: 0, subject: 'Hi', bodyHtml: '<p>Hi</p>', bodyText: 'Hi' }], deleted: false }
    const contactData = { orgId: 'org-test', name: 'Alice', email: 'alice@example.com', deleted: false }

    mockGet
      .mockResolvedValueOnce({ exists: true, id: 'seq1', data: () => seqData })
      .mockResolvedValueOnce({ exists: true, id: 'c1', data: () => contactData })
      .mockResolvedValueOnce({ docs: [{ id: 'existing-enroll-1', data: () => ({ status: 'active' }) }] })

    const { POST } = await import('@/app/api/v1/sequences/[id]/enroll/route')
    const req = new NextRequest('http://localhost/api/v1/sequences/seq1/enroll', {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactIds: ['c1'] }),
    })
    const params = { params: Promise.resolve({ id: 'seq1' }) }
    const res = await POST(req, params)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.enrolled).toEqual(['existing-enroll-1'])
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('rejects enrollment into draft sequence', async () => {
    mockGet.mockResolvedValue({ exists: true, id: 'seq1', data: () => ({ status: 'draft', deleted: false }) })
    const { POST } = await import('@/app/api/v1/sequences/[id]/enroll/route')
    const req = new NextRequest('http://localhost/api/v1/sequences/seq1/enroll', {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactIds: ['c1'] }),
    })
    const params = { params: Promise.resolve({ id: 'seq1' }) }
    const res = await POST(req, params)
    expect(res.status).toBe(422)
  })
})

describe('GET /api/v1/sequence-enrollments', () => {
  it('returns enrollments list', async () => {
    mockGet.mockResolvedValue({
      docs: [{ id: 'e1', data: () => ({ sequenceId: 'seq1', contactId: 'c1', status: 'active' }) }],
    })
    const { GET } = await import('@/app/api/v1/sequence-enrollments/route')
    const req = new NextRequest('http://localhost/api/v1/sequence-enrollments', { headers: authHeader })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toHaveLength(1)
  })
})

describe('DELETE /api/v1/sequence-enrollments/[id]', () => {
  it('exits an enrollment', async () => {
    mockGet.mockResolvedValue({ exists: true, id: 'e1', data: () => ({ status: 'active', deleted: false }) })
    mockUpdate.mockResolvedValue({})
    const { DELETE } = await import('@/app/api/v1/sequence-enrollments/[id]/route')
    const req = new NextRequest('http://localhost/api/v1/sequence-enrollments/e1', { method: 'DELETE', headers: authHeader })
    const params = { params: Promise.resolve({ id: 'e1' }) }
    const res = await DELETE(req, params)
    expect(res.status).toBe(200)
  })
})
