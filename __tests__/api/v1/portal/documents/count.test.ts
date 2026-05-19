import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockGet = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
  },
}))

jest.mock('@/lib/api/auth', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  withAuth: (_requiredRole: 'admin' | 'client', handler: any) => async (req: NextRequest, user: any) =>
    handler(req, user),
}))

beforeEach(() => {
  jest.clearAllMocks()
  const query = { where: mockWhere, get: mockGet }
  mockWhere.mockReturnValue(query)
  mockCollection.mockReturnValue(query)
  mockGet.mockResolvedValue({ docs: [] })
})

describe('GET /api/v1/portal/documents/count', () => {
  it('counts only client-visible, non-deleted documents for the active org', async () => {
    mockGet.mockResolvedValueOnce({
      docs: [
        { data: () => ({ status: 'client_review', deleted: false }) },
        { data: () => ({ status: 'approved' }) },
        { data: () => ({ status: 'internal_draft' }) },
        { data: () => ({ status: 'accepted', deleted: true }) },
      ],
    })

    const { GET } = await import('@/app/api/v1/portal/documents/count/route')
    const req = new NextRequest('http://localhost/api/v1/portal/documents/count')
    const res = await GET(req, { uid: 'client-1', role: 'client', orgId: 'org-1' })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockCollection).toHaveBeenCalledWith('client_documents')
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'org-1')
    expect(body.data).toEqual({ count: 2 })
  })
})
