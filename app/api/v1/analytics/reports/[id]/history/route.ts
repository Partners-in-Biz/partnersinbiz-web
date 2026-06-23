import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { analyticsPropertyErrorResponse, requireAnalyticsProperty } from '@/lib/analytics/property-access'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withAuth('admin', async (_req: NextRequest, user: ApiUser, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params
  try {
    const snap = await adminDb.collection('product_reports').doc(id).get()
    if (!snap.exists) return apiError('Report not found', 404)
    await requireAnalyticsProperty(user, { propertyId: snap.data()?.propertyId })

    const runs = await adminDb.collection('product_report_runs')
      .where('reportId', '==', id)
      .orderBy('ranAt', 'desc')
      .limit(50)
      .get()
    return apiSuccess(runs.docs.map(d => ({ id: d.id, ...d.data() })))
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-report-history]', e)
    return apiError('Failed to query report history', 500)
  }
})
