import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { actorFrom } from '@/lib/api/actor'
import { analyticsPropertyErrorResponse, requireAnalyticsProperty } from '@/lib/analytics/property-access'
import { AVAILABLE_METRICS } from '@/lib/analytics/report-metrics'
import type { ApiUser } from '@/lib/api/types'
import type { ReportFrequency } from '@/lib/analytics/types'

export const dynamic = 'force-dynamic'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const GET = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const propertyId = searchParams.get('propertyId')
  if (!propertyId) return apiError('propertyId is required', 400)

  try {
    const property = await requireAnalyticsProperty(user, { propertyId })
    const snap = await adminDb.collection('product_reports')
      .where('propertyId', '==', property.id)
      .orderBy('createdAt', 'desc')
      .get()
    return apiSuccess(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-reports-get]', e)
    return apiError('Failed to query reports', 500)
  }
})

export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  let body: {
    propertyId?: string; name?: string; frequency?: ReportFrequency
    metrics?: string[]; recipients?: string[]
  }
  try { body = await req.json() } catch { return apiError('Invalid JSON', 400) }

  const { propertyId, name, frequency, metrics, recipients } = body
  if (!propertyId) return apiError('propertyId is required', 400)
  if (!name?.trim()) return apiError('name is required', 400)
  if (frequency !== 'weekly' && frequency !== 'monthly') return apiError('frequency must be weekly or monthly', 400)
  if (!Array.isArray(metrics) || metrics.length === 0) return apiError('Select at least one metric', 400)
  const invalidMetric = metrics.find(m => !AVAILABLE_METRICS.includes(m as never))
  if (invalidMetric) return apiError(`Unknown metric: ${invalidMetric}`, 400)
  if (!Array.isArray(recipients) || recipients.length === 0) return apiError('At least one recipient is required', 400)
  const badEmail = recipients.find(r => !EMAIL_RE.test(r))
  if (badEmail) return apiError(`Invalid recipient: ${badEmail}`, 400)

  try {
    const property = await requireAnalyticsProperty(user, { propertyId })
    const ref = await adminDb.collection('product_reports').add({
      orgId: property.orgId,
      propertyId: property.id,
      name: name.trim(),
      frequency,
      metrics,
      recipients,
      active: true,
      lastRunAt: null,
      ...actorFrom(user),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return apiSuccess({ id: ref.id }, 201)
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-reports-post]', e)
    return apiError('Failed to create report', 500)
  }
})
