import {
  aggregatePayRunTotals,
  assertCanApprovePayRun,
  assertCanSubmitPayRun,
  assertPayRunMutable,
  buildInputSetHash,
  buildPayRunLockHash,
  emptyPayRunTotals,
  negateTotals,
} from '@/lib/payroll/pay-run'
import type { PayRun, PayRunItem, PayrollCalculationTotals } from '@/lib/payroll/types'

const totals = (net: number): PayrollCalculationTotals => ({
  grossEarningsMinor: net + 100,
  taxableEarningsMinor: net + 100,
  preTaxDeductionsMinor: 0,
  postTaxDeductionsMinor: 0,
  payeMinor: 80,
  uifEmployeeMinor: 20,
  uifEmployerMinor: 20,
  sdlEmployerMinor: 10,
  netPayMinor: net,
  employerCostMinor: net + 130,
  benefitsMinor: 0,
  allowancesMinor: 0,
  overtimeMinor: 0,
  bonusMinor: 0,
  commissionMinor: 0,
  leavePaidMinor: 0,
  leaveUnpaidReductionMinor: 0,
})

function baseRun(partial: Partial<PayRun> = {}): PayRun {
  return {
    id: 'run-1',
    schemaVersion: 1,
    orgId: 'org-a',
    legalEntityId: 'entity-a',
    bookId: 'book-a',
    version: 1,
    createdAt: '2026-03-20T00:00:00.000Z',
    createdBy: 'clerk',
    updatedAt: '2026-03-20T00:00:00.000Z',
    updatedBy: 'clerk',
    calendarId: 'cal-1',
    payPeriodId: 'per-1',
    ruleVersionId: 'rule-1',
    kind: 'regular',
    status: 'calculated',
    label: 'March',
    inputCutoffAt: '2026-03-20T12:00:00.000Z',
    inputsFrozen: true,
    inputSetHash: 'abc',
    totals: emptyPayRunTotals(),
    itemIds: ['i1'],
    payslipIds: [],
    immutable: false,
    contentHash: 'hash',
    externalPaymentInitiated: false,
    sarsSubmissionInitiated: false,
    externalSalaryPaymentObservations: [],
    ...partial,
  }
}

describe('payroll pay-run domain', () => {
  test('aggregates run totals and builds stable lock hashes', () => {
    const items = [
      { totals: totals(1000) },
      { totals: totals(2000) },
    ] as PayRunItem[]
    const agg = aggregatePayRunTotals(items)
    expect(agg.employeeCount).toBe(2)
    expect(agg.netPayMinor).toBe(3000)
    expect(agg.payeMinor).toBe(160)
    const hashA = buildPayRunLockHash({
      payRunId: 'r1',
      payPeriodId: 'p1',
      ruleVersionId: 'rule',
      inputCutoffAt: '2026-03-20T12:00:00.000Z',
      inputSetHash: buildInputSetHash(['d2', 'd1']),
      totals: agg,
      itemIds: ['b', 'a'],
      itemResultDigests: ['d2', 'd1'],
    })
    const hashB = buildPayRunLockHash({
      payRunId: 'r1',
      payPeriodId: 'p1',
      ruleVersionId: 'rule',
      inputCutoffAt: '2026-03-20T12:00:00.000Z',
      inputSetHash: buildInputSetHash(['d1', 'd2']),
      totals: agg,
      itemIds: ['a', 'b'],
      itemResultDigests: ['d1', 'd2'],
    })
    expect(hashA).toBe(hashB)
    expect(hashA).toHaveLength(64)
  })

  test('negates totals for full-run reversals', () => {
    const reversed = negateTotals(totals(500))
    expect(reversed.netPayMinor).toBe(-500)
    expect(reversed.payeMinor).toBe(-80)
  })

  test('enforces cut-off freeze and approval separation before lock', () => {
    expect(() => assertPayRunMutable(baseRun({ status: 'approved_locked', immutable: true }), 'edit')).toThrow(/locked/)
    expect(() =>
      assertCanSubmitPayRun(baseRun({ inputsFrozen: false }), 1, '2026-03-21T00:00:00.000Z'),
    ).toThrow(/frozen/)
    expect(() =>
      assertCanSubmitPayRun(baseRun({ inputsFrozen: true }), 1, '2026-03-19T00:00:00.000Z'),
    ).toThrow(/cut-off/)
    assertCanSubmitPayRun(baseRun({ status: 'calculated', inputsFrozen: true }), 2, '2026-03-21T00:00:00.000Z')
    expect(() =>
      assertCanApprovePayRun(baseRun({ status: 'in_review', submittedBy: 'approver', createdBy: 'other' }), 'approver'),
    ).toThrow(/submitter/)
    expect(() =>
      assertCanApprovePayRun(baseRun({ status: 'in_review', submittedBy: 'clerk', createdBy: 'approver' }), 'approver'),
    ).toThrow(/creator/)
    assertCanApprovePayRun(baseRun({ status: 'in_review', submittedBy: 'clerk', createdBy: 'clerk' }), 'approver')
  })
})
