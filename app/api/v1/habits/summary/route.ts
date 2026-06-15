import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { summarizeHabitHealth, type HabitCheckIn, type HabitRecord } from '@/lib/habits/engine'

export const dynamic = 'force-dynamic'

export const GET = withAuth('client', async (req, user) => {
  const { searchParams } = new URL(req.url)
  const orgId = searchParams.get('orgId')?.trim()
  const ownerId = searchParams.get('ownerId')?.trim()
  const weekStart = searchParams.get('weekStart')?.trim() || undefined
  const today = searchParams.get('today')?.trim() || undefined

  if (!orgId) return apiError('orgId is required; pass it as a query param')
  if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)

  let habitsQuery = adminDb.collection('habits').where('orgId', '==', orgId)
  if (ownerId) habitsQuery = habitsQuery.where('ownerId', '==', ownerId)
  const habitsSnapshot = await habitsQuery.orderBy('createdAt', 'desc').get()
  const habits = habitsSnapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as HabitRecord)
    .filter((habit) => habit.status !== 'archived')

  let checkInsQuery = adminDb.collection('habitCheckIns').where('orgId', '==', orgId)
  if (ownerId) checkInsQuery = checkInsQuery.where('ownerId', '==', ownerId)
  const checkInsSnapshot = await checkInsQuery.orderBy('localDate', 'desc').get()
  const checkIns = checkInsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as HabitCheckIn)

  const summaries = habits.map((habit) => summarizeHabitHealth(habit, checkIns, { weekStart, today }))
  return apiSuccess(summaries, 200, { total: summaries.length, page: 1, limit: summaries.length })
})
