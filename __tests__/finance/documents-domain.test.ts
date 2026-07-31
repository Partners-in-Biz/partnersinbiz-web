import {
  assertAllocationAmount,
  assertDueOnOrAfterIssue,
  assertReconciliationCanApprove,
  assertReconciliationStatementMath,
  buildDocumentLine,
  computeReconciliationDifference,
  formatDocumentNumber,
  lineNetExclusiveMinor,
  projectDocumentStatusFromOutstanding,
  projectOpenItemStatus,
  sumDocumentLines,
} from '@/lib/accounting/documents'
import type { TaxCode, TaxRuleVersion } from '@/lib/accounting/tax-types'
import { immutableContentHash } from '@/lib/accounting/foundation'

const taxCode: TaxCode = {
  id: 'tax-za-std', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a',
  code: 'ZA-STD', name: 'Standard VAT', jurisdictionCode: 'ZA', category: 'output_vat',
  recoverability: 'full', active: true, schemaVersion: 1, version: 1,
  createdAt: '2026-07-01T00:00:00.000Z', createdBy: 'system',
  updatedAt: '2026-07-01T00:00:00.000Z', updatedBy: 'system',
}

const taxRuleBase = {
  id: 'rule-za-std', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a',
  taxCodeId: 'tax-za-std', jurisdictionCode: 'ZA', versionNumber: 1, rateBasisPoints: 1500,
  rateNumerator: 15, rateDenominator: 100, roundingMode: 'half_up' as const,
  taxPointPolicyId: 'za-invoice', effectiveFrom: '2026-07-01', status: 'approved' as const,
  sourceCitation: 'SARS VAT 15%', sourceChecksum: 'za-vat-15', immutable: true,
  schemaVersion: 1 as const, version: 1,
  createdAt: '2026-07-01T00:00:00.000Z', createdBy: 'system',
  updatedAt: '2026-07-01T00:00:00.000Z', updatedBy: 'system',
}
const taxRule: TaxRuleVersion = { ...taxRuleBase, contentHash: immutableContentHash(taxRuleBase) }

describe('documents domain', () => {
  test('computes exclusive VAT line and document totals in minor units', () => {
    expect(lineNetExclusiveMinor(1000, 10_000)).toBe(10_000)
    const line = buildDocumentLine({
      line: {
        id: 'l1', description: 'Consulting', quantityMilli: 1000, unitPriceMinor: 10_000,
        taxCodeId: 'tax-za-std', taxIncluded: false, revenueOrExpenseAccountId: 'revenue',
      },
      sequence: 1, taxCode, taxRules: [taxRule], documentDate: '2026-07-15',
    })
    expect(line.taxableMinor).toBe(10_000)
    expect(line.taxMinor).toBe(1_500)
    expect(line.grossMinor).toBe(11_500)
    expect(sumDocumentLines([line])).toEqual({ subtotalMinor: 10_000, taxMinor: 1_500, totalMinor: 11_500 })
  })

  test('projects open-item and document statuses from outstanding balances', () => {
    expect(projectOpenItemStatus(11_500, 11_500)).toBe('open')
    expect(projectOpenItemStatus(11_500, 5_000)).toBe('partially_paid')
    expect(projectOpenItemStatus(11_500, 0)).toBe('closed')
    expect(projectDocumentStatusFromOutstanding('issued', 11_500, 5_000)).toBe('partially_paid')
    expect(projectDocumentStatusFromOutstanding('issued', 11_500, 0)).toBe('paid')
    expect(projectDocumentStatusFromOutstanding('voided', 11_500, 0)).toBe('voided')
  })

  test('rejects allocations that exceed payment or open-item remaining amounts', () => {
    expect(() => assertAllocationAmount(1_000, 5_000, 1_001)).toThrow('payment unallocated')
    expect(() => assertAllocationAmount(5_000, 1_000, 900, 200)).toThrow('open item outstanding')
    expect(() => assertAllocationAmount(5_000, 1_000, 1_000)).not.toThrow()
  })

  test('formats document numbers and enforces due dates', () => {
    expect(formatDocumentNumber('inv', 7)).toBe('INV-000007')
    expect(() => assertDueOnOrAfterIssue('2026-07-15', '2026-07-14')).toThrow('dueDate')
    assertDueOnOrAfterIssue('2026-07-15', '2026-07-15')
  })

  test('enforces bank reconciliation statement and zero-difference approval math', () => {
    assertReconciliationStatementMath({ openingBalanceMinor: 10_000, statementMovementMinor: 2_500, closingBalanceMinor: 12_500 })
    expect(() => assertReconciliationStatementMath({
      openingBalanceMinor: 10_000, statementMovementMinor: 2_500, closingBalanceMinor: 12_000,
    })).toThrow('closing balance')
    expect(computeReconciliationDifference({ statementMovementMinor: 2_500, matchedMovementMinor: 2_500 })).toBe(0)
    assertReconciliationCanApprove({ status: 'in_review', differenceMinor: 0 })
    expect(() => assertReconciliationCanApprove({ status: 'in_review', differenceMinor: 1 })).toThrow('difference must be zero')
  })
})
