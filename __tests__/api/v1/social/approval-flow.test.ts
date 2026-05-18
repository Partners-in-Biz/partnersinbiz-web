/**
 * Two-stage approval flow API tests.
 *
 * Covers:
 *   POST /api/v1/social/posts/:id/submit
 *   POST /api/v1/social/posts/:id/qa-approve
 *   POST /api/v1/social/posts/:id/qa-reject
 *   POST /api/v1/social/posts/:id/client-approve
 *   POST /api/v1/social/posts/:id/client-reject
 */
import { NextRequest } from 'next/server'

const AI_KEY = 'test-ai-key'
process.env.AI_API_KEY = AI_KEY
process.env.SESSION_COOKIE_NAME = '__session'

// ---- Hoisted mocks --------------------------------------------------------

const mockGet = jest.fn()
const mockUpdate = jest.fn()
const mockSet = jest.fn()
const mockBatchSet = jest.fn()
const mockBatchUpdate = jest.fn()
const mockBatchCommit = jest.fn().mockResolvedValue(undefined)
const mockBatch = {
  set: mockBatchSet,
  update: mockBatchUpdate,
  commit: mockBatchCommit,
}

const mockCommentsDoc = { id: 'new-comment-id' }
const mockCommentsDocFn = jest.fn(() => mockCommentsDoc)
const mockCommentsCollection = { doc: mockCommentsDocFn }

const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: {
    verifyIdToken: jest.fn(),
    verifySessionCookie: jest.fn(),
  },
  adminDb: {
    get collection() { return mockCollection },
    batch: () => mockBatch,
  },
}))

// Stub regeneration so it never hits the AI SDK or Firestore in tests.
jest.mock('@/lib/social/regenerate', () => ({
  regeneratePost: jest.fn().mockResolvedValue({
    postId: 'p1',
    newStatus: 'qa_review',
    oldText: 'old',
    newText: 'new',
    feedbackUsed: [],
    regenerationCount: 1,
  }),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
    increment: jest.fn((n: number) => ({ __increment: n })),
    arrayUnion: jest.fn((...args: unknown[]) => ({ __arrayUnion: args })),
  },
  Timestamp: {
    fromDate: jest.fn((d: Date) => d),
  },
}))

// ---- Imports under test (after mocks) -------------------------------------
import { POST as SUBMIT } from '@/app/api/v1/social/posts/[id]/submit/route'
import { POST as QA_APPROVE } from '@/app/api/v1/social/posts/[id]/qa-approve/route'
import { POST as QA_REJECT } from '@/app/api/v1/social/posts/[id]/qa-reject/route'
import { POST as CLIENT_APPROVE } from '@/app/api/v1/social/posts/[id]/client-approve/route'
import { POST as CLIENT_REJECT } from '@/app/api/v1/social/posts/[id]/client-reject/route'

// ---- Helpers --------------------------------------------------------------

interface OrgSettings {
  requiresQaApproval?: boolean
  requiresClientApproval?: boolean
  defaultDeliveryMode?: 'auto_publish' | 'download_only' | 'both'
}

interface PostFixture {
  status: string
  orgId?: string
  requiresApproval?: boolean
  deliveryMode?: 'auto_publish' | 'download_only' | 'both'
  scheduledAt?: unknown
  platform?: string
  accountIds?: string[]
  approval?: Record<string, unknown>
}

/**
 * Wires up `mockCollection` so each route's Firestore reads/writes resolve
 * deterministically.
 *
 * - `social_posts` -> a doc that .get() returns the supplied post and
 *   .update() records the call. Includes a `comments` sub-collection.
 * - `organizations` -> a doc that .get() returns the supplied org settings.
 * - `users` -> a doc that .get() returns a fixed displayName.
 * - `social_queue` -> a doc that .set() records the queue write.
 */
function setupMocks(opts: {
  post: PostFixture | null
  org?: OrgSettings
  userDisplayName?: string
} = { post: null }) {
  const post = opts.post
  const org = opts.org ?? {}
  const displayName = opts.userDisplayName ?? 'Test User'

  mockGet.mockReset()
  mockUpdate.mockReset().mockResolvedValue(undefined)
  mockSet.mockReset().mockResolvedValue(undefined)
  mockBatchSet.mockReset()
  mockBatchUpdate.mockReset()
  mockBatchCommit.mockReset().mockResolvedValue(undefined)
  mockCollection.mockReset()
  mockCommentsDocFn.mockReset().mockReturnValue(mockCommentsDoc)

  const postRef = {
    get: jest.fn().mockResolvedValue({
      exists: post !== null,
      data: () => (post ? { orgId: 'org-1', ...post } : undefined),
    }),
    update: mockUpdate,
    collection: jest.fn().mockReturnValue(mockCommentsCollection),
  }

  const orgRef = {
    get: jest.fn().mockResolvedValue({
      exists: true,
      data: () => ({
        settings: {
          social: {
            requiresQaApproval: org.requiresQaApproval,
            requiresClientApproval: org.requiresClientApproval,
            defaultDeliveryMode: org.defaultDeliveryMode,
          },
        },
      }),
    }),
  }

  const userRef = {
    get: jest.fn().mockResolvedValue({
      exists: true,
      data: () => ({ displayName, role: 'admin' }),
    }),
  }

  const queueRef = { set: mockSet }

  mockCollection.mockImplementation((name: string) => {
    if (name === 'social_posts') return { doc: jest.fn().mockReturnValue(postRef) }
    if (name === 'organizations') return { doc: jest.fn().mockReturnValue(orgRef) }
    if (name === 'users') return { doc: jest.fn().mockReturnValue(userRef) }
    if (name === 'social_queue') return { doc: jest.fn().mockReturnValue(queueRef) }
    if (name === 'social_audit_log') {
      return { add: jest.fn().mockResolvedValue({ id: 'audit-1' }) }
    }
    if (name === 'notifications') {
      return { add: jest.fn().mockResolvedValue({ id: 'notif-1' }) }
    }
    if (name === 'social_accounts') {
      return {
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ orgId: 'org-1', status: 'active' }),
          }),
        }),
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue({ empty: false, docs: [{ id: 'acct-1', data: () => ({ orgId: 'org-1', status: 'active' }) }] }),
          }),
        }),
      }
    }
    if (name === 'activity') {
      return { add: jest.fn().mockResolvedValue({ id: 'activity-1' }) }
    }
    throw new Error(`Unexpected collection: ${name}`)
  })
}

function makeReq(body?: object) {
  return new NextRequest('http://localhost/test', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${AI_KEY}`,
      'x-org-id': 'org-1',
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) } as unknown as { params: Promise<{ id: string }> })

// ---- Tests ----------------------------------------------------------------

describe('POST /api/v1/social/posts/:id/submit', () => {
  it('transitions draft -> qa_review with default org settings', async () => {
    setupMocks({ post: { status: 'draft' } })

    const res = await SUBMIT(makeReq(), ctx('p1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.status).toBe('qa_review')
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'qa_review' }),
    )
  })

  it('transitions draft -> client_review when requiresQa is false', async () => {
    setupMocks({
      post: { status: 'draft' },
      org: { requiresQaApproval: false, requiresClientApproval: true },
    })

    const res = await SUBMIT(makeReq(), ctx('p1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.status).toBe('client_review')
  })

  it('transitions draft -> approved (then finalised) when requiresApproval is false', async () => {
    setupMocks({
      post: { status: 'draft', requiresApproval: false, deliveryMode: 'download_only' },
    })

    const res = await SUBMIT(makeReq(), ctx('p1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    // download_only -> vaulted
    expect(body.data.status).toBe('vaulted')
  })

  it('returns 400 when post is not in draft', async () => {
    setupMocks({ post: { status: 'qa_review' } })

    const res = await SUBMIT(makeReq(), ctx('p1'))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/must be draft/i)
  })

  it('returns 404 when post does not exist', async () => {
    setupMocks({ post: null })

    const res = await SUBMIT(makeReq(), ctx('p1'))

    expect(res.status).toBe(404)
  })
})

describe('POST /api/v1/social/posts/:id/qa-approve', () => {
  it('transitions qa_review -> client_review', async () => {
    setupMocks({ post: { status: 'qa_review' } })

    const res = await QA_APPROVE(makeReq(), ctx('p1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.status).toBe('client_review')
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'client_review',
        'approval.qaApprovedBy': expect.anything(),
      }),
    )
  })

  it('transitions qa_review -> approved when requiresClientApproval is false', async () => {
    setupMocks({
      post: { status: 'qa_review', deliveryMode: 'auto_publish' },
      org: { requiresClientApproval: false },
    })

    const res = await QA_APPROVE(makeReq(), ctx('p1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    // auto_publish + no scheduledAt => approved
    expect(body.data.status).toBe('approved')
  })

  it('returns 400 for an invalid transition', async () => {
    setupMocks({ post: { status: 'draft' } })

    const res = await QA_APPROVE(makeReq(), ctx('p1'))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/qa_review/)
  })
})

describe('POST /api/v1/social/posts/:id/qa-reject', () => {
  it('transitions qa_review -> regenerating, writes a qa_rejection comment, increments rejectionCount', async () => {
    setupMocks({ post: { status: 'qa_review', approval: { rejectionCount: 0 } } })

    const res = await QA_REJECT(makeReq({ reason: 'Off brand voice.' }), ctx('p1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.status).toBe('regenerating')

    // Comment doc was set with kind=qa_rejection
    expect(mockBatchSet).toHaveBeenCalledWith(
      mockCommentsDoc,
      expect.objectContaining({
        kind: 'qa_rejection',
        userRole: 'admin',
        text: 'Off brand voice.',
        agentPickedUp: false,
      }),
    )

    // Post update batched with status=regenerating + increment + arrayUnion
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: 'regenerating',
        'approval.rejectionCount': { __increment: 1 },
        'approval.lastRejectionStage': 'qa',
      }),
    )

    expect(mockBatchCommit).toHaveBeenCalled()
  })

  it('returns 400 when reason is empty', async () => {
    setupMocks({ post: { status: 'qa_review' } })

    const res = await QA_REJECT(makeReq({ reason: '   ' }), ctx('p1'))

    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid transition', async () => {
    setupMocks({ post: { status: 'draft' } })

    const res = await QA_REJECT(makeReq({ reason: 'no good' }), ctx('p1'))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/qa_review/)
  })
})

describe('POST /api/v1/social/posts/:id/client-approve', () => {
  it('transitions client_review -> vaulted when deliveryMode === download_only', async () => {
    setupMocks({
      post: { status: 'client_review', deliveryMode: 'download_only' },
    })

    const res = await CLIENT_APPROVE(makeReq(), ctx('p1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.status).toBe('vaulted')
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        'approval.clientApprovedBy': expect.anything(),
        // legacy back-compat fields
        approvedBy: expect.anything(),
        approvedAt: expect.anything(),
      }),
    )
  })

  it('transitions client_review -> scheduled when auto_publish + scheduledAt set', async () => {
    setupMocks({
      post: {
        status: 'client_review',
        deliveryMode: 'auto_publish',
        scheduledAt: { seconds: 1234, nanoseconds: 0 },
        platform: 'instagram',
        accountIds: ['acct-1'],
      },
    })

    const res = await CLIENT_APPROVE(makeReq(), ctx('p1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.status).toBe('scheduled')

    // social_queue doc was set
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        postId: 'p1',
        status: 'pending',
      }),
      { merge: true },
    )
  })

  it('returns 400 when current status is draft', async () => {
    setupMocks({ post: { status: 'draft' } })

    const res = await CLIENT_APPROVE(makeReq(), ctx('p1'))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/client_review/)
  })

  it('also accepts legacy pending_approval status', async () => {
    setupMocks({
      post: { status: 'pending_approval', deliveryMode: 'download_only' },
    })

    const res = await CLIENT_APPROVE(makeReq(), ctx('p1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.status).toBe('vaulted')
  })
})

describe('POST /api/v1/social/posts/:id/client-reject', () => {
  it('transitions client_review -> regenerating, writes a client_rejection comment', async () => {
    setupMocks({ post: { status: 'client_review', approval: { rejectionCount: 1 } } })

    const res = await CLIENT_REJECT(makeReq({ reason: 'Too pushy.' }), ctx('p1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.status).toBe('regenerating')

    expect(mockBatchSet).toHaveBeenCalledWith(
      mockCommentsDoc,
      expect.objectContaining({
        kind: 'client_rejection',
        userRole: 'client',
        text: 'Too pushy.',
        agentPickedUp: false,
      }),
    )

    expect(mockBatchUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: 'regenerating',
        'approval.lastRejectionStage': 'client',
      }),
    )
  })

  it('returns 400 when reason is missing', async () => {
    setupMocks({ post: { status: 'client_review' } })

    const res = await CLIENT_REJECT(makeReq({}), ctx('p1'))

    expect(res.status).toBe(400)
  })

  it('returns 400 when called from qa_review', async () => {
    setupMocks({ post: { status: 'qa_review' } })

    const res = await CLIENT_REJECT(makeReq({ reason: 'no' }), ctx('p1'))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/client_review/)
  })
})
