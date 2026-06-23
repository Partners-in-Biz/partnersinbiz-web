// lib/reports/run-schedule.ts
//
// Executes a single report schedule: regenerate the report for the latest
// completed period, then email it to the schedule's (subscribed) recipients
// using the chosen template. Used by both the cron and the manual "send now".

import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { generateReport } from './generate'
import { buildCustomReport } from './custom'
import { lastCompletedMonth } from './snapshot'
import { sendCampaignEmail, FROM_ADDRESS } from '@/lib/email/resend'
import { buildReportEmailHtml, buildReportEmailText } from './email'
import { markScheduleSent } from './schedule'
import { renderTemplateSubject } from './templates'
import { REPORTS_COLLECTION, type Report, type ReportSchedule } from './types'

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.PUBLIC_BASE_URL ||
    'https://partnersinbiz.online'
  )
}

/**
 * Resolve the reporting period for a schedule run. Weekly schedules report the
 * trailing 7 days; monthly/quarterly report the last completed month/quarter.
 */
function periodForSchedule(schedule: ReportSchedule, tz: string, now = new Date()) {
  if (schedule.cadence === 'weekly') {
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1))
    const start = new Date(end)
    start.setUTCDate(start.getUTCDate() - 6)
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), tz }
  }
  if (schedule.cadence === 'quarterly') {
    // Last completed month is a reasonable anchor; widen to the trailing quarter.
    const m = lastCompletedMonth(tz, now)
    const start = new Date(`${m.start}T00:00:00Z`)
    start.setUTCMonth(start.getUTCMonth() - 2)
    return { start: start.toISOString().slice(0, 10), end: m.end, tz }
  }
  return lastCompletedMonth(tz, now)
}

export interface RunScheduleResult {
  scheduleId: string
  reportId: string
  sentTo: string[]
  skipped?: string
}

export async function runSchedule(schedule: ReportSchedule, now = new Date()): Promise<RunScheduleResult> {
  const recipients = (schedule.recipients ?? []).filter(
    (r) => !(schedule.unsubscribed ?? []).includes(r),
  )
  if (recipients.length === 0) {
    // Nothing to send — still roll the cadence forward so it doesn't fire every run.
    await markScheduleSent(schedule.id, schedule.cadence, now)
    return { scheduleId: schedule.id, reportId: '', sentTo: [], skipped: 'no active recipients' }
  }

  const orgDoc = await adminDb.collection('organizations').doc(schedule.orgId).get()
  const tz = ((orgDoc.data() as { timezone?: string } | undefined)?.timezone) ?? 'UTC'
  const period = periodForSchedule(schedule, tz, now)

  let report: Report
  if (schedule.category === 'custom' && schedule.spec) {
    report = await buildCustomReport({
      orgId: schedule.orgId,
      spec: { ...schedule.spec, period: { ...period } },
      generatedBy: 'cron',
      createdBy: 'schedule',
    })
  } else {
    report = await generateReport({
      orgId: schedule.orgId,
      type: schedule.type,
      period,
      generatedBy: 'cron',
      createdBy: 'schedule',
      propertyId: schedule.propertyId ?? undefined,
    })
  }

  // Tag the report with its schedule.
  await adminDb.collection(REPORTS_COLLECTION).doc(report.id).update({
    scheduleId: schedule.id,
    category: schedule.category,
  })

  const link = `${appBaseUrl()}/reports/${report.publicToken}`
  const periodLabel = `${report.period.start} → ${report.period.end}`
  const subject = renderTemplateSubject(schedule.template, { org: report.brand.orgName, period: periodLabel })

  const sendResult = await sendCampaignEmail({
    from: FROM_ADDRESS,
    to: recipients,
    subject,
    html: buildReportEmailHtml({ report, link, templateId: schedule.template }),
    text: buildReportEmailText({ report, link, templateId: schedule.template }),
  })

  if (sendResult.ok) {
    await adminDb.collection(REPORTS_COLLECTION).doc(report.id).update({
      status: 'sent',
      sentTo: FieldValue.arrayUnion(...recipients),
      sentAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
  }
  await markScheduleSent(schedule.id, schedule.cadence, now)

  return {
    scheduleId: schedule.id,
    reportId: report.id,
    sentTo: recipients,
    ...(sendResult.ok ? {} : { skipped: sendResult.error ?? 'send failed' }),
  }
}
