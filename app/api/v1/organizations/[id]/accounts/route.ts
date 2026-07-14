/**
 * GET /api/v1/organizations/[id]/accounts
 * Lists social accounts for the given org.
 */
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { isMember } from '@/lib/organizations/helpers'
import { canAccessOrg } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export const GET = withAuth('admin', async (req, user, ctx) => {
  const { id } = await (ctx as Params).params
  const doc = await adminDb.collection('organizations').doc(id).get()
  if (!doc.exists) return apiError('Organisation not found', 404)
  if (!canAccessOrg(user, id)) return apiError('Forbidden', 403)

  const data = doc.data()!
  // This guard is unreachable with current roles ('admin', 'client', 'ai') because withAuth('admin') blocks clients.
  // Kept intentionally for when lower-privilege roles are introduced.
  if (user.role !== 'admin' && user.role !== 'ai') {
    if (!isMember(data.members ?? [], user.uid)) return apiError('Forbidden', 403)
  }

  const snapshot = await adminDb
    .collection('social_accounts')
    .where('orgId', '==', id)
    .get()

  const accounts = snapshot.docs.map((d) => {
    const acct = d.data()
    const { encryptedTokens: _, ...safe } = acct
    return { id: d.id, ...safe }
  })

  return apiSuccess(accounts, 200, { total: accounts.length, page: 1, limit: accounts.length })
})
