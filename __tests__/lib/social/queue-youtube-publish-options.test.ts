const publishPost = jest.fn()
const queueUpdate = jest.fn()
const postUpdate = jest.fn()
const txnUpdate = jest.fn()

class FakeTimestamp {
  seconds: number

  constructor(seconds: number) {
    this.seconds = seconds
  }

  valueOf() {
    return this.seconds
  }
}

const queueEntry = {
  orgId: 'org-1',
  postId: 'post-youtube-1',
  platform: 'youtube',
  status: 'pending',
  scheduledAt: new FakeTimestamp(1),
  attempts: 0,
  maxAttempts: 5,
}

const postData = {
  orgId: 'org-1',
  platform: 'youtube',
  platforms: ['youtube'],
  status: 'scheduled',
  approvedAt: '2026-07-01T09:00:00.000Z',
  content: { text: 'Description for the growth video' },
  media: [{ type: 'video', url: 'https://cdn.example.com/growth-video.mp4' }],
  title: 'Growth video title',
  tags: ['growth', 'automation'],
  privacyStatus: 'unlisted',
  targetVisibility: 'unlisted',
}

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn((name: string) => {
      if (name === 'social_queue') {
        return {
          where: jest.fn((field: string, _op: string, value: string) => ({
            get: jest.fn().mockResolvedValue({
              docs: value === 'pending'
                ? [{ id: 'post-youtube-1', data: () => queueEntry }]
                : [],
            }),
          })),
          doc: jest.fn(() => ({
            get: jest.fn().mockResolvedValue({ exists: true, data: () => queueEntry }),
            update: queueUpdate.mockResolvedValue(undefined),
          })),
        }
      }
      if (name === 'social_posts') {
        return {
          doc: jest.fn(() => ({
            get: jest.fn().mockResolvedValue({ exists: true, data: () => postData }),
            update: postUpdate.mockResolvedValue(undefined),
          })),
        }
      }
      throw new Error(`Unexpected collection ${name}`)
    }),
    runTransaction: jest.fn(async (callback: (txn: unknown) => Promise<unknown>) => callback({
      get: jest.fn().mockResolvedValue({ exists: true, data: () => queueEntry }),
      update: txnUpdate,
    })),
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
  Timestamp: {
    now: jest.fn(() => new FakeTimestamp(100)),
    fromMillis: jest.fn((millis: number) => new FakeTimestamp(Math.floor(millis / 1000))),
  },
}))

jest.mock('@/lib/social/account-resolver', () => ({
  isTokenExpiredError: jest.fn(() => false),
  markAccountTokenExpired: jest.fn(),
  refreshAccountToken: jest.fn(),
  resolveProvider: jest.fn().mockResolvedValue({
    provider: { publishPost, publishThread: jest.fn() },
    accountId: 'youtube-account-1',
  }),
  toPlatformType: jest.fn((platform: string) => platform),
}))

jest.mock('@/lib/social/publish-text', () => ({
  validatePublishReadyText: jest.fn((text: string) => ({ valid: true, text, errors: [] })),
}))

jest.mock('@/lib/social/outbound-link-validation', () => ({
  validateOutboundLinks: jest.fn().mockResolvedValue({ valid: true, errors: [] }),
}))

jest.mock('@/lib/social/publish-failure-alerts', () => ({
  notifySocialPublishFailure: jest.fn(),
}))

jest.mock('@/lib/social/first-comment', () => ({
  getFirstComment: jest.fn(() => null),
  postFirstComment: jest.fn(),
}))

describe('social queue YouTube publish metadata', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    publishPost.mockResolvedValue({ platformPostId: 'youtube-video-1' })
  })

  it('passes title, tags, privacyStatus, and targetVisibility to the YouTube provider', async () => {
    const { processQueue } = await import('@/lib/social/queue')

    const result = await processQueue()

    expect(result.processed).toBe(1)
    expect(publishPost).toHaveBeenCalledWith(expect.objectContaining({
      text: 'Description for the growth video',
      mediaUrls: ['https://cdn.example.com/growth-video.mp4'],
      title: 'Growth video title',
      tags: ['growth', 'automation'],
      privacyStatus: 'unlisted',
      targetVisibility: 'unlisted',
    }))
  })
})
