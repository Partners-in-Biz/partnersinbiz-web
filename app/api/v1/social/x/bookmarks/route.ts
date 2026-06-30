import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { fetchXBookmarksForAccount, findPersonalXBookmarkAccount, missingXBookmarkScopes } from '@/lib/social/x-bookmarks'

export const dynamic = 'force-dynamic'

export const GET = withAuth('client', withTenant(async (req: NextRequest, user, orgId) => {
  const url = new URL(req.url)
  const scope = url.searchParams.get('scope')
  if (scope !== 'personal') {
    return apiError('X bookmarks are only available for personal user-owned accounts. Use scope=personal.', 400)
  }

  const maxResultsRaw = Number(url.searchParams.get('maxResults') ?? '5')
  const maxResults = Number.isFinite(maxResultsRaw) ? Math.min(Math.max(Math.floor(maxResultsRaw), 1), 100) : 5
  const account = await findPersonalXBookmarkAccount(orgId, user.uid)

  if (!account) {
    const personalXAccounts = await adminDb
      .collection('social_accounts')
      .where('orgId', '==', orgId)
      .where('platform', '==', 'twitter')
      .where('accountScope', '==', 'personal')
      .where('ownerUid', '==', user.uid)
      .get()
    const activeAccount = personalXAccounts.docs.map((doc) => ({ id: doc.id, data: doc.data() })).find((item) => item.data.status === 'active')
    return apiError(
      activeAccount
        ? `Reconnect your personal X account so PiB can request bookmark scopes. Missing: ${missingXBookmarkScopes(activeAccount.data.scopes).join(', ')}`
        : 'Connect your personal X account before reading bookmarks.',
      409,
    )
  }

  try {
    const bookmarks = await fetchXBookmarksForAccount({ orgId, account: account.data, maxResults })
    return apiSuccess({ accountId: account.id, bookmarks, latest: bookmarks[0] ?? null })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Could not fetch X bookmarks', 502)
  }
}))
