import { NextRequest } from 'next/server'

const mockPostGet = jest.fn()
const mockPostUpdate = jest.fn()
const mockCollection = jest.fn()
const mockLogAudit = jest.fn()
const mockLogActivity = jest.fn()

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  },
  Timestamp: {
    fromDate: jest.fn((date: Date) => date),
  },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => mockCollection(name),
  },
}))

jest.mock('@/lib/api/auth', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  withAuth: (_role: 'admin' | 'client', handler: any) => async (req: NextRequest, ctx?: any) =>
    handler(req, { uid: 'ai-agent', role: 'ai' }, ctx),
}))

jest.mock('@/lib/api/tenant', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  withTenant: (handler: any) => async (req: NextRequest, user: any, ctx?: any) =>
    handler(req, user, 'pib-platform-owner', ctx),
}))

jest.mock('@/lib/social/scheduling', () => ({
  cancelSocialQueueEntry: jest.fn(async () => undefined),
  hasActivePublishAccount: jest.fn(async () => true),
  hasFinalApproval: jest.fn(() => true),
  upsertSocialQueueEntry: jest.fn(async () => undefined),
}))

jest.mock('@/lib/social/audit', () => ({
  logAudit: (...args: unknown[]) => mockLogAudit(...args),
}))

jest.mock('@/lib/activity/log', () => ({
  logActivity: (...args: unknown[]) => {
    mockLogActivity(...args)
    return Promise.resolve()
  },
}))

jest.mock('@/lib/social/outbound-link-validation', () => ({
  validateOutboundLinks: jest.fn(async () => ({ valid: true, errors: [] })),
}))

function request(body: unknown) {
  return new NextRequest('http://localhost/api/v1/social/posts/post-1', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockPostGet.mockResolvedValue({
    exists: true,
    data: () => ({
      orgId: 'pib-platform-owner',
      platform: 'youtube',
      platforms: ['youtube'],
      status: 'approved',
      content: { text: 'Draft video description' },
      approvedAt: '2026-07-01T09:18:29.975Z',
      media: [{ url: 'https://storage.googleapis.com/pib/video.mp4', type: 'video' }],
    }),
  })
  mockPostUpdate.mockResolvedValue(undefined)
  mockCollection.mockImplementation((name: string) => ({
    doc: jest.fn(() => ({
      get: name === 'social_posts' ? mockPostGet : jest.fn().mockResolvedValue({ exists: false }),
      update: name === 'social_posts' ? mockPostUpdate : jest.fn(),
    })),
  }))
})

describe('PUT /api/v1/social/posts/:id metadata updates', () => {
  it('persists provider publish metadata for YouTube posts', async () => {
    const { PUT } = await import('@/app/api/v1/social/posts/[id]/route')

    const res = await PUT(request({
      title: 'Daily Growth Decisions, Not Dashboard Debt',
      privacyStatus: 'public',
      targetVisibility: 'public',
      categoryId: '28',
      publishAt: '2026-07-10T07:00:00.000Z',
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: true,
      aiDisclosureNotes: 'AI-assisted captions and editing.',
    }), { params: Promise.resolve({ id: 'post-1' }) })

    expect(res.status).toBe(200)
    expect(mockPostUpdate).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Daily Growth Decisions, Not Dashboard Debt',
      privacyStatus: 'public',
      targetVisibility: 'public',
      categoryId: '28',
      publishAt: '2026-07-10T07:00:00.000Z',
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: true,
      aiDisclosureNotes: 'AI-assisted captions and editing.',
    }))
  })
})
