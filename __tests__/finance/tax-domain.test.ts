import { immutableContentHash } from '@/lib/accounting/foundation'
import {
  assertTaxRuleVersionHash,
  calculateTaxAmount,
  FinanceValidationError,
  resolveEffectiveTaxRule,
  ZA_STANDARD_VAT_RATE_BPS,
} from '@/lib/accounting/tax'
import type { TaxCode, TaxRuleVersion } from '@/lib/accounting/tax-types'

const scope = { orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a' }

function rule(overrides: Partial<TaxRuleVersion> = {}): TaxRuleVersion {
  const base: Omit<TaxRuleVersion, 'contentHash'> = {
    ...scope,
    id: 'rule-za-standard-v1',
    schemaVersion: 1,
    version: 1,
    taxCodeId: 'tax-za-standard',
    jurisdictionCode: 'ZA',
    versionNumber: 1,
    rateBasisPoints: ZA_STANDARD_VAT_RATE_BPS,
    rateNumerator: 15,
    rateDenominator: 100,
    roundingMode: 'half_up',
    taxPointPolicyId: 'za-invoice',
    effectiveFrom: '2026-07-01',
    status: 'approved',
    approvalId: 'approval-tax-rule',
    approvalActorId: 'approver',
    approvedAt: '2026-07-01T09:00:00.000Z',
    sourceCitation: 'SARS VAT 15% standard rate package boundary',
    sourceChecksum: 'za-vat-standard-15-v1',
    immutable: true,
    createdAt: '2026-07-01T09:00:00.000Z',
    createdBy: 'admin',
    updatedAt: '2026-07-01T09:00:00.000Z',
    updatedBy: 'admin',
    ...overrides,
  }
  return { ...base, contentHash: immutableContentHash(base) }
}

const code: TaxCode = {
  ...scope,
  id: 'tax-za-standard',
  schemaVersion: 1,
  version: 1,
  code: 'ZA-STD',
  name: 'South Africa standard VAT',
  jurisdictionCode: 'ZA',
  category: 'output_vat',
  recoverability: 'full',
  outputAccountId: 'vat-output',
  inputAccountId: 'vat-input',
  active: true,
  createdAt: '2026-07-01T09:00:00.000Z',
  createdBy: 'admin',
  updatedAt: '2026-07-01T09:00:00.000Z',
  updatedBy: 'admin',
}

describe('VAT and configurable tax rule domain', () => {
  test('pins the unique effective South African rule version and refuses later rate changes', () => {
    const current = rule({ effectiveTo: '2027-03-31' })
    const later = rule({
      id: 'rule-za-standard-v2',
      versionNumber: 2,
      rateBasisPoints: 1600,
      rateNumerator: 16,
      effectiveFrom: '2027-04-01',
      sourceChecksum: 'za-vat-standard-16-v2',
    })

    const resolved = resolveEffectiveTaxRule([current, later], code.id, '2026-07-15')
    expect(resolved.id).toBe(current.id)
    expect(resolved.rateBasisPoints).toBe(1500)

    expect(resolveEffectiveTaxRule([current, later], code.id, '2027-05-01').id).toBe(later.id)
    expect(resolveEffectiveTaxRule([current, later], code.id, '2027-05-01').rateBasisPoints).toBe(1600)
  })

  test('calculates inclusive and exclusive VAT with half-up minor-unit rounding and stores a trace', () => {
    const current = rule()
    const exclusive = calculateTaxAmount({
      taxCode: code,
      rule: current,
      taxableMinorExclusive: 10_000,
      taxIncluded: false,
      documentDate: '2026-07-15',
    })
    expect(exclusive.taxableMinor).toBe(10_000)
    expect(exclusive.taxMinor).toBe(1_500)
    expect(exclusive.grossMinor).toBe(11_500)
    expect(exclusive.trace.taxRuleVersionId).toBe(current.id)
    expect(exclusive.trace.rateBasisPoints).toBe(1500)
    expect(exclusive.trace.jurisdictionCode).toBe('ZA')

    const inclusive = calculateTaxAmount({
      taxCode: code,
      rule: current,
      taxableMinorExclusive: 11_500,
      taxIncluded: true,
      documentDate: '2026-07-15',
    })
    expect(inclusive.grossMinor).toBe(11_500)
    expect(inclusive.taxMinor).toBe(1_500)
    expect(inclusive.taxableMinor).toBe(10_000)
  })

  test('zero-rated and exempt codes produce zero tax without inventing a rate', () => {
    const zeroCode: TaxCode = { ...code, id: 'tax-zero', code: 'ZA-ZERO', category: 'zero_rated' }
    const zeroRule = rule({ id: 'rule-zero', taxCodeId: 'tax-zero', rateBasisPoints: 0, rateNumerator: 0, rateDenominator: 1, sourceChecksum: 'zero' })
    const result = calculateTaxAmount({
      taxCode: zeroCode,
      rule: zeroRule,
      taxableMinorExclusive: 50_000,
      taxIncluded: false,
      documentDate: '2026-07-15',
    })
    expect(result.taxMinor).toBe(0)
    expect(result.taxableMinor).toBe(50_000)
  })

  test('rejects draft or hash-tampered tax rule versions at calculation time', () => {
    const draft = rule({ status: 'draft' as TaxRuleVersion['status'], immutable: false as true })
    expect(() => assertTaxRuleVersionHash(draft)).toThrow(FinanceValidationError)

    const good = rule()
    expect(() => assertTaxRuleVersionHash({ ...good, contentHash: 'tampered' })).toThrow('content hash')
  })

  test('refuses ambiguous overlapping effective ranges for the same tax code', () => {
    const a = rule({ effectiveTo: '2026-12-31' })
    const b = rule({
      id: 'overlap',
      versionNumber: 2,
      effectiveFrom: '2026-12-01',
      sourceChecksum: 'overlap',
    })
    expect(() => resolveEffectiveTaxRule([a, b], code.id, '2026-12-15'))
      .toThrow('unique effective tax rule')
  })
})
