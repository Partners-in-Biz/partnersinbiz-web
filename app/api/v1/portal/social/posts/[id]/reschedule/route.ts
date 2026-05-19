import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { withTenant } from '@/lib/api/tenant'
import { adminDb } from '@/lib/firebase/admin'
import { hasActivePublishAccount, hasFinalApproval, upsertSocialQueueEntry } from '@/lib/social/scheduling'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export const POST = withAuth('client', withTenant(async (req: NextRequest, user, orgId, context) => {
  const { id } = await (context as Params).params
  const body = await req.json().catch(() => null)
  const scheduledAtRaw = typeof body?.scheduledAt === 'string' ? body.scheduledAt : ''
  const scheduledDate = new Date(scheduledAtRaw)

  if (!scheduledAtRaw || Number.isNaN(scheduledDate.getTime())) {
    return apiError('scheduledAt must be a valid ISO date string', 400)
  }

  const ref = adminDb.collection('social_posts').doc(id)
  const snap = await ref.get()
  if (!snap.exists) return apiError('Post not found', 404)

  const post = snap.data()!
  if (post.orgId && post.orgId !== orgId) return apiError('Post not found', 404)
  if (post.status === 'published') return apiError('Published posts cannot be rescheduled', 400)
  if (post.status === 'cancelled') return apiError('Cancelled posts cannot be rescheduled', 400)
  if (!hasFinalApproval(post)) return apiError('Post must be approved before it can be scheduled', 400)
  if (!(await hasActivePublishAccount(post, orgId))) {
    return apiError('Connect an active social account before scheduling this post', 400)
  }

  const scheduledAt = Timestamp.fromDate(scheduledDate)
  const updates = {
    status: 'scheduled',
    scheduledAt,
    scheduledFor: scheduledAt,
    error: null,
    updatedAt: FieldValue.serverTimestamp(),
  }
  const queuedPost = { ...post, ...updates }

  await ref.update(updates)
  await upsertSocialQueueEntry({
    postId: id,
    orgId,
    scheduledAt,
    post: queuedPost,
  })

  return apiSuccess({
    id,
    status: 'scheduled',
    scheduledAt,
    scheduledFor: scheduledAt,
    error: null,
    updatedBy: user.uid,
  })
}))
