/**
 * Vera Phase 4+5 independent calc correctness golden fixtures.
 * Exact minor-unit expectations for Theo regression tests.
 *
 * Tax year documented on each payroll row. Package under test is
 * za-payroll-tax-tables-2026-v1 labeled 2025/26 (1 Mar 2025 – 28 Feb 2026).
 * Not a live SARS feed. No SARS submit. No payment initiation.
 */
import { buildPayrollRuleContentHash, calculatePayrollPeriod } from '@/lib/payroll/calculation'
import { zaPayrollRuleVersionDraft, ZA_PAYROLL_PACKAGE_V2026 } from '@/lib/jurisdictions/za/payroll'
import { calculateTaxAmount, buildTaxRuleContentHash, ZA_STANDARD_VAT_RATE_BPS } from '@/lib/accounting/tax'
import {
  buildStraightLineSchedule,
  computeDisposalGainLoss,
  depreciableBaseMinor,
  netBookValueMinor,
} from '@/lib/accounting/assets'
import {
  computeRealizedFxMinor,
  convertTxnToFunctional,
} from '@/lib/finance/multi-currency/service'
import {
  laborCostMinor,
  buildTimeCostLines,
  buildWipJournalLines,
  buildProjectProfitAndLoss,
  buildProjectWip,
} from '@/lib/accounting/job-costing'
import type { PayrollCalculationInput, PayrollRuleVersion } from '@/lib/payroll/types'
import type { TaxCode, TaxRuleVersion } from '@/lib/accounting/tax-types'
import type { LedgerAccount, PostedJournalEntry } from '@/lib/accounting/types'

export const VERA_AUDIT_META = {
  auditId: 'IjQ1F1sGvrZNS16inQ36',
  auditDate: '2026-08-03',
  headAtAudit: '4b1960a8369d019b9ac4fe24eb13756b4c182cc8',
  packageId: ZA_PAYROLL_PACKAGE_V2026.packageId,
  packageTaxYearLabel: ZA_PAYROLL_PACKAGE_V2026.taxYearLabel,
  packageEffectiveFrom: ZA_PAYROLL_PACKAGE_V2026.effectiveFrom,
  /** Open-ended until a superseding package is approved. */
  packageEffectiveTo: null as string | null,
  vatStandardBps: ZA_STANDARD_VAT_RATE_BPS,
  sources: {
    packageModule: 'lib/jurisdictions/za/payroll.ts',
    independentCrossCheck:
      'Independent half-up annualize/de-annualize PAYE vs package brackets; Budget 2026/27 secondary tables for variance only',
    budget2026_27Secondary:
      'KPMG SA Budget Guide 2026 + SARS Budget 2026 FAQ snippets + Stip 2026/27 employer guide (secondary; not live SARS API)',
  },
  hardGates: {
    externalPaymentInitiated: false as const,
    sarsSubmissionInitiated: false as const,
  },
} as const

/** Published 2025/26 individual income tax brackets in ZAR cents (matches package). */
export const SARS_TABLES_2025_26 = {
  taxYearLabel: '2025/26',
  period: { from: '2025-03-01', to: '2026-02-28' },
  brackets: [
    { upToInclusiveMinor: 23_710_000, rateNumerator: 18, rateDenominator: 100, cumulativeBaseTaxMinor: 0 },
    { upToInclusiveMinor: 37_050_000, rateNumerator: 26, rateDenominator: 100, cumulativeBaseTaxMinor: 4_267_800 },
    { upToInclusiveMinor: 51_280_000, rateNumerator: 31, rateDenominator: 100, cumulativeBaseTaxMinor: 7_736_200 },
    { upToInclusiveMinor: 67_300_000, rateNumerator: 36, rateDenominator: 100, cumulativeBaseTaxMinor: 12_147_500 },
    { upToInclusiveMinor: 85_790_000, rateNumerator: 39, rateDenominator: 100, cumulativeBaseTaxMinor: 17_914_700 },
    { upToInclusiveMinor: 181_700_000, rateNumerator: 41, rateDenominator: 100, cumulativeBaseTaxMinor: 25_125_800 },
    { upToInclusiveMinor: null, rateNumerator: 45, rateDenominator: 100, cumulativeBaseTaxMinor: 64_448_900 },
  ],
  rebates: { primaryMinor: 1_723_500, secondaryMinor: 944_400, tertiaryMinor: 314_500 },
  uif: { employeePct: 1, employerPct: 1, monthlyCeilingMinor: 1_771_200 },
  sdl: { employerPct: 1, employeePct: 0, monthlyCeilingMinor: null },
} as const

/**
 * Budget 2026 individual tables (tax year 2026/27) in ZAR cents — variance reference only.
 * Primary R17 820 / secondary R9 765 / tertiary R3 249; first band to R245 100.
 */
export const SARS_TABLES_2026_27_REFERENCE = {
  taxYearLabel: '2026/27',
  period: { from: '2026-03-01', to: '2027-02-28' },
  brackets: [
    { upToInclusiveMinor: 24_510_000, rateNumerator: 18, rateDenominator: 100, cumulativeBaseTaxMinor: 0 },
    { upToInclusiveMinor: 38_310_000, rateNumerator: 26, rateDenominator: 100, cumulativeBaseTaxMinor: 4_411_800 },
    { upToInclusiveMinor: 53_020_000, rateNumerator: 31, rateDenominator: 100, cumulativeBaseTaxMinor: 7_999_800 },
    { upToInclusiveMinor: 69_580_000, rateNumerator: 36, rateDenominator: 100, cumulativeBaseTaxMinor: 12_559_900 },
    { upToInclusiveMinor: 88_700_000, rateNumerator: 39, rateDenominator: 100, cumulativeBaseTaxMinor: 18_521_500 },
    { upToInclusiveMinor: 187_860_000, rateNumerator: 41, rateDenominator: 100, cumulativeBaseTaxMinor: 25_978_300 },
    { upToInclusiveMinor: null, rateNumerator: 45, rateDenominator: 100, cumulativeBaseTaxMinor: 66_633_900 },
  ],
  rebates: { primaryMinor: 1_782_000, secondaryMinor: 976_500, tertiaryMinor: 324_900 },
  uif: { employeePct: 1, employerPct: 1, monthlyCeilingMinor: 1_771_200 },
  sdl: { employerPct: 1, employeePct: 0, monthlyCeilingMinor: null },
} as const

function approvedPayrollRule(): PayrollRuleVersion {
  const draft = {
    ...zaPayrollRuleVersionDraft({
      id: 'rule-vera-golden',
      orgId: 'org-vera-audit',
      legalEntityId: 'le-vera-audit',
      bookId: 'book-vera-audit',
      versionNumber: 1,
    }),
    schemaVersion: 1 as const,
    version: 2,
    createdAt: '2026-03-01T00:00:00.000Z',
    createdBy: 'vera-audit',
    updatedAt: '2026-03-01T00:00:00.000Z',
    updatedBy: 'vera-audit',
    status: 'approved' as const,
    immutable: true as const,
    approvalId: 'ap-vera-golden',
    approvalActorId: 'approver',
    approvedAt: '2026-03-01T00:00:00.000Z',
  }
  return { ...draft, contentHash: buildPayrollRuleContentHash(draft) }
}

function salariedInput(partial: Partial<PayrollCalculationInput> & Pick<PayrollCalculationInput, 'rateMinor' | 'ageYears' | 'periodStart' | 'periodEnd' | 'payDate'>): PayrollCalculationInput {
  return {
    orgId: 'org-vera-audit',
    legalEntityId: 'le-vera-audit',
    bookId: 'book-vera-audit',
    employeeId: 'emp-golden',
    employmentId: 'empl-golden',
    payPeriodId: 'per-golden',
    frequency: 'monthly',
    workerCategory: 'salaried',
    termVersionId: 'term-golden',
    termContentHash: 'term-hash-golden',
    standardHoursPerPeriod: 160,
    overtimeMultiplierNumerator: 150,
    overtimeMultiplierDenominator: 100,
    subjectToUif: true,
    subjectToSdl: true,
    taxResidency: 'za_resident',
    ordinaryHoursWorked: 0,
    overtimeHours: 0,
    components: [],
    leave: [],
    ...partial,
  }
}

export interface PayrollGoldenRow {
  id: string
  title: string
  /** Which SARS table year the expected* fields match. */
  expectedAgainstTaxYear: '2025/26'
  /** Calendar period used in the engine input (may fall outside package year). */
  samplePeriod: { start: string; end: string; payDate: string }
  samplePeriodTaxYear: '2025/26' | '2026/27'
  rateMinor: number
  ageYears: number
  expected: {
    grossEarningsMinor: number
    taxableEarningsMinor: number
    payeMinor: number
    uifEmployeeMinor: number
    uifEmployerMinor: number
    sdlEmployerMinor: number
    netPayMinor: number
  }
  /** Informative only — independent 2026/27 PAYE if tables differ. */
  payeMinorIf2026_27?: number
}

/**
 * Exact engine totals under package 2025/26.
 * S1–S3 use in-year periods (Mar 2025). S4–S9 intentionally use Aug 2026 (2026/27 calendar)
 * to document package drift when no 2026/27 package is pinned.
 */
export const PAYROLL_GOLDEN_ROWS: readonly PayrollGoldenRow[] = [
  {
    id: 'paye-25k-monthly-age35-in-year',
    title: 'R25,000 monthly salaried age 35 — period inside 2025/26',
    expectedAgainstTaxYear: '2025/26',
    samplePeriod: { start: '2025-08-01', end: '2025-08-31', payDate: '2025-08-25' },
    samplePeriodTaxYear: '2025/26',
    rateMinor: 2_500_000,
    ageYears: 35,
    expected: {
      grossEarningsMinor: 2_500_000,
      taxableEarningsMinor: 2_500_000,
      payeMinor: 348_308,
      uifEmployeeMinor: 17_712,
      uifEmployerMinor: 17_712,
      sdlEmployerMinor: 25_000,
      netPayMinor: 2_133_980,
    },
    payeMinorIf2026_27: 327_000,
  },
  {
    id: 'paye-40k-monthly-age35-in-year',
    title: 'R40,000 monthly salaried age 35 — period inside 2025/26',
    expectedAgainstTaxYear: '2025/26',
    samplePeriod: { start: '2025-08-01', end: '2025-08-31', payDate: '2025-08-25' },
    samplePeriodTaxYear: '2025/26',
    rateMinor: 4_000_000,
    ageYears: 35,
    expected: {
      grossEarningsMinor: 4_000_000,
      taxableEarningsMinor: 4_000_000,
      payeMinor: 783_933,
      uifEmployeeMinor: 17_712,
      uifEmployerMinor: 17_712,
      sdlEmployerMinor: 40_000,
      netPayMinor: 3_198_355,
    },
    payeMinorIf2026_27: 760_225,
  },
  {
    id: 'uif-at-ceiling-remuneration',
    title: 'UIF caps at R17,712 monthly remuneration (1% = R177.12)',
    expectedAgainstTaxYear: '2025/26',
    samplePeriod: { start: '2025-08-01', end: '2025-08-31', payDate: '2025-08-25' },
    samplePeriodTaxYear: '2025/26',
    rateMinor: 1_771_200,
    ageYears: 35,
    expected: {
      grossEarningsMinor: 1_771_200,
      taxableEarningsMinor: 1_771_200,
      payeMinor: 175_191,
      uifEmployeeMinor: 17_712,
      uifEmployerMinor: 17_712,
      sdlEmployerMinor: 17_712,
      netPayMinor: 1_578_297,
    },
  },
  {
    id: 'uif-above-ceiling-50k',
    title: 'R50,000 monthly — UIF still ceiling-capped',
    expectedAgainstTaxYear: '2025/26',
    samplePeriod: { start: '2025-08-01', end: '2025-08-31', payDate: '2025-08-25' },
    samplePeriodTaxYear: '2025/26',
    rateMinor: 5_000_000,
    ageYears: 35,
    expected: {
      grossEarningsMinor: 5_000_000,
      taxableEarningsMinor: 5_000_000,
      payeMinor: 1_130_267,
      uifEmployeeMinor: 17_712,
      uifEmployerMinor: 17_712,
      sdlEmployerMinor: 50_000,
      netPayMinor: 3_852_021,
    },
    payeMinorIf2026_27: 1_107_558,
  },
  {
    id: 'paye-secondary-rebate-age66',
    title: 'R40,000 monthly age 66 — secondary rebate',
    expectedAgainstTaxYear: '2025/26',
    samplePeriod: { start: '2025-08-01', end: '2025-08-31', payDate: '2025-08-25' },
    samplePeriodTaxYear: '2025/26',
    rateMinor: 4_000_000,
    ageYears: 66,
    expected: {
      grossEarningsMinor: 4_000_000,
      taxableEarningsMinor: 4_000_000,
      payeMinor: 705_233,
      uifEmployeeMinor: 17_712,
      uifEmployerMinor: 17_712,
      sdlEmployerMinor: 40_000,
      netPayMinor: 3_277_055,
    },
    payeMinorIf2026_27: 687_100,
  },
  {
    id: 'paye-tertiary-rebate-age76',
    title: 'R40,000 monthly age 76 — tertiary rebate',
    expectedAgainstTaxYear: '2025/26',
    samplePeriod: { start: '2025-08-01', end: '2025-08-31', payDate: '2025-08-25' },
    samplePeriodTaxYear: '2025/26',
    rateMinor: 4_000_000,
    ageYears: 76,
    expected: {
      grossEarningsMinor: 4_000_000,
      taxableEarningsMinor: 4_000_000,
      payeMinor: 679_025,
      uifEmployeeMinor: 17_712,
      uifEmployerMinor: 17_712,
      sdlEmployerMinor: 40_000,
      netPayMinor: 3_303_263,
    },
    payeMinorIf2026_27: 660_025,
  },
  {
    id: 'drift-probe-40k-aug-2026-calendar',
    title: 'DRIFT PROBE: R40k Aug 2026 calendar period still uses 2025/26 package',
    expectedAgainstTaxYear: '2025/26',
    samplePeriod: { start: '2026-08-01', end: '2026-08-31', payDate: '2026-08-25' },
    samplePeriodTaxYear: '2026/27',
    rateMinor: 4_000_000,
    ageYears: 35,
    expected: {
      grossEarningsMinor: 4_000_000,
      taxableEarningsMinor: 4_000_000,
      payeMinor: 783_933,
      uifEmployeeMinor: 17_712,
      uifEmployerMinor: 17_712,
      sdlEmployerMinor: 40_000,
      netPayMinor: 3_198_355,
    },
    payeMinorIf2026_27: 760_225,
  },
] as const

export function runPayrollGolden(row: PayrollGoldenRow) {
  const rule = approvedPayrollRule()
  const input = salariedInput({
    rateMinor: row.rateMinor,
    ageYears: row.ageYears,
    periodStart: row.samplePeriod.start,
    periodEnd: row.samplePeriod.end,
    payDate: row.samplePeriod.payDate,
  })
  const result = calculatePayrollPeriod(input, rule)
  return {
    id: row.id,
    totals: {
      grossEarningsMinor: result.totals.grossEarningsMinor,
      taxableEarningsMinor: result.totals.taxableEarningsMinor,
      payeMinor: result.totals.payeMinor,
      uifEmployeeMinor: result.totals.uifEmployeeMinor,
      uifEmployerMinor: result.totals.uifEmployerMinor,
      sdlEmployerMinor: result.totals.sdlEmployerMinor,
      netPayMinor: result.totals.netPayMinor,
    },
    identitiesHold: result.accountantReview.identitiesHold,
    externalPaymentInitiated: result.accountantReview.externalPaymentInitiated,
    sarsSubmissionInitiated: result.accountantReview.sarsSubmissionInitiated,
    packageTaxYearLabel: rule.taxYearLabel,
    resultDigest: result.resultDigest,
  }
}

export interface VatGoldenCase {
  id: string
  taxIncluded: boolean
  taxableMinorExclusive: number
  expected: { taxableMinor: number; taxMinor: number; grossMinor: number }
}

export const VAT_GOLDEN_CASES: readonly VatGoldenCase[] = [
  { id: 'vat15-exclusive-10000', taxIncluded: false, taxableMinorExclusive: 10_000, expected: { taxableMinor: 10_000, taxMinor: 1_500, grossMinor: 11_500 } },
  { id: 'vat15-inclusive-11500', taxIncluded: true, taxableMinorExclusive: 11_500, expected: { taxableMinor: 10_000, taxMinor: 1_500, grossMinor: 11_500 } },
  { id: 'vat15-exclusive-3333', taxIncluded: false, taxableMinorExclusive: 3_333, expected: { taxableMinor: 3_333, taxMinor: 500, grossMinor: 3_833 } },
  { id: 'vat15-exclusive-1c', taxIncluded: false, taxableMinorExclusive: 1, expected: { taxableMinor: 1, taxMinor: 0, grossMinor: 1 } },
  { id: 'vat15-exclusive-999999', taxIncluded: false, taxableMinorExclusive: 999_999, expected: { taxableMinor: 999_999, taxMinor: 150_000, grossMinor: 1_149_999 } },
] as const

function approvedVatRule(): { code: TaxCode; rule: TaxRuleVersion } {
  const scope = { orgId: 'org-vera-audit', legalEntityId: 'le-vera-audit', bookId: 'book-vera-audit' }
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
    createdBy: 'vera',
    updatedAt: '2026-07-01T09:00:00.000Z',
    updatedBy: 'vera',
  }
  const base: Omit<TaxRuleVersion, 'contentHash'> = {
    ...scope,
    id: 'rule-za-standard-v1',
    schemaVersion: 1,
    version: 1,
    taxCodeId: code.id,
    jurisdictionCode: 'ZA',
    versionNumber: 1,
    rateBasisPoints: ZA_STANDARD_VAT_RATE_BPS,
    rateNumerator: 15,
    rateDenominator: 100,
    roundingMode: 'half_up',
    taxPointPolicyId: 'za-invoice',
    effectiveFrom: '2025-01-01',
    status: 'approved',
    approvalId: 'ap-vat',
    approvalActorId: 'approver',
    approvedAt: '2026-07-01T09:00:00.000Z',
    sourceCitation: 'SARS VAT 15% standard rate package boundary',
    sourceChecksum: 'za-vat-standard-15-v1',
    immutable: true,
    createdAt: '2026-07-01T09:00:00.000Z',
    createdBy: 'vera',
    updatedAt: '2026-07-01T09:00:00.000Z',
    updatedBy: 'vera',
  }
  return { code, rule: { ...base, contentHash: buildTaxRuleContentHash(base) } }
}

export function runVatGolden(c: VatGoldenCase) {
  const { code, rule } = approvedVatRule()
  return calculateTaxAmount({
    taxCode: code,
    rule,
    taxableMinorExclusive: c.taxableMinorExclusive,
    taxIncluded: c.taxIncluded,
    documentDate: '2026-08-01',
  })
}

export interface FxGoldenCase {
  id: string
  kind: 'realized' | 'unrealized_open'
  role: 'receivable' | 'payable'
  txnMinor: number
  originalRateScaled: number
  compareRateScaled: number
  rateScale: number
  expectedFxMinor: number
}

export const FX_GOLDEN_CASES: readonly FxGoldenCase[] = [
  {
    id: 'fx-ar-realized-gain',
    kind: 'realized',
    role: 'receivable',
    txnMinor: 100_000,
    originalRateScaled: 1_850_000_000,
    compareRateScaled: 1_900_000_000,
    rateScale: 8,
    expectedFxMinor: 50_000,
  },
  {
    id: 'fx-ap-realized-gain-rate-fall',
    kind: 'realized',
    role: 'payable',
    txnMinor: 100_000,
    originalRateScaled: 1_850_000_000,
    compareRateScaled: 1_800_000_000,
    rateScale: 8,
    expectedFxMinor: 50_000,
  },
  {
    id: 'fx-ar-partial-settle-40pct',
    kind: 'realized',
    role: 'receivable',
    txnMinor: 40_000,
    originalRateScaled: 1_850_000_000,
    compareRateScaled: 1_900_000_000,
    rateScale: 8,
    expectedFxMinor: 20_000,
  },
  {
    id: 'fx-ar-unrealized-open-60pct-reval',
    kind: 'unrealized_open',
    role: 'receivable',
    txnMinor: 60_000,
    originalRateScaled: 1_850_000_000,
    compareRateScaled: 1_920_000_000,
    rateScale: 8,
    expectedFxMinor: 42_000,
  },
] as const

export function runFxGolden(c: FxGoldenCase) {
  if (c.kind === 'realized') {
    const r = computeRealizedFxMinor({
      role: c.role,
      settledTxnMinor: c.txnMinor,
      originalRateScaled: c.originalRateScaled,
      originalRateScale: c.rateScale,
      settlementRateScaled: c.compareRateScaled,
      settlementRateScale: c.rateScale,
    })
    return { fxMinor: r.realizedFxMinor, ...r }
  }
  const originalFunctionalMinor = convertTxnToFunctional(c.txnMinor, c.originalRateScaled, c.rateScale)
  const revaluedFunctionalMinor = convertTxnToFunctional(c.txnMinor, c.compareRateScaled, c.rateScale)
  const rawDiff = revaluedFunctionalMinor - originalFunctionalMinor
  const unrealizedFxMinor = c.role === 'receivable' ? rawDiff : -rawDiff
  return { fxMinor: unrealizedFxMinor, originalFunctionalMinor, revaluedFunctionalMinor, unrealizedFxMinor }
}

export interface DepreciationGoldenCase {
  id: string
  costMinor: number
  residualValueMinor: number
  usefulLifeMonths: number
  inServiceDate: string
  expectedAmounts: number[]
  expectedFinalNbv: number
}

export const DEPRECIATION_GOLDEN_CASES: readonly DepreciationGoldenCase[] = [
  {
    id: 'sl-divisible-10000-3m',
    costMinor: 10_000,
    residualValueMinor: 1_000,
    usefulLifeMonths: 3,
    inServiceDate: '2026-01-15',
    expectedAmounts: [3_000, 3_000, 3_000],
    expectedFinalNbv: 1_000,
  },
  {
    id: 'sl-remainder-catchup-10000-3m',
    costMinor: 10_000,
    residualValueMinor: 0,
    usefulLifeMonths: 3,
    inServiceDate: '2026-07-01',
    expectedAmounts: [3_333, 3_333, 3_334],
    expectedFinalNbv: 0,
  },
  {
    id: 'sl-9000-3m-equal',
    costMinor: 9_000,
    residualValueMinor: 0,
    usefulLifeMonths: 3,
    inServiceDate: '2026-01-01',
    expectedAmounts: [3_000, 3_000, 3_000],
    expectedFinalNbv: 0,
  },
] as const

export const DISPOSAL_GOLDEN_CASES = [
  { id: 'dispose-gain', proceedsMinor: 40_000, nbvAtDisposalMinor: 38_000, expectedGainLossMinor: 2_000 },
  { id: 'dispose-loss', proceedsMinor: 10_000, nbvAtDisposalMinor: 38_000, expectedGainLossMinor: -28_000 },
  { id: 'dispose-after-m1-9000', proceedsMinor: 5_000, nbvAtDisposalMinor: 6_000, expectedGainLossMinor: -1_000 },
] as const

export function runDepreciationGolden(c: DepreciationGoldenCase) {
  const schedule = buildStraightLineSchedule(c)
  return {
    amounts: schedule.map((l) => l.amountMinor),
    sum: schedule.reduce((s, l) => s + l.amountMinor, 0),
    base: depreciableBaseMinor(c.costMinor, c.residualValueMinor),
    finalNbv: schedule[schedule.length - 1]?.closingNbvMinor ?? netBookValueMinor(c.costMinor, 0),
  }
}

export const JOB_COSTING_GOLDEN = {
  labor: [
    { id: 'labor-60m-850', durationMinutes: 60, rate: 85_000, expected: 85_000 },
    { id: 'labor-30m-850', durationMinutes: 30, rate: 85_000, expected: 42_500 },
    { id: 'labor-1m-100', durationMinutes: 1, rate: 100, expected: 2 },
    { id: 'labor-90m-600', durationMinutes: 90, rate: 60_000, expected: 90_000 },
  ],
  wipBatch: {
    id: 'wip-single-te-balanced',
    durationMinutes: 90,
    rate: 60_000,
    expectedAmount: 90_000,
  },
  pnl: {
    id: 'pnl-rev-cost-margin',
    revenueMinor: 100_000,
    costMinor: 40_000,
    expectedMarginMinor: 60_000,
  },
} as const

export function runJobCostingLaborGoldens() {
  return JOB_COSTING_GOLDEN.labor.map((row) => ({
    id: row.id,
    actual: laborCostMinor(row.durationMinutes, row.rate),
    expected: row.expected,
  }))
}

export function runJobCostingWipGolden() {
  const lines = buildTimeCostLines(
    [
      {
        timeEntryId: 'te-golden-1',
        orgId: 'org-vera-audit',
        projectId: 'proj-golden',
        userId: 'u1',
        currency: 'ZAR',
        durationMinutes: JOB_COSTING_GOLDEN.wipBatch.durationMinutes,
        costRateMinorPerHour: JOB_COSTING_GOLDEN.wipBatch.rate,
        billable: true,
        endAt: '2026-08-01T12:00:00.000Z',
        description: 'Golden WIP labor',
        deleted: false,
      },
    ],
    'wip_cost',
    'org-vera-audit',
  )
  const journal = buildWipJournalLines({
    lines,
    laborExpenseAccountId: 'acc-labor-exp',
    wipAssetAccountId: 'acc-wip-clearing',
  })
  const debit = journal.reduce((s, l) => s + l.debitMinor, 0)
  const credit = journal.reduce((s, l) => s + l.creditMinor, 0)
  return {
    amountMinor: lines[0].amountMinor,
    balanced: debit === credit,
    debit,
    credit,
  }
}

export function runJobCostingPnLGolden() {
  const scope = { orgId: 'org-vera-audit', legalEntityId: 'le-vera-audit', bookId: 'book-vera-audit' }
  const revenue: LedgerAccount = {
    ...scope,
    id: 'acc-rev',
    schemaVersion: 1,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'v',
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'v',
    code: '4000',
    name: 'Revenue',
    accountType: 'income',
    normalBalance: 'credit',
    currency: 'ZAR',
    currencyPolicy: 'functional_only',
    reportMapping: 'income',
    postingAllowed: true,
    activeFrom: '2026-01-01',
  }
  const expense: LedgerAccount = {
    ...revenue,
    id: 'acc-exp',
    code: '5000',
    name: 'Expense',
    accountType: 'expense',
    normalBalance: 'debit',
    reportMapping: 'expense',
  }
  const journal: PostedJournalEntry = {
    ...scope,
    id: 'jnl-1',
    schemaVersion: 1,
    version: 1,
    status: 'posted',
    postingDate: '2026-08-10',
    postingPurpose: 'manual',
    currency: 'ZAR',
    lines: [
      { accountId: 'acc-exp', debitMinor: 40_000, creditMinor: 0, projectId: 'proj-golden' },
      { accountId: 'acc-rev', debitMinor: 0, creditMinor: 100_000, projectId: 'proj-golden' },
      { accountId: 'acc-exp', debitMinor: 0, creditMinor: 0 },
    ],
    createdAt: '2026-08-10T00:00:00.000Z',
    createdBy: 'v',
    updatedAt: '2026-08-10T00:00:00.000Z',
    updatedBy: 'v',
    contentHash: 'x',
    immutable: true,
  } as PostedJournalEntry

  // Build a balanced journal properly for the P&L extractor
  const balancedJournal: PostedJournalEntry = {
    ...journal,
    lines: [
      { accountId: 'acc-exp', debitMinor: 40_000, creditMinor: 0, projectId: 'proj-golden', description: 'Cost' },
      { accountId: 'acc-clear', debitMinor: 0, creditMinor: 40_000, description: 'Clear cost' },
      { accountId: 'acc-ar', debitMinor: 100_000, creditMinor: 0, description: 'AR' },
      { accountId: 'acc-rev', debitMinor: 0, creditMinor: 100_000, projectId: 'proj-golden', description: 'Rev' },
    ],
  } as PostedJournalEntry

  const clearAsset: LedgerAccount = {
    ...revenue,
    id: 'acc-clear',
    code: '2000',
    name: 'Clearing',
    accountType: 'liability',
    normalBalance: 'credit',
    reportMapping: 'liability',
  }
  const ar: LedgerAccount = {
    ...revenue,
    id: 'acc-ar',
    code: '1100',
    name: 'AR',
    accountType: 'asset',
    normalBalance: 'debit',
    reportMapping: 'asset',
  }

  const pnl = buildProjectProfitAndLoss({
    scope,
    projectId: 'proj-golden',
    fromDate: '2026-08-01',
    toDate: '2026-08-31',
    accountingBasis: 'accrual',
    accounts: [revenue, expense, clearAsset, ar],
    journals: [balancedJournal],
  })

  const wip = buildProjectWip({
    scope,
    projectId: 'proj-golden',
    asOfDate: '2026-08-31',
    applications: [
      {
        id: 'app-1',
        orgId: scope.orgId,
        legalEntityId: scope.legalEntityId,
        bookId: scope.bookId,
        purpose: 'wip_cost',
        status: 'applied',
        createdAt: '2026-08-05T00:00:00.000Z',
        lines: [
          {
            timeEntryId: 'te1',
            projectId: 'proj-golden',
            durationMinutes: 60,
            costRateMinorPerHour: 50_000,
            amountMinor: 50_000,
            currency: 'ZAR',
            description: 'Open WIP',
            dimensions: { projectId: 'proj-golden' },
          },
        ],
      } as any,
    ],
    pnl,
  })

  return { pnl, wip }
}

export interface GoldenRunSummary {
  domain: string
  fixtureId: string
  pass: boolean
  expected?: unknown
  actual?: unknown
  note?: string
}

export function runAllVeraPhase45Goldens(): {
  meta: typeof VERA_AUDIT_META
  packageMatches2025_26Tables: boolean
  packageMatches2026_27Tables: boolean
  results: GoldenRunSummary[]
  passCount: number
  failCount: number
  materialFindings: Array<{ severity: 'high' | 'medium' | 'low'; code: string; summary: string }>
} {
  const results: GoldenRunSummary[] = []

  const pkgBracketsMatch =
    JSON.stringify(ZA_PAYROLL_PACKAGE_V2026.payeBrackets) ===
    JSON.stringify(
      SARS_TABLES_2025_26.brackets.map((b) => ({
        upToInclusiveMinor: b.upToInclusiveMinor,
        rateNumerator: b.rateNumerator,
        rateDenominator: b.rateDenominator,
        cumulativeBaseTaxMinor: b.cumulativeBaseTaxMinor,
      })),
    )
  const pkgRebateMatch =
    ZA_PAYROLL_PACKAGE_V2026.rebates.primaryMinor === SARS_TABLES_2025_26.rebates.primaryMinor &&
    ZA_PAYROLL_PACKAGE_V2026.rebates.secondaryMinor === SARS_TABLES_2025_26.rebates.secondaryMinor &&
    ZA_PAYROLL_PACKAGE_V2026.rebates.tertiaryMinor === SARS_TABLES_2025_26.rebates.tertiaryMinor
  const packageMatches2025_26Tables = pkgBracketsMatch && pkgRebateMatch
  // Runtime compare (package may intentionally lag the next-year reference tables).
  const packagePrimary = Number(ZA_PAYROLL_PACKAGE_V2026.rebates.primaryMinor)
  const reference2026_27Primary = Number(SARS_TABLES_2026_27_REFERENCE.rebates.primaryMinor)
  const packageMatches2026_27Tables = packagePrimary === reference2026_27Primary

  for (const row of PAYROLL_GOLDEN_ROWS) {
    const run = runPayrollGolden(row)
    const pass =
      run.totals.grossEarningsMinor === row.expected.grossEarningsMinor &&
      run.totals.taxableEarningsMinor === row.expected.taxableEarningsMinor &&
      run.totals.payeMinor === row.expected.payeMinor &&
      run.totals.uifEmployeeMinor === row.expected.uifEmployeeMinor &&
      run.totals.uifEmployerMinor === row.expected.uifEmployerMinor &&
      run.totals.sdlEmployerMinor === row.expected.sdlEmployerMinor &&
      run.totals.netPayMinor === row.expected.netPayMinor &&
      run.identitiesHold === true &&
      run.externalPaymentInitiated === false &&
      run.sarsSubmissionInitiated === false
    results.push({
      domain: 'payroll',
      fixtureId: row.id,
      pass,
      expected: row.expected,
      actual: run.totals,
      note:
        row.samplePeriodTaxYear !== row.expectedAgainstTaxYear
          ? `Calendar period is ${row.samplePeriodTaxYear} but package/expectation is ${row.expectedAgainstTaxYear}; 2026/27 PAYE ref=${row.payeMinorIf2026_27 ?? 'n/a'}`
          : row.payeMinorIf2026_27 != null
            ? `2026/27 PAYE ref=${row.payeMinorIf2026_27}`
            : undefined,
    })
  }

  for (const c of VAT_GOLDEN_CASES) {
    const actual = runVatGolden(c)
    const pass =
      actual.taxableMinor === c.expected.taxableMinor &&
      actual.taxMinor === c.expected.taxMinor &&
      actual.grossMinor === c.expected.grossMinor
    results.push({
      domain: 'vat_line',
      fixtureId: c.id,
      pass,
      expected: c.expected,
      actual: { taxableMinor: actual.taxableMinor, taxMinor: actual.taxMinor, grossMinor: actual.grossMinor },
    })
  }

  for (const c of FX_GOLDEN_CASES) {
    const actual = runFxGolden(c)
    const pass = actual.fxMinor === c.expectedFxMinor
    results.push({
      domain: 'fx',
      fixtureId: c.id,
      pass,
      expected: c.expectedFxMinor,
      actual: actual.fxMinor,
    })
  }

  for (const c of DEPRECIATION_GOLDEN_CASES) {
    const actual = runDepreciationGolden(c)
    const pass =
      JSON.stringify(actual.amounts) === JSON.stringify(c.expectedAmounts) &&
      actual.sum === depreciableBaseMinor(c.costMinor, c.residualValueMinor) &&
      actual.finalNbv === c.expectedFinalNbv
    results.push({
      domain: 'depreciation',
      fixtureId: c.id,
      pass,
      expected: { amounts: c.expectedAmounts, finalNbv: c.expectedFinalNbv },
      actual,
    })
  }

  for (const c of DISPOSAL_GOLDEN_CASES) {
    const actual = computeDisposalGainLoss(c)
    results.push({
      domain: 'disposal',
      fixtureId: c.id,
      pass: actual === c.expectedGainLossMinor,
      expected: c.expectedGainLossMinor,
      actual,
    })
  }

  for (const row of runJobCostingLaborGoldens()) {
    results.push({
      domain: 'job_costing_labor',
      fixtureId: row.id,
      pass: row.actual === row.expected,
      expected: row.expected,
      actual: row.actual,
    })
  }

  const wip = runJobCostingWipGolden()
  results.push({
    domain: 'job_costing_wip',
    fixtureId: JOB_COSTING_GOLDEN.wipBatch.id,
    pass: wip.balanced && wip.amountMinor === JOB_COSTING_GOLDEN.wipBatch.expectedAmount,
    expected: { amount: JOB_COSTING_GOLDEN.wipBatch.expectedAmount, balanced: true },
    actual: wip,
  })

  const { pnl, wip: wipR } = runJobCostingPnLGolden()
  results.push({
    domain: 'job_costing_pnl',
    fixtureId: JOB_COSTING_GOLDEN.pnl.id,
    pass:
      pnl.totalRevenueMinor === JOB_COSTING_GOLDEN.pnl.revenueMinor &&
      pnl.totalCostMinor === JOB_COSTING_GOLDEN.pnl.costMinor &&
      pnl.grossMarginMinor === JOB_COSTING_GOLDEN.pnl.expectedMarginMinor &&
      wipR.unbilledLaborCostMinor === 50_000 &&
      wipR.wipMinor === 50_000,
    expected: {
      revenue: JOB_COSTING_GOLDEN.pnl.revenueMinor,
      cost: JOB_COSTING_GOLDEN.pnl.costMinor,
      margin: JOB_COSTING_GOLDEN.pnl.expectedMarginMinor,
      wip: 50_000,
    },
    actual: {
      revenue: pnl.totalRevenueMinor,
      cost: pnl.totalCostMinor,
      margin: pnl.grossMarginMinor,
      wip: wipR.wipMinor,
    },
  })

  const passCount = results.filter((r) => r.pass).length
  const failCount = results.length - passCount

  const materialFindings: Array<{ severity: 'high' | 'medium' | 'low'; code: string; summary: string }> = [
    {
      severity: 'high',
      code: 'PAYROLL_TAX_YEAR_PACKAGE_GAP',
      summary:
        'Pinned package is 2025/26 (open-ended effectiveTo=null). Calendar periods from 2026-03-01 fall in 2026/27 but still calculate on 2025/26 brackets/rebates. Engine math variance=0 vs 2025/26; material PAYE drift vs Budget 2026/27 tables (e.g. R40k/mo age35 PAYE 783933 vs ~760225 cents).',
    },
    {
      severity: 'high',
      code: 'VAT_RETURN_TRACE_NOT_PERIOD_SCOPED',
      summary:
        'prepareTaxReturn sums journalTaxTraces filtered only by tax-code org/entity/book. JournalTaxTraceLine has no taxPointDate/periodId; sourceCutoffAt is validated against the period but not applied as a filter. Multi-period books can overstate VAT return totals.',
    },
    {
      severity: 'medium',
      code: 'VERA_FIXTURE_RANGE_ONLY',
      summary:
        'lib/payroll/vera-calc-fixtures.ts uses min/max gates rather than exact golden expected totals. This pack adds exact rows for regression.',
    },
    {
      severity: 'low',
      code: 'SDL_EMPLOYER_EXEMPTION_NOT_MODELED',
      summary:
        'SDL is flat 1% of leviable amount with no employer annual payroll exemption threshold. Documented product gap unless intentionally out of scope.',
    },
  ]

  return {
    meta: VERA_AUDIT_META,
    packageMatches2025_26Tables,
    packageMatches2026_27Tables,
    results,
    passCount,
    failCount,
    materialFindings,
  }
}
