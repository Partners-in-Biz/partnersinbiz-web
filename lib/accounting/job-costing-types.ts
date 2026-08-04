import type { AccountingBasis, FinanceScope, VersionedFinanceRecord } from '@/lib/finance/types'
import type { HASH_ALGORITHM_VERSION } from '@/lib/finance/integrity'
import type { CostDimensions } from './cost-dimensions'
import type { JournalLineInput } from './types'
import type { DocumentLineInput } from './documents'

export type JobCostingScope = Required<FinanceScope>

export type TimeCostPurpose = 'wip_cost' | 'draft_invoice_lines'

export type TimeCostApplicationStatus = 'applied' | 'reversed'

/** Snapshot of a PiB time entry used for optional finance costing (never mutates time APIs). */
export interface TimeCostSourceEntry {
  timeEntryId: string
  orgId: string
  projectId: string
  taskId?: string | null
  userId?: string
  description?: string
  billable: boolean
  durationMinutes: number
  /** Labor cost rate in minor units per hour (not the customer bill rate). */
  costRateMinorPerHour: number
  currency: string
  /** When set, entry is already on a customer invoice — cannot draft-bill again. */
  invoiceId?: string | null
  /** Must be set (stopped timer). */
  endAt: string | null
  deleted?: boolean
}

export interface TimeCostLineResult {
  timeEntryId: string
  projectId: string
  taskId?: string
  durationMinutes: number
  costRateMinorPerHour: number
  amountMinor: number
  currency: string
  description: string
  dimensions: CostDimensions
}

export interface TimeCostApplication extends VersionedFinanceRecord {
  bookId: string
  purpose: TimeCostPurpose
  status: TimeCostApplicationStatus
  currency: string
  projectIds: string[]
  timeEntryIds: string[]
  lines: TimeCostLineResult[]
  totalCostMinor: number
  /** Proposed balanced journal lines for WIP labor cost (not auto-posted). */
  proposedJournalLines?: JournalLineInput[]
  /** Proposed AR invoice draft lines (not auto-issued). */
  proposedInvoiceLines?: DocumentLineInput[]
  laborExpenseAccountId?: string
  wipAssetAccountId?: string
  revenueAccountId?: string
  taxCodeId?: string
  requestId: string
  idempotencyKey: string
  immutable: true
  contentHash: string
  externalEgressAllowed: false
  externalPaymentInitiated: false
  canonicalPayloadVersion: 1
  hashAlgorithmVersion: typeof HASH_ALGORITHM_VERSION
}

export interface ProjectPnLSectionLine {
  accountId: string
  accountCode: string
  accountName: string
  accountType: 'income' | 'expense'
  amountMinor: number
  source: 'journal' | 'document'
}

export type JobCostAgingBucketKey = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus'

export interface JobCostAgingBucket {
  key: JobCostAgingBucketKey
  label: string
  amountMinor: number
  count: number
  applicationIds: string[]
}

export interface ProjectInvoiceCashSlice {
  invoiceId: string
  projectGrossMinor: number
  invoiceTotalMinor: number
  cashAppliedMinor: number
  outstandingMinor: number
}

export interface ProjectProfitAndLossReport {
  kind: 'project_profit_and_loss'
  scope: JobCostingScope
  projectId: string
  fromDate: string
  toDate: string
  accountingBasis: AccountingBasis
  revenueLines: ProjectPnLSectionLine[]
  costLines: ProjectPnLSectionLine[]
  totalRevenueMinor: number
  totalCostMinor: number
  grossMarginMinor: number
  /** Cash applied to project-tagged customer invoices (pro-rata by project line share). */
  cashAppliedMinor: number
  /** Remaining AR on project-tagged invoices (pro-rata). */
  outstandingArMinor: number
  invoiceCashSlices: ProjectInvoiceCashSlice[]
  journalEntryIds: string[]
  invoiceIds: string[]
  billIds: string[]
  inputDigest: string
}

export interface ProjectWipReport {
  kind: 'project_wip'
  scope: JobCostingScope
  projectId: string
  asOfDate: string
  /** Unbilled labor cost still held as WIP (time cost applications purpose=wip_cost not yet released by draft invoice). */
  unbilledLaborCostMinor: number
  /** Labor cost that had wip_cost then was released by draft_invoice_lines on the same time entries. */
  releasedLaborCostMinor: number
  /** Recognized project revenue through as-of (from P&L). */
  recognizedRevenueMinor: number
  /** Recognized project cost through as-of (from P&L). */
  recognizedCostMinor: number
  /** Open WIP = unbilled labor cost only. */
  wipMinor: number
  openTimeCostApplicationIds: string[]
  /** Aging of still-open WIP applications by application createdAt date. */
  aging: JobCostAgingBucket[]
  inputDigest: string
}

export type JobCostClosedLoopStepId =
  | 'quote_project'
  | 'time_cost'
  | 'wip'
  | 'invoice'
  | 'cash'

export type JobCostClosedLoopStepStatus = 'missing' | 'pending' | 'open' | 'done' | 'blocked'

export interface JobCostClosedLoopStep {
  id: JobCostClosedLoopStepId
  label: string
  status: JobCostClosedLoopStepStatus
  detail: string
  refs: string[]
}

export interface JobCostClosedLoopTrace {
  kind: 'job_cost_closed_loop'
  scope: JobCostingScope
  projectId: string
  quoteId?: string
  asOfDate: string
  steps: JobCostClosedLoopStep[]
  doubleBillGuards: {
    wipClaimPerTimeEntry: true
    draftInvoiceClaimPerTimeEntry: true
    sourceInvoiceIdBlocksDraft: true
  }
  hardGates: {
    externalEgressAllowed: false
    externalPaymentInitiated: false
    sarsSubmissionInitiated: false
  }
  totals: {
    unbilledLaborCostMinor: number
    releasedLaborCostMinor: number
    totalRevenueMinor: number
    totalCostMinor: number
    grossMarginMinor: number
    cashAppliedMinor: number
    outstandingArMinor: number
  }
  inputDigest: string
}

export type JobCostingAuditEventType =
  | 'job_costing.time_cost.applied'
  | 'job_costing.time_cost.reversed'

export interface JobCostingAuditEvent extends FinanceScope {
  id: string
  schemaVersion: 1
  aggregateType: 'time_cost_application'
  aggregateId: string
  aggregateVersion: number
  eventType: JobCostingAuditEventType
  actorId: string
  requestId?: string
  idempotencyKey?: string
  occurredAt: string
  sequence: number
  previousEventId?: string
  previousEventHash?: string
  eventHash: string
  payload: Record<string, unknown>
  externalEgressAllowed: false
  canonicalPayloadVersion: 1
  hashAlgorithmVersion: typeof HASH_ALGORITHM_VERSION
}
