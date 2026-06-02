import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { actorFrom } from '@/lib/api/actor'
import { analyticsPropertyErrorResponse, requireAnalyticsProperty } from '@/lib/analytics/property-access'
import { VALID_FUNNEL_WINDOWS } from '@/lib/analytics/types'
import type { ApiUser } from '@/lib/api/types'
import type { FunnelStep, FunnelWindow } from '@/lib/analytics/types'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const propertyId = searchParams.get('propertyId')
  if (!propertyId) return apiError('propertyId is required', 400)

  try {
    const property = await requireAnalyticsProperty(user, { propertyId })
    const snap = await adminDb.collection('product_funnels')
      .where('propertyId', '==', property.id)
      .orderBy('createdAt', 'desc')
      .get()
    return apiSuccess(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-funnels-get]', e)
    return apiError('Failed to query funnels', 500)
  }
})

export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  let body: { propertyId?: string; name?: string; steps?: FunnelStep[]; window?: FunnelWindow }
  try { body = await req.json() } catch { return apiError('Invalid JSON', 400) }

  const { propertyId, name, steps, window: win } = body
  if (!propertyId) return apiError('propertyId is required', 400)
  if (!name?.trim()) return apiError('name is required', 400)
  if (!Array.isArray(steps) || steps.length < 2) return apiError('At least 2 steps required', 400)
  if (win && !VALID_FUNNEL_WINDOWS.includes(win)) return apiError('Invalid window', 400)

  try {
    const property = await requireAnalyticsProperty(user, { propertyId })
    const ref = await adminDb.collection('product_funnels').add({
      orgId: property.orgId,
      propertyId: property.id,
      name: name.trim(),
      steps,
      window: win ?? '24h',
      ...actorFrom(user),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return apiSuccess({ id: ref.id }, 201)
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-funnels-post]', e)
    return apiError('Failed to create funnel', 500)
  }
})
