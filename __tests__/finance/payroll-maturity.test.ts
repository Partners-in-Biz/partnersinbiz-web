import {
  approvedLeaveToCalcInputs,
  buildPayslipDownloadPack,
  leaveDurationToHours,
  mergeLeaveInputs,
  projectPayCalendar,
} from '@/lib/payroll/leave'
import { FinancePayrollCalculationService, InMemoryPayrollStore } from '@/lib/payroll/calculation-service'
import { FinancePayRunService } from '@/lib/payroll/pay-run-service'
import { FinancePayrollLeaveService } from '@/lib/payroll/leave-service'
import { zaPayrollRuleVersionDraft } from '@/lib/jurisdictions/za/payroll'
import { canonicalDigest, HASH_ALGORITHM_VERSION } from '@/lib/finance/integrity'
import type { FinanceActorContext, FinanceApprovalRecord } from '@/lib/finance/types'
import { FinanceNotFoundError } from '@/lib/finance/errors'
import type { Payslip } from '@/lib/payroll/types'

const orgId = 'org-maturity'
const scope = { orgId, legalEntityId: 'entity-a', bookId: 'book-a' }
const request = (key: string) => ({ requestId: `req-${key}`, idempotencyKey: `idem-${key}` })

function actorFor(uid: string, role: FinanceActorContext['assignments'][number]['role']): FinanceActorContext {
  return {
    uid, orgId, membershipRole: 'owner', membershipActive: true, financeModuleEnabled: true,
    assignments: [{ id: `${uid}-a0`, orgId, userId: uid, legalEntityId: scope.legalEntityId, scopeMode: 'entity', role, status: 'active' }],
  }
}

const clerk = actorFor('clerk-1', 'payroll_clerk')
const approver = actorFor('approver-1', 'payroll_approver')
const employeeUser = actorFor('emp-user-1', 'finance_viewer')
const stranger = actorFor('stranger', 'finance_viewer')

function approval(id: string, action: FinanceApprovalRecord['action']): FinanceApprovalRecord {
  const base = {
    orgId, legalEntityId: scope.legalEntityId, bookId: scope.bookId, id, schemaVersion: 1 as const, action,
    status: 'approved' as const, approvedBy: 'external-approver', approverRole: 'payroll_approver' as const,
    approverAssignmentId: 'external-a0', approvedAt: '2026-08-01T10:00:00.000Z', reason: `Approve ${action}`,
    subjectDigest: canonicalDigest({ id, action }), immutable: true as const, canonicalPayloadVersion: 1 as const,
    hashAlgorithmVersion: HASH_ALGORITHM_VERSION,
  }
  return { ...base, contentHash: canonicalDigest(base) }
}

describe('payroll leave pure helpers', () => {
  test('converts days to hours and projects cut-off calendar', () => {
    expect(leaveDurationToHours({ unit: 'days', quantity: 2.5, hoursPerDay: 8 })).toBe(20)
    const view = projectPayCalendar({
      calendars: [{
        id: 'cal-1', orgId, legalEntityId: scope.legalEntityId, bookId: scope.bookId, schemaVersion: 1, version: 1,
        createdAt: '', createdBy: '', updatedAt: '', updatedBy: '', code: 'M', name: 'Monthly', frequency: 'monthly', status: 'active',
      }],
      periods: [{
        id: 'p1', orgId, legalEntityId: scope.legalEntityId, bookId: scope.bookId, schemaVersion: 1, version: 1,
        createdAt: '', createdBy: '', updatedAt: '', updatedBy: '', calendarId: 'cal-1', frequency: 'monthly', label: 'Aug',
        periodStart: '2026-08-01', periodEnd: '2026-08-31', cutOffAt: '2026-08-20T12:00:00.000Z', payDate: '2026-08-25',
        taxYearLabel: '2025/26', status: 'open',
      }],
      nowIso: '2026-08-18T00:00:00.000Z',
    })
    expect(view[0].cutoffStatus).toBe('open_for_input')
    expect(view[0].hoursUntilCutoff).toBeGreaterThan(0)
  })

  test('approved unpaid leave merges into calc when explicit leave omitted', () => {
    const fromApproved = approvedLeaveToCalcInputs([
      { id: 'lv1', status: 'approved', payEffect: 'unpaid', startDate: '2026-08-10', endDate: '2026-08-11', hours: 16 },
    ], '2026-08-01', '2026-08-31')
    expect(fromApproved).toEqual([{ id: 'lv1', kind: 'unpaid', hours: 16 }])
    expect(mergeLeaveInputs(undefined, fromApproved)).toEqual(fromApproved)
    expect(mergeLeaveInputs([{ id: 'x', kind: 'paid', hours: 8 }], fromApproved)[0].id).toBe('x')
  })

  test('payslip pack is download-only with no egress flags', () => {
    const payslip = {
      id: 'ps1', orgId, legalEntityId: scope.legalEntityId, bookId: scope.bookId, payRunId: 'run1', payRunItemId: 'item1',
      employeeId: 'emp1', employmentId: 'empl1', payPeriodId: 'per1', payDate: '2026-08-25', periodStart: '2026-08-01',
      periodEnd: '2026-08-31', status: 'generated', publicationStatus: 'internal_only', accessVersion: 1, generationChecksum: 'abc',
      rendered: {
        employeeDisplayName: 'Ada', employeeNumber: 'E1', currency: 'ZAR',
        lines: [{ lineId: 'l1', componentCode: 'BASE', kind: 'base_salary', description: 'Salary', quantity: 1, unitAmountMinor: 100000, amountMinor: 100000, taxTreatment: 'taxable', uifTreatment: 'include', sdlTreatment: 'include' }],
        totals: {
          ordinaryMinor: 100000, overtimeMinor: 0, leavePaidMinor: 0, leaveUnpaidReductionMinor: 0, bonusMinor: 0, commissionMinor: 0,
          allowancesMinor: 0, benefitsMinor: 0, grossEarningsMinor: 100000, taxableEarningsMinor: 100000, preTaxDeductionsMinor: 0,
          postTaxDeductionsMinor: 0, payeMinor: 10000, uifEmployeeMinor: 1000, uifEmployerMinor: 1000, sdlEmployerMinor: 1000,
          netPayMinor: 89000, employerCostMinor: 102000,
        },
        netPayMinor: 89000,
      },
      immutable: true, contentHash: 'x', externalPaymentInitiated: false, sarsSubmissionInitiated: false, autoSent: false,
      schemaVersion: 1, version: 1, createdAt: '', createdBy: '', updatedAt: '', updatedBy: '',
    } as unknown as Payslip
    const pack = buildPayslipDownloadPack(payslip)
    expect(pack.externalEgressAllowed).toBe(false)
    expect(pack.autoSent).toBe(false)
    expect(pack.sarsSubmissionInitiated).toBe(false)
    expect(pack.files.length).toBe(3)
    expect(pack.files[0].content).toContain('download only')
  })
})

describe('payroll maturity service integration', () => {
  test('leave affects calc; ESS sees own payslip only; pack download only', async () => {
    let now = '2026-08-15T10:00:00.000Z'
    const store = new InMemoryPayrollStore()
    const calc = new FinancePayrollCalculationService(store, () => now)
    const leave = new FinancePayrollLeaveService(store, () => now)
    const runs = new FinancePayRunService(store, () => now)

    const employee = await calc.createEmployee(clerk, {
      id: 'emp-1', ...scope, employeeNumber: 'E1', displayName: 'Ada Lovelace', taxResidency: 'za_resident',
      dateOfBirth: '1990-01-01', startDate: '2025-01-01', linkedUserId: 'emp-user-1', expectedVersion: 0, ...request('emp'),
    })
    const employment = await calc.createEmployment(clerk, { id: 'empl-1', ...scope, employeeId: employee.id, expectedVersion: 0, ...request('empl') })
    const term = await calc.createTermVersion(clerk, {
      id: 'term-1', ...scope, employeeId: employee.id, employmentId: employment.id, versionNumber: 1, workerCategory: 'salaried',
      frequency: 'monthly', rateMinor: 4_000_000, standardHoursPerPeriod: 160, overtimeMultiplierNumerator: 150, overtimeMultiplierDenominator: 100,
      subjectToUif: true, subjectToSdl: true, effectiveFrom: '2025-03-01', expectedVersion: 0, ...request('term'),
    })
    const draft = await calc.createRuleVersion(clerk, {
      ...zaPayrollRuleVersionDraft({ id: 'rule-1', orgId, legalEntityId: scope.legalEntityId, bookId: scope.bookId, versionNumber: 1 }),
      ...scope, expectedVersion: 0, ...request('rule'),
    })
    calc.registerApproval(approval('ap-rule', 'payroll.rule.approve'))
    const rule = await calc.approveRuleVersion(approver, {
      ...scope, ruleVersionId: draft.id, expectedVersion: draft.version, approvalId: 'ap-rule', reason: 'tables', ...request('rule-ap'),
    })
    const calendar = await calc.createCalendar(clerk, {
      id: 'cal-1', ...scope, code: 'M', name: 'Monthly', frequency: 'monthly', expectedVersion: 0, ...request('cal'),
    })
    const period = await calc.createPayPeriod(clerk, {
      id: 'per-1', ...scope, calendarId: calendar.id, label: '2026-08', periodStart: '2026-08-01', periodEnd: '2026-08-31',
      payDate: '2026-08-25', cutOffAt: '2026-08-20T12:00:00.000Z', taxYearLabel: '2025/26', expectedVersion: 0, ...request('per'),
    })

    const leaveType = await leave.createLeaveType(clerk, {
      id: 'lt-unpaid', ...scope, code: 'UNPAID', name: 'Unpaid leave', unit: 'hours', payEffect: 'unpaid', hoursPerDay: 8,
      accrues: false, expectedVersion: 0, ...request('lt'),
    })
    await leave.setLeaveBalance(clerk, {
      id: 'lb-1', ...scope, employeeId: employee.id, leaveTypeId: leaveType.id, balanceQuantity: 40, asOfDate: '2026-08-01',
      expectedVersion: 0, ...request('lb'),
    })
    const leaveRec = await leave.requestLeave(clerk, {
      id: 'lv-1', ...scope, employeeId: employee.id, leaveTypeId: leaveType.id, startDate: '2026-08-10', endDate: '2026-08-10',
      unit: 'hours', quantity: 8, expectedVersion: 0, ...request('lv'),
    })
    expect(leaveRec.status).toBe('approved')

    const baseline = await calc.calculateEmployee(clerk, {
      id: 'calc-base', ...scope, employeeId: employee.id, employmentId: employment.id, termVersionId: term.id,
      payPeriodId: period.id, ruleVersionId: rule.id, expectedVersion: 0, ...request('calc-base'),
    })
    expect(baseline.result.totals.leaveUnpaidReductionMinor).toBeGreaterThan(0)

    now = '2026-08-21T10:00:00.000Z'
    let run = await runs.createPayRun(clerk, {
      id: 'run-1', ...scope, calendarId: calendar.id, payPeriodId: period.id, ruleVersionId: rule.id, label: 'Aug 2026',
      expectedVersion: 0, ...request('run'),
    })
    run = await runs.addItem(clerk, { id: 'item-1', ...scope, payRunId: run.id, calculationId: baseline.id, expectedVersion: run.version, ...request('item') })
    run = await runs.freezeInputs(clerk, { ...scope, payRunId: run.id, expectedVersion: run.version, ...request('freeze') })
    run = await runs.submitForReview(clerk, { ...scope, payRunId: run.id, expectedVersion: run.version, ...request('submit') })
    runs.registerApproval(approval('ap-run', 'payroll.run.approve'))
    const locked = await runs.approveAndLock(approver, {
      ...scope, payRunId: run.id, expectedVersion: run.version, approvalId: 'ap-run', reason: 'ok', ...request('lock'),
    })
    expect(locked.status).toBe('approved_locked')
    const payslipId = locked.payslipIds[0]
    expect(payslipId).toBeTruthy()

    const own = leave.listMyPayslips(employeeUser, scope)
    expect(own.map((p) => p.id)).toContain(payslipId)
    expect(leave.listMyPayslips(stranger, scope)).toEqual([])
    expect(runs.getPayslip(employeeUser, scope, payslipId).id).toBe(payslipId)
    expect(() => runs.getPayslip(stranger, scope, payslipId)).toThrow(FinanceNotFoundError)

    const pack = await leave.buildPayslipPack(employeeUser, { id: 'pack-1', ...scope, payslipId, expectedVersion: 0, ...request('pack') })
    expect(pack.externalEgressAllowed).toBe(false)
    expect(pack.autoSent).toBe(false)
    expect(pack.sarsSubmissionInitiated).toBe(false)
    expect(pack.files.length).toBeGreaterThanOrEqual(2)
    const downloaded = await leave.markPayslipPackDownloaded(employeeUser, scope, pack.id, request('pack-dl'))
    expect(downloaded.status).toBe('downloaded')
    expect(['past_cutoff', 'locked']).toContain(leave.listLeaveBundle(scope).calendarProjection[0].cutoffStatus)
  })
})
