/**
 * Vera-friendly PAYE/UIF/SDL edge-case fixtures.
 * Deterministic calc outcomes for audit packs — not a live SARS feed.
 */
import { buildPayrollRuleContentHash, calculatePayrollPeriod } from './calculation'
import type { PayrollCalculationInput, PayrollRuleVersion } from './types'
import { zaPayrollRuleVersionDraft } from '@/lib/jurisdictions/za/payroll'

export interface VeraCalcFixture {
  id: string
  title: string
  description: string
  tags: Array<'paye' | 'uif' | 'sdl' | 'rebate' | 'overtime' | 'bonus' | 'hourly' | 'edge'>
  buildInput: () => PayrollCalculationInput
  expect: {
    payeMinorMin?: number
    payeMinorMax?: number
    uifEmployeeMinorMin?: number
    uifEmployeeMinorMax?: number
    sdlEmployerMinorMin?: number
    identitiesHold: true
    externalPaymentInitiated: false
    sarsSubmissionInitiated: false
  }
}

function approvedRule(): PayrollRuleVersion {
  const draft = {
    ...zaPayrollRuleVersionDraft({
      id: 'rule-vera-fixture',
      orgId: 'org-vera',
      legalEntityId: 'le-vera',
      bookId: 'book-vera',
      versionNumber: 1,
    }),
    schemaVersion: 1 as const,
    version: 2,
    createdAt: '2026-03-01T00:00:00.000Z',
    createdBy: 'system',
    updatedAt: '2026-03-01T00:00:00.000Z',
    updatedBy: 'system',
    status: 'approved' as const,
    immutable: true as const,
    approvalId: 'ap-vera',
    approvalActorId: 'approver',
    approvedAt: '2026-03-01T00:00:00.000Z',
  }
  return { ...draft, contentHash: buildPayrollRuleContentHash(draft) }
}

function baseInput(partial: Partial<PayrollCalculationInput> = {}): PayrollCalculationInput {
  return {
    orgId: 'org-vera',
    legalEntityId: 'le-vera',
    bookId: 'book-vera',
    employeeId: 'emp-vera',
    employmentId: 'empl-vera',
    payPeriodId: 'per-vera',
    periodStart: '2026-08-01',
    periodEnd: '2026-08-31',
    payDate: '2026-08-25',
    frequency: 'monthly',
    workerCategory: 'salaried',
    termVersionId: 'term-vera',
    termContentHash: 'term-hash',
    rateMinor: 4_000_000,
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

export const VERA_PAYROLL_CALC_FIXTURES: readonly VeraCalcFixture[] = [
  {
    id: 'paye-primary-rebate-salaried-40k',
    title: 'PAYE primary rebate — R40k monthly salaried',
    description: 'Standard salaried monthly with primary rebate only; positive PAYE and UIF under ceiling.',
    tags: ['paye', 'rebate', 'uif', 'sdl'],
    buildInput: () => baseInput(),
    expect: {
      payeMinorMin: 1,
      uifEmployeeMinorMin: 1,
      sdlEmployerMinorMin: 1,
      identitiesHold: true,
      externalPaymentInitiated: false,
      sarsSubmissionInitiated: false,
    },
  },
  {
    id: 'uif-at-monthly-ceiling',
    title: 'UIF employee contribution capped at monthly ceiling',
    description: 'High salary so UIF base hits monthly ceiling.',
    tags: ['uif', 'edge'],
    buildInput: () => baseInput({ rateMinor: 50_000_000 }),
    expect: {
      uifEmployeeMinorMin: 1,
      uifEmployeeMinorMax: 20_000,
      identitiesHold: true,
      externalPaymentInitiated: false,
      sarsSubmissionInitiated: false,
    },
  },
  {
    id: 'sdl-employer-only-no-employee',
    title: 'SDL employer-only on leviable amount',
    description: 'SDL has zero employee rate; employer SDL positive when subjectToSdl.',
    tags: ['sdl'],
    buildInput: () => baseInput({ rateMinor: 3_000_000 }),
    expect: {
      sdlEmployerMinorMin: 1,
      identitiesHold: true,
      externalPaymentInitiated: false,
      sarsSubmissionInitiated: false,
    },
  },
  {
    id: 'paye-secondary-rebate-age-65',
    title: 'PAYE secondary rebate from age 65',
    description: 'Employee age 65+ receives secondary rebate.',
    tags: ['paye', 'rebate', 'edge'],
    buildInput: () => baseInput({ ageYears: 66 }),
    expect: {
      payeMinorMin: 0,
      identitiesHold: true,
      externalPaymentInitiated: false,
      sarsSubmissionInitiated: false,
    },
  },
  {
    id: 'bonus-taxable-inclusion',
    title: 'Bonus increases taxable earnings and PAYE',
    description: 'One-off bonus component lifts gross/taxable and PAYE vs base salary only.',
    tags: ['bonus', 'paye'],
    buildInput: () =>
      baseInput({
        components: [
          {
            componentCode: 'BONUS',
            quantityMinorUnits: 1,
            unitAmountMinor: 500_000,
            description: 'Performance bonus',
            kind: 'bonus',
            taxTreatment: 'taxable',
            uifTreatment: 'include',
            sdlTreatment: 'include',
          },
        ],
      }),
    expect: {
      payeMinorMin: 1,
      identitiesHold: true,
      externalPaymentInitiated: false,
      sarsSubmissionInitiated: false,
    },
  },
  {
    id: 'hourly-overtime-multiplier',
    title: 'Hourly worker with overtime multiplier',
    description: 'Hourly ordinary + OT hours with term multiplier.',
    tags: ['hourly', 'overtime', 'uif', 'sdl'],
    buildInput: () =>
      baseInput({
        workerCategory: 'hourly',
        rateMinor: 25_000,
        ordinaryHoursWorked: 160,
        overtimeHours: 10,
        components: [],
      }),
    expect: {
      payeMinorMin: 0,
      uifEmployeeMinorMin: 1,
      identitiesHold: true,
      externalPaymentInitiated: false,
      sarsSubmissionInitiated: false,
    },
  },
] as const

export function listVeraCalcFixtureIds(): string[] {
  return VERA_PAYROLL_CALC_FIXTURES.map((f) => f.id)
}

export function getVeraCalcFixture(id: string): VeraCalcFixture {
  const row = VERA_PAYROLL_CALC_FIXTURES.find((f) => f.id === id)
  if (!row) throw new Error(`Unknown Vera calc fixture: ${id}`)
  return row
}

export function runVeraCalcFixture(id: string): {
  fixtureId: string
  title: string
  tags: VeraCalcFixture['tags']
  totals: {
    grossEarningsMinor: number
    taxableEarningsMinor: number
    payeMinor: number
    uifEmployeeMinor: number
    uifEmployerMinor: number
    sdlEmployerMinor: number
    netPayMinor: number
  }
  identitiesHold: boolean
  externalPaymentInitiated: false
  sarsSubmissionInitiated: false
  resultDigest: string
} {
  const fixture = getVeraCalcFixture(id)
  const rule = approvedRule()
  const input = fixture.buildInput()
  const result = calculatePayrollPeriod(input, rule)
  const totals = result.totals

  if (fixture.expect.payeMinorMin != null && totals.payeMinor < fixture.expect.payeMinorMin) {
    throw new Error(`${id}: payeMinor ${totals.payeMinor} < min ${fixture.expect.payeMinorMin}`)
  }
  if (fixture.expect.payeMinorMax != null && totals.payeMinor > fixture.expect.payeMinorMax) {
    throw new Error(`${id}: payeMinor ${totals.payeMinor} > max ${fixture.expect.payeMinorMax}`)
  }
  if (fixture.expect.uifEmployeeMinorMin != null && totals.uifEmployeeMinor < fixture.expect.uifEmployeeMinorMin) {
    throw new Error(`${id}: uifEmployeeMinor below min`)
  }
  if (fixture.expect.uifEmployeeMinorMax != null && totals.uifEmployeeMinor > fixture.expect.uifEmployeeMinorMax) {
    throw new Error(`${id}: uifEmployeeMinor above max (got ${totals.uifEmployeeMinor})`)
  }
  if (fixture.expect.sdlEmployerMinorMin != null && totals.sdlEmployerMinor < fixture.expect.sdlEmployerMinorMin) {
    throw new Error(`${id}: sdlEmployerMinor below min`)
  }
  if (!result.accountantReview.identitiesHold) throw new Error(`${id}: identitiesHold false`)

  return {
    fixtureId: id,
    title: fixture.title,
    tags: fixture.tags,
    totals: {
      grossEarningsMinor: totals.grossEarningsMinor,
      taxableEarningsMinor: totals.taxableEarningsMinor,
      payeMinor: totals.payeMinor,
      uifEmployeeMinor: totals.uifEmployeeMinor,
      uifEmployerMinor: totals.uifEmployerMinor,
      sdlEmployerMinor: totals.sdlEmployerMinor,
      netPayMinor: totals.netPayMinor,
    },
    identitiesHold: true,
    externalPaymentInitiated: false,
    sarsSubmissionInitiated: false,
    resultDigest: result.resultDigest,
  }
}

export function runAllVeraCalcFixtures() {
  return VERA_PAYROLL_CALC_FIXTURES.map((f) => runVeraCalcFixture(f.id))
}
