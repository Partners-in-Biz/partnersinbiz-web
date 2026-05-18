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

  let snap
  try {
    snap = await adminDb
      .collection('notifications')
      .where('orgId', '==', ctx.orgId)
      .where('userId', '==', uid)
      .where('status', '==', 'unread')
      .limit(100)
      .get()
  } catch (err) {
    console.error('mark-read query failed', err)
    return apiError('Failed to mark notifications as read', 500)
  }

  if (snap.empty) return apiSuccess({ updated: 0 })

  const batch = adminDb.batch()
  snap.docs.forEach(doc => {
    batch.update(doc.ref, {
      status: 'read',
      readAt: FieldValue.serverTimestamp(),
    })
  })

  await batch.commit()

  return apiSuccess({ updated: snap.size })
}

export const POST = withCrmAuth('viewer', handler)
