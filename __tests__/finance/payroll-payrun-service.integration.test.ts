import { FinancePayrollCalculationService, InMemoryPayrollStore } from '@/lib/payroll/calculation-service'
import { FinancePayRunService } from '@/lib/payroll/pay-run-service'
import { zaPayrollRuleVersionDraft } from '@/lib/jurisdictions/za/payroll'
import { canonicalDigest, HASH_ALGORITHM_VERSION } from '@/lib/finance/integrity'
import type { FinanceActorContext, FinanceApprovalRecord } from '@/lib/finance/types'

const orgId = 'org-payrun'
const scope = { orgId, legalEntityId: 'entity-a', bookId: 'book-a' }
const request = (key: string) => ({ requestId: `req-${key}`, idempotencyKey: `idem-${key}` })

function actorFor(uid: string, role: FinanceActorContext['assignments'][number]['role']): FinanceActorContext {
  return {
    uid,
    orgId,
    membershipRole: 'owner',
    membershipActive: true,
    financeModuleEnabled: true,
    assignments: [{
      id: `${uid}-a0`,
      orgId,
      userId: uid,
      legalEntityId: scope.legalEntityId,
      scopeMode: 'entity',
      role,
      status: 'active',
    }],
  }
}

const clerk = actorFor('clerk-1', 'payroll_clerk')
const approver = actorFor('approver-1', 'payroll_approver')

function approval(id: string, action: FinanceApprovalRecord['action'], approvedBy = 'external-approver'): FinanceApprovalRecord {
  const base = {
    orgId,
    legalEntityId: scope.legalEntityId,
    bookId: scope.bookId,
    id,
    schemaVersion: 1 as const,
    action,
    status: 'approved' as const,
    approvedBy,
    approverRole: 'payroll_approver' as const,
    approverAssignmentId: 'external-a0',
    approvedAt: '2026-03-21T10:00:00.000Z',
    reason: `Approve ${action}`,
    subjectDigest: canonicalDigest({ id, action }),
    immutable: true as const,
    canonicalPayloadVersion: 1 as const,
    hashAlgorithmVersion: HASH_ALGORITHM_VERSION,
  }
  return { ...base, contentHash: canonicalDigest(base) }
}

async function seedCalc(store: InMemoryPayrollStore, now: string) {
  const calcService = new FinancePayrollCalculationService(store, () => now)
  const employee = await calcService.createEmployee(clerk, {
    id: 'emp-1', ...scope, employeeNumber: 'E1', displayName: 'Ada Lovelace',
    taxResidency: 'za_resident', dateOfBirth: '1990-01-01', startDate: '2025-01-01',
    expectedVersion: 0, ...request('emp'),
  })
  const employment = await calcService.createEmployment(clerk, {
    id: 'empl-1', ...scope, employeeId: employee.id, expectedVersion: 0, ...request('empl'),
  })
  const term = await calcService.createTermVersion(clerk, {
    id: 'term-1', ...scope, employeeId: employee.id, employmentId: employment.id,
    versionNumber: 1, workerCategory: 'salaried', frequency: 'monthly',
    rateMinor: 3_000_000, standardHoursPerPeriod: 160,
    overtimeMultiplierNumerator: 150, overtimeMultiplierDenominator: 100,
    subjectToUif: true, subjectToSdl: true, effectiveFrom: '2025-03-01',
    expectedVersion: 0, ...request('term'),
  })
  await calcService.createPayComponent(clerk, {
    id: 'cmp-bonus', ...scope, code: 'BONUS', name: 'Bonus', kind: 'bonus',
    taxTreatment: 'taxable', uifTreatment: 'include', sdlTreatment: 'include',
    jurisdictionCode: 'ZA', expectedVersion: 0, ...request('cmp'),
  })
  const draft = await calcService.createRuleVersion(clerk, {
    ...zaPayrollRuleVersionDraft({
      id: 'rule-1', orgId, legalEntityId: scope.legalEntityId, bookId: scope.bookId, versionNumber: 1,
    }),
    ...scope, expectedVersion: 0, ...request('rule'),
  })
  calcService.registerApproval(approval('ap-rule', 'payroll.rule.approve'))
  const rule = await calcService.approveRuleVersion(approver, {
    ...scope, ruleVersionId: draft.id, expectedVersion: draft.version,
    approvalId: 'ap-rule', reason: 'tables', ...request('rule-ap'),
  })
  const calendar = await calcService.createCalendar(clerk, {
    id: 'cal-1', ...scope, code: 'M', name: 'Monthly', frequency: 'monthly',
    expectedVersion: 0, ...request('cal'),
  })
  const period = await calcService.createPayPeriod(clerk, {
    id: 'per-1', ...scope, calendarId: calendar.id, label: '2026-03',
    periodStart: '2026-03-01', periodEnd: '2026-03-31', payDate: '2026-03-25',
    cutOffAt: '2026-03-20T12:00:00.000Z',
    taxYearLabel: '2025/26', expectedVersion: 0, ...request('per'),
  })
  const calculation = await calcService.calculateEmployee(clerk, {
    id: 'calc-1', ...scope,
    employeeId: employee.id, employmentId: employment.id, termVersionId: term.id,
    payPeriodId: period.id, ruleVersionId: rule.id,
    components: [{ componentCode: 'BONUS', quantityMinorUnits: 1, unitAmountMinor: 100_000 }],
    expectedVersion: 0, ...request('calc'),
  })
  return { calcService, employee, employment, term, rule, calendar, period, calculation }
}

describe('payroll pay-run service integration', () => {
  test('cut-off freeze, review, SOD approve/lock, payslips, history, payment observation', async () => {
    let now = '2026-03-19T10:00:00.000Z'
    const store = new InMemoryPayrollStore()
    const seeded = await seedCalc(store, now)
    const service = new FinancePayRunService(store, () => now)

    const run = await service.createPayRun(clerk, {
      id: 'run-1', ...scope, calendarId: seeded.calendar.id, payPeriodId: seeded.period.id,
      ruleVersionId: seeded.rule.id, label: 'March 2026', expectedVersion: 0, ...request('run'),
    })
    expect(run.status).toBe('draft')
    expect(run.inputCutoffAt).toBe('2026-03-20T12:00:00.000Z')

    let withItem = await service.addItem(clerk, {
      id: 'item-1', ...scope, payRunId: run.id, calculationId: seeded.calculation.id,
      expectedVersion: run.version, ...request('item'),
    })
    expect(withItem.status).toBe('calculated')
    expect(withItem.totals.netPayMinor).toBe(seeded.calculation.result.totals.netPayMinor)

    await expect(service.freezeInputs(clerk, {
      ...scope, payRunId: withItem.id, expectedVersion: withItem.version, ...request('freeze-early'),
    })).rejects.toThrow(/cut-off/)

    now = '2026-03-21T09:00:00.000Z'
    withItem = await service.freezeInputs(clerk, {
      ...scope, payRunId: withItem.id, expectedVersion: withItem.version, ...request('freeze'),
    })
    expect(withItem.inputsFrozen).toBe(true)

    await expect(service.addItem(clerk, {
      id: 'item-2', ...scope, payRunId: withItem.id, calculationId: seeded.calculation.id,
      expectedVersion: withItem.version, ...request('item2'),
    })).rejects.toThrow(/frozen/)

    const submitted = await service.submitForReview(clerk, {
      ...scope, payRunId: withItem.id, expectedVersion: withItem.version, ...request('submit'),
    })
    expect(submitted.status).toBe('in_review')
    expect(submitted.submittedBy).toBe('clerk-1')

    await expect(service.approveAndLock(clerk, {
      ...scope, payRunId: submitted.id, expectedVersion: submitted.version,
      approvalId: 'ap-run', reason: 'nope', ...request('self-ap'),
    })).rejects.toThrow()

    service.registerApproval(approval('ap-run', 'payroll.run.approve'))
    const locked = await service.approveAndLock(approver, {
      ...scope, payRunId: submitted.id, expectedVersion: submitted.version,
      approvalId: 'ap-run', reason: 'Approved March payroll', ...request('approve'),
    })
    expect(locked.status).toBe('approved_locked')
    expect(locked.immutable).toBe(true)
    expect(locked.lockHash).toHaveLength(64)
    expect(locked.payslipIds).toHaveLength(1)
    expect(locked.externalPaymentInitiated).toBe(false)
    expect(locked.sarsSubmissionInitiated).toBe(false)

    const payslip = service.getPayslip(clerk, scope, locked.payslipIds[0])
    expect(payslip.publicationStatus).toBe('internal_only')
    expect(payslip.autoSent).toBe(false)
    expect(payslip.rendered.netPayMinor).toBe(locked.totals.netPayMinor)
    expect(payslip.immutable).toBe(true)

    const period = store.periods.get(seeded.period.id)!
    expect(period.status).toBe('locked')

    await expect(service.addItem(clerk, {
      id: 'item-x', ...scope, payRunId: locked.id, calculationId: seeded.calculation.id,
      expectedVersion: locked.version, ...request('item-x'),
    })).rejects.toThrow(/locked/)

    const observed = await service.observeExternalSalaryPayment(clerk, {
      id: 'obs-1', ...scope, payRunId: locked.id, amountMinor: locked.totals.netPayMinor,
      reference: 'BANK-REF-1', expectedVersion: locked.version, ...request('obs'),
    })
    expect(observed.externalSalaryPaymentObservations).toHaveLength(1)
    expect(observed.externalSalaryPaymentObservations[0].externalPaymentInitiated).toBe(false)
    expect(observed.externalPaymentInitiated).toBe(false)

    const history = service.listPayRunHistory(scope, seeded.period.id)
    expect(history.some((row) => row.payRunId === locked.id && row.status === 'approved_locked')).toBe(true)
    expect(store.auditEvents.some((e) => e.eventType === 'payroll.run.approved_locked')).toBe(true)
    expect(store.auditEvents.every((e) => e.externalEgressAllowed === false)).toBe(true)
  })

  test('full reversal preserves original lock hash and creates opposite run', async () => {
    let now = '2026-03-21T09:00:00.000Z'
    const store = new InMemoryPayrollStore()
    const seeded = await seedCalc(store, '2026-03-19T10:00:00.000Z')
    const service = new FinancePayRunService(store, () => now)

    let run = await service.createPayRun(clerk, {
      id: 'run-r', ...scope, calendarId: seeded.calendar.id, payPeriodId: seeded.period.id,
      ruleVersionId: seeded.rule.id, label: 'March', expectedVersion: 0, ...request('run-r'),
    })
    run = await service.addItem(clerk, {
      id: 'item-r', ...scope, payRunId: run.id, calculationId: seeded.calculation.id,
      expectedVersion: run.version, ...request('item-r'),
    })
    run = await service.freezeInputs(clerk, {
      ...scope, payRunId: run.id, expectedVersion: run.version, ...request('freeze-r'),
    })
    run = await service.submitForReview(clerk, {
      ...scope, payRunId: run.id, expectedVersion: run.version, ...request('submit-r'),
    })
    service.registerApproval(approval('ap-run-r', 'payroll.run.approve'))
    const locked = await service.approveAndLock(approver, {
      ...scope, payRunId: run.id, expectedVersion: run.version,
      approvalId: 'ap-run-r', reason: 'lock', ...request('approve-r'),
    })
    const originalLockHash = locked.lockHash!
    const originalNet = locked.totals.netPayMinor

    service.registerApproval(approval('ap-rev', 'payroll.run.reverse'))
    const reversal = await service.reversePayRun(approver, {
      id: 'run-rev', ...scope, originalPayRunId: locked.id, expectedVersion: locked.version,
      approvalId: 'ap-rev', reason: 'Full reverse March', ...request('rev'),
    })
    expect(reversal.kind).toBe('full_reversal')
    expect(reversal.status).toBe('approved_locked')
    expect(reversal.originalPayRunId).toBe(locked.id)
    expect(reversal.totals.netPayMinor).toBe(-originalNet)
    expect(reversal.externalPaymentInitiated).toBe(false)

    const original = store.payRuns.get(locked.id)!
    expect(original.status).toBe('reversed')
    expect(original.lockHash).toBe(originalLockHash)
    expect(original.totals.netPayMinor).toBe(originalNet)
    expect(original.reversalPayRunId).toBe(reversal.id)
    expect(original.immutable).toBe(true)
  })

  test('correction run supports back-pay, recovery, and amended tax/deduction deltas', async () => {
    let now = '2026-03-21T09:00:00.000Z'
    const store = new InMemoryPayrollStore()
    const seeded = await seedCalc(store, '2026-03-19T10:00:00.000Z')
    const service = new FinancePayRunService(store, () => now)

    let run = await service.createPayRun(clerk, {
      id: 'run-c', ...scope, calendarId: seeded.calendar.id, payPeriodId: seeded.period.id,
      ruleVersionId: seeded.rule.id, label: 'March', expectedVersion: 0, ...request('run-c'),
    })
    run = await service.addItem(clerk, {
      id: 'item-c', ...scope, payRunId: run.id, calculationId: seeded.calculation.id,
      expectedVersion: run.version, ...request('item-c'),
    })
    run = await service.freezeInputs(clerk, {
      ...scope, payRunId: run.id, expectedVersion: run.version, ...request('freeze-c'),
    })
    run = await service.submitForReview(clerk, {
      ...scope, payRunId: run.id, expectedVersion: run.version, ...request('submit-c'),
    })
    service.registerApproval(approval('ap-run-c', 'payroll.run.approve'))
    const locked = await service.approveAndLock(approver, {
      ...scope, payRunId: run.id, expectedVersion: run.version,
      approvalId: 'ap-run-c', reason: 'lock', ...request('approve-c'),
    })
    const originalItemId = locked.itemIds[0]

    let correction = await service.createCorrectionRun(clerk, {
      id: 'run-corr', ...scope, originalPayRunId: locked.id, kind: 'back_pay',
      label: 'March back-pay', expectedVersion: 0, ...request('corr'),
    })
    expect(correction.status).toBe('correction')
    expect(correction.originalPayRunId).toBe(locked.id)

    correction = await service.applyIndividualAdjustment(clerk, {
      id: 'adj-back', ...scope, payRunId: correction.id, originalPayRunId: locked.id,
      originalItemId, employeeId: seeded.employee.id, employmentId: seeded.employment.id,
      kind: 'back_pay',
      deltaComponents: [
        { componentCode: 'BACKPAY', kind: 'bonus', quantityMinorUnits: 1, unitAmountMinor: 50_000, taxTreatment: 'taxable' },
        { componentCode: 'PAYE_ADJ', kind: 'statutory_paye', quantityMinorUnits: 1, unitAmountMinor: 9_000, taxTreatment: 'post_tax_deduction' },
      ],
      reason: 'Missed bonus back-pay with amended PAYE',
      expectedVersion: correction.version, ...request('adj-back'),
    })
    expect(correction.itemIds).toHaveLength(1)
    expect(correction.totals.grossEarningsMinor).toBe(50_000)
    expect(correction.totals.payeMinor).toBe(9_000)

    let recovery = await service.createCorrectionRun(clerk, {
      id: 'run-rec', ...scope, originalPayRunId: locked.id, kind: 'overpayment_recovery',
      label: 'Recovery', expectedVersion: 0, ...request('rec'),
    })
    recovery = await service.applyIndividualAdjustment(clerk, {
      id: 'adj-rec', ...scope, payRunId: recovery.id, originalPayRunId: locked.id,
      originalItemId, employeeId: seeded.employee.id, employmentId: seeded.employment.id,
      kind: 'overpayment_recovery',
      deltaComponents: [
        { componentCode: 'RECOVER', kind: 'deduction', quantityMinorUnits: 1, unitAmountMinor: 25_000, taxTreatment: 'post_tax_deduction' },
      ],
      reason: 'Recover overpayment',
      expectedVersion: recovery.version, ...request('adj-rec'),
    })
    expect(recovery.totals.postTaxDeductionsMinor).toBe(25_000)
    expect(recovery.totals.netPayMinor).toBe(-25_000)

    now = '2026-03-22T09:00:00.000Z'
    correction = await service.freezeInputs(clerk, {
      ...scope, payRunId: correction.id, expectedVersion: correction.version, ...request('freeze-corr'),
    })
    correction = await service.submitForReview(clerk, {
      ...scope, payRunId: correction.id, expectedVersion: correction.version, ...request('submit-corr'),
    })
    service.registerApproval(approval('ap-corr', 'payroll.run.approve'))
    const lockedCorr = await service.approveAndLock(approver, {
      ...scope, payRunId: correction.id, expectedVersion: correction.version,
      approvalId: 'ap-corr', reason: 'Approve back-pay', ...request('approve-corr'),
    })
    expect(lockedCorr.status).toBe('approved_locked')
    expect(lockedCorr.payslipIds).toHaveLength(1)
    expect(store.payRuns.get(locked.id)!.status).toBe('approved_locked')
    expect(store.payRuns.get(locked.id)!.lockHash).toBe(locked.lockHash)
  })
})
