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
import { buildSocialFailedPostDiagnostics } from '@/lib/social/failed-post-diagnostics'
import { GET } from '@/app/api/v1/social/reports/failed-post-diagnostics/route'

function docs(rows: Record<string, unknown>[], prefix: string) {
  return rows.map((row, index) => ({ id: `${prefix}-${index}`, data: () => row }))
}

function setupCollections({
  posts = [],
  accounts = [],
}: {
  posts?: Record<string, unknown>[]
  accounts?: Record<string, unknown>[]
}) {
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    const getRows = () => {
      if (name === 'social_posts') return posts
      if (name === 'social_accounts') return accounts
      throw new Error(`Unexpected collection: ${name}`)
    }

    return {
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ docs: docs(getRows(), name) }),
    }
  })
}

describe('social failed post diagnostics', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('groups failed posts by platform and recovery category', () => {
    const diagnostics = buildSocialFailedPostDiagnostics({
      now: new Date('2026-06-30T08:00:00.000Z'),
      posts: [
        {
          id: 'linkedin-expired-token',
          status: 'failed',
          platforms: ['linkedin'],
          accountIds: ['li'],
          error: 'LinkedIn image initializeUpload error 401: EXPIRED_ACCESS_TOKEN',
          content: { text: 'LinkedIn post' },
          updatedAt: '2026-06-29T10:00:00.000Z',
        },
        {
          id: 'twitter-media-scope',
          status: 'failed',
          platform: 'x',
          platforms: ['x'],
          accountIds: ['tw'],
          error: 'Twitter/X media upload requires OAuth 1.0a credentials or an OAuth 2 token with media upload support.',
        },
        {
          id: 'queued-not-failed',
          status: 'scheduled',
          platforms: ['twitter'],
          accountIds: ['tw'],
        },
        {
          id: 'deleted-failed',
          status: 'failed',
          deleted: true,
          platforms: ['facebook'],
        },
      ],
      accounts: [
        { id: 'li', platform: 'linkedin', status: 'active' },
        { id: 'tw', platform: 'twitter', status: 'active' },
      ],
    })

    expect(diagnostics.summary.totalPosts).toBe(3)
    expect(diagnostics.summary.failedPosts).toBe(2)
    expect(diagnostics.summary.platformsAffected).toBe(2)
    expect(diagnostics.summary.expiredOrUnpublishableFailures).toBe(1)
    expect(diagnostics.summary.mediaCredentialFailures).toBe(1)
    expect(diagnostics.primaryFinding.code).toBe('auth_reconnect_required')
    expect(diagnostics.platformBreakdown.map((item) => item.platform).sort()).toEqual(['linkedin', 'twitter'])
    expect(diagnostics.errorBreakdown).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'account_auth_or_publishability', count: 1, platforms: ['linkedin'] }),
      expect.objectContaining({ category: 'media_upload_or_scope', count: 1, platforms: ['twitter'] }),
    ]))
    expect(diagnostics.recoveryQueue[0]).toEqual(expect.objectContaining({
      postId: 'linkedin-expired-token',
      safeToRetry: false,
      recommendedAction: expect.stringContaining('Reconnect'),
    }))
  })

  it('returns tenant-scoped read-only diagnostics from the API route', async () => {
    setupCollections({
      posts: [
        { status: 'failed', platforms: ['bluesky'], accountIds: ['bs'], error: 'Selected bluesky account is not publishable. Reconnect it from Social Accounts and try again.' },
        { status: 'published', platforms: ['linkedin'], accountIds: ['li'] },
      ],
      accounts: [
        { id: 'bs', platform: 'bluesky', status: 'active' },
        { id: 'li', platform: 'linkedin', status: 'active' },
      ],
    })

    const res = await GET(new NextRequest('http://localhost/api/v1/social/reports/failed-post-diagnostics'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.summary.totalPosts).toBe(2)
    expect(body.data.summary.failedPosts).toBe(1)
    expect(body.data.primaryFinding.code).toBe('auth_reconnect_required')
    expect(adminDb.collection).toHaveBeenCalledWith('social_posts')
    expect(adminDb.collection).toHaveBeenCalledWith('social_accounts')
  })
})
