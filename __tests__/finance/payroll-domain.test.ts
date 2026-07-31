import {
  annualizeAmount,
  assertCalculationDeterministic,
  calculateAnnualPayeBeforeRebate,
  calculateAnnualRebate,
  calculatePayrollPeriod,
  deAnnualizeAmount,
  multiplyRateByHours,
  multiplyRateByMultiplier,
  periodsPerYear,
} from '@/lib/payroll/calculation'
import { zaPayrollRuleVersionDraft, ZA_PAYROLL_PACKAGE_V2026 } from '@/lib/jurisdictions/za/payroll'
import { buildPayrollRuleContentHash } from '@/lib/payroll/calculation'
import type { PayrollCalculationInput, PayrollRuleVersion } from '@/lib/payroll/types'

function approvedRule(): PayrollRuleVersion {
  const draft = {
    ...zaPayrollRuleVersionDraft({
      id: 'rule-za-2026',
      orgId: 'org-a',
      legalEntityId: 'entity-a',
      bookId: 'book-a',
      versionNumber: 1,
    }),
    schemaVersion: 1 as const,
    version: 2,
    createdAt: '2026-03-01T00:00:00.000Z',
    createdBy: 'admin',
    updatedAt: '2026-03-01T00:00:00.000Z',
    updatedBy: 'approver',
    status: 'approved' as const,
    immutable: true as const,
    approvalId: 'ap-1',
    approvalActorId: 'approver',
    approvedAt: '2026-03-01T00:00:00.000Z',
  }
  return { ...draft, contentHash: buildPayrollRuleContentHash(draft) }
}

function baseInput(partial: Partial<PayrollCalculationInput> = {}): PayrollCalculationInput {
  return {
    orgId: 'org-a',
    legalEntityId: 'entity-a',
    bookId: 'book-a',
    employeeId: 'emp-1',
    employmentId: 'empl-1',
    payPeriodId: 'period-1',
    periodStart: '2026-03-01',
    periodEnd: '2026-03-31',
    payDate: '2026-03-25',
    frequency: 'monthly',
    workerCategory: 'salaried',
    termVersionId: 'term-1',
    termContentHash: 'term-hash',
    rateMinor: 2_500_000, // R25,000.00
    standardHoursPerPeriod: 160,
    overtimeMultiplierNumerator: 150,
    overtimeMultiplierDenominator: 100,
    subjectToUif: true,
    subjectToSdl: true,
    taxResidency: 'za_resident',
    ageYears: 35,
    ordinaryHoursWorked: 0,
    overtimeHours: 0,
    components: [],
    leave: [],
    ...partial,
  }
}

describe('payroll domain calculation', () => {
  test('publishes versioned ZA package metadata and periods', () => {
    expect(ZA_PAYROLL_PACKAGE_V2026.packageId).toBe('za-payroll-tax-tables-2026-v1')
    expect(ZA_PAYROLL_PACKAGE_V2026.jurisdictionCode).toBe('ZA')
    expect(ZA_PAYROLL_PACKAGE_V2026.uif.monthlyCeilingMinor).toBe(1_771_200)
    const rule = approvedRule()
    expect(periodsPerYear('monthly', rule)).toBe(12)
    expect(periodsPerYear('weekly', rule)).toBe(52)
  })

  test('computes PAYE brackets and rebates in minor units', () => {
    const rule = approvedRule()
    // R200,000 annual -> 18%
    expect(calculateAnnualPayeBeforeRebate(20_000_000, rule)).toBe(3_600_000)
    // primary rebate only under 65
    expect(calculateAnnualRebate(rule, 40)).toBe(1_723_500)
    expect(calculateAnnualRebate(rule, 66)).toBe(1_723_500 + 944_400)
    expect(deAnnualizeAmount(annualizeAmount(100, 12), 12)).toBe(100)
  })

  test('calculates monthly salaried pay with overtime bonus allowance benefit deduction leave', () => {
    const rule = approvedRule()
    const input = baseInput({
      overtimeHours: 10,
      leave: [{ id: 'lv1', kind: 'unpaid', hours: 8 }],
      components: [
        { componentCode: 'BONUS', kind: 'bonus', quantityMinorUnits: 1, unitAmountMinor: 200_000 },
        { componentCode: 'COMM', kind: 'commission', quantityMinorUnits: 1, unitAmountMinor: 150_000 },
        { componentCode: 'TRAVEL', kind: 'allowance', quantityMinorUnits: 1, unitAmountMinor: 50_000 },
        { componentCode: 'MEDAID', kind: 'benefit', quantityMinorUnits: 1, unitAmountMinor: 80_000 },
        {
          componentCode: 'PENSION',
          kind: 'deduction',
          quantityMinorUnits: 1,
          unitAmountMinor: 100_000,
          taxTreatment: 'pre_tax_deduction',
        },
        {
          componentCode: 'GARNISH',
          kind: 'deduction',
          quantityMinorUnits: 1,
          unitAmountMinor: 25_000,
          taxTreatment: 'post_tax_deduction',
        },
      ],
    })
    const result = calculatePayrollPeriod(input, rule)
    expect(result.accountantReview.externalPaymentInitiated).toBe(false)
    expect(result.accountantReview.sarsSubmissionInitiated).toBe(false)
    expect(result.accountantReview.identitiesHold).toBe(true)
    expect(result.totals.overtimeMinor).toBe(
      multiplyRateByHours(
        multiplyRateByMultiplier(2_500_000, 150, 100, 'ot'),
        10,
        'ot',
      ),
    )
    // unpaid 8/160 of R25,000.00 salary -> R1,250.00
    expect(result.totals.leaveUnpaidReductionMinor).toBe(125_000)
    expect(result.totals.grossEarningsMinor).toBeGreaterThan(0)
    expect(result.totals.payeMinor).toBeGreaterThan(0)
    expect(result.totals.uifEmployeeMinor).toBeGreaterThan(0)
    expect(result.totals.uifEmployerMinor).toBe(result.totals.uifEmployeeMinor)
    expect(result.totals.sdlEmployerMinor).toBeGreaterThan(0)
    expect(result.totals.netPayMinor).toBe(
      result.totals.grossEarningsMinor -
        result.totals.preTaxDeductionsMinor -
        result.totals.payeMinor -
        result.totals.uifEmployeeMinor -
        result.totals.postTaxDeductionsMinor,
    )
    expect(result.trace.length).toBeGreaterThan(5)
    expect(result.trace[0].code).toBe('pin_rule')
    assertCalculationDeterministic(input, rule)
    const again = calculatePayrollPeriod(input, rule)
    expect(again.resultDigest).toBe(result.resultDigest)
  })

  test('calculates weekly hourly worker with paid leave', () => {
    const rule = approvedRule()
    const input = baseInput({
      frequency: 'weekly',
      workerCategory: 'hourly',
      rateMinor: 15_000, // R150/hr
      standardHoursPerPeriod: 40,
      ordinaryHoursWorked: 32,
      overtimeHours: 4,
      leave: [{ id: 'lv-paid', kind: 'paid', hours: 8 }],
      periodStart: '2026-03-02',
      periodEnd: '2026-03-08',
      payDate: '2026-03-06',
      components: [],
    })
    const result = calculatePayrollPeriod(input, rule)
    expect(result.periodsPerYear).toBe(52)
    expect(result.totals.leavePaidMinor).toBe(multiplyRateByHours(15_000, 8, 'leave'))
    expect(result.totals.grossEarningsMinor).toBe(
      multiplyRateByHours(15_000, 32, 'ord') +
        multiplyRateByHours(multiplyRateByMultiplier(15_000, 150, 100, 'ot'), 4, 'ot') +
        multiplyRateByHours(15_000, 8, 'leave'),
    )
    expect(result.accountantReview.identitiesHold).toBe(true)
    expect(result.resultDigest).toHaveLength(64)
  })

  test('rejects draft rule versions for final calculation', () => {
    const rule = approvedRule()
    const draft = { ...rule, status: 'draft' as const, immutable: false }
    expect(() => calculatePayrollPeriod(baseInput(), draft)).toThrow('approved immutable')
  })
})
