import type { LeaveRecordInput, PayPeriod, PayrollCalendar, Payslip } from './types'

export type LeavePayEffect = 'paid' | 'unpaid' | 'none'
export type LeaveUnit = 'hours' | 'days'
export type LeaveRequestStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'cancelled' | 'applied'

export type PayPeriodCutoffStatus = 'upcoming' | 'open_for_input' | 'past_cutoff' | 'closed' | 'locked'

export interface PayCalendarPeriodView {
  periodId: string
  calendarId: string
  calendarCode: string
  calendarName: string
  frequency: PayrollCalendar['frequency']
  label: string
  periodStart: string
  periodEnd: string
  payDate: string
  cutOffAt: string
  status: PayPeriod['status']
  cutoffStatus: PayPeriodCutoffStatus
  hoursUntilCutoff: number | null
}

export interface PayslipPackFile {
  name: string
  contentType: string
  content: string
}

export function leaveDurationToHours(input: {
  unit: LeaveUnit
  quantity: number
  hoursPerDay?: number
}): number {
  if (!(input.quantity > 0) || !Number.isFinite(input.quantity)) {
    throw new Error('Leave quantity must be a positive finite number')
  }
  if (input.unit === 'hours') return Math.round(input.quantity * 100) / 100
  const hoursPerDay = input.hoursPerDay ?? 8
  if (!(hoursPerDay > 0)) throw new Error('hoursPerDay must be positive')
  return Math.round(input.quantity * hoursPerDay * 100) / 100
}

export function dateRangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd
}

export function projectPayCalendar(input: {
  calendars: PayrollCalendar[]
  periods: PayPeriod[]
  nowIso: string
}): PayCalendarPeriodView[] {
  const nowMs = Date.parse(input.nowIso)
  const calById = new Map(input.calendars.map((c) => [c.id, c]))
  return [...input.periods]
    .map((period) => {
      const calendar = calById.get(period.calendarId)
      const cutMs = Date.parse(period.cutOffAt)
      let cutoffStatus: PayPeriodCutoffStatus = 'open_for_input'
      if (period.status === 'locked') cutoffStatus = 'locked'
      else if (period.status === 'closed') cutoffStatus = 'closed'
      else if (!Number.isNaN(cutMs) && !Number.isNaN(nowMs)) {
        cutoffStatus = nowMs < cutMs ? 'open_for_input' : 'past_cutoff'
      }
      const hoursUntilCutoff =
        Number.isNaN(cutMs) || Number.isNaN(nowMs) || cutMs <= nowMs
          ? null
          : Math.round(((cutMs - nowMs) / 3_600_000) * 10) / 10
      return {
        periodId: period.id,
        calendarId: period.calendarId,
        calendarCode: calendar?.code ?? '',
        calendarName: calendar?.name ?? '',
        frequency: calendar?.frequency ?? period.frequency,
        label: period.label,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        payDate: period.payDate,
        cutOffAt: period.cutOffAt,
        status: period.status,
        cutoffStatus,
        hoursUntilCutoff,
      } satisfies PayCalendarPeriodView
    })
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart) || a.payDate.localeCompare(b.payDate))
}

export function approvedLeaveToCalcInputs(
  rows: Array<{
    id: string
    status: LeaveRequestStatus
    payEffect: LeavePayEffect
    startDate: string
    endDate: string
    hours: number
    componentCode?: string
    description?: string
  }>,
  periodStart: string,
  periodEnd: string,
): LeaveRecordInput[] {
  return rows
    .filter(
      (row) =>
        row.status === 'approved' &&
        (row.payEffect === 'paid' || row.payEffect === 'unpaid') &&
        dateRangesOverlap(row.startDate, row.endDate, periodStart, periodEnd) &&
        row.hours > 0,
    )
    .map((row) => ({
      id: row.id,
      kind: row.payEffect as 'paid' | 'unpaid',
      hours: row.hours,
      ...(row.componentCode ? { componentCode: row.componentCode } : {}),
      ...(row.description ? { description: row.description } : {}),
    }))
}

export function mergeLeaveInputs(
  explicit: LeaveRecordInput[] | undefined,
  fromApproved: LeaveRecordInput[],
): LeaveRecordInput[] {
  if (explicit && explicit.length > 0) return explicit
  return fromApproved
}

function formatMinorZar(minor: number): string {
  const sign = minor < 0 ? '-' : ''
  const abs = Math.abs(minor)
  const whole = Math.floor(abs / 100)
  const cents = String(abs % 100).padStart(2, '0')
  return `${sign}R ${whole.toLocaleString('en-ZA')}.${cents}`
}

export function buildPayslipDownloadPack(payslip: Payslip): {
  files: PayslipPackFile[]
  rowCount: number
  externalEgressAllowed: false
  autoSent: false
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
} {
  const lines = payslip.rendered.lines
    .map((line) => `${line.componentCode.padEnd(16)} ${line.description.padEnd(28)} ${formatMinorZar(line.amountMinor)}`)
    .join('\n')
  const text = [
    'Partners in Biz — Payslip (download only)',
    `Employee: ${payslip.rendered.employeeDisplayName} (${payslip.rendered.employeeNumber})`,
    `Period: ${payslip.periodStart} → ${payslip.periodEnd}`,
    `Pay date: ${payslip.payDate}`,
    `Payslip id: ${payslip.id}`,
    `Pay run: ${payslip.payRunId}`,
    '',
    'Lines',
    lines,
    '',
    `Gross: ${formatMinorZar(payslip.rendered.totals.grossEarningsMinor)}`,
    `PAYE: ${formatMinorZar(payslip.rendered.totals.payeMinor)}`,
    `UIF (employee): ${formatMinorZar(payslip.rendered.totals.uifEmployeeMinor)}`,
    `Net: ${formatMinorZar(payslip.rendered.netPayMinor)}`,
    '',
    'Notice: Internal download pack only. Not emailed. No SARS submit. No bank payment initiated.',
    `publicationStatus=${payslip.publicationStatus} autoSent=${String(payslip.autoSent)}`,
  ].join('\n')

  const manifest = {
    kind: 'payroll.payslip_pack',
    payslipId: payslip.id,
    employeeId: payslip.employeeId,
    payRunId: payslip.payRunId,
    payPeriodId: payslip.payPeriodId,
    generationChecksum: payslip.generationChecksum,
    externalEgressAllowed: false,
    autoSent: false,
    sarsSubmissionInitiated: false,
    externalPaymentInitiated: false,
  }

  return {
    files: [
      { name: `payslip-${payslip.id}.txt`, contentType: 'text/plain; charset=utf-8', content: text },
      {
        name: `payslip-${payslip.id}.json`,
        contentType: 'application/json',
        content: JSON.stringify({ ...manifest, rendered: payslip.rendered, periodStart: payslip.periodStart, periodEnd: payslip.periodEnd, payDate: payslip.payDate }, null, 2),
      },
      { name: 'manifest.json', contentType: 'application/json', content: JSON.stringify(manifest, null, 2) },
    ],
    rowCount: payslip.rendered.lines.length,
    externalEgressAllowed: false,
    autoSent: false,
    sarsSubmissionInitiated: false,
    externalPaymentInitiated: false,
  }
}
