/**
 * Development/staging verification for SA payroll:
 * calculation engine + pay-run calendars/cut-offs, review/approval lock,
 * payslips, history, corrections, reversals, external payment observation only.
 * No SARS submission/payment, no external salary payment initiation, no production deploy.
 */
import { FinancePayrollCalculationService, InMemoryPayrollStore } from '../../lib/payroll/calculation-service'
import { FinancePayRunService } from '../../lib/payroll/pay-run-service'
import { zaPayrollRuleVersionDraft } from '../../lib/jurisdictions/za/payroll'
import { assertCalculationDeterministic } from '../../lib/payroll/calculation'
import { canonicalDigest, HASH_ALGORITHM_VERSION } from '../../lib/finance/integrity'
import type { FinanceActorContext, FinanceApprovalRecord } from '../../lib/finance/types'

const nowStart = '2026-03-15T12:00:00.000Z'
let now = nowStart
const orgId = 'org-verify-payroll'
const scope = { orgId, legalEntityId: 'entity-a', bookId: 'book-a' }
const request = (key: string) => ({ requestId: `verify-${key}`, idempotencyKey: `verify-idem-${key}` })

function actorFor(uid: string, role: FinanceActorContext['assignments'][number]['role']): FinanceActorContext {
  return {
    uid,
    orgId,
    membershipRole: 'owner',
    membershipActive: true,
    financeModuleEnabled: true,
    assignments: [{
      id: `${uid}-a0`, orgId, userId: uid, legalEntityId: scope.legalEntityId,
      scopeMode: 'entity', role, status: 'active',
    }],
  }
}

function makeApproval(id: string, action: FinanceApprovalRecord['action']): FinanceApprovalRecord {
  const base = {
    orgId, legalEntityId: scope.legalEntityId, bookId: scope.bookId, id,
    schemaVersion: 1 as const,
    action,
    status: 'approved' as const,
    approvedBy: 'verify-external-approver',
    approverRole: 'payroll_approver' as const,
    approverAssignmentId: 'verify-external-a0',
    approvedAt: now,
    reason: `Approve ${action}`,
    subjectDigest: canonicalDigest({ id, action }),
    immutable: true as const,
    canonicalPayloadVersion: 1 as const,
    hashAlgorithmVersion: HASH_ALGORITHM_VERSION,
  }
  return { ...base, contentHash: canonicalDigest(base) }
}

async function main() {
  const store = new InMemoryPayrollStore()
  const service = new FinancePayrollCalculationService(store, () => now)
  const payRuns = new FinancePayRunService(store, () => now)
  const clerk = actorFor('verify-clerk', 'payroll_clerk')
  const approver = actorFor('verify-approver', 'payroll_approver')

  const employee = await service.createEmployee(clerk, {
    id: 'emp-v', ...scope, employeeNumber: 'V001', displayName: 'Verify Worker',
    taxResidency: 'za_resident', dateOfBirth: '1985-01-15', startDate: '2024-01-01',
    expectedVersion: 0, ...request('emp'),
  })
  const employment = await service.createEmployment(clerk, {
    id: 'empl-v', ...scope, employeeId: employee.id, expectedVersion: 0, ...request('empl'),
  })
  const term = await service.createTermVersion(clerk, {
    id: 'term-v', ...scope, employeeId: employee.id, employmentId: employment.id,
    versionNumber: 1, workerCategory: 'salaried', frequency: 'monthly',
    rateMinor: 4_000_000, standardHoursPerPeriod: 173.33,
    overtimeMultiplierNumerator: 150, overtimeMultiplierDenominator: 100,
    subjectToUif: true, subjectToSdl: true, effectiveFrom: '2025-03-01',
    expectedVersion: 0, ...request('term'),
  })

  for (const [id, code, name, kind, tax] of [
    ['c1', 'BONUS', 'Bonus', 'bonus', 'taxable'],
    ['c2', 'COMM', 'Commission', 'commission', 'taxable'],
    ['c3', 'ALLOW', 'Allowance', 'allowance', 'taxable'],
    ['c4', 'BEN', 'Benefit', 'benefit', 'taxable'],
    ['c5', 'DED', 'Deduction', 'deduction', 'post_tax_deduction'],
  ] as const) {
    await service.createPayComponent(clerk, {
      id, ...scope, code, name, kind: kind as any,
      taxTreatment: tax as any, uifTreatment: kind === 'deduction' ? 'exclude' : 'include',
      sdlTreatment: kind === 'deduction' ? 'exclude' : 'include',
      jurisdictionCode: 'ZA', expectedVersion: 0, ...request(`cmp-${id}`),
    })
  }

  const draftBody = zaPayrollRuleVersionDraft({
    id: 'rule-v', orgId, legalEntityId: scope.legalEntityId, bookId: scope.bookId, versionNumber: 1,
  })
  const draft = await service.createRuleVersion(clerk, { ...draftBody, ...scope, expectedVersion: 0, ...request('rule') })
  service.registerApproval(makeApproval('ap-v', 'payroll.rule.approve'))
  const rule = await service.approveRuleVersion(approver, {
    ...scope, ruleVersionId: draft.id, expectedVersion: draft.version,
    approvalId: 'ap-v', reason: 'Approve', ...request('rule-ap'),
  })

  const cal = await service.createCalendar(clerk, {
    id: 'cal-v', ...scope, code: 'M', name: 'Monthly', frequency: 'monthly',
    expectedVersion: 0, ...request('cal'),
  })
  const period = await service.createPayPeriod(clerk, {
    id: 'per-v', ...scope, calendarId: cal.id, label: '2026-03',
    periodStart: '2026-03-01', periodEnd: '2026-03-31', payDate: '2026-03-25',
    cutOffAt: '2026-03-20T12:00:00.000Z',
    taxYearLabel: '2025/26', expectedVersion: 0, ...request('per'),
  })

  const calc = await service.calculateEmployee(clerk, {
    id: 'calc-v', ...scope,
    employeeId: employee.id, employmentId: employment.id, termVersionId: term.id,
    payPeriodId: period.id, ruleVersionId: rule.id,
    overtimeHours: 6,
    leave: [{ id: 'l1', kind: 'unpaid', hours: 4 }],
    components: [
      { componentCode: 'BONUS', quantityMinorUnits: 1, unitAmountMinor: 250_000 },
      { componentCode: 'COMM', quantityMinorUnits: 1, unitAmountMinor: 100_000 },
      { componentCode: 'ALLOW', quantityMinorUnits: 1, unitAmountMinor: 75_000 },
      { componentCode: 'BEN', quantityMinorUnits: 1, unitAmountMinor: 50_000 },
      { componentCode: 'DED', quantityMinorUnits: 1, unitAmountMinor: 30_000 },
    ],
    expectedVersion: 0, ...request('calc'),
  })

  assertCalculationDeterministic({
    orgId: scope.orgId,
    legalEntityId: scope.legalEntityId,
    bookId: scope.bookId,
    employeeId: employee.id,
    employmentId: employment.id,
    payPeriodId: period.id,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    payDate: period.payDate,
    frequency: term.frequency,
    workerCategory: term.workerCategory,
    termVersionId: term.id,
    termContentHash: term.contentHash,
    rateMinor: term.rateMinor,
    standardHoursPerPeriod: term.standardHoursCenti / 100,
    overtimeMultiplierNumerator: term.overtimeMultiplierNumerator,
    overtimeMultiplierDenominator: term.overtimeMultiplierDenominator,
    subjectToUif: term.subjectToUif,
    subjectToSdl: term.subjectToSdl,
    taxResidency: employee.taxResidency,
    ageYears: 41,
    ordinaryHoursWorked: 0,
    overtimeHours: 6,
    components: [
      { componentCode: 'BONUS', kind: 'bonus', quantityMinorUnits: 1, unitAmountMinor: 250_000, taxTreatment: 'taxable', uifTreatment: 'include', sdlTreatment: 'include' },
      { componentCode: 'COMM', kind: 'commission', quantityMinorUnits: 1, unitAmountMinor: 100_000, taxTreatment: 'taxable', uifTreatment: 'include', sdlTreatment: 'include' },
      { componentCode: 'ALLOW', kind: 'allowance', quantityMinorUnits: 1, unitAmountMinor: 75_000, taxTreatment: 'taxable', uifTreatment: 'include', sdlTreatment: 'include' },
      { componentCode: 'BEN', kind: 'benefit', quantityMinorUnits: 1, unitAmountMinor: 50_000, taxTreatment: 'taxable', uifTreatment: 'include', sdlTreatment: 'include' },
      { componentCode: 'DED', kind: 'deduction', quantityMinorUnits: 1, unitAmountMinor: 30_000, taxTreatment: 'post_tax_deduction', uifTreatment: 'exclude', sdlTreatment: 'exclude' },
    ],
    leave: [{ id: 'l1', kind: 'unpaid', hours: 4 }],
  }, rule)
  if (!calc.result.accountantReview.identitiesHold) throw new Error('identity failed')
  if (calc.externalPaymentInitiated !== false) throw new Error('payment initiated')
  if (calc.sarsSubmissionInitiated !== false) throw new Error('sars submit')

  // weekly hourly spot check
  const empW = await service.createEmployee(clerk, {
    id: 'emp-vw', ...scope, employeeNumber: 'V002', displayName: 'Hourly',
    taxResidency: 'za_resident', startDate: '2025-01-01', expectedVersion: 0, ...request('empw'),
  })
  const emplW = await service.createEmployment(clerk, {
    id: 'empl-vw', ...scope, employeeId: empW.id, expectedVersion: 0, ...request('emplw'),
  })
  const termW = await service.createTermVersion(clerk, {
    id: 'term-vw', ...scope, employeeId: empW.id, employmentId: emplW.id,
    versionNumber: 1, workerCategory: 'hourly', frequency: 'weekly',
    rateMinor: 18_000, standardHoursPerPeriod: 40,
    overtimeMultiplierNumerator: 150, overtimeMultiplierDenominator: 100,
    subjectToUif: true, subjectToSdl: true, effectiveFrom: '2025-03-01',
    expectedVersion: 0, ...request('termw'),
  })
  const calW = await service.createCalendar(clerk, {
    id: 'cal-vw', ...scope, code: 'W', name: 'Weekly', frequency: 'weekly',
    expectedVersion: 0, ...request('calw'),
  })
  const perW = await service.createPayPeriod(clerk, {
    id: 'per-vw', ...scope, calendarId: calW.id, label: 'W10',
    periodStart: '2026-03-02', periodEnd: '2026-03-08', payDate: '2026-03-06',
    taxYearLabel: '2025/26', expectedVersion: 0, ...request('perw'),
  })
  const weekly = await service.calculateEmployee(clerk, {
    id: 'calc-vw', ...scope,
    employeeId: empW.id, employmentId: emplW.id, termVersionId: termW.id,
    payPeriodId: perW.id, ruleVersionId: rule.id,
    ordinaryHoursWorked: 40, overtimeHours: 5,
    leave: [{ id: 'lp', kind: 'paid', hours: 0 }],
    expectedVersion: 0, ...request('calcw'),
  })
  if (weekly.result.periodsPerYear !== 52) throw new Error('weekly periods')

  // Pay run lifecycle
  let run = await payRuns.createPayRun(clerk, {
    id: 'run-v', ...scope, calendarId: cal.id, payPeriodId: period.id,
    ruleVersionId: rule.id, label: '2026-03 run', expectedVersion: 0, ...request('run'),
  })
  run = await payRuns.addItem(clerk, {
    id: 'item-v', ...scope, payRunId: run.id, calculationId: calc.id,
    expectedVersion: run.version, ...request('item'),
  })
  now = '2026-03-21T10:00:00.000Z'
  run = await payRuns.freezeInputs(clerk, {
    ...scope, payRunId: run.id, expectedVersion: run.version, ...request('freeze'),
  })
  run = await payRuns.submitForReview(clerk, {
    ...scope, payRunId: run.id, expectedVersion: run.version, ...request('submit'),
  })
  payRuns.registerApproval(makeApproval('ap-run-v', 'payroll.run.approve'))
  const locked = await payRuns.approveAndLock(approver, {
    ...scope, payRunId: run.id, expectedVersion: run.version,
    approvalId: 'ap-run-v', reason: 'Approve locked pay run', ...request('approve'),
  })
  if (locked.status !== 'approved_locked' || !locked.immutable || !locked.lockHash) {
    throw new Error('pay run not locked')
  }
  if (locked.payslipIds.length !== 1) throw new Error('payslip missing')
  if (locked.externalPaymentInitiated !== false || locked.sarsSubmissionInitiated !== false) {
    throw new Error('egress flags')
  }
  const payslip = payRuns.getPayslip(scope, locked.payslipIds[0])
  if (payslip.autoSent !== false || payslip.publicationStatus !== 'internal_only') {
    throw new Error('payslip publication')
  }

  const originalLockHash = locked.lockHash
  payRuns.registerApproval(makeApproval('ap-rev-v', 'payroll.run.reverse'))
  const reversal = await payRuns.reversePayRun(approver, {
    id: 'run-rev-v', ...scope, originalPayRunId: locked.id, expectedVersion: locked.version,
    approvalId: 'ap-rev-v', reason: 'Full reversal', ...request('rev'),
  })
  if (reversal.totals.netPayMinor !== -locked.totals.netPayMinor) throw new Error('reversal totals')
  if (store.payRuns.get(locked.id)?.lockHash !== originalLockHash) throw new Error('original lock mutated')
  if (store.payRuns.get(locked.id)?.status !== 'reversed') throw new Error('original not marked reversed')

  let correction = await payRuns.createCorrectionRun(clerk, {
    id: 'run-corr-v', ...scope, originalPayRunId: locked.id, kind: 'amended_deduction_tax',
    label: 'Amended tax/deduction', expectedVersion: 0, ...request('corr'),
  })
  correction = await payRuns.applyIndividualAdjustment(clerk, {
    id: 'adj-v', ...scope, payRunId: correction.id, originalPayRunId: locked.id,
    originalItemId: locked.itemIds[0], employeeId: employee.id, employmentId: employment.id,
    kind: 'amended_tax',
    deltaComponents: [
      { componentCode: 'PAYE_FIX', kind: 'statutory_paye', quantityMinorUnits: 1, unitAmountMinor: 1_500, taxTreatment: 'post_tax_deduction' },
      { componentCode: 'DED_FIX', kind: 'deduction', quantityMinorUnits: 1, unitAmountMinor: 500, taxTreatment: 'post_tax_deduction' },
    ],
    reason: 'Amended PAYE and deduction',
    expectedVersion: correction.version, ...request('adj'),
  })
  now = '2026-03-22T10:00:00.000Z'
  correction = await payRuns.freezeInputs(clerk, {
    ...scope, payRunId: correction.id, expectedVersion: correction.version, ...request('freeze-c'),
  })
  correction = await payRuns.submitForReview(clerk, {
    ...scope, payRunId: correction.id, expectedVersion: correction.version, ...request('submit-c'),
  })
  payRuns.registerApproval(makeApproval('ap-corr-v', 'payroll.run.approve'))
  const lockedCorr = await payRuns.approveAndLock(approver, {
    ...scope, payRunId: correction.id, expectedVersion: correction.version,
    approvalId: 'ap-corr-v', reason: 'Approve correction', ...request('approve-c'),
  })
  if (lockedCorr.status !== 'approved_locked') throw new Error('correction not locked')

  const observed = await payRuns.observeExternalSalaryPayment(clerk, {
    id: 'obs-v', ...scope, payRunId: locked.id, amountMinor: Math.abs(locked.totals.netPayMinor),
    reference: 'SALARY-BANK-1', expectedVersion: store.payRuns.get(locked.id)!.version, ...request('obs'),
  })
  if (observed.externalSalaryPaymentObservations[0]?.externalPaymentInitiated !== false) {
    throw new Error('payment initiated on observation')
  }

  const history = payRuns.listPayRunHistory(scope, period.id)
  if (history.length < 3) throw new Error('history incomplete')
  if (store.auditEvents.some((e) => e.externalEgressAllowed !== false)) throw new Error('egress')

  console.log(JSON.stringify({
    ok: true,
    ruleVersionId: rule.id,
    ruleStatus: rule.status,
    packageId: rule.packageId,
    monthlyCalculationId: calc.id,
    monthlyNetPayMinor: calc.result.totals.netPayMinor,
    monthlyPayeMinor: calc.result.totals.payeMinor,
    monthlyUifEmployeeMinor: calc.result.totals.uifEmployeeMinor,
    monthlySdlEmployerMinor: calc.result.totals.sdlEmployerMinor,
    monthlyResultDigest: calc.result.resultDigest,
    weeklyCalculationId: weekly.id,
    weeklyGrossMinor: weekly.result.totals.grossEarningsMinor,
    identitiesHold: calc.result.accountantReview.identitiesHold,
    payRunId: locked.id,
    payRunStatus: store.payRuns.get(locked.id)?.status,
    lockHash: originalLockHash,
    payslipId: payslip.id,
    reversalPayRunId: reversal.id,
    correctionPayRunId: lockedCorr.id,
    historyCount: history.length,
    externalPaymentInitiated: false,
    sarsSubmissionInitiated: false,
    noEgress: store.auditEvents.every((e) => e.externalEgressAllowed === false),
    auditEvents: store.auditEvents.length,
    traceSteps: calc.result.trace.length,
    cutOffAt: period.cutOffAt,
  }))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
