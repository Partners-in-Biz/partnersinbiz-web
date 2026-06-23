import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { sendEmail } from '@/lib/email/send'
import { analyticsPropertyErrorResponse, requireAnalyticsProperty } from '@/lib/analytics/property-access'
import { computeReportData, reportToHtml } from '@/lib/analytics/report-metrics'
import type { DateRange } from '@/lib/analytics/query'
import type { ApiUser } from '@/lib/api/types'
import type { ScheduledReport } from '@/lib/analytics/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/** POST — generate the report now, email all recipients, record run history. */
export const POST = withAuth('admin', async (_req: NextRequest, user: ApiUser, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params

  try {
    const snap = await adminDb.collection('product_reports').doc(id).get()
    if (!snap.exists) return apiError('Report not found', 404)
    const report = { id: snap.id, ...snap.data() } as ScheduledReport
    const property = await requireAnalyticsProperty(user, { propertyId: report.propertyId })

    const days = report.frequency === 'weekly' ? 7 : 30
    const range: DateRange = { from: new Date(Date.now() - days * 86400000), to: new Date() }

    const data = await computeReportData(property.id, range, report.metrics)
    const html = reportToHtml(report.name, range, data)

    const subject = `${report.name} — ${range.from.toISOString().slice(0, 10)} to ${range.to.toISOString().slice(0, 10)}`
    const sendResults = await Promise.all(
      report.recipients.map(to => sendEmail({ to, subject, html })),
    )
    const allOk = sendResults.every(r => r.success)
    const firstErr = sendResults.find(r => !r.success)?.error ?? null

    const runDoc = {
      reportId: report.id,
      propertyId: property.id,
      orgId: property.orgId,
      ranAt: FieldValue.serverTimestamp(),
      rangeFrom: range.from.toISOString(),
      rangeTo: range.to.toISOString(),
      recipients: report.recipients,
      status: allOk ? 'sent' : 'failed',
      metrics: data.scalar,
      error: allOk ? null : firstErr,
      triggeredBy: 'manual',
    }
    const runRef = await adminDb.collection('product_report_runs').add(runDoc)
    await snap.ref.update({ lastRunAt: FieldValue.serverTimestamp() })

    return apiSuccess({ runId: runRef.id, status: runDoc.status, metrics: data.scalar, error: runDoc.error })
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-report-run]', e)
    return apiError('Failed to run report', 500)
  }
})
