export type OperatorListResourceKind =
  | 'ar_documents'
  | 'ap_documents'
  | 'ledger_journals'
  | 'payments'
  | 'open_items'

export type OperatorAdvancedFilters = {
  status?: string
  statuses?: string[]
  counterpartyCompanyId?: string
  fromDate?: string
  toDate?: string
  documentNumberContains?: string
  referenceContains?: string
  minOutstandingMinor?: number
  maxOutstandingMinor?: number
  minAmountMinor?: number
  maxAmountMinor?: number
  currency?: string
  unallocatedOnly?: boolean
  direction?: 'receipt' | 'disbursement'
  periodId?: string
  sourceType?: string
  query?: string
}

export type FinanceSavedView = {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  ownerUserId: string
  resourceKind: OperatorListResourceKind
  name: string
  filters: OperatorAdvancedFilters
  sortKey?: string
  sortDir?: 'asc' | 'desc'
  schemaVersion: 1
  version: number
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

export type PeriodCloseBlockerCode =
  | 'unreconciled_bank'
  | 'unapproved_journals'
  | 'open_pay_runs'
  | 'missing_fx_reval'
  | 'incomplete_cutover'
  | 'open_accounting_period_gap'

export type PeriodCloseBlockerSeverity = 'blocker' | 'warning'

export type PeriodCloseBlocker = {
  code: PeriodCloseBlockerCode
  severity: PeriodCloseBlockerSeverity
  title: string
  detail: string
  count: number
  href: string
  itemIds: string[]
}

export type PeriodCloseCommandCentre = {
  orgId: string
  legalEntityId: string
  bookId: string
  periodId?: string
  periodLabel?: string
  asOfDate: string
  blockers: PeriodCloseBlocker[]
  blockerCount: number
  warningCount: number
  readyToClose: boolean
  externalPaymentInitiated: false
  sarsSubmissionInitiated: false
  externalEgressAllowed: false
}

export type OverpayMode = 'reject' | 'on_account' | 'leave_unallocated'

export type AllocationPlanLine = {
  targetType: 'customer_invoice' | 'supplier_bill' | 'open_item' | 'on_account'
  targetId: string
  allocatedMinor: number
  discountMinor: number
  writeOffMinor: number
  openItemId?: string
}

export type MultiAllocatePlan = {
  paymentId: string
  lines: AllocationPlanLine[]
  allocatedTotalMinor: number
  remainderMinor: number
  overpayMode: OverpayMode
  externalPaymentInitiated: false
}

export type BulkSelectionPlan = {
  action: 'bulk_issue' | 'bulk_void' | 'bulk_allocate'
  resourceKind: OperatorListResourceKind
  selectAllFiltered: boolean
  filteredCount: number
  selectedIds: string[]
  capped: boolean
  maxTargets: number
}

export type OperatorDepthAuditEvent = {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  action: string
  subjectType: string
  subjectId: string
  actorUserId: string
  at: string
  metadata: Record<string, unknown>
  externalEgressAllowed: false
  externalPaymentInitiated: false
}
