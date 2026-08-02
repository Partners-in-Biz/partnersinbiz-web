/** Phase-3 opening trial balance + per-book cutover wizard (no SARS/pay initiate). */

export type CutoverPackageStatus =
  | 'draft'
  | 'validated'
  | 'approved'
  | 'activated'
  | 'failed'

export type CutoverOpenItemRole = 'customer' | 'supplier'

export interface CutoverTrialBalanceLine {
  accountId: string
  accountCode?: string
  accountName?: string
  /** Debit minor units (>= 0). Exactly one of debit/credit should be non-zero. */
  debitMinor: number
  creditMinor: number
  controlAccountRole?: 'receivables' | 'payables' | 'tax' | 'payroll' | 'bank' | 'retained_earnings'
}

export interface CutoverOpeningOpenItem {
  id: string
  counterpartyCompanyId: string
  counterpartyRole: CutoverOpenItemRole
  currency: string
  originalMinor: number
  dueDate: string
  taxDate: string
  controlAccountId: string
  /** Legacy reference for settlement without double-recognising revenue/tax. */
  legacySourceRef: string
  description?: string
}

export interface CutoverPayrollYtdOpening {
  id: string
  employeeId: string
  taxYearId: string
  componentCode: string
  amountMinor: number
  currency: string
  sourceEvidenceRef?: string
}

export interface CutoverTaxStateSnapshot {
  id: string
  taxPeriodId?: string
  taxCodeId?: string
  description: string
  balanceMinor: number
  currency: string
  sourceEvidenceRef?: string
}

export interface CutoverPackage {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  periodId: string
  currency: string
  /** Canonical cutover date YYYY-MM-DD; becomes book.cutoverAt on activate. */
  cutoverAt: string
  status: CutoverPackageStatus
  description: string
  trialBalanceLines: CutoverTrialBalanceLine[]
  openingOpenItems: CutoverOpeningOpenItem[]
  payrollYtdOpenings: CutoverPayrollYtdOpening[]
  taxStateSnapshots: CutoverTaxStateSnapshot[]
  totalDebitMinor: number
  totalCreditMinor: number
  receivablesControlTotalMinor: number
  payablesControlTotalMinor: number
  openItemCustomerTotalMinor: number
  openItemSupplierTotalMinor: number
  validationErrors: string[]
  approvalId?: string
  approvalActorId?: string
  approvedAt?: string
  approvalReason?: string
  activatedAt?: string
  activatedBy?: string
  openingJournalEntryId?: string
  materializedOpenItemIds: string[]
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
  schemaVersion: 1
  version: number
  /** Hard gates — never true in this module. */
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
}

export type CutoverFinanceAction =
  | 'cutover.package.create'
  | 'cutover.package.update'
  | 'cutover.package.validate'
  | 'cutover.package.approve'
  | 'cutover.package.activate'
  | 'cutover.read'
