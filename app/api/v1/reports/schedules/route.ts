// GET  /api/v1/reports/schedules?orgId=...   — list schedules for an org (US-177)
// POST /api/v1/reports/schedules              — create a schedule

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { createSchedule, listSchedules } from '@/lib/reports/schedule'
import { getReport } from '@/lib/reports/generate'
import { DEFAULT_REPORT_TEMPLATE, getReportTemplate } from '@/lib/reports/templates'
import {
  REPORT_CATEGORIES,
  type ReportCategory,
  type ReportType,
  type ScheduleCadence,
} from '@/lib/reports/types'

export const dynamic = 'force-dynamic'

const CADENCES: ScheduleCadence[] = ['weekly', 'monthly', 'quarterly']

export const GET = withAuth('admin', async (req: NextRequest, user) => {
  const url = new URL(req.url)
  const scope = resolveOrgScope(user, url.searchParams.get('orgId'))
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })
  const schedules = await listSchedules(scope.orgId)
  return NextResponse.json({ ok: true, schedules })
})

interface CreateBody {
  orgId?: string
  name?: string
  cadence?: ScheduleCadence
  category?: ReportCategory
  type?: ReportType
  recipients?: string[]
  template?: string
  propertyId?: string | null
  sourceReportId?: string | null
  firstSendAt?: string
}

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = (await req.json().catch(() => ({}))) as CreateBody
  const scope = resolveOrgScope(user, body.orgId?.trim() ?? null)
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })
  const orgId = scope.orgId

  const cadence: ScheduleCadence = CADENCES.includes(body.cadence as ScheduleCadence)
    ? (body.cadence as ScheduleCadence)
    : 'monthly'
  const category: ReportCategory = REPORT_CATEGORIES.includes(body.category as ReportCategory)
    ? (body.category as ReportCategory)
    : 'monthly'
  const recipients = (body.recipients ?? []).map(String).map((s) => s.trim()).filter(Boolean)
  const template = getReportTemplate(body.template).id || DEFAULT_REPORT_TEMPLATE

  // Carry a custom spec forward if the schedule is anchored to a custom report.
  let spec = null
  let type: ReportType = body.type ?? 'monthly'
  if (body.sourceReportId) {
    const source = await getReport(body.sourceReportId)
    if (source && source.orgId === orgId) {
      if (source.custom) spec = source.custom
      type = source.type
    }
  }

  const schedule = await createSchedule({
    orgId,
    name: (body.name ?? 'Scheduled report').slice(0, 120),
    cadence,
    category: spec ? 'custom' : category,
    type,
    recipients,
    template,
    propertyId: body.propertyId ?? null,
    sourceReportId: body.sourceReportId ?? null,
    spec,
    firstSendAt: body.firstSendAt,
    createdBy: (user as { uid?: string })?.uid ?? 'admin',
  })
  return NextResponse.json({ ok: true, schedule })
})
