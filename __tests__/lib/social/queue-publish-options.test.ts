const mockQueueUpdate = jest.fn()
const mockPostUpdate = jest.fn()
const mockTxnUpdate = jest.fn()
const mockPublishPost = jest.fn()

const dueQueueDoc = {
  id: 'queue-youtube-post',
  data: () => ({
    orgId: 'pib-platform-owner',
    postId: 'youtube-post',
    status: 'pending',
    scheduledAt: { seconds: 1 },
    attempts: 0,
    maxAttempts: 5,
  }),
}

const scheduledYoutubePost = {
  orgId: 'pib-platform-owner',
  platform: 'youtube',
  status: 'scheduled',
  approvedAt: '2026-07-01T09:00:00.000Z',
  content: { text: 'Daily Growth Decisions\n\nA short description for YouTube.' },
  media: [{ url: 'https://storage.googleapis.com/pib/video.mp4', type: 'video' }],
  title: 'Daily Growth Decisions, Not Dashboard Debt',
  tags: ['ai-employees', 'growth-ops'],
  privacyStatus: 'public',
  targetVisibility: 'public',
  categoryId: '28',
  publishAt: '2026-07-02T07:00:00.000Z',
  selfDeclaredMadeForKids: false,
}

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'server-timestamp'),
  },
  Timestamp: {
    now: jest.fn(() => ({ seconds: 2 })),
    fromMillis: jest.fn((millis: number) => ({ seconds: Math.floor(millis / 1000) })),
  },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn((name: string) => {
      if (name === 'social_queue') {
        return {
          where: jest.fn((field: string, op: string, value: string) => ({
            get: jest.fn().mockResolvedValue({
              docs: value === 'pending' ? [dueQueueDoc] : [],
            }),
          })),
          doc: jest.fn(() => ({
            update: mockQueueUpdate.mockResolvedValue(undefined),
          })),
        }
      }
      if (name === 'social_posts') {
        return {
          doc: jest.fn(() => ({
            get: jest.fn().mockResolvedValue({
              exists: true,
              data: () => scheduledYoutubePost,
            }),
            update: mockPostUpdate.mockResolvedValue(undefined),
          })),
        }
      }
      throw new Error(`Unexpected collection ${name}`)
    }),
    runTransaction: jest.fn(async (callback: (txn: unknown) => Promise<unknown>) => callback({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({ status: 'pending', scheduledAt: { seconds: 1 } }),
      }),
      update: mockTxnUpdate,
    })),
  },
}))

jest.mock('@/lib/social/account-resolver', () => ({
  isTokenExpiredError: jest.fn(() => false),
  markAccountTokenExpired: jest.fn(),
  refreshAccountToken: jest.fn(),
  resolveProvider: jest.fn(async () => ({
    accountId: 'youtube-account',
    provider: {
      publishPost: mockPublishPost.mockResolvedValue({ platformPostId: 'yt-123' }),
    },
  })),
  toPlatformType: jest.fn(() => 'youtube'),
}))

jest.mock('@/lib/social/scheduling', () => ({
  hasFinalApproval: jest.fn(() => true),
}))

jest.mock('@/lib/social/publish-text', () => ({
  validatePublishReadyText: jest.fn((text: string) => ({ valid: true, text, errors: [] })),
}))

jest.mock('@/lib/social/outbound-link-validation', () => ({
  validateOutboundLinks: jest.fn(async () => ({ valid: true, errors: [] })),
}))

jest.mock('@/lib/social/publish-failure-alerts', () => ({
  notifySocialPublishFailure: jest.fn(async () => undefined),
}))

jest.mock('@/lib/social/first-comment', () => ({
  getFirstComment: jest.fn(() => null),
  postFirstComment: jest.fn(async () => undefined),
}))

describe('social queue publish options', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('passes YouTube upload metadata from the post to the provider', async () => {
    const { processQueue } = await import('@/lib/social/queue')

    const result = await processQueue()

    expect(result.processed).toBe(1)
    expect(mockPublishPost).toHaveBeenCalledWith(expect.objectContaining({
      text: scheduledYoutubePost.content.text,
      mediaUrls: ['https://storage.googleapis.com/pib/video.mp4'],
      title: scheduledYoutubePost.title,
      tags: scheduledYoutubePost.tags,
      privacyStatus: 'public',
      targetVisibility: 'public',
      categoryId: '28',
      publishAt: scheduledYoutubePost.publishAt,
      selfDeclaredMadeForKids: false,
    }))
  })
})
