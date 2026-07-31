/**
 * South African payroll tax-table package boundaries.
 * Versioned tables are stored as approved payroll_rule_versions.
 * This module publishes stable package metadata and draft builders only —
 * no live SARS feed, submission, or payment.
 */
import type { PayrollRuleVersion, PayeBracket, StatutoryRate } from '@/lib/payroll/types'
import { ZA_JURISDICTION_CODE } from './tax'
import type { TaxTablePackageMeta } from '../contracts'

/** SARS-style annual PAYE brackets for tax year 2025/26 (1 Mar 2025 – 28 Feb 2026), ZAR cents. */
export const ZA_PAYE_BRACKETS_2026_MINOR: readonly PayeBracket[] = [
  { upToInclusiveMinor: 23_710_000, rateNumerator: 18, rateDenominator: 100, cumulativeBaseTaxMinor: 0 },
  { upToInclusiveMinor: 37_050_000, rateNumerator: 26, rateDenominator: 100, cumulativeBaseTaxMinor: 4_267_800 },
  { upToInclusiveMinor: 51_280_000, rateNumerator: 31, rateDenominator: 100, cumulativeBaseTaxMinor: 7_736_200 },
  { upToInclusiveMinor: 67_300_000, rateNumerator: 36, rateDenominator: 100, cumulativeBaseTaxMinor: 12_147_500 },
  { upToInclusiveMinor: 85_790_000, rateNumerator: 39, rateDenominator: 100, cumulativeBaseTaxMinor: 17_914_700 },
  { upToInclusiveMinor: 181_700_000, rateNumerator: 41, rateDenominator: 100, cumulativeBaseTaxMinor: 25_125_800 },
  { upToInclusiveMinor: null, rateNumerator: 45, rateDenominator: 100, cumulativeBaseTaxMinor: 64_448_900 },
] as const

export const ZA_UIF_2026: StatutoryRate = {
  employeeRateNumerator: 1,
  employeeRateDenominator: 100,
  employerRateNumerator: 1,
  employerRateDenominator: 100,
  /** Monthly remuneration ceiling for UIF contributions (cents). */
  monthlyCeilingMinor: 1_771_200,
}

export const ZA_SDL_2026: StatutoryRate = {
  employeeRateNumerator: 0,
  employeeRateDenominator: 100,
  employerRateNumerator: 1,
  employerRateDenominator: 100,
  /** No per-period ceiling; employer liability on leviable amount. */
  monthlyCeilingMinor: null,
}

export const ZA_REBATES_2026 = {
  primaryMinor: 1_723_500,
  secondaryMinor: 944_400,
  tertiaryMinor: 314_500,
  secondaryAgeFrom: 65,
  tertiaryAgeFrom: 75,
} as const

export const ZA_PAYROLL_PACKAGE_V2026: TaxTablePackageMeta & {
  payeBrackets: readonly PayeBracket[]
  uif: StatutoryRate
  sdl: StatutoryRate
  rebates: typeof ZA_REBATES_2026
  periodsPerYear: { monthly: 12; weekly: 52 }
  roundingMode: 'half_up'
} = {
  packageId: 'za-payroll-tax-tables-2026-v1',
  jurisdictionCode: ZA_JURISDICTION_CODE,
  label: 'South Africa payroll PAYE/UIF/SDL golden package v1 (2025/26 brackets)',
  taxYearLabel: '2025/26',
  effectiveFrom: '2025-03-01',
  // Open-ended until a superseding approved package is published; not a live SARS feed.
  sourceCitation:
    'Configurable ZA payroll golden package (PAYE brackets, rebates, UIF ceiling, SDL). Not a live SARS feed; no submission/payment.',
  sourceChecksum: 'za-payroll-2026-v1-paye-uif-sdl',
  payeBrackets: ZA_PAYE_BRACKETS_2026_MINOR,
  uif: ZA_UIF_2026,
  sdl: ZA_SDL_2026,
  rebates: ZA_REBATES_2026,
  periodsPerYear: { monthly: 12, weekly: 52 },
  roundingMode: 'half_up',
}

export function zaPayrollRuleVersionDraft(input: {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  versionNumber: number
  packageBoundary?: typeof ZA_PAYROLL_PACKAGE_V2026
}): Omit<
  PayrollRuleVersion,
  | 'schemaVersion'
  | 'version'
  | 'createdAt'
  | 'createdBy'
  | 'updatedAt'
  | 'updatedBy'
  | 'status'
  | 'immutable'
  | 'contentHash'
  | 'approvalId'
  | 'approvalActorId'
  | 'approvedAt'
> {
  const pack = input.packageBoundary ?? ZA_PAYROLL_PACKAGE_V2026
  return {
    id: input.id,
    orgId: input.orgId,
    legalEntityId: input.legalEntityId,
    bookId: input.bookId,
    jurisdictionCode: pack.jurisdictionCode,
    versionNumber: input.versionNumber,
    packageId: pack.packageId,
    taxYearLabel: pack.taxYearLabel,
    effectiveFrom: pack.effectiveFrom,
    ...(pack.effectiveTo ? { effectiveTo: pack.effectiveTo } : {}),
    payeBrackets: pack.payeBrackets.map((b) => ({ ...b })),
    uif: { ...pack.uif },
    sdl: { ...pack.sdl },
    primaryRebateMinor: pack.rebates.primaryMinor,
    secondaryRebateMinor: pack.rebates.secondaryMinor,
    tertiaryRebateMinor: pack.rebates.tertiaryMinor,
    secondaryAgeFrom: pack.rebates.secondaryAgeFrom,
    tertiaryAgeFrom: pack.rebates.tertiaryAgeFrom,
    periodsPerYearMonthly: pack.periodsPerYear.monthly,
    periodsPerYearWeekly: pack.periodsPerYear.weekly,
    roundingMode: pack.roundingMode,
    sourceCitation: pack.sourceCitation,
    sourceChecksum: pack.sourceChecksum,
  }
}
