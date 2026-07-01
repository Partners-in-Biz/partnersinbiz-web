import { NextRequest } from 'next/server'

const mockDocGet = jest.fn()
const mockDocUpdate = jest.fn()
const mockQueueSet = jest.fn()
const mockCollection = jest.fn()
const mockPublishPost = jest.fn()
const mockMarkAccountTokenExpired = jest.fn()
const mockToPlatformType = jest.fn(() => 'linkedin')

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'server-timestamp'),
  },
  Timestamp: {
    fromDate: jest.fn((date: Date) => ({ seconds: Math.floor(date.getTime() / 1000), toDate: () => date })),
  },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
  },
}))

jest.mock('@/lib/api/auth', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  withAuth: (_role: 'admin' | 'client', handler: any) => async (req: NextRequest, user: any, ctx?: any) =>
    handler(req, user, ctx),
}))

jest.mock('@/lib/api/tenant', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  withTenant: (handler: any) => async (req: NextRequest, user: any, ctx?: any) => handler(req, user, 'org-1', ctx),
}))

jest.mock('@/lib/social/scheduling', () => ({
  hasActivePublishAccount: jest.fn(async () => true),
  hasFinalApproval: jest.fn(() => true),
  upsertSocialQueueEntry: jest.fn(async () => undefined),
}))

jest.mock('@/lib/social/account-resolver', () => ({
  isTokenExpiredError: jest.fn((message: string) => message.includes('Session has expired')),
  markAccountTokenExpired: mockMarkAccountTokenExpired,
  toPlatformType: mockToPlatformType,
  resolveProvider: jest.fn(async () => ({
    accountId: 'account-1',
    provider: { publishPost: mockPublishPost },
  })),
  refreshAccountToken: jest.fn(async () => null),
}))

jest.mock('@/lib/social/audit', () => ({
  logAudit: jest.fn(async () => undefined),
}))

jest.mock('@/lib/activity/log', () => ({
  logActivity: jest.fn(async () => undefined),
}))

const user = { uid: 'client-1', role: 'client' as const }
const params = { params: Promise.resolve({ id: 'post-1' }) }

function request(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockDocUpdate.mockResolvedValue(undefined)
  mockQueueSet.mockResolvedValue(undefined)
  mockMarkAccountTokenExpired.mockResolvedValue(undefined)
  mockPublishPost.mockResolvedValue({ platformPostId: 'urn:li:share:1' })
  mockToPlatformType.mockReturnValue('linkedin')
  mockDocGet.mockResolvedValue({
    exists: true,
    data: () => ({
      orgId: 'org-1',
      platform: 'linkedin',
      status: 'failed',
      content: { text: 'Post body' },
      approvedAt: '2026-05-18T06:00:00Z',
      media: [],
    }),
  })
  mockCollection.mockImplementation((name: string) => ({
    doc: jest.fn(() => ({
      get: name === 'social_posts' ? mockDocGet : jest.fn().mockResolvedValue({ exists: false }),
      update: name === 'social_posts' ? mockDocUpdate : jest.fn(),
      set: name === 'social_queue' ? mockQueueSet : jest.fn(),
    })),
  }))
})

describe('portal social post actions', () => {
  it('reschedules an approved failed post and queues it again', async () => {
    const { POST } = await import('@/app/api/v1/portal/social/posts/[id]/reschedule/route')
    const res = await POST(
      request('http://localhost/api/v1/portal/social/posts/post-1/reschedule', {
        scheduledAt: '2026-05-20T07:00:00.000Z',
      }),
      user,
      params,
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockDocUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'scheduled', error: null }))
    expect(body.data).toMatchObject({ id: 'post-1', status: 'scheduled', error: null })
  })

  it('publishes a failed post immediately from the portal', async () => {
    const { POST } = await import('@/app/api/v1/portal/social/posts/[id]/publish-now/route')
    const res = await POST(request('http://localhost/api/v1/portal/social/posts/post-1/publish-now'), user, params)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockPublishPost).toHaveBeenCalledWith(expect.objectContaining({ text: 'Post body' }))
    expect(mockDocUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'published', externalId: 'urn:li:share:1' }))
    expect(mockQueueSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', error: null }), { merge: true })
    expect(body.data).toMatchObject({ id: 'post-1', status: 'published', externalId: 'urn:li:share:1' })
  })

  it('passes YouTube upload metadata when publishing immediately from the portal', async () => {
    mockToPlatformType.mockReturnValueOnce('youtube')
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        orgId: 'org-1',
        platform: 'youtube',
        status: 'approved',
        content: { text: 'Video description' },
        approvedAt: '2026-05-18T06:00:00Z',
        media: [{ url: 'https://storage.googleapis.com/pib/video.mp4', altText: 'Growth operations clip' }],
        title: 'Daily Growth Decisions, Not Dashboard Debt',
        tags: ['ai-employees', 'growth-ops'],
        privacyStatus: 'public',
        targetVisibility: 'public',
        categoryId: '28',
        publishAt: '2026-07-02T07:00:00.000Z',
        selfDeclaredMadeForKids: false,
      }),
    })

    const { POST } = await import('@/app/api/v1/portal/social/posts/[id]/publish-now/route')
    const res = await POST(request('http://localhost/api/v1/portal/social/posts/post-1/publish-now'), user, params)

    expect(res.status).toBe(200)
    expect(mockPublishPost).toHaveBeenCalledWith(expect.objectContaining({
      text: 'Video description',
      mediaUrls: ['https://storage.googleapis.com/pib/video.mp4'],
      altTexts: ['Growth operations clip'],
      title: 'Daily Growth Decisions, Not Dashboard Debt',
      tags: ['ai-employees', 'growth-ops'],
      privacyStatus: 'public',
      targetVisibility: 'public',
      categoryId: '28',
      publishAt: '2026-07-02T07:00:00.000Z',
      selfDeclaredMadeForKids: false,
    }))
  })

  it('marks the social account expired when publish fails with an expired token', async () => {
    mockPublishPost.mockRejectedValueOnce(new Error('Instagram API error 400: Session has expired'))

    const { POST } = await import('@/app/api/v1/portal/social/posts/[id]/publish-now/route')
    const res = await POST(request('http://localhost/api/v1/portal/social/posts/post-1/publish-now'), user, params)
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(mockMarkAccountTokenExpired).toHaveBeenCalledWith('account-1', 'Instagram API error 400: Session has expired')
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', error: 'Instagram API error 400: Session has expired' }),
    )
    expect(body.error).toContain('Publish failed')
  })
})
