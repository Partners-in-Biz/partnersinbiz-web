/**
 * South African VAT / tax logic boundaries.
 * Versioned rates and rules live in approved tax_rule_versions records.
 * This module only publishes stable jurisdiction constants and package metadata
 * so historical postings never recalculate when SARS packages change.
 */
import { ZA_STANDARD_VAT_RATE_BPS } from '@/lib/accounting/tax'

export const ZA_JURISDICTION_CODE = 'ZA' as const

export const ZA_TAX_POINT_POLICIES = {
  /** Invoice tax point (default for accrual ZA VAT). */
  invoice: 'za-invoice',
  /** Payment/tax-point on verified allocation (cash-oriented). */
  payment: 'za-payment',
} as const

export interface ZaVatPackageBoundary {
  packageId: string
  jurisdictionCode: typeof ZA_JURISDICTION_CODE
  label: string
  standardRateBasisPoints: number
  standardRateNumerator: number
  standardRateDenominator: number
  taxPointPolicyId: string
  sourceCitation: string
  sourceChecksum: string
  /** Inclusive effective calendar bounds for the published package boundary. */
  effectiveFrom: string
  effectiveTo?: string
}

/** Configurable, versioned package boundary — not a live SARS feed. */
export const ZA_VAT_STANDARD_PACKAGE_V1: ZaVatPackageBoundary = {
  packageId: 'za-vat-standard-v1',
  jurisdictionCode: ZA_JURISDICTION_CODE,
  label: 'South Africa standard VAT 15%',
  standardRateBasisPoints: ZA_STANDARD_VAT_RATE_BPS,
  standardRateNumerator: 15,
  standardRateDenominator: 100,
  taxPointPolicyId: ZA_TAX_POINT_POLICIES.invoice,
  sourceCitation: 'SARS VAT standard rate package boundary (configurable; no live submission)',
  sourceChecksum: 'za-vat-standard-15-v1',
  effectiveFrom: '2018-04-01',
}

export function zaStandardVatRuleDraft(input: {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  taxCodeId: string
  versionNumber: number
  packageBoundary?: ZaVatPackageBoundary
}) {
  const pack = input.packageBoundary ?? ZA_VAT_STANDARD_PACKAGE_V1
  return {
    id: input.id,
    orgId: input.orgId,
    legalEntityId: input.legalEntityId,
    bookId: input.bookId,
    taxCodeId: input.taxCodeId,
    jurisdictionCode: pack.jurisdictionCode,
    versionNumber: input.versionNumber,
    rateBasisPoints: pack.standardRateBasisPoints,
    rateNumerator: pack.standardRateNumerator,
    rateDenominator: pack.standardRateDenominator,
    roundingMode: 'half_up' as const,
    taxPointPolicyId: pack.taxPointPolicyId,
    effectiveFrom: pack.effectiveFrom,
    sourceCitation: pack.sourceCitation,
    sourceChecksum: pack.sourceChecksum,
    ...(pack.effectiveTo ? { effectiveTo: pack.effectiveTo } : {}),
  }
}
