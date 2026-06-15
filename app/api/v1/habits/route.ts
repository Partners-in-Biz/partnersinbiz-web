import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { buildHabitRecord, type HabitInput, type HabitRecord } from '@/lib/habits/engine'

export const dynamic = 'force-dynamic'

export const GET = withAuth('client', async (req, user) => {
  const { searchParams } = new URL(req.url)
  const orgId = searchParams.get('orgId')?.trim()
  const ownerId = searchParams.get('ownerId')?.trim()
  const status = searchParams.get('status')?.trim()
  const limit = Math.min(Number(searchParams.get('limit') ?? 100), 200)

  if (!orgId) return apiError('orgId is required; pass it as a query param')
  if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)

  let query = adminDb.collection('habits').where('orgId', '==', orgId)
  if (ownerId) query = query.where('ownerId', '==', ownerId)
  if (status) query = query.where('status', '==', status)

  const snapshot = await query.orderBy('createdAt', 'desc').get()
  const habits = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as HabitRecord)
    .filter((habit) => habit.status !== 'archived')
    .slice(0, limit)

  return apiSuccess(habits, 200, { total: habits.length, page: 1, limit })
})

export const POST = withAuth('client', async (req, user) => {
  const body = (await req.json()) as HabitInput
  const orgId = body.orgId?.trim()
  if (!orgId) return apiError('orgId is required')
  if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)

  try {
    const habit = buildHabitRecord({
      ...body,
      orgId,
      ownerId: body.ownerId?.trim() || user.uid,
    }, new Date().toISOString())
    const doc = await adminDb.collection('habits').add(habit)
    return apiSuccess({ ...habit, id: doc.id }, 201)
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Invalid habit payload')
  }
})
