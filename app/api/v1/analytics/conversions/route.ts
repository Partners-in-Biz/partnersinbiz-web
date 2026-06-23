import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { actorFrom } from '@/lib/api/actor'
import { analyticsPropertyErrorResponse, requireAnalyticsProperty } from '@/lib/analytics/property-access'
import type { ApiUser } from '@/lib/api/types'
import type { GoalType } from '@/lib/analytics/types'

export const dynamic = 'force-dynamic'

const VALID_TYPES: GoalType[] = ['event', 'pageview', 'duration']

export const GET = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const propertyId = searchParams.get('propertyId')
  if (!propertyId) return apiError('propertyId is required', 400)

  try {
    const property = await requireAnalyticsProperty(user, { propertyId })
    const snap = await adminDb.collection('product_goals')
      .where('propertyId', '==', property.id)
      .orderBy('createdAt', 'desc')
      .get()
    return apiSuccess(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-conversions-get]', e)
    return apiError('Failed to query goals', 500)
  }
})

export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  let body: {
    propertyId?: string; name?: string; type?: GoalType; target?: string
    minDuration?: number; value?: number
  }
  try { body = await req.json() } catch { return apiError('Invalid JSON', 400) }

  const { propertyId, name, type, target, minDuration, value } = body
  if (!propertyId) return apiError('propertyId is required', 400)
  if (!name?.trim()) return apiError('name is required', 400)
  if (!type || !VALID_TYPES.includes(type)) return apiError('Invalid goal type', 400)
  if (type !== 'duration' && !target?.trim()) return apiError('target is required', 400)

  try {
    const property = await requireAnalyticsProperty(user, { propertyId })
    const ref = await adminDb.collection('product_goals').add({
      orgId: property.orgId,
      propertyId: property.id,
      name: name.trim(),
      type,
      target: (target ?? '').trim(),
      minDuration: type === 'duration' ? Math.max(0, Number(minDuration) || 0) : null,
      value: Math.max(0, Number(value) || 0),
      active: true,
      ...actorFrom(user),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return apiSuccess({ id: ref.id }, 201)
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-conversions-post]', e)
    return apiError('Failed to create goal', 500)
  }
})
