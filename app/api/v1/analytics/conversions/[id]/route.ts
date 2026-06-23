import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { analyticsPropertyErrorResponse, requireAnalyticsProperty } from '@/lib/analytics/property-access'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

async function loadGoal(user: ApiUser, id: string) {
  const snap = await adminDb.collection('product_goals').doc(id).get()
  if (!snap.exists) return null
  const goal = snap.data()!
  await requireAnalyticsProperty(user, { propertyId: goal.propertyId })
  return { ref: snap.ref, goal }
}

export const PATCH = withAuth('admin', async (req: NextRequest, user: ApiUser, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return apiError('Invalid JSON', 400) }

  try {
    const loaded = await loadGoal(user, id)
    if (!loaded) return apiError('Goal not found', 404)

    const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }
    if (typeof body.name === 'string') update.name = body.name.trim()
    if (typeof body.target === 'string') update.target = body.target.trim()
    if (typeof body.value === 'number') update.value = Math.max(0, body.value)
    if (typeof body.minDuration === 'number') update.minDuration = Math.max(0, body.minDuration)
    if (typeof body.active === 'boolean') update.active = body.active

    await loaded.ref.update(update)
    return apiSuccess({ id })
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-goal-patch]', e)
    return apiError('Failed to update goal', 500)
  }
})

export const DELETE = withAuth('admin', async (_req: NextRequest, user: ApiUser, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params
  try {
    const loaded = await loadGoal(user, id)
    if (!loaded) return apiError('Goal not found', 404)
    await loaded.ref.delete()
    return apiSuccess({ id })
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-goal-delete]', e)
    return apiError('Failed to delete goal', 500)
  }
})
