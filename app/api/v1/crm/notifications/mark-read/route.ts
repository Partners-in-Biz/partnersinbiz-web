/**
 * POST /api/v1/crm/notifications/mark-read
 * Marks all unread notifications as read for the current user in this org.
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

async function handler(_req: NextRequest, ctx: CrmAuthContext): Promise<Response> {
  const uid = ctx.actor.uid

  try {
    const snap = await adminDb
      .collection('notifications')
      .where('orgId', '==', ctx.orgId)
      .limit(250)
      .get()

    const docs = snap.docs.filter(doc => {
      const data = doc.data()
      const userId = data.userId
      return data.status === 'unread' && (userId === uid || userId === null || typeof userId === 'undefined')
    })

    if (docs.length === 0) return apiSuccess({ updated: 0 })

    const batch = adminDb.batch()
    docs.forEach(doc => {
      batch.update(doc.ref, {
        status: 'read',
        readAt: FieldValue.serverTimestamp(),
      })
    })

    await batch.commit()

    return apiSuccess({ updated: docs.length })
  } catch (err) {
    console.error('mark-read query failed', err)
    return apiError('Failed to mark notifications as read', 500)
  }
}

export const POST = withCrmAuth('viewer', handler)
