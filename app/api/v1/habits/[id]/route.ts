import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import type { HabitRecord } from '@/lib/habits/engine'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

async function loadHabit(id: string) {
  const ref = adminDb.collection('habits').doc(id)
  const doc = await ref.get()
  if (!doc.exists) return null
  return { ref, habit: { id: doc.id, ...doc.data() } as HabitRecord }
}

export const GET = withAuth('client', async (_req, user, context) => {
  const { id } = await (context as RouteContext).params
  const loaded = await loadHabit(id)
  if (!loaded || loaded.habit.status === 'archived') return apiError('Habit not found', 404)
  if (!canAccessOrg(user, loaded.habit.orgId)) return apiError('Forbidden', 403)
  return apiSuccess(loaded.habit)
})

export const PATCH = withAuth('client', async (req, user, context) => {
  const { id } = await (context as RouteContext).params
  const loaded = await loadHabit(id)
  if (!loaded || loaded.habit.status === 'archived') return apiError('Habit not found', 404)
  if (!canAccessOrg(user, loaded.habit.orgId)) return apiError('Forbidden', 403)

  const body = (await req.json()) as Partial<HabitRecord>
  const updates: Partial<HabitRecord> = {}
  for (const key of ['title', 'description', 'status', 'schedule', 'anchor', 'minimumViableAction', 'startDate'] as const) {
    if (body[key] !== undefined) updates[key] = body[key] as never
  }
  if (updates.status && !['active', 'paused', 'archived'].includes(updates.status)) {
    return apiError('Invalid status; expected active | paused | archived')
  }
  await loaded.ref.update({ ...updates, updatedAt: new Date().toISOString() })
  return apiSuccess({ ...loaded.habit, ...updates, updatedAt: new Date().toISOString() })
})
