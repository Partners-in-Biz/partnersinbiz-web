import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { analyticsPropertyErrorResponse, requireAnalyticsProperty } from '@/lib/analytics/property-access'
import { AVAILABLE_METRICS } from '@/lib/analytics/report-metrics'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function loadReport(user: ApiUser, id: string) {
  const snap = await adminDb.collection('product_reports').doc(id).get()
  if (!snap.exists) return null
  await requireAnalyticsProperty(user, { propertyId: snap.data()?.propertyId })
  return { ref: snap.ref, report: snap.data()! }
}

export const PATCH = withAuth('admin', async (req: NextRequest, user: ApiUser, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return apiError('Invalid JSON', 400) }

  try {
    const loaded = await loadReport(user, id)
    if (!loaded) return apiError('Report not found', 404)

    const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }
    if (typeof body.name === 'string') update.name = body.name.trim()
    if (body.frequency === 'weekly' || body.frequency === 'monthly') update.frequency = body.frequency
    if (typeof body.active === 'boolean') update.active = body.active
    if (Array.isArray(body.metrics)) {
      const bad = body.metrics.find(m => !AVAILABLE_METRICS.includes(m as never))
      if (bad) return apiError(`Unknown metric: ${bad}`, 400)
      update.metrics = body.metrics
    }
    if (Array.isArray(body.recipients)) {
      const bad = body.recipients.find(r => !EMAIL_RE.test(String(r)))
      if (bad) return apiError(`Invalid recipient: ${bad}`, 400)
      update.recipients = body.recipients
    }

    await loaded.ref.update(update)
    return apiSuccess({ id })
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-report-patch]', e)
    return apiError('Failed to update report', 500)
  }
})

export const DELETE = withAuth('admin', async (_req: NextRequest, user: ApiUser, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params
  try {
    const loaded = await loadReport(user, id)
    if (!loaded) return apiError('Report not found', 404)
    await loaded.ref.delete()
    return apiSuccess({ id })
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-report-delete]', e)
    return apiError('Failed to delete report', 500)
  }
})
