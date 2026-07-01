import { NextRequest } from 'next/server'

let mockUser = { uid: 'agent:maya', role: 'ai' as 'ai' | 'client' | 'admin' }

const mockPostGet = jest.fn()
const mockCommentSet = jest.fn()
const mockCommentDoc = jest.fn()
const mockUserGet = jest.fn()
const mockNotificationAdd = jest.fn()
const mockCollection = jest.fn()
const mockNotifyNewComment = jest.fn()
const mockGetHermesProfileLink = jest.fn()
const mockCreateHermesRun = jest.fn()

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: any) => (req: NextRequest, ctx?: unknown) =>
    handler(req, mockUser, ctx),
}))

jest.mock('@/lib/api/tenant', () => ({
  withTenant: (handler: any) => (req: NextRequest, user: any, ctx?: unknown) =>
    handler(req, user, 'pib-platform-owner', ctx),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => mockCollection(name),
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  },
}))

jest.mock('@/lib/notifications/notify', () => ({
  notifyNewComment: (...args: unknown[]) => mockNotifyNewComment(...args),
}))

jest.mock('@/lib/hermes/server', () => ({
  getHermesProfileLink: (...args: unknown[]) => mockGetHermesProfileLink(...args),
  createHermesRun: (...args: unknown[]) => mockCreateHermesRun(...args),
}))

jest.mock('@/lib/activity/log', () => ({
  logActivity: jest.fn(() => Promise.resolve()),
}))

function setupCollections() {
  mockPostGet.mockResolvedValue({
    exists: true,
    data: () => ({ orgId: 'pib-platform-owner' }),
  })
  mockCommentSet.mockResolvedValue(undefined)
  mockCommentDoc.mockReturnValue({ id: 'comment-1', set: mockCommentSet })
  mockUserGet.mockResolvedValue({
    exists: true,
    data: () => ({ displayName: mockUser.uid }),
  })
  mockNotificationAdd.mockResolvedValue({ id: 'notification-1' })
  mockNotifyNewComment.mockResolvedValue(undefined)
  mockGetHermesProfileLink.mockResolvedValue({ baseUrl: 'https://agent.example.test' })
  mockCreateHermesRun.mockResolvedValue({ id: 'run-1' })

  mockCollection.mockImplementation((name: string) => {
    if (name === 'social_posts') {
      return {
        doc: () => ({
          get: mockPostGet,
          collection: () => ({
            doc: mockCommentDoc,
          }),
        }),
      }
    }
    if (name === 'users') {
      return {
        doc: () => ({
          get: mockUserGet,
        }),
      }
    }
    if (name === 'notifications') {
      return {
        add: mockNotificationAdd,
      }
    }
    throw new Error(`Unexpected collection ${name}`)
  })
}

async function postComment() {
  const { POST } = await import('@/app/api/v1/social/posts/[id]/comments/route')
  return POST(
    new NextRequest('http://localhost/api/v1/social/posts/post-1/comments', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-org-id': 'pib-platform-owner',
      },
      body: JSON.stringify({ text: 'Internal asset note only' }),
    }),
    { params: Promise.resolve({ id: 'post-1' }) },
  )
}

async function flushPromises() {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

describe('POST /api/v1/social/posts/:id/comments', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    mockUser = { uid: 'agent:maya', role: 'ai' }
    setupCollections()
  })

  it('does not dispatch a Hermes run for AI-authored internal comments', async () => {
    const res = await postComment()
    await flushPromises()

    expect(res.status).toBe(200)
    expect(mockCommentSet).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'agent:maya',
      userRole: 'ai',
      text: 'Internal asset note only',
    }))
    expect(mockGetHermesProfileLink).not.toHaveBeenCalled()
    expect(mockCreateHermesRun).not.toHaveBeenCalled()
  })

  it('still dispatches a Hermes run for client feedback comments', async () => {
    mockUser = { uid: 'client-1', role: 'client' }
    mockUserGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ displayName: 'Client One' }),
    })

    const res = await postComment()
    await flushPromises()

    expect(res.status).toBe(200)
    expect(mockGetHermesProfileLink).toHaveBeenCalledWith('pib-platform-owner')
    expect(mockCreateHermesRun).toHaveBeenCalledWith(
      { baseUrl: 'https://agent.example.test' },
      'client-1',
      expect.objectContaining({
        prompt: expect.stringContaining('Client Client One left feedback'),
      }),
    )
  })
})
