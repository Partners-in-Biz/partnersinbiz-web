import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withPortalAuth } from '@/lib/auth/portal-middleware'

export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/account/delete/cancel
 * Cancels a scheduled account deletion within the 30-day recovery window.
 */
export const POST = withPortalAuth(async (_req: NextRequest, uid: string) => {
  try {
    const snap = await adminDb
      .collection('account_deletions')
      .where('uid', '==', uid)
      .where('status', '==', 'scheduled')
      .limit(1)
      .get()

    if (snap.empty) {
      return apiError('No scheduled deletion to cancel', 404)
    }

    const doc = snap.docs[0]
    const purgeAfter = Number(doc.data()?.purgeAfter ?? 0)
    if (purgeAfter && Date.now() > purgeAfter) {
      return apiError('Recovery window has expired', 410)
    }

    await doc.ref.update({
      status: 'cancelled',
      cancelledAt: FieldValue.serverTimestamp(),
    })

    return apiSuccess({ job: { id: doc.id, uid, status: 'cancelled' } })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
