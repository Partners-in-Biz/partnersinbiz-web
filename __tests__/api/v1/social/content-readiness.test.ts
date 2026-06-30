import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: jest.fn() },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: any) => (req: NextRequest, ctx?: unknown) =>
    handler(req, { uid: 'agent:pip', role: 'ai', orgId: 'pib-platform-owner' }, ctx),
}))

jest.mock('@/lib/api/tenant', () => ({
  withTenant: (handler: any) => (req: NextRequest, user: any, ctx?: unknown) =>
    handler(req, user, 'pib-platform-owner', ctx),
}))

import { adminDb } from '@/lib/firebase/admin'
import { buildSocialContentReadiness } from '@/lib/social/content-readiness'
import { GET } from '@/app/api/v1/social/reports/content-readiness/route'

function docs(rows: Record<string, unknown>[], prefix: string) {
  return rows.map((row, index) => ({ id: `${prefix}-${index}`, data: () => row }))
}

function setupCollections({
  posts = [],
  accounts = [],
  queue = [],
}: {
  posts?: Record<string, unknown>[]
  accounts?: Record<string, unknown>[]
  queue?: Record<string, unknown>[]
}) {
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    const getRows = () => {
      if (name === 'social_posts') return posts
      if (name === 'social_accounts') return accounts
      if (name === 'social_queue') return queue
      throw new Error(`Unexpected collection: ${name}`)
    }

    return {
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ docs: docs(getRows(), name) }),
    }
  })
}

describe('social content readiness diagnostics', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('identifies ready approved content with no upcoming schedule as the daily marketing gap', () => {
    const diagnostics = buildSocialContentReadiness({
      now: new Date('2026-06-30T08:00:00.000Z'),
      posts: [
        { id: 'ready-linkedin', status: 'approved', platforms: ['linkedin'], content: { text: 'Use AI agents for daily growth.' }, media: [] },
        { id: 'ready-instagram', status: 'approved', platforms: ['instagram'], content: { text: 'A visual workflow for PiB.' }, media: [{ url: 'https://cdn.example/pib.png', type: 'image' }] },
        { id: 'old-published', status: 'published', platforms: ['facebook'], publishedAt: '2026-06-12T09:00:00.000Z', content: { text: 'Previous post.' } },
      ],
      accounts: [
        { id: 'li', platform: 'linkedin', status: 'active' },
        { id: 'ig', platform: 'instagram', status: 'active' },
        { id: 'fb', platform: 'facebook', status: 'active' },
        { id: 'tw', platform: 'twitter', status: 'active' },
        { id: 'bs', platform: 'bluesky', status: 'active' },
        { id: 'pin', platform: 'pinterest', status: 'active' },
      ],
      queueEntries: [],
    })

    expect(diagnostics.summary.readyToSchedulePosts).toBe(2)
    expect(diagnostics.summary.upcomingScheduledPosts).toBe(0)
    expect(diagnostics.primaryFinding.code).toBe('calendar_gap')
    expect(diagnostics.nextActions[0]).toContain('Ask Maya to turn the approved Vault content into a dated schedule')
    expect(diagnostics.actionQueue[0]).toEqual(expect.objectContaining({
      postId: 'ready-linkedin',
      action: 'schedule_or_repurpose',
      reason: expect.stringContaining('approved'),
    }))
  })

  it('returns tenant-scoped read-only readiness diagnostics from the API route', async () => {
    setupCollections({
      posts: [
        { status: 'approved', platforms: ['linkedin'], content: { text: 'Approved LinkedIn post.' } },
        { status: 'scheduled', platforms: ['twitter'], scheduledFor: '2026-07-01T09:00:00.000Z', content: { text: 'Scheduled X post.' } },
      ],
      accounts: [
        { platform: 'linkedin', status: 'active' },
        { platform: 'twitter', status: 'active' },
      ],
      queue: [
        { postId: 'post-1', status: 'pending', scheduledFor: '2026-07-01T09:00:00.000Z' },
      ],
    })

    const res = await GET(new NextRequest('http://localhost/api/v1/social/reports/content-readiness'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.summary.totalPosts).toBe(2)
    expect(body.data.summary.activeAccounts).toBe(2)
    expect(body.data.summary.pendingQueueEntries).toBe(1)
    expect(adminDb.collection).toHaveBeenCalledWith('social_posts')
    expect(adminDb.collection).toHaveBeenCalledWith('social_accounts')
    expect(adminDb.collection).toHaveBeenCalledWith('social_queue')
  })
})
