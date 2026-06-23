// POST /api/v1/reports/schedules/:scheduleId/send-now (US-177 manual "send now")
//
// Generates the report immediately and emails it to the schedule's subscribed
// recipients, then rolls the cadence forward.

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { getSchedule } from '@/lib/reports/schedule'
import { runSchedule } from '@/lib/reports/run-schedule'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

type RouteContext = { params: Promise<{ scheduleId: string }> }

export const POST = withAuth('admin', async (_req: NextRequest, user, ctx) => {
  const { scheduleId } = await (ctx as RouteContext).params
  const schedule = await getSchedule(scheduleId)
  if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canAccessOrg(user, schedule.orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const result = await runSchedule(schedule)
  return NextResponse.json({ ok: true, result })
})
