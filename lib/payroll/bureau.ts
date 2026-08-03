import { canonicalDigest } from '@/lib/finance/integrity'
import { buildPayslipDownloadPack } from './leave'
import type {
  CalendarDensityCell,
  Emp501AnnualReadinessPack,
  LeaveBalanceView,
  LeaveCalendarDayEntry,
  LeaveMonthCalendar,
  MultiEntityPayRunBoard,
  PayRunBoardRow,
  SalaryStructureLine,
  SalaryStructureTemplate,
} from './bureau-types'
import type {
  Emp201Snapshot,
  Emp501Reconciliation,
  Irp5Record,
  LeaveBalance,
  LeaveRecord,
  LeaveType,
  PayPeriod,
  PayRun,
  PayrollCalendar,
  PayrollEmployee,
  PayrollTaxYear,
  Payslip,
  PeriodComponentInput,
} from './types'

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function monthKey(year: number, month: number): string {
  return `${year}-${pad2(month)}`
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function dateInInclusiveRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end
}

export function expandLeaveDays(startDate: string, endDate: string): string[] {
  const out: string[] = []
  const start = new Date(`${startDate}T00:00:00.000Z`)
  const end = new Date(`${endDate}T00:00:00.000Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return out
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

function cutoffStatusFor(period: PayPeriod | undefined, runStatus: PayRun['status'], nowIso: string): PayRunBoardRow['cutoffStatus'] {
  if (runStatus === 'approved_locked' || period?.status === 'locked') return 'locked'
  if (period?.status === 'closed') return 'closed'
  const cutMs = period ? Date.parse(period.cutOffAt) : NaN
  const nowMs = Date.parse(nowIso)
  if (!Number.isNaN(cutMs) && !Number.isNaN(nowMs)) {
    return nowMs < cutMs ? 'open_for_input' : 'past_cutoff'
  }
  return 'open_for_input'
}

export function buildMultiEntityPayRunBoard(input: {
  entities: Array<{
    legalEntityId: string
    legalEntityLabel?: string
    bookId: string
    bookLabel?: string
    payRuns: PayRun[]
    periods: PayPeriod[]
    calendars?: PayrollCalendar[]
  }>
  nowIso: string
  windowStart?: string
  windowEnd?: string
}): MultiEntityPayRunBoard {
  const periodById = new Map<string, PayPeriod>()
  for (const entity of input.entities) {
    for (const p of entity.periods) periodById.set(p.id, p)
  }

  const rows: PayRunBoardRow[] = []
  for (const entity of input.entities) {
    for (const run of entity.payRuns) {
      const period = periodById.get(run.payPeriodId)
      const periodStart = period?.periodStart ?? run.createdAt.slice(0, 10)
      const periodEnd = period?.periodEnd ?? periodStart
      const payDate = period?.payDate ?? periodEnd
      const cutOffAt = period?.cutOffAt ?? `${payDate}T23:59:59.000Z`
      rows.push({
        legalEntityId: entity.legalEntityId,
        legalEntityLabel: entity.legalEntityLabel ?? entity.legalEntityId,
        bookId: entity.bookId,
        bookLabel: entity.bookLabel ?? entity.bookId,
        payRunId: run.id,
        label: run.label,
        status: run.status,
        kind: run.kind,
        payPeriodId: run.payPeriodId,
        periodLabel: period?.label ?? run.label,
        periodStart,
        periodEnd,
        payDate,
        cutOffAt,
        cutoffStatus: cutoffStatusFor(period, run.status, input.nowIso),
        itemCount: run.itemIds?.length ?? 0,
        payslipCount: run.payslipIds?.length ?? 0,
        totalsGrossMinor: run.totals?.grossEarningsMinor ?? 0,
        totalsNetMinor: run.totals?.netPayMinor ?? 0,
        totalsPayeMinor: run.totals?.payeMinor ?? 0,
      })
    }
  }

  rows.sort((a, b) => a.payDate.localeCompare(b.payDate) || a.legalEntityId.localeCompare(b.legalEntityId) || a.payRunId.localeCompare(b.payRunId))

  const defaultStart = rows[0]?.periodStart ?? input.nowIso.slice(0, 10)
  const defaultEnd = rows[rows.length - 1]?.periodEnd ?? defaultStart
  const windowStart = input.windowStart ?? defaultStart
  const windowEnd = input.windowEnd ?? defaultEnd

  const densityMap = new Map<string, CalendarDensityCell>()
  const ensure = (date: string): CalendarDensityCell => {
    let cell = densityMap.get(date)
    if (!cell) {
      cell = { date, payDateCount: 0, cutOffCount: 0, lockedRunCount: 0, inReviewCount: 0, draftCount: 0 }
      densityMap.set(date, cell)
    }
    return cell
  }

  for (const row of rows) {
    if (dateInInclusiveRange(row.payDate, windowStart, windowEnd)) {
      const cell = ensure(row.payDate)
      cell.payDateCount += 1
      if (row.status === 'approved_locked') cell.lockedRunCount += 1
      else if (row.status === 'in_review') cell.inReviewCount += 1
      else if (row.status === 'draft' || row.status === 'calculated' || row.status === 'calculating') cell.draftCount += 1
    }
    const cutDate = row.cutOffAt.slice(0, 10)
    if (dateInInclusiveRange(cutDate, windowStart, windowEnd)) {
      ensure(cutDate).cutOffCount += 1
    }
  }

  const density = [...densityMap.values()].sort((a, b) => a.date.localeCompare(b.date))
  const lockedCount = rows.filter((r) => r.status === 'approved_locked').length
  const inReviewCount = rows.filter((r) => r.status === 'in_review').length
  const draftOrCalculatedCount = rows.filter((r) =>
    r.status === 'draft' || r.status === 'calculated' || r.status === 'calculating' || r.status === 'correction',
  ).length

  return {
    generatedAt: input.nowIso,
    windowStart,
    windowEnd,
    rows,
    density,
    summary: {
      entityCount: new Set(input.entities.map((e) => e.legalEntityId)).size,
      runCount: rows.length,
      lockedCount,
      inReviewCount,
      draftOrCalculatedCount,
      totalNetMinor: rows.reduce((s, r) => s + r.totalsNetMinor, 0),
      totalPayeMinor: rows.reduce((s, r) => s + r.totalsPayeMinor, 0),
    },
    hardGates: {
      externalPaymentInitiated: false,
      sarsSubmissionInitiated: false,
      externalEgressAllowed: false,
      massEmailAllowed: false,
    },
  }
}

export function buildLeaveMonthCalendar(input: {
  year: number
  month: number
  leaveRecords: LeaveRecord[]
  leaveBalances: LeaveBalance[]
  leaveTypes: LeaveType[]
  employees: Array<Pick<PayrollEmployee, 'id' | 'displayName' | 'employeeNumber'>>
}): LeaveMonthCalendar {
  const monthStart = `${input.year}-${pad2(input.month)}-01`
  const dim = daysInMonth(input.year, input.month)
  const monthEnd = `${input.year}-${pad2(input.month)}-${pad2(dim)}`
  const empById = new Map(input.employees.map((e) => [e.id, e]))
  const typeById = new Map(input.leaveTypes.map((t) => [t.id, t]))

  const dayMap = new Map<string, LeaveCalendarDayEntry[]>()
  for (let d = 1; d <= dim; d += 1) dayMap.set(`${input.year}-${pad2(input.month)}-${pad2(d)}`, [])

  const toEntry = (rec: LeaveRecord): LeaveCalendarDayEntry => {
    const emp = empById.get(rec.employeeId)
    return {
      leaveRecordId: rec.id,
      employeeId: rec.employeeId,
      employeeLabel: emp ? `${emp.employeeNumber} · ${emp.displayName}` : rec.employeeId,
      leaveTypeCode: rec.leaveTypeCode,
      status: rec.status,
      payEffect: rec.payEffect,
      hours: rec.hours,
      quantity: rec.quantity,
      unit: rec.unit,
      startDate: rec.startDate,
      endDate: rec.endDate,
    }
  }

  for (const rec of input.leaveRecords) {
    if (rec.status === 'cancelled' || rec.status === 'rejected') continue
    const days = expandLeaveDays(rec.startDate, rec.endDate)
    const entry = toEntry(rec)
    for (const day of days) {
      if (day >= monthStart && day <= monthEnd) {
        dayMap.get(day)?.push(entry)
      }
    }
  }

  const pendingRequests = input.leaveRecords
    .filter((r) => r.status === 'pending')
    .map(toEntry)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))

  const balances: LeaveBalanceView[] = input.leaveBalances.map((b) => {
    const emp = empById.get(b.employeeId)
    const lt = typeById.get(b.leaveTypeId)
    return {
      employeeId: b.employeeId,
      employeeLabel: emp ? `${emp.employeeNumber} · ${emp.displayName}` : b.employeeId,
      leaveTypeId: b.leaveTypeId,
      leaveTypeCode: lt?.code ?? b.leaveTypeId,
      unit: b.unit,
      balanceQuantity: b.balanceQuantity,
      balanceHours: b.balanceHours,
      asOfDate: b.asOfDate,
      accrues: Boolean(lt?.accrues),
    }
  })

  const accrualMap = new Map<string, { leaveTypeCode: string; accrues: boolean; employeeCountWithBalance: number; totalBalanceHours: number }>()
  for (const b of balances) {
    const key = b.leaveTypeCode
    const row = accrualMap.get(key) ?? { leaveTypeCode: key, accrues: b.accrues, employeeCountWithBalance: 0, totalBalanceHours: 0 }
    row.employeeCountWithBalance += 1
    row.totalBalanceHours = Math.round((row.totalBalanceHours + b.balanceHours) * 100) / 100
    row.accrues = row.accrues || b.accrues
    accrualMap.set(key, row)
  }

  return {
    year: input.year,
    month: input.month,
    monthKey: monthKey(input.year, input.month),
    days: [...dayMap.entries()].map(([date, entries]) => ({ date, entries })),
    pendingRequests,
    balances,
    accrualSummary: [...accrualMap.values()].sort((a, b) => a.leaveTypeCode.localeCompare(b.leaveTypeCode)),
    hardGates: { externalEgressAllowed: false },
  }
}

export function salaryStructureToPeriodComponents(lines: SalaryStructureLine[]): PeriodComponentInput[] {
  return lines.map((line) => ({
    componentCode: line.componentCode,
    quantityMinorUnits: line.quantityMinorUnits,
    unitAmountMinor: line.unitAmountMinor,
    description: line.description,
    taxTreatment: line.taxTreatment,
    uifTreatment: line.uifTreatment,
    sdlTreatment: line.sdlTreatment,
    kind: line.kind,
  }))
}

export function buildSalaryStructureContentHash(template: Omit<SalaryStructureTemplate, 'contentHash'>): string {
  return canonicalDigest({
    code: template.code,
    name: template.name,
    frequency: template.frequency,
    status: template.status,
    lines: template.lines,
    notes: template.notes ?? null,
  })
}

/** Minimal ZIP (store method) as base64 — no compression, no external deps. */
export function buildZipBase64(files: Array<{ name: string; content: string }>): string {
  const encoder = new TextEncoder()
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  const u16 = (n: number) => {
    const b = new Uint8Array(2)
    b[0] = n & 0xff
    b[1] = (n >> 8) & 0xff
    return b
  }
  const u32 = (n: number) => {
    const b = new Uint8Array(4)
    b[0] = n & 0xff
    b[1] = (n >> 8) & 0xff
    b[2] = (n >> 16) & 0xff
    b[3] = (n >> 24) & 0xff
    return b
  }
  const concat = (chunks: Uint8Array[]) => {
    const total = chunks.reduce((s, c) => s + c.length, 0)
    const out = new Uint8Array(total)
    let o = 0
    for (const c of chunks) {
      out.set(c, o)
      o += c.length
    }
    return out
  }
  const crc32 = (data: Uint8Array): number => {
    let c = 0xffffffff
    for (let i = 0; i < data.length; i += 1) {
      c ^= data[i]
      for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
    return (c ^ 0xffffffff) >>> 0
  }

  for (const file of files) {
    const nameBytes = encoder.encode(file.name)
    const data = encoder.encode(file.content)
    const crc = crc32(data)
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      data,
    ])
    localParts.push(local)
    const central = concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes,
    ])
    centralParts.push(central)
    offset += local.length
  }

  const centralDir = concat(centralParts)
  const locals = concat(localParts)
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralDir.length),
    u32(locals.length),
    u16(0),
  ])
  const zip = concat([locals, centralDir, end])
  let binary = ''
  for (let i = 0; i < zip.length; i += 1) binary += String.fromCharCode(zip[i])
  // btoa available in browsers; Node: Buffer
  if (typeof Buffer !== 'undefined') return Buffer.from(zip).toString('base64')
  return btoa(binary)
}

export function buildBulkPayslipRunPackFiles(input: {
  payRun: PayRun
  payslips: Payslip[]
}): {
  files: Array<{ name: string; contentType: string; content: string }>
  zipBase64: string
  zipFileName: string
  rowCount: number
  payslipIds: string[]
  externalEgressAllowed: false
  autoSent: false
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
} {
  if (input.payRun.status !== 'approved_locked' && input.payRun.status !== 'reversed') {
    throw new Error('Bulk payslip pack requires a locked (or reversed) pay run')
  }
  const payslips = [...input.payslips].sort((a, b) => a.employeeId.localeCompare(b.employeeId) || a.id.localeCompare(b.id))
  if (payslips.length < 1) throw new Error('No payslips on pay run for bulk pack')

  const files: Array<{ name: string; contentType: string; content: string }> = []
  let rowCount = 0
  for (const ps of payslips) {
    const pack = buildPayslipDownloadPack(ps)
    rowCount += pack.rowCount
    for (const f of pack.files) {
      if (f.name === 'manifest.json') {
        files.push({ name: `payslips/${ps.id}/manifest.json`, contentType: f.contentType, content: f.content })
      } else {
        files.push({ name: `payslips/${ps.id}/${f.name}`, contentType: f.contentType, content: f.content })
      }
    }
  }

  const bulkManifest = {
    kind: 'payroll.bulk_payslip_run_pack_v1',
    payRunId: input.payRun.id,
    payPeriodId: input.payRun.payPeriodId,
    payslipIds: payslips.map((p) => p.id),
    payslipCount: payslips.length,
    externalEgressAllowed: false,
    autoSent: false,
    sarsSubmissionInitiated: false,
    externalPaymentInitiated: false,
    massEmailAllowed: false,
    notice: 'Bulk download pack only. Not emailed. No SARS submit. No bank payment initiated.',
  }
  files.unshift({
    name: 'bulk-manifest.json',
    contentType: 'application/json',
    content: JSON.stringify(bulkManifest, null, 2),
  })
  files.push({
    name: 'README.txt',
    contentType: 'text/plain; charset=utf-8',
    content: [
      'Partners in Biz — bulk payslip run pack',
      `Pay run: ${input.payRun.id} (${input.payRun.label})`,
      `Payslips: ${payslips.length}`,
      'Delivery: browser/ZIP download only. Mass email is forbidden.',
      'Hard gates: sarsSubmissionInitiated=false externalPaymentInitiated=false autoSent=false',
    ].join('\n'),
  })

  const zipBase64 = buildZipBase64(files.map((f) => ({ name: f.name, content: f.content })))
  return {
    files,
    zipBase64,
    zipFileName: `payslips-run-${input.payRun.id}.zip`,
    rowCount,
    payslipIds: payslips.map((p) => p.id),
    externalEgressAllowed: false,
    autoSent: false,
    sarsSubmissionInitiated: false,
    externalPaymentInitiated: false,
  }
}

export function buildEmp501AnnualReadinessPack(input: {
  id: string
  taxYear: PayrollTaxYear
  emp501: Emp501Reconciliation
  irp5Records: Irp5Record[]
  emp201Snapshots: Emp201Snapshot[]
}): Emp501AnnualReadinessPack {
  const irp5 = input.irp5Records.filter((r) => r.taxYearId === input.taxYear.id)
  const emp201 = input.emp201Snapshots.filter((r) => r.taxYearId === input.taxYear.id)
  const irp5Approved = irp5.filter((r) => r.status === 'approved_locked')
  const emp201Approved = emp201.filter((r) => r.status === 'approved_locked')
  const blockers: string[] = []
  if (!input.emp501.reconciled) blockers.push('EMP501 not fully reconciled (non-zero differences)')
  if (input.emp501.status !== 'approved_locked' && input.emp501.status !== 'ready') {
    blockers.push(`EMP501 status is ${input.emp501.status}`)
  }
  if (irp5.length < 1) blockers.push('No IRP5/IT3(a) certificates for tax year')
  if (irp5Approved.length < irp5.length) blockers.push('Not all IRP5/IT3(a) certificates are approved_locked')
  if (emp201.length < 1) blockers.push('No EMP201 monthly snapshots for tax year')
  if (emp201Approved.length < emp201.length) blockers.push('Not all EMP201 snapshots are approved_locked')

  const batchExportReady = blockers.length === 0
  const irp5CsvHeader = 'certificateId,kind,employeeId,status,taxableEarningsMinor,payeMinor,uifEmployeeMinor,sarsSubmissionInitiated'
  const irp5CsvRows = irp5.map((r) =>
    [
      r.id,
      r.certificateKind,
      r.employeeId,
      r.status,
      r.totals?.taxableEarningsMinor ?? 0,
      r.totals?.payeMinor ?? 0,
      r.totals?.uifEmployeeMinor ?? 0,
      String(r.sarsSubmissionInitiated ?? false),
    ].join(','),
  )
  const readinessJson = {
    kind: 'payroll.emp501_annual_pack_v1',
    taxYearId: input.taxYear.id,
    taxYearLabel: input.taxYear.taxYearLabel,
    emp501Id: input.emp501.id,
    emp501Status: input.emp501.status,
    emp501Reconciled: input.emp501.reconciled,
    irp5Count: irp5.length,
    irp5ApprovedCount: irp5Approved.length,
    emp201Count: emp201.length,
    emp201ApprovedCount: emp201Approved.length,
    batchExportReady,
    blockers,
    externalEgressAllowed: false,
    autoSent: false,
    sarsSubmissionInitiated: false,
    externalPaymentInitiated: false,
    notice: 'Prepare/download only. No SARS eFiling submit. No payment initiation.',
  }

  const checklistTxt = [
    'EMP501 annual readiness pack',
    `Tax year: ${input.taxYear.id}`,
    `EMP501: ${input.emp501.id} status=${input.emp501.status} reconciled=${String(input.emp501.reconciled)}`,
    `IRP5 batch: ${irp5Approved.length}/${irp5.length} approved`,
    `EMP201: ${emp201Approved.length}/${emp201.length} approved`,
    `batchExportReady: ${String(batchExportReady)}`,
    blockers.length ? `Blockers:\n- ${blockers.join('\n- ')}` : 'Blockers: none',
    '',
    'HARD GATES: sarsSubmissionInitiated=false externalPaymentInitiated=false autoSent=false externalEgressAllowed=false',
  ].join('\n')

  return {
    id: input.id,
    taxYearId: input.taxYear.id,
    emp501Id: input.emp501.id,
    files: [
      { name: 'readiness.json', contentType: 'application/json', content: JSON.stringify(readinessJson, null, 2) },
      { name: 'checklist.txt', contentType: 'text/plain; charset=utf-8', content: checklistTxt },
      {
        name: 'irp5-batch.csv',
        contentType: 'text/csv; charset=utf-8',
        content: [irp5CsvHeader, ...irp5CsvRows].join('\n'),
      },
      {
        name: 'emp501-summary.json',
        contentType: 'application/json',
        content: JSON.stringify(
          {
            id: input.emp501.id,
            status: input.emp501.status,
            reconciled: input.emp501.reconciled,
            difference: input.emp501.difference ?? null,
            sarsSubmissionInitiated: input.emp501.sarsSubmissionInitiated ?? false,
          },
          null,
          2,
        ),
      },
    ],
    readiness: {
      emp501Reconciled: Boolean(input.emp501.reconciled),
      emp501Status: input.emp501.status,
      irp5Count: irp5.length,
      irp5ApprovedCount: irp5Approved.length,
      emp201Count: emp201.length,
      emp201ApprovedCount: emp201Approved.length,
      batchExportReady,
      blockers,
    },
    externalEgressAllowed: false,
    autoSent: false,
    sarsSubmissionInitiated: false,
    externalPaymentInitiated: false,
    notice: 'Prepare/download only — NO SARS submit',
  }
}
