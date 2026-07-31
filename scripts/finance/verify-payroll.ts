/**
 * Development/staging verification for SA payroll calculation engine:
 * versioned tax tables, worker profiles, monthly/weekly calc, traces.
 * No SARS submission/payment, no external salary payment, no production deploy.
 */
import { FinancePayrollCalculationService, InMemoryPayrollStore } from '../../lib/payroll/calculation-service'
import { zaPayrollRuleVersionDraft } from '../../lib/jurisdictions/za/payroll'
import { calculatePayrollPeriod } from '../../lib/payroll/calculation'
import { canonicalDigest, HASH_ALGORITHM_VERSION } from '../../lib/finance/integrity'
import type { FinanceActorContext, FinanceApprovalRecord } from '../../lib/finance/types'

const now = '2026-03-15T12:00:00.000Z'
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

function makeApproval(id: string): FinanceApprovalRecord {
  const base = {
    orgId, legalEntityId: scope.legalEntityId, bookId: scope.bookId, id,
    schemaVersion: 1 as const,
    action: 'payroll.rule.approve' as const,
    status: 'approved' as const,
    approvedBy: 'verify-payroll-approver',
    approverRole: 'payroll_approver' as const,
    approverAssignmentId: 'verify-approver-a0',
    approvedAt: now,
    reason: 'Approve ZA payroll tables',
    subjectDigest: canonicalDigest({ id, action: 'payroll.rule.approve' }),
    immutable: true as const,
    canonicalPayloadVersion: 1 as const,
    hashAlgorithmVersion: HASH_ALGORITHM_VERSION,
  }
  return { ...base, contentHash: canonicalDigest(base) }
}

async function main() {
  const store = new InMemoryPayrollStore()
  const service = new FinancePayrollCalculationService(store, () => now)
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
  service.registerApproval(makeApproval('ap-v'))
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

  const pure = calculatePayrollPeriod(calc.result ? {
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
    standardHoursPerPeriod: term.standardHoursPerPeriod,
    overtimeMultiplierNumerator: term.overtimeMultiplierNumerator,
    overtimeMultiplierDenominator: term.overtimeMultiplierDenominator,
    subjectToUif: term.subjectToUif,
    subjectToSdl: term.subjectToSdl,
    taxResidency: employee.taxResidency,
    ageYears: 41,
    ordinaryHoursWorked: 0,
    overtimeHours: 6,
    components: [
      { componentCode: 'BONUS', kind: 'bonus', quantityMinorUnits: 1, unitAmountMinor: 250_000 },
      { componentCode: 'COMM', kind: 'commission', quantityMinorUnits: 1, unitAmountMinor: 100_000 },
      { componentCode: 'ALLOW', kind: 'allowance', quantityMinorUnits: 1, unitAmountMinor: 75_000 },
      { componentCode: 'BEN', kind: 'benefit', quantityMinorUnits: 1, unitAmountMinor: 50_000 },
      { componentCode: 'DED', kind: 'deduction', quantityMinorUnits: 1, unitAmountMinor: 30_000, taxTreatment: 'post_tax_deduction' },
    ],
    leave: [{ id: 'l1', kind: 'unpaid', hours: 4 }],
  } : null as any, rule)

  if (pure.resultDigest !== calc.result.resultDigest) {
    throw new Error(`result digest mismatch service=${calc.result.resultDigest} pure=${pure.resultDigest}`)
  }
  if (!calc.result.accountantReview.identitiesHold) throw new Error('identity failed')
  if (calc.externalPaymentInitiated !== false) throw new Error('payment initiated')
  if (calc.sarsSubmissionInitiated !== false) throw new Error('sars submit')
  if (store.auditEvents.some((e) => e.externalEgressAllowed !== false)) throw new Error('egress')
  if (calc.result.totals.payeMinor <= 0) throw new Error('expected PAYE')
  if (calc.result.totals.uifEmployeeMinor <= 0) throw new Error('expected UIF')
  if (calc.result.totals.sdlEmployerMinor <= 0) throw new Error('expected SDL')

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
    externalPaymentInitiated: false,
    sarsSubmissionInitiated: false,
    noEgress: store.auditEvents.every((e) => e.externalEgressAllowed === false),
    auditEvents: store.auditEvents.length,
    traceSteps: calc.result.trace.length,
  }))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
