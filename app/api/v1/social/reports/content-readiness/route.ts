/**
 * GET /api/v1/social/reports/content-readiness
 * Read-only on-demand marketing readiness diagnostic for chat agents.
 */
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess, apiErrorFromException } from '@/lib/api/response'
import { buildSocialContentReadiness } from '@/lib/social/content-readiness'

export const dynamic = 'force-dynamic'

function rowsFromSnapshot<T extends Record<string, unknown>>(snap: { docs: Array<{ id: string; data: () => T }> }) {
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
}

export const GET = withAuth(
  'client',
  withTenant(async (_req, _user, orgId) => {
    try {
      const [postsSnap, accountsSnap, queueSnap] = await Promise.all([
        adminDb.collection('social_posts').where('orgId', '==', orgId).limit(5000).get(),
        adminDb.collection('social_accounts').where('orgId', '==', orgId).limit(500).get(),
        adminDb.collection('social_queue').where('orgId', '==', orgId).limit(5000).get(),
      ])

      return apiSuccess(buildSocialContentReadiness({
        posts: rowsFromSnapshot(postsSnap),
        accounts: rowsFromSnapshot(accountsSnap),
        queueEntries: rowsFromSnapshot(queueSnap),
      }))
    } catch (err) {
      return apiErrorFromException(err)
    }
  }),
)
