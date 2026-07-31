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

export type PayPeriodStatus = 'open' | 'closed'

export interface PayPeriod extends VersionedFinanceRecord {
  bookId: string
  calendarId: string
  frequency: PayFrequency
  label: string
  periodStart: string
  periodEnd: string
  payDate: string
  taxYearLabel: string
  status: PayPeriodStatus
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
