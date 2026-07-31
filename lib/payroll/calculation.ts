import { canonicalDigest } from '@/lib/finance/integrity'
import {
  FinanceValidationError,
  assertSafeInteger,
  immutableContentHash,
  parseCanonicalDate,
  requiredText,
} from '@/lib/accounting/foundation'
import type {
  PayComponentKind,
  PayFrequency,
  PayrollCalculationInput,
  PayrollCalculationResult,
  PayrollComponentLine,
  PayrollRuleVersion,
  PayrollTraceStep,
  PayrollCalculationTotals,
  TaxTreatment,
  UifTreatment,
  SdlTreatment,
} from './types'

export { FinanceValidationError }

export function assertPayrollRuleVersionHash(rule: PayrollRuleVersion): void {
  if (rule.status !== 'approved' || !rule.immutable) {
    throw new FinanceValidationError('Only approved immutable payroll rule versions may be used for calculation')
  }
  if (!rule.contentHash || immutableContentHash(rule) !== rule.contentHash) {
    throw new FinanceValidationError('Payroll rule version content hash is invalid')
  }
}

export function buildPayrollRuleContentHash(rule: Omit<PayrollRuleVersion, 'contentHash'>): string {
  return immutableContentHash(rule)
}

export function periodsPerYear(frequency: PayFrequency, rule: PayrollRuleVersion): number {
  if (frequency === 'monthly') return rule.periodsPerYearMonthly
  if (frequency === 'weekly') return rule.periodsPerYearWeekly
  throw new FinanceValidationError('Unsupported pay frequency')
}

function roundHalfUpDiv(numerator: number, denominator: number): number {
  if (denominator <= 0) throw new FinanceValidationError('Denominator must be positive')
  if (numerator === 0) return 0
  const sign = numerator < 0 ? -1 : 1
  const absolute = Math.abs(numerator)
  return sign * Math.floor((absolute + Math.floor(denominator / 2)) / denominator)
}

function assertNonNeg(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new FinanceValidationError(`${field} must be a non-negative safe integer`)
  }
}

function assertHours(value: number, field: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new FinanceValidationError(`${field} must be a non-negative finite number`)
  }
  // Allow 2 decimal hours represented as number; convert via cents-of-hour * rate carefully.
}

/** Multiply amountMinor * hours with 2dp hour precision using integer math (hours * 100). */
export function multiplyRateByHours(rateMinor: number, hours: number, field: string): number {
  assertNonNeg(rateMinor, field)
  assertHours(hours, field)
  const hoursCenti = Math.round(hours * 100)
  if (!Number.isSafeInteger(hoursCenti) || hoursCenti < 0) {
    throw new FinanceValidationError(`${field} hours precision is invalid`)
  }
  return roundHalfUpDiv(rateMinor * hoursCenti, 100)
}

export function multiplyRateByMultiplier(
  baseMinor: number,
  numerator: number,
  denominator: number,
  field: string,
): number {
  assertNonNeg(baseMinor, field)
  assertSafeInteger(numerator, `${field}.numerator`, 0)
  assertSafeInteger(denominator, `${field}.denominator`, 1)
  return roundHalfUpDiv(baseMinor * numerator, denominator)
}

export function annualizeAmount(periodMinor: number, periods: number): number {
  assertNonNeg(periodMinor, 'periodMinor')
  assertSafeInteger(periods, 'periods', 1)
  const annual = periodMinor * periods
  if (!Number.isSafeInteger(annual)) throw new FinanceValidationError('Annualized amount exceeds safe integer precision')
  return annual
}

export function deAnnualizeAmount(annualMinor: number, periods: number): number {
  assertNonNeg(annualMinor, 'annualMinor')
  assertSafeInteger(periods, 'periods', 1)
  return roundHalfUpDiv(annualMinor, periods)
}

export function calculateAnnualPayeBeforeRebate(annualTaxableMinor: number, rule: PayrollRuleVersion): number {
  assertNonNeg(annualTaxableMinor, 'annualTaxableMinor')
  assertPayrollRuleVersionHash(rule)
  let remaining = annualTaxableMinor
  let previousCeiling = 0
  for (const bracket of rule.payeBrackets) {
    const ceiling = bracket.upToInclusiveMinor
    const upper = ceiling === null ? Number.POSITIVE_INFINITY : ceiling
    if (annualTaxableMinor <= previousCeiling) return 0
    if (annualTaxableMinor <= upper || ceiling === null) {
      const bandIncome = annualTaxableMinor - previousCeiling
      const bandTax = roundHalfUpDiv(bandIncome * bracket.rateNumerator, bracket.rateDenominator)
      const total = bracket.cumulativeBaseTaxMinor + bandTax
      if (!Number.isSafeInteger(total)) throw new FinanceValidationError('PAYE exceeded safe integer precision')
      return total
    }
    previousCeiling = ceiling as number
    remaining = annualTaxableMinor - previousCeiling
    void remaining
  }
  throw new FinanceValidationError('PAYE brackets are incomplete')
}

export function calculateAnnualRebate(rule: PayrollRuleVersion, ageYears?: number): number {
  assertPayrollRuleVersionHash(rule)
  let rebate = rule.primaryRebateMinor
  if (ageYears !== undefined) {
    assertSafeInteger(ageYears, 'ageYears', 0)
    if (ageYears >= rule.secondaryAgeFrom) rebate += rule.secondaryRebateMinor
    if (ageYears >= rule.tertiaryAgeFrom) rebate += rule.tertiaryRebateMinor
  }
  assertNonNeg(rebate, 'rebate')
  return rebate
}

export function scaleCeilingToFrequency(monthlyCeilingMinor: number | null, frequency: PayFrequency): number | null {
  if (monthlyCeilingMinor === null) return null
  assertNonNeg(monthlyCeilingMinor, 'monthlyCeilingMinor')
  if (frequency === 'monthly') return monthlyCeilingMinor
  // weekly ≈ monthly * 12 / 52
  return roundHalfUpDiv(monthlyCeilingMinor * 12, 52)
}

function defaultTreatments(kind: PayComponentKind): {
  tax: TaxTreatment
  uif: UifTreatment
  sdl: SdlTreatment
  employeeFacing: boolean
  employerFacing: boolean
} {
  switch (kind) {
    case 'base_salary':
    case 'hourly_wage':
    case 'overtime':
    case 'bonus':
    case 'commission':
    case 'allowance':
    case 'leave_paid':
      return { tax: 'taxable', uif: 'include', sdl: 'include', employeeFacing: true, employerFacing: false }
    case 'benefit':
      return { tax: 'taxable', uif: 'include', sdl: 'include', employeeFacing: true, employerFacing: true }
    case 'deduction':
      return { tax: 'post_tax_deduction', uif: 'exclude', sdl: 'exclude', employeeFacing: true, employerFacing: false }
    case 'leave_unpaid':
      return { tax: 'non_taxable', uif: 'exclude', sdl: 'exclude', employeeFacing: true, employerFacing: false }
    case 'employer_contribution':
      return { tax: 'non_taxable', uif: 'exclude', sdl: 'exclude', employeeFacing: false, employerFacing: true }
    case 'statutory_paye':
    case 'statutory_uif_employee':
      return { tax: 'post_tax_deduction', uif: 'exclude', sdl: 'exclude', employeeFacing: true, employerFacing: false }
    case 'statutory_uif_employer':
    case 'statutory_sdl':
      return { tax: 'non_taxable', uif: 'exclude', sdl: 'exclude', employeeFacing: false, employerFacing: true }
    default:
      throw new FinanceValidationError(`Unknown component kind: ${kind}`)
  }
}

function lineAmount(quantity: number, unitAmountMinor: number, field: string): number {
  assertHours(quantity, field)
  assertNonNeg(unitAmountMinor, field)
  // quantity is not always hours; for fixed items quantity is 1.
  // Use centi-quantity for 2dp support.
  const qCenti = Math.round(quantity * 100)
  if (!Number.isSafeInteger(qCenti) || qCenti < 0) throw new FinanceValidationError(`${field} quantity is invalid`)
  return roundHalfUpDiv(unitAmountMinor * qCenti, 100)
}

/**
 * Deterministic ZA-capable payroll calculation.
 * Jurisdiction rule package is pinned; core emits accountant-reviewable traces.
 * No salary payment initiation and no SARS submission.
 */
export function calculatePayrollPeriod(
  input: PayrollCalculationInput,
  rule: PayrollRuleVersion,
): PayrollCalculationResult {
  assertPayrollRuleVersionHash(rule)
  requiredText(input.orgId, 'orgId')
  requiredText(input.legalEntityId, 'legalEntityId')
  requiredText(input.bookId, 'bookId')
  requiredText(input.employeeId, 'employeeId')
  requiredText(input.employmentId, 'employmentId')
  requiredText(input.payPeriodId, 'payPeriodId')
  parseCanonicalDate(input.periodStart, 'periodStart')
  parseCanonicalDate(input.periodEnd, 'periodEnd')
  parseCanonicalDate(input.payDate, 'payDate')
  if (input.periodEnd < input.periodStart) throw new FinanceValidationError('periodEnd must be on or after periodStart')

  const periods = periodsPerYear(input.frequency, rule)
  const trace: PayrollTraceStep[] = []
  let step = 0
  const push = (code: string, label: string, inputs: PayrollTraceStep['inputs'], outputs: PayrollTraceStep['outputs']) => {
    step += 1
    trace.push({ step, code, label, inputs, outputs })
  }

  push('pin_rule', 'Pin approved payroll rule version', {
    ruleVersionId: rule.id,
    versionNumber: rule.versionNumber,
    packageId: rule.packageId,
    contentHash: rule.contentHash,
  }, { jurisdictionCode: rule.jurisdictionCode, taxYearLabel: rule.taxYearLabel })

  const warnings: string[] = []
  const lines: PayrollComponentLine[] = []
  let lineSeq = 0
  const addLine = (partial: Omit<PayrollComponentLine, 'lineId'>) => {
    lineSeq += 1
    lines.push({ lineId: `L${lineSeq}`, ...partial })
  }

  // 1) Ordinary earnings from worker profile
  let ordinaryMinor = 0
  if (input.workerCategory === 'salaried') {
    ordinaryMinor = input.rateMinor
    assertNonNeg(ordinaryMinor, 'rateMinor')
    const unpaidHours = input.leave.filter((l) => l.kind === 'unpaid').reduce((s, l) => s + l.hours, 0)
    let unpaidReduction = 0
    let hourlyEquivalent = 0
    if (unpaidHours > 0) {
      if (input.standardHoursPerPeriod <= 0) {
        throw new FinanceValidationError('standardHoursPerPeriod must be positive when unpaid leave is present')
      }
      const standardHoursCenti = Math.round(input.standardHoursPerPeriod * 100)
      const unpaidHoursCenti = Math.round(unpaidHours * 100)
      if (standardHoursCenti <= 0 || unpaidHoursCenti < 0) {
        throw new FinanceValidationError('Unpaid leave hours are invalid')
      }
      // salary * unpaidHours / standardHours
      unpaidReduction = roundHalfUpDiv(input.rateMinor * unpaidHoursCenti, standardHoursCenti)
      hourlyEquivalent = roundHalfUpDiv(input.rateMinor * 100, standardHoursCenti)
      ordinaryMinor = input.rateMinor - unpaidReduction
      if (ordinaryMinor < 0) throw new FinanceValidationError('Unpaid leave reduction exceeds salary')
      addLine({
        componentCode: 'LEAVE_UNPAID',
        kind: 'leave_unpaid',
        description: 'Unpaid leave reduction',
        quantity: unpaidHours,
        unitAmountMinor: hourlyEquivalent,
        amountMinor: -unpaidReduction,
        taxTreatment: 'non_taxable',
        uifTreatment: 'exclude',
        sdlTreatment: 'exclude',
        employeeFacing: true,
        employerFacing: false,
      })
      push('unpaid_leave', 'Apply unpaid leave reduction to salaried ordinary pay', {
        unpaidHours,
        standardHoursPerPeriod: input.standardHoursPerPeriod,
        salaryMinor: input.rateMinor,
        hourlyEquivalent,
      }, { unpaidReductionMinor: unpaidReduction, ordinaryMinor })
    }
    addLine({
      componentCode: 'BASE_SALARY',
      kind: 'base_salary',
      description: 'Ordinary salaried earnings',
      quantity: 1,
      unitAmountMinor: ordinaryMinor,
      amountMinor: ordinaryMinor,
      taxTreatment: 'taxable',
      uifTreatment: 'include',
      sdlTreatment: 'include',
      employeeFacing: true,
      employerFacing: false,
    })
    push('ordinary_salaried', 'Compute ordinary salaried earnings', {
      rateMinor: input.rateMinor,
      unpaidReductionMinor: unpaidReduction,
    }, { ordinaryMinor })
  } else {
    assertHours(input.ordinaryHoursWorked, 'ordinaryHoursWorked')
    ordinaryMinor = multiplyRateByHours(input.rateMinor, input.ordinaryHoursWorked, 'ordinaryHours')
    addLine({
      componentCode: 'HOURLY_WAGE',
      kind: 'hourly_wage',
      description: 'Ordinary hourly earnings',
      quantity: input.ordinaryHoursWorked,
      unitAmountMinor: input.rateMinor,
      amountMinor: ordinaryMinor,
      taxTreatment: 'taxable',
      uifTreatment: 'include',
      sdlTreatment: 'include',
      employeeFacing: true,
      employerFacing: false,
    })
    push('ordinary_hourly', 'Compute ordinary hourly earnings', {
      rateMinor: input.rateMinor,
      ordinaryHoursWorked: input.ordinaryHoursWorked,
    }, { ordinaryMinor })
  }

  // 2) Overtime
  let overtimeMinor = 0
  if (input.overtimeHours > 0) {
    assertHours(input.overtimeHours, 'overtimeHours')
    const otUnit = multiplyRateByMultiplier(
      input.rateMinor,
      input.overtimeMultiplierNumerator,
      input.overtimeMultiplierDenominator,
      'overtimeRate',
    )
    overtimeMinor = multiplyRateByHours(otUnit, input.overtimeHours, 'overtime')
    addLine({
      componentCode: 'OVERTIME',
      kind: 'overtime',
      description: 'Overtime earnings',
      quantity: input.overtimeHours,
      unitAmountMinor: otUnit,
      amountMinor: overtimeMinor,
      taxTreatment: 'taxable',
      uifTreatment: 'include',
      sdlTreatment: 'include',
      employeeFacing: true,
      employerFacing: false,
    })
    push('overtime', 'Compute overtime', {
      baseRateMinor: input.rateMinor,
      multiplierNumerator: input.overtimeMultiplierNumerator,
      multiplierDenominator: input.overtimeMultiplierDenominator,
      overtimeHours: input.overtimeHours,
      otUnitMinor: otUnit,
    }, { overtimeMinor })
  }

  // 3) Paid leave lines (hourly workers typically; salaried already paid via salary)
  let leavePaidMinor = 0
  for (const leave of input.leave) {
    if (leave.kind !== 'paid') continue
    assertHours(leave.hours, 'leave.hours')
    const amount = multiplyRateByHours(input.rateMinor, leave.hours, 'paidLeave')
    // For salaried, paid leave is already in salary — record informational zero-impact unless hourly
    if (input.workerCategory === 'hourly') {
      leavePaidMinor += amount
      addLine({
        componentCode: leave.componentCode ?? 'LEAVE_PAID',
        kind: 'leave_paid',
        description: leave.description ?? 'Paid leave',
        quantity: leave.hours,
        unitAmountMinor: input.rateMinor,
        amountMinor: amount,
        taxTreatment: 'taxable',
        uifTreatment: 'include',
        sdlTreatment: 'include',
        employeeFacing: true,
        employerFacing: false,
      })
    } else {
      warnings.push('Paid leave on salaried worker recorded for audit; amount included in base salary')
      push('leave_paid_salaried_info', 'Paid leave informational for salaried worker', {
        hours: leave.hours,
      }, { amountIncludedInSalary: true })
    }
  }
  if (leavePaidMinor > 0) {
    push('leave_paid', 'Paid leave earnings (hourly)', { leavePaidMinor }, { leavePaidMinor })
  }

  // 4) Explicit period components (bonus, commission, allowances, benefits, deductions)
  let bonusMinor = 0
  let commissionMinor = 0
  let allowancesMinor = 0
  let benefitsMinor = 0
  let preTaxDeductionsMinor = 0
  let postTaxDeductionsMinor = 0
  let employerContributionMinor = 0

  for (const [index, component] of input.components.entries()) {
    const code = requiredText(component.componentCode, `components[${index}].componentCode`)
    const kind = component.kind
    if (!kind) throw new FinanceValidationError(`components[${index}].kind is required for pure calculation`)
    const defaults = defaultTreatments(kind)
    const tax = component.taxTreatment ?? defaults.tax
    const uif = component.uifTreatment ?? defaults.uif
    const sdl = component.sdlTreatment ?? defaults.sdl
    const amount = lineAmount(component.quantityMinorUnits, component.unitAmountMinor, `components[${index}]`)
    const signedAmount = kind === 'deduction' || kind === 'leave_unpaid' ? -Math.abs(amount) : amount

    addLine({
      componentCode: code,
      kind,
      description: component.description ?? code,
      quantity: component.quantityMinorUnits,
      unitAmountMinor: component.unitAmountMinor,
      amountMinor: signedAmount,
      taxTreatment: tax,
      uifTreatment: uif,
      sdlTreatment: sdl,
      employeeFacing: defaults.employeeFacing,
      employerFacing: defaults.employerFacing,
    })

    if (kind === 'bonus') bonusMinor += amount
    else if (kind === 'commission') commissionMinor += amount
    else if (kind === 'allowance') allowancesMinor += amount
    else if (kind === 'benefit') benefitsMinor += amount
    else if (kind === 'employer_contribution') employerContributionMinor += amount
    else if (kind === 'deduction') {
      if (tax === 'pre_tax_deduction') preTaxDeductionsMinor += amount
      else postTaxDeductionsMinor += amount
    }

    push('component', `Apply component ${code}`, {
      kind,
      quantity: component.quantityMinorUnits,
      unitAmountMinor: component.unitAmountMinor,
      taxTreatment: tax,
    }, { amountMinor: signedAmount })
  }

  // Gross earnings (employee cash + taxable benefits typically)
  const grossEarningsMinor =
    ordinaryMinor + overtimeMinor + leavePaidMinor + bonusMinor + commissionMinor + allowancesMinor + benefitsMinor

  // Taxable = taxable lines positive - pre-tax deductions
  let taxableEarningsMinor = 0
  for (const line of lines) {
    if (line.amountMinor > 0 && line.taxTreatment === 'taxable') taxableEarningsMinor += line.amountMinor
    if (line.taxTreatment === 'pre_tax_deduction') taxableEarningsMinor -= Math.abs(line.amountMinor)
  }
  if (taxableEarningsMinor < 0) throw new FinanceValidationError('Taxable earnings cannot be negative')

  push('gross_taxable', 'Sum gross and taxable earnings', {
    ordinaryMinor,
    overtimeMinor,
    leavePaidMinor,
    bonusMinor,
    commissionMinor,
    allowancesMinor,
    benefitsMinor,
    preTaxDeductionsMinor,
  }, { grossEarningsMinor, taxableEarningsMinor })

  // 5) PAYE via annualization
  const annualizedTaxableMinor = annualizeAmount(taxableEarningsMinor, periods)
  const annualTaxBeforeRebateMinor = calculateAnnualPayeBeforeRebate(annualizedTaxableMinor, rule)
  const annualRebateMinor = calculateAnnualRebate(rule, input.ageYears)
  const annualTaxAfterRebateMinor = Math.max(0, annualTaxBeforeRebateMinor - annualRebateMinor)
  const payeMinor = deAnnualizeAmount(annualTaxAfterRebateMinor, periods)

  push('paye', 'Calculate PAYE via annualization', {
    taxableEarningsMinor,
    periodsPerYear: periods,
    annualizedTaxableMinor,
    annualTaxBeforeRebateMinor,
    annualRebateMinor,
    ageYears: input.ageYears ?? null,
  }, { annualTaxAfterRebateMinor, payeMinor })

  addLine({
    componentCode: 'PAYE',
    kind: 'statutory_paye',
    description: 'PAYE (employees tax)',
    quantity: 1,
    unitAmountMinor: payeMinor,
    amountMinor: -payeMinor,
    taxTreatment: 'post_tax_deduction',
    uifTreatment: 'exclude',
    sdlTreatment: 'exclude',
    employeeFacing: true,
    employerFacing: false,
  })

  // 6) UIF
  let uifEmployeeMinor = 0
  let uifEmployerMinor = 0
  if (input.subjectToUif) {
    let uifRemuneration = 0
    for (const line of lines) {
      if (line.amountMinor > 0 && line.uifTreatment === 'include') uifRemuneration += line.amountMinor
    }
    const ceiling = scaleCeilingToFrequency(rule.uif.monthlyCeilingMinor, input.frequency)
    const capped = ceiling === null ? uifRemuneration : Math.min(uifRemuneration, ceiling)
    uifEmployeeMinor = roundHalfUpDiv(capped * rule.uif.employeeRateNumerator, rule.uif.employeeRateDenominator)
    uifEmployerMinor = roundHalfUpDiv(capped * rule.uif.employerRateNumerator, rule.uif.employerRateDenominator)
    push('uif', 'Calculate UIF employee and employer contributions', {
      uifRemuneration,
      ceiling: ceiling,
      capped,
      employeeRate: `${rule.uif.employeeRateNumerator}/${rule.uif.employeeRateDenominator}`,
      employerRate: `${rule.uif.employerRateNumerator}/${rule.uif.employerRateDenominator}`,
    }, { uifEmployeeMinor, uifEmployerMinor })
  } else {
    push('uif_skip', 'Worker not subject to UIF', { subjectToUif: false }, { uifEmployeeMinor: 0, uifEmployerMinor: 0 })
  }
  if (uifEmployeeMinor > 0) {
    addLine({
      componentCode: 'UIF_EE',
      kind: 'statutory_uif_employee',
      description: 'UIF employee contribution',
      quantity: 1,
      unitAmountMinor: uifEmployeeMinor,
      amountMinor: -uifEmployeeMinor,
      taxTreatment: 'post_tax_deduction',
      uifTreatment: 'exclude',
      sdlTreatment: 'exclude',
      employeeFacing: true,
      employerFacing: false,
    })
  }
  if (uifEmployerMinor > 0) {
    addLine({
      componentCode: 'UIF_ER',
      kind: 'statutory_uif_employer',
      description: 'UIF employer contribution',
      quantity: 1,
      unitAmountMinor: uifEmployerMinor,
      amountMinor: uifEmployerMinor,
      taxTreatment: 'non_taxable',
      uifTreatment: 'exclude',
      sdlTreatment: 'exclude',
      employeeFacing: false,
      employerFacing: true,
    })
  }

  // 7) SDL (employer only)
  let sdlEmployerMinor = 0
  if (input.subjectToSdl) {
    let leviable = 0
    for (const line of lines) {
      if (line.amountMinor > 0 && line.sdlTreatment === 'include') leviable += line.amountMinor
    }
    sdlEmployerMinor = roundHalfUpDiv(leviable * rule.sdl.employerRateNumerator, rule.sdl.employerRateDenominator)
    push('sdl', 'Calculate SDL employer levy', {
      leviable,
      employerRate: `${rule.sdl.employerRateNumerator}/${rule.sdl.employerRateDenominator}`,
    }, { sdlEmployerMinor })
  } else {
    push('sdl_skip', 'Employer/worker not subject to SDL on this profile', { subjectToSdl: false }, { sdlEmployerMinor: 0 })
  }
  if (sdlEmployerMinor > 0) {
    addLine({
      componentCode: 'SDL',
      kind: 'statutory_sdl',
      description: 'Skills Development Levy',
      quantity: 1,
      unitAmountMinor: sdlEmployerMinor,
      amountMinor: sdlEmployerMinor,
      taxTreatment: 'non_taxable',
      uifTreatment: 'exclude',
      sdlTreatment: 'exclude',
      employeeFacing: false,
      employerFacing: true,
    })
  }

  const leaveUnpaidReductionMinor = lines
    .filter((l) => l.kind === 'leave_unpaid')
    .reduce((s, l) => s + Math.abs(l.amountMinor), 0)

  const netPayMinor =
    grossEarningsMinor - preTaxDeductionsMinor - payeMinor - uifEmployeeMinor - postTaxDeductionsMinor
  if (netPayMinor < 0) throw new FinanceValidationError('Net pay cannot be negative')

  const employerCostMinor =
    grossEarningsMinor - benefitsMinor + benefitsMinor + uifEmployerMinor + sdlEmployerMinor + employerContributionMinor
  // employer cost = cash gross without double-counting: ordinary+ot+leave+bonus+commission+allowances+benefits + er uif + sdl + er contrib
  const employerCost =
    ordinaryMinor +
    overtimeMinor +
    leavePaidMinor +
    bonusMinor +
    commissionMinor +
    allowancesMinor +
    benefitsMinor +
    uifEmployerMinor +
    sdlEmployerMinor +
    employerContributionMinor

  const totals: PayrollCalculationTotals = {
    grossEarningsMinor,
    taxableEarningsMinor,
    preTaxDeductionsMinor,
    postTaxDeductionsMinor,
    payeMinor,
    uifEmployeeMinor,
    uifEmployerMinor,
    sdlEmployerMinor,
    netPayMinor,
    employerCostMinor: employerCost,
    benefitsMinor,
    allowancesMinor,
    overtimeMinor,
    bonusMinor,
    commissionMinor,
    leavePaidMinor,
    leaveUnpaidReductionMinor,
  }

  const identityHolds =
    grossEarningsMinor - preTaxDeductionsMinor - payeMinor - uifEmployeeMinor - postTaxDeductionsMinor === netPayMinor

  push('net_identity', 'Reconcile net pay identity', {
    grossEarningsMinor,
    preTaxDeductionsMinor,
    payeMinor,
    uifEmployeeMinor,
    postTaxDeductionsMinor,
  }, { netPayMinor, identityHolds })

  if (!identityHolds) throw new FinanceValidationError('Payroll net pay identity failed')
  void employerCostMinor

  const inputDigest = canonicalDigest({
    orgId: input.orgId,
    legalEntityId: input.legalEntityId,
    bookId: input.bookId,
    employeeId: input.employeeId,
    employmentId: input.employmentId,
    payPeriodId: input.payPeriodId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    payDate: input.payDate,
    frequency: input.frequency,
    workerCategory: input.workerCategory,
    termVersionId: input.termVersionId,
    termContentHash: input.termContentHash,
    rateMinor: input.rateMinor,
    standardHoursCenti: Math.round(input.standardHoursPerPeriod * 100),
    overtimeMultiplierNumerator: input.overtimeMultiplierNumerator,
    overtimeMultiplierDenominator: input.overtimeMultiplierDenominator,
    subjectToUif: input.subjectToUif,
    subjectToSdl: input.subjectToSdl,
    taxResidency: input.taxResidency,
    ageYears: input.ageYears ?? null,
    ordinaryHoursCenti: Math.round(input.ordinaryHoursWorked * 100),
    overtimeHoursCenti: Math.round(input.overtimeHours * 100),
    components: input.components.map((component) => ({
      componentCode: component.componentCode,
      quantityCenti: Math.round(component.quantityMinorUnits * 100),
      unitAmountMinor: component.unitAmountMinor,
      description: component.description ?? null,
      taxTreatment: component.taxTreatment ?? null,
      uifTreatment: component.uifTreatment ?? null,
      sdlTreatment: component.sdlTreatment ?? null,
      kind: component.kind ?? null,
    })),
    leave: input.leave.map((row) => ({
      id: row.id,
      kind: row.kind,
      hoursCenti: Math.round(row.hours * 100),
      componentCode: row.componentCode ?? null,
      description: row.description ?? null,
    })),
    ytdTaxableMinor: input.ytdTaxableMinor ?? 0,
    ytdPayeMinor: input.ytdPayeMinor ?? 0,
    ruleVersionId: rule.id,
    ruleContentHash: rule.contentHash,
  })

  const resultWithoutDigest = {
    jurisdictionCode: rule.jurisdictionCode,
    ruleVersionId: rule.id,
    ruleVersionNumber: rule.versionNumber,
    ruleContentHash: rule.contentHash,
    packageId: rule.packageId,
    taxYearLabel: rule.taxYearLabel,
    inputDigest,
    frequency: input.frequency,
    periodsPerYear: periods,
    annualizedTaxableMinor,
    annualTaxBeforeRebateMinor,
    annualRebateMinor,
    annualTaxAfterRebateMinor,
    lines,
    totals,
    trace,
    warnings,
    accountantReview: {
      kind: 'payroll_calculation_review' as const,
      currency: 'ZAR' as const,
      balancedIdentity: 'gross - pre_tax - paye - uif_employee - post_tax = net' as const,
      identitiesHold: true as const,
      externalPaymentInitiated: false as const,
      sarsSubmissionInitiated: false as const,
    },
  }

  const resultDigest = canonicalDigest(resultWithoutDigest)
  return { ...resultWithoutDigest, resultDigest }
}

export function assertCalculationDeterministic(
  input: PayrollCalculationInput,
  rule: PayrollRuleVersion,
): void {
  const a = calculatePayrollPeriod(input, rule)
  const b = calculatePayrollPeriod(input, rule)
  if (a.resultDigest !== b.resultDigest || a.inputDigest !== b.inputDigest) {
    throw new FinanceValidationError('Payroll calculation is not deterministic')
  }
}
