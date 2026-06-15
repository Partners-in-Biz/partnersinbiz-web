import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { buildHabitCheckIn, type HabitCheckInInput, type HabitRecord } from '@/lib/habits/engine'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

async function loadHabit(id: string) {
  const doc = await adminDb.collection('habits').doc(id).get()
  if (!doc.exists) return null
  return { id: doc.id, ...doc.data() } as HabitRecord
}

export const POST = withAuth('client', async (req, user, context) => {
  const { id } = await (context as RouteContext).params
  const habit = await loadHabit(id)
  if (!habit || habit.status === 'archived') return apiError('Habit not found', 404)
  if (!canAccessOrg(user, habit.orgId)) return apiError('Forbidden', 403)

  try {
    const body = (await req.json()) as HabitCheckInInput
    const checkIn = buildHabitCheckIn(habit, body, new Date().toISOString())
    await adminDb.collection('habitCheckIns').doc(checkIn.id).set(checkIn, { merge: true })
    return apiSuccess(checkIn, 201)
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Invalid check-in payload')
  }
})

export const GET = withAuth('client', async (req, user, context) => {
  const { id } = await (context as RouteContext).params
  const habit = await loadHabit(id)
  if (!habit || habit.status === 'archived') return apiError('Habit not found', 404)
  if (!canAccessOrg(user, habit.orgId)) return apiError('Forbidden', 403)

  const { searchParams } = new URL(req.url)
  let query = adminDb.collection('habitCheckIns').where('orgId', '==', habit.orgId).where('habitId', '==', id)
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  if (from) query = query.where('localDate', '>=', from)
  if (to) query = query.where('localDate', '<=', to)

  const snapshot = await query.orderBy('localDate', 'desc').get()
  return apiSuccess(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })))
})
