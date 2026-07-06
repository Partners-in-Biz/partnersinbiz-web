/**
 * POST /api/v1/youtube-studio/channels/adopt
 *
 * "Use existing connection": provision (or heal) a YouTube Studio channel
 * workspace from a social account that was already connected via Marketing
 * Studio - same helper the OAuth callback uses, no OAuth round-trip.
 * Body: { accountId: string }
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiError, apiSuccess } from '@/lib/api/response'
import { isPortalModuleEnabled } from '@/lib/organizations/portal-modules'
import { provisionYouTubeChannelWorkspace } from '@/lib/youtube-studio/channel-provisioning'

export const dynamic = 'force-dynamic'

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export const POST = withAuth('client', withTenant(async (req: NextRequest, user, orgId) => {
  const body = await req.json().catch(() => ({}))
  const accountId = cleanString(body.accountId)
  if (!accountId) return apiError('accountId is required', 400)

  const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
  if (!orgDoc.exists) return apiError('Organisation not found', 404)
  if (user.role !== 'admin' && user.role !== 'ai' && !isPortalModuleEnabled(orgDoc.data()?.settings, 'youtubeStudio')) {
    return apiError('YouTube Studio module is disabled for this client portal', 403, {
      moduleDisabled: true,
      module: 'youtubeStudio',
    })
  }

  const accountDoc = await adminDb.collection('social_accounts').doc(accountId).get()
  const account = accountDoc.data()
  if (!accountDoc.exists || account?.orgId !== orgId) return apiError('Social account not found', 404)
  if (account.platform !== 'youtube') return apiError('accountId must reference a YouTube social account', 400)
  if (account.accountScope === 'personal') {
    return apiError('Personal YouTube accounts cannot power an organisation channel workspace', 400)
  }
  const platformAccountId = cleanString(account.platformAccountId)
  if (!platformAccountId || platformAccountId === 'unknown') {
    return apiError('This YouTube account has no channel id. Reconnect it via OAuth first.', 400)
  }

  const result = await provisionYouTubeChannelWorkspace(orgId, accountId, {
    platformAccountId,
    displayName: cleanString(account.displayName) ?? 'YouTube channel',
    username: cleanString(account.username),
    avatarUrl: cleanString(account.avatarUrl),
    profileUrl: cleanString(account.profileUrl),
    meta: account.platformMeta && typeof account.platformMeta === 'object' ? account.platformMeta : undefined,
  })

  return apiSuccess(
    { channelWorkspaceId: result.channelWorkspaceId, created: result.created },
    result.created ? 201 : 200,
  )
}))
