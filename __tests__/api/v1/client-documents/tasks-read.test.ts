import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockOrderBy = jest.fn()
const mockLimit = jest.fn()
const mockIndexedGet = jest.fn()
const mockFallbackGet = jest.fn()
const mockGetClientDocument = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/client-documents/store', () => ({
  getClientDocument: (...args: unknown[]) => mockGetClientDocument(...args),
}))

jest.mock('@/lib/api/auth', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  withAuth: (_requiredRole: string, handler: any) => (req: NextRequest, user: any, ctx: any) => handler(req, user, ctx),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
    delete: jest.fn(() => 'DELETE_FIELD'),
  },
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockGetClientDocument.mockResolvedValue({ id: 'doc-1', orgId: 'org-1', deleted: false })
  mockLimit.mockReturnValue({ get: mockIndexedGet })
  mockOrderBy.mockReturnValue({ limit: mockLimit })
  mockWhere.mockReturnValue({ orderBy: mockOrderBy, get: mockFallbackGet })
  mockCollection.mockReturnValue({ where: mockWhere })
})

describe('GET /api/v1/client-documents/[id]/tasks', () => {
  it('falls back to a document-scoped read when the composite index is unavailable', async () => {
    mockIndexedGet.mockRejectedValueOnce(Object.assign(new Error('The query requires an index'), { code: 9 }))
    mockFallbackGet.mockResolvedValueOnce({
      docs: [
        { id: 'older', data: () => ({ createdAt: { toMillis: () => 100 }, title: 'Older' }) },
        { id: 'newer', data: () => ({ createdAt: { toMillis: () => 300 }, title: 'Newer' }) },
        { id: 'middle', data: () => ({ createdAt: { toMillis: () => 200 }, title: 'Middle' }) },
      ],
    })

    const { GET } = await import('@/app/api/v1/client-documents/[id]/tasks/route')
    const res = await GET(
      new NextRequest('http://localhost/api/v1/client-documents/doc-1/tasks'),
      { uid: 'admin-1', role: 'admin' },
      { params: Promise.resolve({ id: 'doc-1' }) },
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.map((task: { id: string }) => task.id)).toEqual(['newer', 'middle', 'older'])
    expect(mockFallbackGet).toHaveBeenCalledTimes(1)
  })
})

export {}
