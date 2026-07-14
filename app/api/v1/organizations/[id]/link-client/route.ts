/**
 * POST /api/v1/organizations/[id]/link-client — link org to a client record
 * Body: { clientId: string }
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { isOwnerOrAdmin } from '@/lib/organizations/helpers'
import { canAccessOrg } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export const POST = withAuth('admin', async (req, user, ctx) => {
  const { id } = await (ctx as Params).params
  const doc = await adminDb.collection('organizations').doc(id).get()
  if (!doc.exists) return apiError('Organisation not found', 404)
  if (!canAccessOrg(user, id)) return apiError('Forbidden', 403)

  const data = doc.data()!
  // This guard is unreachable with current roles ('admin', 'client', 'ai') because withAuth('admin') blocks clients.
  // Kept intentionally for when lower-privilege roles are introduced.
  if (user.role !== 'admin' && user.role !== 'ai') {
    if (!isOwnerOrAdmin(data.members ?? [], user.uid)) return apiError('Forbidden', 403)
  }

  const body = await req.json().catch(() => ({}))
  const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : ''
  if (!clientId) return apiError('clientId is required', 400)

  // Verify client exists
  const clientDoc = await adminDb.collection('clients').doc(clientId).get()
  if (!clientDoc.exists) return apiError('Client not found', 404)

  // Idempotency: same client → no-op. Different client → explicit conflict.
  if (data.linkedClientId) {
    if (data.linkedClientId === clientId) return apiSuccess({ linked: true, clientId })
    return apiError(
      `Organisation is already linked to client ${data.linkedClientId}. Unlink it first.`,
      409,
    )
  }

  await adminDb.collection('organizations').doc(id).update({
    linkedClientId: clientId,
    updatedAt: FieldValue.serverTimestamp(),
  })

  return apiSuccess({ linked: true, clientId })
})
