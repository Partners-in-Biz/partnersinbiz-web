import type { VersionedFinanceRecord } from '@/lib/finance/types'
import type {
  PayComponentKind,
  PayFrequency,
  PayRunStatus,
  TaxTreatment,
  UifTreatment,
  SdlTreatment,
  LeavePayEffect,
  LeaveRequestStatus,
  LeaveUnit,
} from './types'

export type SalaryStructureStatus = 'draft' | 'active' | 'archived'

export interface SalaryStructureLine {
  lineId: string
  componentCode: string
  kind: PayComponentKind
  description: string
  /** Fixed amount in minor units when quantity is amount-based; unit rate for hourly-style lines. */
  unitAmountMinor: number
  /** Default quantity (1 for fixed monthly lines; hours for hourly components). */
  quantityMinorUnits: number
  taxTreatment: TaxTreatment
  uifTreatment: UifTreatment
  sdlTreatment: SdlTreatment
}

export interface SalaryStructureTemplate extends VersionedFinanceRecord {
  bookId: string
  code: string
  name: string
  frequency: PayFrequency
  status: SalaryStructureStatus
  lines: SalaryStructureLine[]
  contentHash: string
  notes?: string
}

export interface BulkPayslipRunPack extends VersionedFinanceRecord {
  bookId: string
  payRunId: string
  payPeriodId: string
  payslipIds: string[]
  files: Array<{ name: string; contentType: string; content: string }>
  rowCount: number
  /** Archive format marker — client may reconstruct ZIP from files[] or use zipBase64. */
  archiveFormat: 'multi_file_zip_v1'
  zipBase64: string
  zipFileName: string
  status: 'ready' | 'downloaded'
  publicationStatus: 'internal_only'
  autoSent: false
  externalEgressAllowed: false
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
  contentHash: string
  downloadedAt?: string
  downloadedBy?: string
}

export interface PayRunBoardRow {
  legalEntityId: string
  legalEntityLabel: string
  bookId: string
  bookLabel: string
  payRunId: string
  label: string
  status: PayRunStatus
  kind: string
  payPeriodId: string
  periodLabel: string
  periodStart: string
  periodEnd: string
  payDate: string
  cutOffAt: string
  cutoffStatus: 'upcoming' | 'open_for_input' | 'past_cutoff' | 'closed' | 'locked'
  itemCount: number
  payslipCount: number
  totalsGrossMinor: number
  totalsNetMinor: number
  totalsPayeMinor: number
}

export interface CalendarDensityCell {
  date: string
  payDateCount: number
  cutOffCount: number
  lockedRunCount: number
  inReviewCount: number
  draftCount: number
}

export interface MultiEntityPayRunBoard {
  generatedAt: string
  windowStart: string
  windowEnd: string
  rows: PayRunBoardRow[]
  density: CalendarDensityCell[]
  summary: {
    entityCount: number
    runCount: number
    lockedCount: number
    inReviewCount: number
    draftOrCalculatedCount: number
    totalNetMinor: number
    totalPayeMinor: number
  }
  hardGates: {
    externalPaymentInitiated: false
    sarsSubmissionInitiated: false
    externalEgressAllowed: false
    massEmailAllowed: false
  }
}

export interface LeaveCalendarDayEntry {
  leaveRecordId: string
  employeeId: string
  employeeLabel: string
  leaveTypeCode: string
  status: LeaveRequestStatus
  payEffect: LeavePayEffect
  hours: number
  quantity: number
  unit: LeaveUnit
  startDate: string
  endDate: string
}

export interface LeaveBalanceView {
  employeeId: string
  employeeLabel: string
  leaveTypeId: string
  leaveTypeCode: string
  unit: LeaveUnit
  balanceQuantity: number
  balanceHours: number
  asOfDate: string
  accrues: boolean
}

export interface LeaveMonthCalendar {
  year: number
  month: number
  monthKey: string
  days: Array<{ date: string; entries: LeaveCalendarDayEntry[] }>
  pendingRequests: LeaveCalendarDayEntry[]
  balances: LeaveBalanceView[]
  accrualSummary: Array<{ leaveTypeCode: string; accrues: boolean; employeeCountWithBalance: number; totalBalanceHours: number }>
  hardGates: { externalEgressAllowed: false }
}

export interface Emp501AnnualPackFile {
  name: string
  contentType: string
  content: string
}

export interface Emp501AnnualReadinessPack {
  id: string
  taxYearId: string
  emp501Id: string
  files: Emp501AnnualPackFile[]
  readiness: {
    emp501Reconciled: boolean
    emp501Status: string
    irp5Count: number
    irp5ApprovedCount: number
    emp201Count: number
    emp201ApprovedCount: number
    batchExportReady: boolean
    blockers: string[]
  }
  externalEgressAllowed: false
  autoSent: false
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
  notice: string
}
