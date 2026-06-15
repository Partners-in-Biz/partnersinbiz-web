import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { buildWeeklyReview, type WeeklyReviewInput, type WeeklyReviewRecord } from '@/lib/self-improvement/reflections'

export const dynamic = 'force-dynamic'

export const GET = withAuth('client', async (req, user) => {
  const { searchParams } = new URL(req.url)
  const orgId = searchParams.get('orgId')?.trim()
  const ownerId = searchParams.get('ownerId')?.trim()
  const limit = Math.min(Number(searchParams.get('limit') ?? 100), 200)

  if (!orgId) return apiError('orgId is required; pass it as a query param')
  if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)

  let query = adminDb.collection('life_os_reviews').where('orgId', '==', orgId)
  if (ownerId) query = query.where('ownerId', '==', ownerId)

  const snapshot = await query.orderBy('periodStart', 'desc').get()
  const reviews = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as WeeklyReviewRecord)
    .slice(0, limit)

  return apiSuccess(reviews, 200, { total: reviews.length, page: 1, limit })
})

export const POST = withAuth('client', async (req, user) => {
  const body = (await req.json()) as WeeklyReviewInput
  const orgId = body.orgId?.trim()
  if (!orgId) return apiError('orgId is required')
  if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)

  try {
    const review = buildWeeklyReview({
      ...body,
      orgId,
      ownerId: body.ownerId?.trim() || user.uid,
    }, new Date().toISOString())
    const doc = await adminDb.collection('life_os_reviews').add(review)
    return apiSuccess({ ...review, id: doc.id }, 201)
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Invalid weekly review payload')
  }
})
