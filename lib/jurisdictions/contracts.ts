/**
 * Jurisdiction calculation boundaries.
 * Core payroll/accounting never branches on country codes; it consumes
 * engine results + deterministic traces from these contracts.
 */
import type {
  PayrollCalculationInput,
  PayrollCalculationResult,
  PayrollRuleVersion,
} from '@/lib/payroll/types'

export type JurisdictionCode = string

export interface PayrollEngine {
  readonly jurisdictionCode: JurisdictionCode
  /** Pure calculation against a pinned approved rule version + worker inputs. */
  calculate(input: PayrollCalculationInput, rule: PayrollRuleVersion): PayrollCalculationResult
}

export interface TaxTablePackageMeta {
  packageId: string
  jurisdictionCode: JurisdictionCode
  label: string
  taxYearLabel: string
  effectiveFrom: string
  effectiveTo?: string
  sourceCitation: string
  sourceChecksum: string
}
