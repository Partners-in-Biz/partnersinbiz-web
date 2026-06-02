import { NextRequest } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'

const mockCollection = jest.fn()
const mockPostGet = jest.fn()
const mockUserGet = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: {
    verifyIdToken: jest.fn(),
    verifySessionCookie: jest.fn(),
  },
  adminDb: {
    collection: (name: string) => mockCollection(name),
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  },
  Timestamp: {
    fromDate: jest.fn((date: Date) => date),
  },
}))

describe('GET /api/v1/social/posts/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: 'client-1' })
    mockUserGet.mockResolvedValue({
      exists: true,
      data: () => ({ role: 'client', orgId: 'org-1', activeOrgId: 'org-1' }),
    })
    mockPostGet.mockResolvedValue({
      id: 'post-1',
      exists: true,
      data: () => ({
        orgId: 'org-1',
        status: 'client_review',
        content: { text: 'Review this post' },
      }),
    })

    mockCollection.mockImplementation((name: string) => {
      if (name === 'users') {
        return {
          doc: () => ({
            get: mockUserGet,
          }),
        }
      }
      if (name === 'social_posts') {
        return {
          doc: (id: string) => ({
            id,
            get: mockPostGet,
          }),
        }
      }
      throw new Error(`Unexpected collection ${name}`)
    })
  })

  it('allows a portal client to load their review post', async () => {
    const { GET } = await import('@/app/api/v1/social/posts/[id]/route')

    const res = await GET(
      new NextRequest('http://localhost/api/v1/social/posts/post-1', {
        headers: { cookie: '__session=valid-session' },
      }),
      { params: Promise.resolve({ id: 'post-1' }) },
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual(expect.objectContaining({
      id: 'post-1',
      orgId: 'org-1',
      status: 'client_review',
    }))
  })
})
