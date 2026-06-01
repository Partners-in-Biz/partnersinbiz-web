import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { lastActorFrom } from '@/lib/api/actor'
import { analyticsPropertyErrorResponse, requireAnalyticsProperty } from '@/lib/analytics/property-access'
import { VALID_FUNNEL_WINDOWS } from '@/lib/analytics/types'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withAuth('admin', async (_req: NextRequest, user: ApiUser, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params
  try {
    const snap = await adminDb.collection('product_funnels').doc(id).get()
    if (!snap.exists) return apiError('Funnel not found', 404)
    await requireAnalyticsProperty(user, { propertyId: snap.data()?.propertyId })
    return apiSuccess({ id: snap.id, ...snap.data() })
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-funnel-get]', e)
    return apiError('Failed to fetch funnel', 500)
  }
})

export const PUT = withAuth('admin', async (req: NextRequest, user: ApiUser, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return apiError('Invalid JSON', 400) }

  const ref = adminDb.collection('product_funnels').doc(id)
  try {
    const snap = await ref.get()
    if (!snap.exists) return apiError('Funnel not found', 404)
    await requireAnalyticsProperty(user, { propertyId: snap.data()?.propertyId })

    const update: Record<string, unknown> = { ...lastActorFrom(user), updatedAt: FieldValue.serverTimestamp() }
    if (body.name) update.name = String(body.name).trim()
    if (body.steps) {
      if (!Array.isArray(body.steps) || body.steps.length < 2) return apiError('At least 2 steps required', 400)
      update.steps = body.steps
    }
    if (body.window) {
      if (!VALID_FUNNEL_WINDOWS.includes(body.window as never)) return apiError('Invalid window', 400)
      update.window = body.window
    }

    await ref.update(update)
    const updated = await ref.get()
    return apiSuccess({ id: updated.id, ...updated.data() })
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-funnel-put]', e)
    return apiError('Failed to update funnel', 500)
  }
})

export const DELETE = withAuth('admin', async (_req: NextRequest, user: ApiUser, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params
  try {
    const snap = await adminDb.collection('product_funnels').doc(id).get()
    if (!snap.exists) return apiError('Funnel not found', 404)
    await requireAnalyticsProperty(user, { propertyId: snap.data()?.propertyId })
    await adminDb.collection('product_funnels').doc(id).delete()
    return apiSuccess({ deleted: true })
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-funnel-delete]', e)
    return apiError('Failed to delete funnel', 500)
  }
})
