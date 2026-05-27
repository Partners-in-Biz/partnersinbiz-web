import { NextRequest } from 'next/server'

const mockVerifySessionCookie = jest.fn()
const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockDoc = jest.fn()
const mockGet = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: {
    verifySessionCookie: mockVerifySessionCookie,
  },
  adminDb: {
    collection: mockCollection,
  },
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockVerifySessionCookie.mockResolvedValue({ uid: 'client-1' })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'users') {
      return {
        doc: mockDoc.mockReturnValue({
          get: () => Promise.resolve({
            exists: true,
            data: () => ({ role: 'admin', activeOrgId: 'org-1' }),
          }),
        }),
      }
    }
    if (name === 'orgMembers') {
      return {
        where: () => ({
          get: () => Promise.resolve({
            docs: [
              {
                id: 'org-1_client-1',
                data: () => ({ orgId: 'org-1', uid: 'client-1', role: 'owner' }),
              },
            ],
          }),
        }),
        doc: () => ({
          get: () => Promise.resolve({
            exists: true,
            data: () => ({ orgId: 'org-1', uid: 'client-1', role: 'owner' }),
          }),
        }),
      }
    }
    if (name === 'client_documents') {
      const query = { where: mockWhere, get: mockGet }
      mockWhere.mockReturnValue(query)
      return query
    }
    return {
      doc: () => ({ get: () => Promise.resolve({ exists: false }) }),
      where: () => ({ get: () => Promise.resolve({ docs: [] }) }),
    }
  })
  mockGet.mockResolvedValue({ docs: [] })
})

describe('GET /api/v1/portal/documents/count', () => {
  it('counts only client-visible, non-deleted documents for the active portal org', async () => {
    mockGet.mockResolvedValueOnce({
      docs: [
        { data: () => ({ status: 'client_review', deleted: false }) },
        { data: () => ({ status: 'approved' }) },
        { data: () => ({ status: 'internal_draft' }) },
        { data: () => ({ status: 'accepted', deleted: true }) },
      ],
    })

    const { GET } = await import('@/app/api/v1/portal/documents/count/route')
    const req = new NextRequest('http://localhost/api/v1/portal/documents/count', {
      headers: { cookie: '__session=test-session' },
    })
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockCollection).toHaveBeenCalledWith('client_documents')
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'org-1')
    expect(body.data).toEqual({ count: 2 })
  })
})
