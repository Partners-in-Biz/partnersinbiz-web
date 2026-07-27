import { NextRequest } from 'next/server'

const mockGet = jest.fn()
const mockWhere = jest.fn()
const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (
    _role: string,
    handler: (
      req: NextRequest,
      user: { uid: string; role: 'admin'; authKind: 'session' },
    ) => Promise<Response>,
  ) => async (req: NextRequest) => handler(req, { uid: 'admin-1', role: 'admin', authKind: 'session' }),
}))

function timestamp(milliseconds: number) {
  return { toMillis: () => milliseconds }
}

function commentDoc(id: string, data: Record<string, unknown>) {
  return { id, data: () => data }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockWhere.mockReturnValue({ get: mockGet })
  mockCollection.mockReturnValue({ where: mockWhere })
  mockGet.mockResolvedValue({
    docs: [
      commentDoc('comment-other-resource', {
        orgId: 'org-1',
        resourceType: 'task',
        resourceId: 'task-2',
        createdAt: timestamp(50),
        deleted: false,
      }),
      commentDoc('comment-later', {
        orgId: 'org-1',
        resourceType: 'task',
        resourceId: 'task-1',
        createdAt: timestamp(300),
        deleted: false,
      }),
      commentDoc('comment-deleted', {
        orgId: 'org-1',
        resourceType: 'task',
        resourceId: 'task-1',
        createdAt: timestamp(200),
        deleted: true,
      }),
      commentDoc('comment-earlier', {
        orgId: 'org-1',
        resourceType: 'task',
        resourceId: 'task-1',
        createdAt: timestamp(100),
        deleted: false,
      }),
    ],
  })
})

describe('GET /api/v1/comments', () => {
  it('lists filtered comments in ascending time order without requiring composite indexes', async () => {
    const { GET } = await import('@/app/api/v1/comments/route')
    const res = await GET(new NextRequest(
      'http://localhost/api/v1/comments?orgId=org-1&resourceType=task&resourceId=task-1&limit=2',
    ))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockWhere).toHaveBeenCalledTimes(1)
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'org-1')
    expect(body.data.map((comment: { id: string }) => comment.id)).toEqual([
      'comment-earlier',
      'comment-later',
    ])
  })
})
