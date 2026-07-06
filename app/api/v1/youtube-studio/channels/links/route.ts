/**
 * GET /api/v1/youtube-studio/channels/links
 *
 * Lightweight accountId -> channelWorkspaceId mapping for the current org.
 * Consumed by Marketing Studio's social accounts page to show "YouTube
 * Studio channel" chips and offer the adopt action.
 */
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess } from '@/lib/api/response'
import { listByOrg, YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'

export const dynamic = 'force-dynamic'

export const GET = withAuth('client', withTenant(async (_req, _user, orgId) => {
  const docs = await listByOrg(YOUTUBE_COLLECTIONS.channels, orgId)
  const links = docs.flatMap((doc) => {
    const data = doc.data() as Record<string, unknown>
    const accountId = typeof data.connectedAccountId === 'string' && data.connectedAccountId.trim()
      ? data.connectedAccountId.trim()
      : null
    if (!accountId) return []
    const readiness = data.publishingReadiness && typeof data.publishingReadiness === 'object'
      ? data.publishingReadiness as Record<string, unknown>
      : {}
    return [{
      channelWorkspaceId: doc.id,
      accountId,
      title: typeof data.title === 'string' ? data.title : 'YouTube channel',
      accountStatus: typeof readiness.accountStatus === 'string' ? readiness.accountStatus : 'connected',
    }]
  })

  return apiSuccess({ links })
}))
