import { immutableContentHash, parseCanonicalDate, requiredText, FinanceValidationError } from './foundation'
import type {
  TaxAmountResult,
  TaxCalculationTrace,
  TaxCode,
  TaxRuleVersion,
} from './tax-types'

export { FinanceValidationError }

/** South African standard VAT rate boundary: 15.00% = 1500 basis points. */
export const ZA_STANDARD_VAT_RATE_BPS = 1500

export function assertTaxRuleVersionHash(rule: TaxRuleVersion): void {
  if (rule.status !== 'approved' || !rule.immutable) {
    throw new FinanceValidationError('Only approved immutable tax rule versions may be used for calculation')
  }
  if (!rule.contentHash || immutableContentHash(rule) !== rule.contentHash) {
    throw new FinanceValidationError('Tax rule version content hash is invalid')
  }
}

function ruleEffective(rule: TaxRuleVersion, documentDate: string): boolean {
  const dateEpoch = parseCanonicalDate(documentDate, 'documentDate')
  const from = parseCanonicalDate(rule.effectiveFrom, 'taxRule.effectiveFrom')
  const to = rule.effectiveTo ? parseCanonicalDate(rule.effectiveTo, 'taxRule.effectiveTo') : Number.POSITIVE_INFINITY
  return dateEpoch >= from && dateEpoch <= to
}

export function resolveEffectiveTaxRule(
  rules: readonly TaxRuleVersion[],
  taxCodeId: string,
  documentDate: string,
): TaxRuleVersion {
  requiredText(taxCodeId, 'taxCodeId')
  parseCanonicalDate(documentDate, 'documentDate')
  const candidates = rules.filter((rule) =>
    rule.taxCodeId === taxCodeId &&
    rule.status === 'approved' &&
    rule.immutable &&
    ruleEffective(rule, documentDate))
  if (candidates.length !== 1) {
    throw new FinanceValidationError('Document date must resolve to one unique effective tax rule version')
  }
  const rule = candidates[0]
  assertTaxRuleVersionHash(rule)
  return rule
}

function assertNonNegativeMinor(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new FinanceValidationError(`${field} must be a non-negative safe integer in minor units`)
  }
}

function roundHalfUp(numerator: number, denominator: number): number {
  if (denominator <= 0) throw new FinanceValidationError('Tax rule denominator must be positive')
  if (numerator === 0) return 0
  const sign = numerator < 0 ? -1 : 1
  const absolute = Math.abs(numerator)
  return sign * Math.floor((absolute + Math.floor(denominator / 2)) / denominator)
}

function applyRounding(value: number, mode: TaxRuleVersion['roundingMode']): number {
  if (mode === 'half_up') return roundHalfUp(value, 1) // value already integer candidate via floor path
  if (mode === 'floor') return Math.floor(value)
  if (mode === 'ceil') return Math.ceil(value)
  // half_even banker's rounding for integer results of x + 0.5 style is handled via scaled ints
  const floor = Math.floor(value)
  const fraction = value - floor
  if (fraction < 0.5) return floor
  if (fraction > 0.5) return floor + 1
  return floor % 2 === 0 ? floor : floor + 1
}

/**
 * Calculate tax using a pinned approved rule version.
 * Exclusive mode: tax = round(taxable * rate).
 * Inclusive mode: taxable = round(gross * den / (num+den)); tax = gross - taxable.
 */
export function calculateTaxAmount(input: {
  taxCode: TaxCode
  rule: TaxRuleVersion
  taxableMinorExclusive: number
  taxIncluded: boolean
  documentDate: string
}): TaxAmountResult {
  const { taxCode, rule } = input
  assertTaxRuleVersionHash(rule)
  if (rule.taxCodeId !== taxCode.id) {
    throw new FinanceValidationError('Tax rule version does not belong to the tax code')
  }
  if (taxCode.jurisdictionCode !== rule.jurisdictionCode) {
    throw new FinanceValidationError('Tax code and rule jurisdiction do not match')
  }
  if (!taxCode.active) throw new FinanceValidationError('Tax code is inactive')
  assertNonNegativeMinor(input.taxableMinorExclusive, 'taxableMinorExclusive')
  if (!Number.isSafeInteger(rule.rateBasisPoints) || rule.rateBasisPoints < 0 || rule.rateBasisPoints > 100_000) {
    throw new FinanceValidationError('Tax rule rateBasisPoints is invalid')
  }
  if (!Number.isSafeInteger(rule.rateNumerator) || rule.rateNumerator < 0) {
    throw new FinanceValidationError('Tax rule rateNumerator is invalid')
  }
  if (!Number.isSafeInteger(rule.rateDenominator) || rule.rateDenominator <= 0) {
    throw new FinanceValidationError('Tax rule rateDenominator is invalid')
  }
  if (rule.rateBasisPoints !== Math.round((rule.rateNumerator * 10_000) / rule.rateDenominator) &&
      !(rule.rateNumerator === 0 && rule.rateBasisPoints === 0)) {
    // Allow exact rational that maps to basis points; zero is always ok.
    const expectedBps = Math.round((rule.rateNumerator * 10_000) / rule.rateDenominator)
    if (expectedBps !== rule.rateBasisPoints) {
      throw new FinanceValidationError('Tax rule basis points do not match rational rate components')
    }
  }

  const zeroTaxCategories = new Set(['zero_rated', 'exempt', 'out_of_scope'])
  let taxableMinor = 0
  let taxMinor = 0
  let grossMinor = 0

  if (zeroTaxCategories.has(taxCode.category) || rule.rateNumerator === 0) {
    if (input.taxIncluded) {
      grossMinor = input.taxableMinorExclusive
      taxableMinor = input.taxableMinorExclusive
      taxMinor = 0
    } else {
      taxableMinor = input.taxableMinorExclusive
      taxMinor = 0
      grossMinor = taxableMinor
    }
  } else if (input.taxIncluded) {
    grossMinor = input.taxableMinorExclusive
    const den = rule.rateNumerator + rule.rateDenominator
    // taxable = gross * denominator / (numerator + denominator)
    const scaled = grossMinor * rule.rateDenominator
    taxableMinor = rule.roundingMode === 'half_up'
      ? roundHalfUp(scaled, den)
      : applyRounding(scaled / den, rule.roundingMode)
    taxMinor = grossMinor - taxableMinor
  } else {
    taxableMinor = input.taxableMinorExclusive
    const scaled = taxableMinor * rule.rateNumerator
    taxMinor = rule.roundingMode === 'half_up'
      ? roundHalfUp(scaled, rule.rateDenominator)
      : applyRounding(scaled / rule.rateDenominator, rule.roundingMode)
    grossMinor = taxableMinor + taxMinor
  }

  if (!Number.isSafeInteger(taxableMinor) || !Number.isSafeInteger(taxMinor) || !Number.isSafeInteger(grossMinor)) {
    throw new FinanceValidationError('Tax calculation exceeded safe integer precision')
  }
  if (taxableMinor < 0 || taxMinor < 0 || grossMinor < 0) {
    throw new FinanceValidationError('Tax calculation produced a negative amount')
  }

  const trace: TaxCalculationTrace = {
    taxCodeId: taxCode.id,
    taxRuleVersionId: rule.id,
    jurisdictionCode: rule.jurisdictionCode,
    category: taxCode.category,
    rateBasisPoints: rule.rateBasisPoints,
    rateNumerator: rule.rateNumerator,
    rateDenominator: rule.rateDenominator,
    roundingMode: rule.roundingMode,
    taxPointPolicyId: rule.taxPointPolicyId,
    taxIncluded: input.taxIncluded,
    documentDate: input.documentDate,
    sourceCitation: rule.sourceCitation,
    sourceChecksum: rule.sourceChecksum,
  }

  return { taxableMinor, taxMinor, grossMinor, trace }
}

export function buildTaxRuleContentHash(rule: Omit<TaxRuleVersion, 'contentHash'>): string {
  return immutableContentHash(rule)
}
