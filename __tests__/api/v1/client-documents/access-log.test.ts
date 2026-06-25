import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockOrderBy = jest.fn()
const mockLimit = jest.fn()
const mockGet = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
  },
}))

// The route resolves document access through getAccessibleClientDocument →
// getClientDocument(id). Mock the store so we control the document (and 404 cases)
// without standing up the underlying Firestore document fetch.
const mockGetClientDocument = jest.fn()
jest.mock('@/lib/client-documents/store', () => ({
  getClientDocument: (...args: unknown[]) => mockGetClientDocument(...args),
}))

jest.mock('@/lib/api/auth', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  withAuth: (requiredRole: 'admin' | 'client', handler: any) => async (req: NextRequest, user: any, ctx?: any) => {
    const roleOk =
      user?.role === 'ai' || user?.role === 'admin' || (requiredRole === 'client' && user?.role === 'client')
    if (!roleOk) {
      return new Response(JSON.stringify({ success: false, error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return handler(req, user, ctx)
  },
}))

const adminUser = { uid: 'admin-1', role: 'admin' as const }
const clientUser = { uid: 'client-1', role: 'client' as const, orgId: 'org-1' }

function getRequest(url: string) {
  return new NextRequest(url, { method: 'GET' })
}

function stageAccessLog(docs: Array<{ id: string; data: () => Record<string, unknown> }>) {
  mockGet.mockResolvedValueOnce({ docs })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetClientDocument.mockReset()
  mockGet.mockReset()

  // Chain: adminDb.collection('document_access_log').where(...).orderBy(...).limit(...).get()
  const limitChain = { get: mockGet }
  mockLimit.mockReturnValue(limitChain)
  const orderByChain = { limit: mockLimit }
  mockOrderBy.mockReturnValue(orderByChain)
  const whereChain = { orderBy: mockOrderBy }
  mockWhere.mockReturnValue(whereChain)
  mockCollection.mockReturnValue({ where: mockWhere })
})

describe('GET /api/v1/client-documents/[id]/access-log', () => {
  it('returns access-log entries ordered by accessedAt desc with default limit 20', async () => {
    mockGetClientDocument.mockResolvedValueOnce({ id: 'doc-1', orgId: 'org-1', deleted: false })
    stageAccessLog([
      { id: 'log-1', data: () => ({ type: 'view', email: 'a@example.com', accessedAt: 't1' }) },
      { id: 'log-2', data: () => ({ type: 'code_entered', email: 'a@example.com', accessedAt: 't2' }) },
    ])

    const { GET } = await import('@/app/api/v1/client-documents/[id]/access-log/route')
    const req = getRequest('http://localhost/api/v1/client-documents/doc-1/access-log')
    const res = await GET(req, adminUser, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.events).toEqual([
      { id: 'log-1', type: 'view', email: 'a@example.com', accessedAt: 't1' },
      { id: 'log-2', type: 'code_entered', email: 'a@example.com', accessedAt: 't2' },
    ])
    expect(mockCollection).toHaveBeenCalledWith('document_access_log')
    expect(mockWhere).toHaveBeenCalledWith('documentId', '==', 'doc-1')
    expect(mockOrderBy).toHaveBeenCalledWith('accessedAt', 'desc')
    expect(mockLimit).toHaveBeenCalledWith(20)
  })

  it('honours ?limit=N within the 1..100 range', async () => {
    mockGetClientDocument.mockResolvedValueOnce({ id: 'doc-1', orgId: 'org-1', deleted: false })
    stageAccessLog([])

    const { GET } = await import('@/app/api/v1/client-documents/[id]/access-log/route')
    const req = getRequest('http://localhost/api/v1/client-documents/doc-1/access-log?limit=50')
    const res = await GET(req, adminUser, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(200)
    expect(mockLimit).toHaveBeenCalledWith(50)
  })

  it('caps ?limit above 100 down to 100', async () => {
    mockGetClientDocument.mockResolvedValueOnce({ id: 'doc-1', orgId: 'org-1', deleted: false })
    stageAccessLog([])

    const { GET } = await import('@/app/api/v1/client-documents/[id]/access-log/route')
    const req = getRequest('http://localhost/api/v1/client-documents/doc-1/access-log?limit=500')
    const res = await GET(req, adminUser, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(200)
    expect(mockLimit).toHaveBeenCalledWith(100)
  })

  it('returns 404 when the document does not exist', async () => {
    mockGetClientDocument.mockResolvedValueOnce(null)

    const { GET } = await import('@/app/api/v1/client-documents/[id]/access-log/route')
    const req = getRequest('http://localhost/api/v1/client-documents/missing/access-log')
    const res = await GET(req, adminUser, { params: Promise.resolve({ id: 'missing' }) })

    expect(res.status).toBe(404)
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('returns 404 when the document is soft-deleted (store filters it out)', async () => {
    // getClientDocument returns null for soft-deleted documents.
    mockGetClientDocument.mockResolvedValueOnce(null)

    const { GET } = await import('@/app/api/v1/client-documents/[id]/access-log/route')
    const req = getRequest('http://localhost/api/v1/client-documents/doc-1/access-log')
    const res = await GET(req, adminUser, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(404)
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('blocks client role via withAuth when not linked to the document org', async () => {
    // Client role for an org that is not linked/visible on the document → 403.
    mockGetClientDocument.mockResolvedValueOnce({ id: 'doc-1', orgId: 'org-1', deleted: false, status: 'draft' })

    const { GET } = await import('@/app/api/v1/client-documents/[id]/access-log/route')
    const req = getRequest('http://localhost/api/v1/client-documents/doc-1/access-log')
    const res = await GET(req, clientUser, { params: Promise.resolve({ id: 'doc-1' }) })

    expect(res.status).toBe(403)
    expect(mockGet).not.toHaveBeenCalled()
  })
})

export {}
