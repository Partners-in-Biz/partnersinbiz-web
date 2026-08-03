import type { FinanceScope, VersionedFinanceRecord } from '@/lib/finance/types'

/** Lite SA-agency methods only — not full ASC-606. */
export type RevenueRecognitionMethod = 'straight_line' | 'milestone'

export type RevenueScheduleStatus = 'draft' | 'active' | 'completed' | 'cancelled'

export type RevenueScheduleLineStatus = 'pending' | 'recognized' | 'reversed'

export type RecognitionRunStatus = 'draft' | 'calculated' | 'approved_posted' | 'reversed'

export type RevenueScope = Required<FinanceScope>

export interface RevenueScheduleLine {
  lineId: string
  periodIndex: number
  /** YYYY-MM for straight_line; optional target period for milestone. */
  periodKey?: string
  milestoneCode?: string
  milestoneName?: string
  amountMinor: number
  cumulativeMinor: number
  status: RevenueScheduleLineStatus
  recognizedRunId?: string
  recognizedAt?: string
}

/**
 * Revenue schedule linked to an AR invoice and/or contract reference.
 * Prepaid/retainer model: billed creates deferred liability; period runs recognize into revenue.
 */
export interface RevenueSchedule extends VersionedFinanceRecord {
  bookId: string
  scheduleNumber: string
  name: string
  description?: string
  /** Optional AR customer invoice id (finance_customer_invoices). */
  arInvoiceId?: string
  /** Free-text / CRM contract reference for agency retainers. */
  contractRef?: string
  customerName?: string
  currency: string
  method: RevenueRecognitionMethod
  status: RevenueScheduleStatus
  /** Total contract / billed consideration in minor units. */
  totalContractMinor: number
  /** Amount already billed (typically equals total for prepaid retainers). */
  billedMinor: number
  recognizedMinor: number
  deferredBalanceMinor: number
  startDate: string
  endDate?: string
  /** Straight-line months; required when method=straight_line. */
  months?: number
  deferredRevenueAccountId: string
  revenueAccountId: string
  lines: RevenueScheduleLine[]
  lastRecognizedPeriodKey?: string
  activatedAt?: string
  completedAt?: string
  cancelledAt?: string
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
  externalEgressAllowed: false
}

export interface RecognitionRunItem {
  id: string
  recognitionRunId: string
  scheduleId: string
  scheduleNumber: string
  scheduleName: string
  lineId: string
  periodIndex: number
  periodKey?: string
  milestoneCode?: string
  amountMinor: number
  openingDeferredMinor: number
  closingDeferredMinor: number
  openingRecognizedMinor: number
  closingRecognizedMinor: number
  deferredRevenueAccountId: string
  revenueAccountId: string
}

export interface RecognitionRun extends VersionedFinanceRecord {
  bookId: string
  periodKey: string
  periodId?: string
  postingDate: string
  status: RecognitionRunStatus
  description: string
  itemCount: number
  totalRecognizedMinor: number
  items: RecognitionRunItem[]
  journalEntryId?: string
  reversalJournalEntryId?: string
  approvalId?: string
  approvalActorId?: string
  approvedAt?: string
  calculatedAt?: string
  calculatedBy?: string
  postedAt?: string
  postedBy?: string
  reversedAt?: string
  reversedBy?: string
  reverseReason?: string
  reverseApprovalId?: string
  inputDigest: string
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
  externalEgressAllowed: false
}

export interface RevenueRecognitionAuditEvent {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  eventType: string
  subjectType: 'schedule' | 'recognition_run' | 'report'
  subjectId: string
  actorUid: string
  at: string
  summary: string
  payloadDigest: string
  externalEgressAllowed: false
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
}

export interface DeferredRevenueReportLine {
  scheduleId: string
  scheduleNumber: string
  name: string
  method: RevenueRecognitionMethod
  status: RevenueScheduleStatus
  billedMinor: number
  recognizedMinor: number
  deferredBalanceMinor: number
  currency: string
  arInvoiceId?: string
  contractRef?: string
  lastRecognizedPeriodKey?: string
}

export interface DeferredRevenueReport {
  orgId: string
  legalEntityId: string
  bookId: string
  asOfPeriodKey: string
  generatedAt: string
  currency: string
  scheduleCount: number
  totalBilledMinor: number
  totalRecognizedMinor: number
  totalDeferredMinor: number
  lines: DeferredRevenueReportLine[]
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
  externalEgressAllowed: false
}

export interface RecognizedVsBilledReport {
  orgId: string
  legalEntityId: string
  bookId: string
  asOfPeriodKey: string
  generatedAt: string
  currency: string
  totalBilledMinor: number
  totalRecognizedMinor: number
  totalDeferredMinor: number
  /** recognized / billed * 10000 (basis points); 0 if billed=0 */
  recognizedBps: number
  lines: DeferredRevenueReportLine[]
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
  externalEgressAllowed: false
}

export interface RevenueRecognitionBundle {
  schedules: RevenueSchedule[]
  recognitionRuns: RecognitionRun[]
  auditEvents: RevenueRecognitionAuditEvent[]
  hardGates: {
    sarsSubmissionInitiated: false
    externalPaymentInitiated: false
    externalEgressAllowed: false
  }
}
