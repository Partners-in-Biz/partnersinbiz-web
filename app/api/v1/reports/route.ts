// GET  /api/v1/reports?orgId=...
// POST /api/v1/reports          — generate a new report

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { generateReport, listReports } from '@/lib/reports/generate'
import { lastCompletedMonth, monthPeriod } from '@/lib/reports/snapshot'
import type { ReportType } from '@/lib/reports/types'
import { adminDb } from '@/lib/firebase/admin'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { analyticsPropertyErrorResponse, requireAnalyticsProperty } from '@/lib/analytics/property-access'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export const GET = withAuth('admin', async (req: NextRequest, user) => {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId')
  if (!orgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 })
  if (!canAccessOrg(user, orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get('limit') ?? '24', 10)))
  const reports = await listReports(orgId, limit)
  return NextResponse.json({ ok: true, reports })
})

interface CreateBody {
  orgId: string
  type?: ReportType
  /** YYYY-MM (e.g. 2026-04). Defaults to last completed month. */
  month?: string
  /** Custom range overrides month. */
  start?: string
  end?: string
  /** Property scope (org-wide if omitted). */
  propertyId?: string
}

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = (await req.json().catch(() => ({}))) as CreateBody
  if (!body.orgId) {
    return NextResponse.json({ error: 'orgId required' }, { status: 400 })
  }
  if (!canAccessOrg(user, body.orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (body.propertyId) {
    try {
      await requireAnalyticsProperty(user, { propertyId: body.propertyId, orgId: body.orgId })
    } catch (err) {
      const propertyError = analyticsPropertyErrorResponse(err)
      if (propertyError) return propertyError
      throw err
    }
  }

  // Resolve org timezone (default UTC).
  const orgDoc = await adminDb.collection('organizations').doc(body.orgId).get()
  const tz = ((orgDoc.data() as { timezone?: string } | undefined)?.timezone) ?? 'UTC'

  const period = body.start && body.end
    ? { start: body.start, end: body.end, tz }
    : body.month
      ? monthPeriod(body.month, tz)
      : lastCompletedMonth(tz)

  const report = await generateReport({
    orgId: body.orgId,
    type: body.type ?? 'monthly',
    period,
    generatedBy: 'admin',
    createdBy: (user as { uid?: string; role?: string })?.uid ?? 'admin',
    propertyId: body.propertyId,
  })
  return NextResponse.json({ ok: true, report })
})
