/** Phase 5 proving kit — demo company, multi-period close, packaging walkthrough, accountant acceptance. */
export type ProvingFinanceAction =
  | 'proving.seed'
  | 'proving.close_fixture.run'
  | 'proving.packaging.dry_run'
  | 'proving.checklist.read'
  | 'proving.checklist.toggle'
  | 'proving.read'

export type CloseBlockerCode =
  | 'unreconciled_bank'
  | 'unapproved_pay_run'
  | 'open_fx_revaluation'
  | 'incomplete_cutover'
  | 'open_ar_dispute'
  | 'missing_depreciation'

export type CloseBlocker = {
  code: CloseBlockerCode
  label: string
  resolved: boolean
  evidence?: string
}

export type ProvingPeriodKey = '2026-05' | '2026-06' | '2026-07'

export type ProvingEntityBlueprint = {
  id: string
  code: string
  legalName: string
  bookId: string
  bookCode: string
  branchId: string
  branchCode: string
  functionalCurrency: 'ZAR'
}

export type DemoArApLine = {
  id: string
  entityId: string
  role: 'customer' | 'supplier'
  counterpartyName: string
  documentNumber: string
  originalMinor: number
  openMinor: number
  dueDate: string
  currency: 'ZAR' | 'USD'
  projectId?: string
}

export type DemoBankLine = {
  id: string
  entityId: string
  bookingDate: string
  description: string
  amountMinor: number
  currency: 'ZAR'
  matched: boolean
}

export type DemoPayrollRun = {
  id: string
  entityId: string
  periodKey: ProvingPeriodKey
  status: 'draft' | 'in_review' | 'approved_locked'
  employeeCount: number
  grossMinor: number
  payeMinor: number
  uifMinor: number
  sdlMinor: number
  netMinor: number
}

export type DemoFxPosition = {
  id: string
  entityId: string
  currency: 'USD'
  openTxnMinor: number
  functionalMinor: number
  rateScaled: number
  rateScale: number
  revaluationOpen: boolean
}

export type DemoAsset = {
  id: string
  entityId: string
  code: string
  name: string
  costMinor: number
  residualMinor: number
  usefulLifeMonths: number
  depreciationPostedThrough?: ProvingPeriodKey
}

export type DemoJobCost = {
  projectId: string
  projectName: string
  entityId: string
  wipMinor: number
  billedMinor: number
  labourHours: number
}

export type ReportFreezeSnapshot = {
  periodKey: ProvingPeriodKey
  entityId: string
  bookId: string
  frozenAt: string
  trialBalanceHash: string
  totalDebitMinor: number
  totalCreditMinor: number
  journalCount: number
  immutable: true
  externalEgressAllowed: false
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
}

export type AcceptanceCheckItem = {
  id: string
  section: string
  step: number
  title: string
  detail: string
  evidenceHint: string
  required: boolean
  checked: boolean
  checkedAt?: string
  checkedBy?: string
}

export type PackagingDryRunResult = {
  kind: string
  family: string
  title: string
  fileNames: string[]
  rowCount: number
  sampleSha256: string
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
  externalEgressAllowed: false
}

export type ProvingSeedSnapshot = {
  schemaVersion: 1
  seedKey: string
  orgId: string
  companyName: string
  seededAt: string
  seededBy: string
  entities: ProvingEntityBlueprint[]
  periods: Array<{
    id: string
    entityId: string
    bookId: string
    periodKey: ProvingPeriodKey
    status: 'open' | 'soft_closed' | 'hard_closed'
    version: number
  }>
  accountsByBook: Record<string, Array<{ id: string; code: string; name: string; accountType: string }>>
  journals: Array<{
    id: string
    entityId: string
    bookId: string
    periodId: string
    periodKey: ProvingPeriodKey
    description: string
    debitMinor: number
    creditMinor: number
    contentHash: string
  }>
  arAp: DemoArApLine[]
  bankLines: DemoBankLine[]
  payrollRuns: DemoPayrollRun[]
  fxPositions: DemoFxPosition[]
  assets: DemoAsset[]
  jobCosts: DemoJobCost[]
  hardGates: {
    sarsSubmissionInitiated: false
    externalPaymentInitiated: false
    externalEgressAllowed: false
    massEmailAllowed: false
  }
}

export type ProvingCloseRun = {
  id: string
  orgId: string
  seedKey: string
  entityId: string
  bookId: string
  periodKey: ProvingPeriodKey
  status: 'blocked' | 'closed' | 'reports_frozen'
  blockers: CloseBlocker[]
  closedAt?: string
  freeze?: ReportFreezeSnapshot
  createdAt: string
  updatedAt: string
}

export type ProvingWorkspace = {
  orgId: string
  seed?: ProvingSeedSnapshot
  closeRuns: ProvingCloseRun[]
  packagingDryRuns: PackagingDryRunResult[]
  acceptanceChecklist: AcceptanceCheckItem[]
  audit: Array<{ at: string; action: string; actorId: string; summary: string; externalEgressAllowed: false }>
}
