// /api/v1/reports/schedules/:scheduleId
//   GET    — fetch one
//   PATCH  — edit cadence/recipients/template/status/etc. (active/pause toggle)
//   DELETE — remove the schedule

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { deleteSchedule, getSchedule, updateSchedule } from '@/lib/reports/schedule'
import {
  REPORT_CATEGORIES,
  type ReportCategory,
  type ReportType,
  type ScheduleCadence,
} from '@/lib/reports/types'
import { getReportTemplate } from '@/lib/reports/templates'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ scheduleId: string }> }
const CADENCES: ScheduleCadence[] = ['weekly', 'monthly', 'quarterly']

export const GET = withAuth('admin', async (_req: NextRequest, user, ctx) => {
  const { scheduleId } = await (ctx as RouteContext).params
  const schedule = await getSchedule(scheduleId)
  if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canAccessOrg(user, schedule.orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json({ ok: true, schedule })
})

interface PatchBody {
  name?: string
  cadence?: ScheduleCadence
  category?: ReportCategory
  type?: ReportType
  recipients?: string[]
  template?: string
  status?: 'active' | 'paused'
  nextSendAt?: string
  propertyId?: string | null
}

export const PATCH = withAuth('admin', async (req: NextRequest, user, ctx) => {
  const { scheduleId } = await (ctx as RouteContext).params
  const schedule = await getSchedule(scheduleId)
  if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canAccessOrg(user, schedule.orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as PatchBody
  const patch: Record<string, unknown> = {}
  if (typeof body.name === 'string') patch.name = body.name.slice(0, 120)
  if (CADENCES.includes(body.cadence as ScheduleCadence)) patch.cadence = body.cadence
  if (REPORT_CATEGORIES.includes(body.category as ReportCategory)) patch.category = body.category
  if (typeof body.type === 'string') patch.type = body.type
  if (Array.isArray(body.recipients)) patch.recipients = body.recipients.map(String)
  if (typeof body.template === 'string') patch.template = getReportTemplate(body.template).id
  if (body.status === 'active' || body.status === 'paused') patch.status = body.status
  if (typeof body.nextSendAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.nextSendAt)) patch.nextSendAt = body.nextSendAt
  if (body.propertyId !== undefined) patch.propertyId = body.propertyId

  await updateSchedule(scheduleId, patch)
  const updated = await getSchedule(scheduleId)
  return NextResponse.json({ ok: true, schedule: updated })
})

export const DELETE = withAuth('admin', async (_req: NextRequest, user, ctx) => {
  const { scheduleId } = await (ctx as RouteContext).params
  const schedule = await getSchedule(scheduleId)
  if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canAccessOrg(user, schedule.orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await deleteSchedule(scheduleId)
  return NextResponse.json({ ok: true })
})
