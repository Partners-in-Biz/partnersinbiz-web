import {
  DEPRECIATION_GOLDEN_CASES,
  DISPOSAL_GOLDEN_CASES,
  FX_GOLDEN_CASES,
  JOB_COSTING_GOLDEN,
  PAYROLL_GOLDEN_ROWS,
  SARS_TABLES_2025_26,
  SARS_TABLES_2026_27_REFERENCE,
  VAT_GOLDEN_CASES,
  VERA_AUDIT_META,
  runAllVeraPhase45Goldens,
  runDepreciationGolden,
  runFxGolden,
  runJobCostingLaborGoldens,
  runJobCostingPnLGolden,
  runJobCostingWipGolden,
  runPayrollGolden,
  runVatGolden,
} from '@/lib/finance/audit/vera-phase45-golden-fixtures'
import { ZA_PAYROLL_PACKAGE_V2026 } from '@/lib/jurisdictions/za/payroll'
import { computeDisposalGainLoss, depreciableBaseMinor } from '@/lib/accounting/assets'

describe('Vera Phase 4+5 calc audit goldens', () => {
  test('package pins documented 2025/26 tables and not 2026/27 Budget tables', () => {
    expect(VERA_AUDIT_META.packageTaxYearLabel).toBe('2025/26')
    expect(ZA_PAYROLL_PACKAGE_V2026.taxYearLabel).toBe(SARS_TABLES_2025_26.taxYearLabel)
    expect(ZA_PAYROLL_PACKAGE_V2026.payeBrackets[0].upToInclusiveMinor).toBe(
      SARS_TABLES_2025_26.brackets[0].upToInclusiveMinor,
    )
    expect(ZA_PAYROLL_PACKAGE_V2026.rebates.primaryMinor).toBe(SARS_TABLES_2025_26.rebates.primaryMinor)
    expect(ZA_PAYROLL_PACKAGE_V2026.rebates.primaryMinor).not.toBe(
      SARS_TABLES_2026_27_REFERENCE.rebates.primaryMinor,
    )
    expect(ZA_PAYROLL_PACKAGE_V2026.uif.monthlyCeilingMinor).toBe(1_771_200)
  })

  test.each([...PAYROLL_GOLDEN_ROWS])('payroll golden $id', (row) => {
    const run = runPayrollGolden(row)
    expect(run.identitiesHold).toBe(true)
    expect(run.externalPaymentInitiated).toBe(false)
    expect(run.sarsSubmissionInitiated).toBe(false)
    expect(run.totals).toEqual(row.expected)
  })

  test.each([...VAT_GOLDEN_CASES])('VAT line golden $id', (c) => {
    const actual = runVatGolden(c)
    expect({
      taxableMinor: actual.taxableMinor,
      taxMinor: actual.taxMinor,
      grossMinor: actual.grossMinor,
    }).toEqual(c.expected)
  })

  test.each([...FX_GOLDEN_CASES])('FX golden $id', (c) => {
    expect(runFxGolden(c).fxMinor).toBe(c.expectedFxMinor)
  })

  test.each([...DEPRECIATION_GOLDEN_CASES])('depreciation golden $id', (c) => {
    const actual = runDepreciationGolden(c)
    expect(actual.amounts).toEqual(c.expectedAmounts)
    expect(actual.sum).toBe(depreciableBaseMinor(c.costMinor, c.residualValueMinor))
    expect(actual.finalNbv).toBe(c.expectedFinalNbv)
  })

  test.each([...DISPOSAL_GOLDEN_CASES])('disposal golden $id', (c) => {
    expect(computeDisposalGainLoss(c)).toBe(c.expectedGainLossMinor)
  })

  test('job costing labor + WIP + P&L goldens', () => {
    for (const row of runJobCostingLaborGoldens()) {
      expect(row.actual).toBe(row.expected)
    }
    const wip = runJobCostingWipGolden()
    expect(wip.amountMinor).toBe(JOB_COSTING_GOLDEN.wipBatch.expectedAmount)
    expect(wip.balanced).toBe(true)
    const { pnl, wip: wipR } = runJobCostingPnLGolden()
    expect(pnl.totalRevenueMinor).toBe(JOB_COSTING_GOLDEN.pnl.revenueMinor)
    expect(pnl.totalCostMinor).toBe(JOB_COSTING_GOLDEN.pnl.costMinor)
    expect(pnl.grossMarginMinor).toBe(JOB_COSTING_GOLDEN.pnl.expectedMarginMinor)
    expect(wipR.wipMinor).toBe(50_000)
  })

  test('aggregate runner: all goldens pass and findings are enumerated', () => {
    const summary = runAllVeraPhase45Goldens()
    expect(summary.packageMatches2025_26Tables).toBe(true)
    expect(summary.packageMatches2026_27Tables).toBe(false)
    expect(summary.failCount).toBe(0)
    expect(summary.passCount).toBe(summary.results.length)
    expect(summary.materialFindings.map((f) => f.code)).toEqual(
      expect.arrayContaining([
        'PAYROLL_TAX_YEAR_PACKAGE_GAP',
        'VAT_RETURN_TRACE_NOT_PERIOD_SCOPED',
      ]),
    )
    for (const row of summary.results) {
      expect(row.pass).toBe(true)
    }
  })
})
