import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockOrderBy = jest.fn()
const mockLimit = jest.fn()
const mockGet = jest.fn()
const mockOrgGet = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: Function) => (req: NextRequest) =>
    handler(req, { uid: 'admin-1', role: 'admin' }),
}))

function postDoc(id: string, data: Record<string, unknown>) {
  return { id, data: () => data }
}

describe('GET /api/v1/social/posts/pending', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    const query = { where: mockWhere, orderBy: mockOrderBy, limit: mockLimit, get: mockGet }
    mockWhere.mockReturnValue(query)
    mockLimit.mockReturnValue(query)
    mockOrderBy.mockImplementation(() => {
      throw new Error('The query requires an index')
    })
    mockCollection.mockImplementation((name: string) => {
      if (name === 'organizations') {
        return {
          doc: (id: string) => ({
            get: () => mockOrgGet(id),
          }),
        }
      }
      return query
    })
    mockOrgGet.mockResolvedValue({ exists: true, data: () => ({ name: 'Acme Co' }) })
  })

  it('serves pending approvals without an ordered composite-index query', async () => {
    mockGet.mockResolvedValue({
      docs: [
        postDoc('later', {
          orgId: 'org-1',
          status: 'pending_approval',
          platform: 'linkedin',
          content: { text: 'Later approval' },
          scheduledAt: { seconds: 200 },
        }),
        postDoc('earlier', {
          orgId: 'org-1',
          status: 'pending_approval',
          platform: 'x',
          content: 'Earlier approval',
          scheduledFor: { seconds: 100 },
        }),
      ],
    })

    const { GET } = await import('@/app/api/v1/social/posts/pending/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/social/posts/pending?limit=12'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockWhere).toHaveBeenCalledWith('status', '==', 'pending_approval')
    expect(mockOrderBy).not.toHaveBeenCalled()
    expect(mockLimit).toHaveBeenCalledWith(100)
    expect(body.data.map((post: { id: string }) => post.id)).toEqual(['earlier', 'later'])
    expect(body.data[0].orgName).toBe('Acme Co')
  })
})
