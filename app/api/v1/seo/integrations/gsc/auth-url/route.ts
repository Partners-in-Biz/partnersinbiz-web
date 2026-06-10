import { NextRequest } from 'next/server'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { gscAuthUrl } from '@/lib/seo/integrations/gsc'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const sprintId = new URL(req.url).searchParams.get('sprintId')
  if (!sprintId) return apiError('sprintId is required', 400)
  const state = Buffer.from(JSON.stringify({ sprintId, uid: user.uid, ts: Date.now() })).toString('base64url')
  await adminDb.collection('gsc_oauth_states').doc(state).set({
    sprintId,
    uid: user.uid,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + 15 * 60 * 1000),
    consumedAt: null,
  })
  return apiSuccess({ url: gscAuthUrl(state), state })
})
