/**
 * GET /api/v1/social/reports/failed-post-diagnostics
 * Read-only on-demand failed-publish recovery diagnostic for chat agents.
 */
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess, apiErrorFromException } from '@/lib/api/response'
import { buildSocialFailedPostDiagnostics } from '@/lib/social/failed-post-diagnostics'

export const dynamic = 'force-dynamic'

function rowsFromSnapshot<T extends Record<string, unknown>>(snap: { docs: Array<{ id: string; data: () => T }> }) {
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
}

export const GET = withAuth(
  'client',
  withTenant(async (_req, _user, orgId) => {
    try {
      const [postsSnap, accountsSnap] = await Promise.all([
        adminDb.collection('social_posts').where('orgId', '==', orgId).limit(5000).get(),
        adminDb.collection('social_accounts').where('orgId', '==', orgId).limit(500).get(),
      ])

      return apiSuccess(buildSocialFailedPostDiagnostics({
        posts: rowsFromSnapshot(postsSnap),
        accounts: rowsFromSnapshot(accountsSnap),
      }))
    } catch (err) {
      return apiErrorFromException(err)
    }
  }),
)
