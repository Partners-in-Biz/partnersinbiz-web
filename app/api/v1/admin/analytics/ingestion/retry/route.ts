import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { restrictedAdminOrgIds } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/admin/analytics/ingestion/retry  { id }
 *
 * Re-inserts a dead-letter doc into product_events: copies the original
 * payload, stamps retriedAt / retriedBy, then deletes the dead-letter doc.
 * Done atomically inside a Firestore transaction.
 */
export const POST = withAuth('admin', async (req, user) => {
  let body: { id?: unknown }
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!id) return apiError('id is required', 400)

  const deadRef = adminDb.collection('product_events_deadletter').doc(id)
  const restricted = restrictedAdminOrgIds(user)
  const restrictedSet = new Set(restricted)
  const newEventRef = adminDb.collection('product_events').doc()

  try {
    const result = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(deadRef)
      if (!snap.exists) return { ok: false as const, reason: 'not_found' }
      const data = snap.data() as Record<string, unknown>

      const orgId = typeof data.orgId === 'string' ? data.orgId : ''
      if (restrictedSet.size > 0 && !restrictedSet.has(orgId)) {
        return { ok: false as const, reason: 'forbidden' }
      }

      // Strip dead-letter-only metadata so we re-insert a clean event payload.
      const { failedAt, reason, error, retriedAt, retriedBy, ...payload } = data
      void failedAt
      void reason
      void error
      void retriedAt
      void retriedBy

      tx.set(newEventRef, {
        ...payload,
        retriedAt: FieldValue.serverTimestamp(),
        retriedBy: user.uid ?? 'admin',
        retriedFromDeadLetterId: id,
        serverTime: FieldValue.serverTimestamp(),
      })
      tx.delete(deadRef)
      return { ok: true as const, orgId, newEventId: newEventRef.id }
    })

    if (!result.ok) {
      if (result.reason === 'not_found') return apiError('Dead-letter event not found', 404)
      return apiError('You do not have access to this organisation', 403)
    }

    return apiSuccess({
      retried: true,
      deadLetterId: id,
      newEventId: result.newEventId,
      orgId: result.orgId,
    })
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Retry failed', 500)
  }
})
