// /api/cron/reports — monthly report generator.
//
// Runs on the 1st of every month. For every active client org, generates the
// last completed month's report (in the org's timezone) as a draft. Reports
// land in `status: 'rendered'`. They are NOT auto-sent — Peet (or admin) must
// review and press "Send" from the admin UI.

import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { generateReport } from '@/lib/reports/generate'
import { lastCompletedMonth } from '@/lib/reports/snapshot'
import { dueSchedules } from '@/lib/reports/schedule'
import { runSchedule } from '@/lib/reports/run-schedule'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

interface CronSummary {
  total: number
  ok: number
  failed: number
  errors: Array<{ orgId: string; error: string }>
  schedules?: {
    total: number
    ok: number
    failed: number
    errors: Array<{ scheduleId: string; error: string }>
  }
}

/**
 * Run every active schedule whose nextSendAt has arrived (US-177). The cron runs
 * daily for schedules even though the monthly KPI pass only fires on the 1st.
 */
async function runDueSchedules(): Promise<NonNullable<CronSummary['schedules']>> {
  const result = { total: 0, ok: 0, failed: 0, errors: [] as Array<{ scheduleId: string; error: string }> }
  const due = await dueSchedules()
  for (const schedule of due) {
    result.total += 1
    try {
      await runSchedule(schedule)
      result.ok += 1
    } catch (err) {
      result.failed += 1
      result.errors.push({ scheduleId: schedule.id, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return result
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const onlyOrgId = url.searchParams.get('orgId') // optional override
  // Monthly KPI pass only runs on the 1st (or when forced) so a daily cron can
  // also drive schedules without re-emitting monthly reports every day.
  const forceMonthly = url.searchParams.get('monthly') === '1'
  const isFirstOfMonth = new Date().getUTCDate() === 1
  const runMonthly = forceMonthly || isFirstOfMonth || Boolean(onlyOrgId)

  const summary: CronSummary = { total: 0, ok: 0, failed: 0, errors: [] }

  // 1) Honour due schedules (US-177).
  summary.schedules = await runDueSchedules()

  if (!runMonthly) {
    return NextResponse.json({ ...summary, ok: true })
  }

  // 2) Monthly KPI report pass.
  const orgsSnap = onlyOrgId
    ? await adminDb.collection('organizations').where('__name__', '==', onlyOrgId).get()
    : await adminDb.collection('organizations').where('type', '==', 'client').get()

  for (const orgDoc of orgsSnap.docs) {
    summary.total += 1
    const data = orgDoc.data() as { timezone?: string; status?: string }
    if (data.status === 'churned' || data.status === 'suspended') continue
    const tz = data.timezone ?? 'UTC'
    try {
      const period = lastCompletedMonth(tz)
      await generateReport({
        orgId: orgDoc.id,
        type: 'monthly',
        period,
        generatedBy: 'cron',
        createdBy: 'cron',
      })
      summary.ok += 1
    } catch (err) {
      summary.failed += 1
      summary.errors.push({
        orgId: orgDoc.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json({ ...summary, ok: true })
}
