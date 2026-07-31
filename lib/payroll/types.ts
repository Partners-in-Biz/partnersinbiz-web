import type { FinanceScope, VersionedFinanceRecord } from '@/lib/finance/types'
import type { HASH_ALGORITHM_VERSION } from '@/lib/finance/integrity'

export type PayFrequency = 'monthly' | 'weekly'
export type WorkerCategory = 'salaried' | 'hourly'
export type PayComponentKind =
  | 'base_salary'
  | 'hourly_wage'
  | 'overtime'
  | 'bonus'
  | 'commission'
  | 'allowance'
  | 'benefit'
  | 'deduction'
  | 'leave_paid'
  | 'leave_unpaid'
  | 'employer_contribution'
  | 'statutory_paye'
  | 'statutory_uif_employee'
  | 'statutory_uif_employer'
  | 'statutory_sdl'

export type TaxTreatment = 'taxable' | 'non_taxable' | 'pre_tax_deduction' | 'post_tax_deduction'
export type UifTreatment = 'include' | 'exclude'
export type SdlTreatment = 'include' | 'exclude'

export interface PayeBracket {
  /** Inclusive upper bound of annual taxable income in minor units; null = open-ended. */
  upToInclusiveMinor: number | null
  rateNumerator: number
  rateDenominator: number
  /** Tax on income up to the previous bracket ceiling (annual minor units). */
  cumulativeBaseTaxMinor: number
}

export interface StatutoryRate {
  employeeRateNumerator: number
  employeeRateDenominator: number
  employerRateNumerator: number
  employerRateDenominator: number
  monthlyCeilingMinor: number | null
}

export interface PayrollEmployee extends VersionedFinanceRecord {
  bookId: string
  employeeNumber: string
  displayName: string
  status: 'active' | 'terminated'
  /** Redacted identity fields stay out of calculation traces by default. */
  taxResidency: 'za_resident' | 'non_resident'
  dateOfBirth?: string
  startDate: string
  endDate?: string
}

export interface EmploymentTermVersion extends VersionedFinanceRecord {
  bookId: string
  employeeId: string
  employmentId: string
  versionNumber: number
  workerCategory: WorkerCategory
  frequency: PayFrequency
  /** Monthly/weekly salary or hourly rate in minor units. */
  rateMinor: number
  /** Standard hours for the period in centi-hours (16000 = 160.00). */
  standardHoursCenti: number
  overtimeMultiplierNumerator: number
  overtimeMultiplierDenominator: number
  subjectToUif: boolean
  subjectToSdl: boolean
  effectiveFrom: string
  effectiveTo?: string
  status: 'draft' | 'active' | 'superseded'
  immutable: boolean
  contentHash: string
}

export interface PayrollEmployment extends VersionedFinanceRecord {
  bookId: string
  employeeId: string
  branchId?: string
  status: 'active' | 'ended'
  currentTermVersionId?: string
}

export interface PayComponentDefinition extends VersionedFinanceRecord {
  bookId: string
  code: string
  name: string
  kind: PayComponentKind
  taxTreatment: TaxTreatment
  uifTreatment: UifTreatment
  sdlTreatment: SdlTreatment
  active: boolean
  jurisdictionCode: string
}

export interface PayrollRuleVersion extends VersionedFinanceRecord {
  bookId: string
  jurisdictionCode: string
  versionNumber: number
  packageId: string
  taxYearLabel: string
  effectiveFrom: string
  effectiveTo?: string
  payeBrackets: PayeBracket[]
  uif: StatutoryRate
  sdl: StatutoryRate
  primaryRebateMinor: number
  secondaryRebateMinor: number
  tertiaryRebateMinor: number
  secondaryAgeFrom: number
  tertiaryAgeFrom: number
  periodsPerYearMonthly: number
  periodsPerYearWeekly: number
  roundingMode: 'half_up'
  status: 'draft' | 'approved'
  approvalId?: string
  approvalActorId?: string
  approvedAt?: string
  sourceCitation: string
  sourceChecksum: string
  immutable: boolean
  contentHash: string
}

export interface PayrollCalendar extends VersionedFinanceRecord {
  bookId: string
  code: string
  name: string
  frequency: PayFrequency
  status: 'active' | 'disabled'
}

export type PayPeriodStatus = 'open' | 'closed' | 'locked'

export interface PayPeriod extends VersionedFinanceRecord {
  bookId: string
  calendarId: string
  frequency: PayFrequency
  label: string
  periodStart: string
  periodEnd: string
  /** Inclusive input cut-off instant (ISO). Inputs freeze at/after this time. */
  cutOffAt: string
  payDate: string
  taxYearLabel: string
  status: PayPeriodStatus
}

export type PayRunStatus =
  | 'draft'
  | 'calculating'
  | 'calculated'
  | 'in_review'
  | 'approved_locked'
  | 'reversed'
  | 'correction'

export type PayRunKind =
  | 'regular'
  | 'correction'
  | 'individual_adjustment'
  | 'back_pay'
  | 'overpayment_recovery'
  | 'amended_deduction_tax'
  | 'full_reversal'

export type PayrollAdjustmentKind =
  | 'back_pay'
  | 'overpayment_recovery'
  | 'missed_deduction'
  | 'amended_tax'
  | 'amended_deduction'
  | 'individual_correction'
  | 'full_run_reversal'

export interface PayRunTotals {
  employeeCount: number
  grossEarningsMinor: number
  taxableEarningsMinor: number
  preTaxDeductionsMinor: number
  postTaxDeductionsMinor: number
  payeMinor: number
  uifEmployeeMinor: number
  uifEmployerMinor: number
  sdlEmployerMinor: number
  netPayMinor: number
  employerCostMinor: number
}

export interface PayRun extends VersionedFinanceRecord {
  bookId: string
  calendarId: string
  payPeriodId: string
  ruleVersionId: string
  kind: PayRunKind
  status: PayRunStatus
  label: string
  inputCutoffAt: string
  inputsFrozen: boolean
  frozenAt?: string
  inputSetHash?: string
  lockHash?: string
  totals: PayRunTotals
  itemIds: string[]
  payslipIds: string[]
  originalPayRunId?: string
  reversalPayRunId?: string
  correctionOfPayRunId?: string
  submittedBy?: string
  submittedAt?: string
  approvalId?: string
  approvalActorId?: string
  approvedAt?: string
  lockedAt?: string
  lockedBy?: string
  reason?: string
  immutable: boolean
  contentHash: string
  externalPaymentInitiated: false
  sarsSubmissionInitiated: false
  /** Observed external salary payments (recorded/reconciled only — never initiated here). */
  externalSalaryPaymentObservations: ExternalSalaryPaymentObservation[]
}

export interface PayRunItem extends VersionedFinanceRecord {
  bookId: string
  payRunId: string
  employeeId: string
  employmentId: string
  calculationId: string
  status: 'calculated' | 'approved_locked' | 'reversed' | 'corrected'
  resultDigest: string
  inputDigest: string
  totals: PayrollCalculationTotals
  lines: PayrollComponentLine[]
  originalItemId?: string
  adjustmentId?: string
  payslipId?: string
  immutable: boolean
  contentHash: string
  externalPaymentInitiated: false
  sarsSubmissionInitiated: false
}

export interface Payslip extends VersionedFinanceRecord {
  bookId: string
  payRunId: string
  payRunItemId: string
  employeeId: string
  employmentId: string
  payPeriodId: string
  payDate: string
  periodStart: string
  periodEnd: string
  status: 'generated' | 'superseded'
  publicationStatus: 'internal_only'
  accessVersion: number
  generationChecksum: string
  rendered: {
    employeeDisplayName: string
    employeeNumber: string
    currency: 'ZAR'
    lines: PayrollComponentLine[]
    totals: PayrollCalculationTotals
    netPayMinor: number
  }
  immutable: boolean
  contentHash: string
  externalPaymentInitiated: false
  sarsSubmissionInitiated: false
  autoSent: false
}

export interface PayrollAdjustment extends VersionedFinanceRecord {
  bookId: string
  kind: PayrollAdjustmentKind
  status: 'draft' | 'applied' | 'approved_locked'
  payRunId?: string
  originalPayRunId: string
  originalItemId?: string
  employeeId?: string
  employmentId?: string
  /** Signed delta component lines applied on the correction run (minor units). */
  deltaComponents: PeriodComponentInput[]
  reason: string
  approvalId?: string
  approvalActorId?: string
  approvedAt?: string
  immutable: boolean
  contentHash: string
  externalPaymentInitiated: false
  sarsSubmissionInitiated: false
}

export interface ExternalSalaryPaymentObservation {
  id: string
  observedAt: string
  amountMinor: number
  currency: 'ZAR'
  reference: string
  bankAccountHint?: string
  /** Always false — payroll never initiates external salary payments. */
  externalPaymentInitiated: false
  recordedBy: string
}

export interface LeaveRecordInput {
  id: string
  kind: 'paid' | 'unpaid'
  hours: number
  componentCode?: string
  description?: string
}

export interface PeriodComponentInput {
  componentCode: string
  /** Quantity: hours for hourly/OT/leave; 1 for fixed amounts. */
  quantityMinorUnits: number
  /** Unit amount in minor units (rate or fixed amount). For OT, base hourly rate before multiplier. */
  unitAmountMinor: number
  description?: string
  /** Override default tax/uif/sdl from component definition when set. */
  taxTreatment?: TaxTreatment
  uifTreatment?: UifTreatment
  sdlTreatment?: SdlTreatment
  kind?: PayComponentKind
}

export interface PayrollCalculationInput {
  orgId: string
  legalEntityId: string
  bookId: string
  employeeId: string
  employmentId: string
  payPeriodId: string
  periodStart: string
  periodEnd: string
  payDate: string
  frequency: PayFrequency
  workerCategory: WorkerCategory
  termVersionId: string
  termContentHash: string
  rateMinor: number
  standardHoursPerPeriod: number
  overtimeMultiplierNumerator: number
  overtimeMultiplierDenominator: number
  subjectToUif: boolean
  subjectToSdl: boolean
  taxResidency: 'za_resident' | 'non_resident'
  /** Whole years of age at period end when known; drives secondary/tertiary rebates. */
  ageYears?: number
  ordinaryHoursWorked: number
  overtimeHours: number
  components: PeriodComponentInput[]
  leave: LeaveRecordInput[]
  /** Optional YTD taxable earnings before this period (annualization aid / openings). */
  ytdTaxableMinor?: number
  ytdPayeMinor?: number
}

export interface PayrollTraceStep {
  step: number
  code: string
  label: string
  inputs: Record<string, number | string | boolean | null>
  outputs: Record<string, number | string | boolean | null>
}

export interface PayrollComponentLine {
  lineId: string
  componentCode: string
  kind: PayComponentKind
  description: string
  quantity: number
  unitAmountMinor: number
  amountMinor: number
  taxTreatment: TaxTreatment
  uifTreatment: UifTreatment
  sdlTreatment: SdlTreatment
  employeeFacing: boolean
  employerFacing: boolean
}

export interface PayrollCalculationTotals {
  grossEarningsMinor: number
  taxableEarningsMinor: number
  preTaxDeductionsMinor: number
  postTaxDeductionsMinor: number
  payeMinor: number
  uifEmployeeMinor: number
  uifEmployerMinor: number
  sdlEmployerMinor: number
  netPayMinor: number
  employerCostMinor: number
  benefitsMinor: number
  allowancesMinor: number
  overtimeMinor: number
  bonusMinor: number
  commissionMinor: number
  leavePaidMinor: number
  leaveUnpaidReductionMinor: number
}

export interface PayrollCalculationResult {
  jurisdictionCode: string
  ruleVersionId: string
  ruleVersionNumber: number
  ruleContentHash: string
  packageId: string
  taxYearLabel: string
  inputDigest: string
  resultDigest: string
  frequency: PayFrequency
  periodsPerYear: number
  annualizedTaxableMinor: number
  annualTaxBeforeRebateMinor: number
  annualRebateMinor: number
  annualTaxAfterRebateMinor: number
  lines: PayrollComponentLine[]
  totals: PayrollCalculationTotals
  trace: PayrollTraceStep[]
  warnings: string[]
  /** Accountant-reviewable structured summary (no SARS submit). */
  accountantReview: {
    kind: 'payroll_calculation_review'
    currency: 'ZAR'
    balancedIdentity:
      | 'gross - pre_tax - paye - uif_employee - post_tax = net'
    identitiesHold: boolean
    externalPaymentInitiated: false
    sarsSubmissionInitiated: false
  }
}

export interface PayrollCalculationRecord extends VersionedFinanceRecord {
  bookId: string
  employeeId: string
  employmentId: string
  payPeriodId: string
  ruleVersionId: string
  status: 'calculated'
  result: PayrollCalculationResult
  immutable: boolean
  contentHash: string
  externalPaymentInitiated: false
  sarsSubmissionInitiated: false
}

export interface PayrollAuditEvent extends FinanceScope {
  id: string
  schemaVersion: 1
  aggregateType: string
  aggregateId: string
  aggregateVersion: number
  eventType: string
  actorId: string
  requestId: string
  idempotencyKey: string
  occurredAt: string
  sequence: number
  previousEventId?: string
  previousEventHash?: string
  payload: Record<string, unknown>
  externalEgressAllowed: false
  canonicalPayloadVersion: 1
  hashAlgorithmVersion: typeof HASH_ALGORITHM_VERSION
  eventHash: string
  reason?: string
}

export type PayrollScope = Required<FinanceScope>

export type PayrollTaxYearStatus = 'open' | 'closed' | 'locked'
export type StatutoryRecordStatus = 'draft' | 'ready' | 'approved_locked' | 'superseded'
export type CertificateKind = 'IRP5' | 'IT3(a)'
export type StatutoryExportKind = 'irp5_batch' | 'emp201' | 'emp501' | 'payroll_tax_summary'
export type YtdOpeningStatus = 'draft' | 'approved'

/** Configurable SARS tax-table reference pinned on statutory-ready outputs (no live feed/submit). */
export interface TaxTableReference {
  ruleVersionId: string
  packageId: string
  taxYearLabel: string
  sourceChecksum: string
  sourceCitation: string
  jurisdictionCode: string
}

export interface StatutoryMoneyTotals {
  grossEarningsMinor: number
  taxableEarningsMinor: number
  payeMinor: number
  uifEmployeeMinor: number
  uifEmployerMinor: number
  sdlEmployerMinor: number
  netPayMinor: number
  periodsIncluded: number
}

export interface PayrollTaxYear extends VersionedFinanceRecord {
  bookId: string
  jurisdictionCode: string
  taxYearLabel: string
  startDate: string
  endDate: string
  status: PayrollTaxYearStatus
  /** Approved payroll rule versions that may be referenced for this year. */
  ruleVersionIds: string[]
  packageIds: string[]
  lockedAt?: string
  lockedBy?: string
  approvalId?: string
  immutable: boolean
  contentHash: string
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
}

export interface PayrollYtdOpening extends VersionedFinanceRecord {
  bookId: string
  taxYearId: string
  employeeId: string
  employmentId: string
  status: YtdOpeningStatus
  grossEarningsMinor: number
  taxableEarningsMinor: number
  payeMinor: number
  uifEmployeeMinor: number
  uifEmployerMinor: number
  sdlEmployerMinor: number
  sourceEvidence: string
  approvalId?: string
  approvalActorId?: string
  approvedAt?: string
  immutable: boolean
  contentHash: string
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
}

export interface Irp5Record extends VersionedFinanceRecord {
  bookId: string
  taxYearId: string
  taxYearLabel: string
  employeeId: string
  employmentId: string
  employeeNumber: string
  displayName: string
  taxResidency: 'za_resident' | 'non_resident'
  certificateKind: CertificateKind
  status: StatutoryRecordStatus
  totals: StatutoryMoneyTotals
  ytdOpeningId?: string
  sourcePayRunIds: string[]
  sourceItemIds: string[]
  sourceItemDigests: string[]
  taxTableReferences: TaxTableReference[]
  exportManifestId?: string
  approvalId?: string
  approvalActorId?: string
  approvedAt?: string
  lockedAt?: string
  immutable: boolean
  contentHash: string
  /** Ready record only — never submits to SARS. */
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
}

export interface Emp201Snapshot extends VersionedFinanceRecord {
  bookId: string
  taxYearId: string
  taxYearLabel: string
  /** Liability month YYYY-MM (from pay date / period). */
  taxMonth: string
  status: StatutoryRecordStatus
  employeeCount: number
  totals: StatutoryMoneyTotals
  sourcePayRunIds: string[]
  sourceItemIds: string[]
  sourceItemDigests: string[]
  taxTableReferences: TaxTableReference[]
  exportManifestId?: string
  approvalId?: string
  approvalActorId?: string
  approvedAt?: string
  lockedAt?: string
  immutable: boolean
  contentHash: string
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
}

export interface Emp501Difference {
  grossEarningsMinor: number
  taxableEarningsMinor: number
  payeMinor: number
  uifEmployeeMinor: number
  uifEmployerMinor: number
  sdlEmployerMinor: number
  netPayMinor: number
}

export interface Emp501Reconciliation extends VersionedFinanceRecord {
  bookId: string
  taxYearId: string
  taxYearLabel: string
  status: StatutoryRecordStatus
  emp201SnapshotIds: string[]
  irp5RecordIds: string[]
  monthlyTotals: StatutoryMoneyTotals
  certificateTotals: StatutoryMoneyTotals
  difference: Emp501Difference
  reconciled: boolean
  taxTableReferences: TaxTableReference[]
  exportManifestId?: string
  approvalId?: string
  approvalActorId?: string
  approvedAt?: string
  lockedAt?: string
  immutable: boolean
  contentHash: string
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
}

export interface PayrollExportManifest extends VersionedFinanceRecord {
  bookId: string
  taxYearId: string
  kind: StatutoryExportKind
  status: 'generated' | 'approved'
  recordIds: string[]
  format: 'json_evidence_v1'
  contentDigest: string
  /** Internal evidence payload for accountant export — not a SARS submission channel. */
  evidence: Record<string, unknown>
  approvalId?: string
  approvalActorId?: string
  approvedAt?: string
  immutable: boolean
  contentHash: string
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
  externalEgressAllowed: false
}

export interface PayrollTaxSummary {
  taxYearId: string
  taxYearLabel: string
  status: PayrollTaxYearStatus
  employeeCertificates: number
  irp5Count: number
  it3aCount: number
  emp201Count: number
  emp501Reconciled: boolean | null
  totals: StatutoryMoneyTotals
  taxTableReferences: TaxTableReference[]
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
}
