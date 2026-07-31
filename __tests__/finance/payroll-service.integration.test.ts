import { FinancePayrollCalculationService, InMemoryPayrollStore } from '@/lib/payroll/calculation-service'
import { zaPayrollRuleVersionDraft } from '@/lib/jurisdictions/za/payroll'
import { canonicalDigest, HASH_ALGORITHM_VERSION } from '@/lib/finance/integrity'
import type { FinanceActorContext, FinanceApprovalRecord } from '@/lib/finance/types'

const now = '2026-03-15T10:00:00.000Z'
const orgId = 'org-payroll'
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
const admin = actorFor('admin-1', 'finance_admin')

function makeApproval(id: string): FinanceApprovalRecord {
  const base = {
    orgId,
    legalEntityId: scope.legalEntityId,
    bookId: scope.bookId,
    id,
    schemaVersion: 1 as const,
    action: 'payroll.rule.approve' as const,
    status: 'approved' as const,
    approvedBy: 'external-approver',
    approverRole: 'payroll_approver' as const,
    approverAssignmentId: 'external-a0',
    approvedAt: now,
    reason: 'Approve ZA tables',
    subjectDigest: canonicalDigest({ id, action: 'payroll.rule.approve' }),
    immutable: true as const,
    canonicalPayloadVersion: 1 as const,
    hashAlgorithmVersion: HASH_ALGORITHM_VERSION,
  }
  return { ...base, contentHash: canonicalDigest(base) }
}

describe('payroll calculation service integration', () => {
  test('configures worker profiles, approves ZA tax tables, calculates monthly and weekly runs', async () => {
    const store = new InMemoryPayrollStore()
    const service = new FinancePayrollCalculationService(store, () => now)

    const employeeMonthly = await service.createEmployee(clerk, {
      id: 'emp-m', ...scope, employeeNumber: 'E001', displayName: 'Monthly Salaried',
      taxResidency: 'za_resident', dateOfBirth: '1990-05-10', startDate: '2025-01-01',
      expectedVersion: 0, ...request('emp-m'),
    })
    const employmentM = await service.createEmployment(clerk, {
      id: 'empl-m', ...scope, employeeId: employeeMonthly.id, expectedVersion: 0, ...request('empl-m'),
    })
    const termM = await service.createTermVersion(clerk, {
      id: 'term-m', ...scope, employeeId: employeeMonthly.id, employmentId: employmentM.id,
      versionNumber: 1, workerCategory: 'salaried', frequency: 'monthly',
      rateMinor: 3_000_000, standardHoursPerPeriod: 160,
      overtimeMultiplierNumerator: 150, overtimeMultiplierDenominator: 100,
      subjectToUif: true, subjectToSdl: true, effectiveFrom: '2025-03-01',
      expectedVersion: 0, ...request('term-m'),
    })

    const employeeWeekly = await service.createEmployee(clerk, {
      id: 'emp-w', ...scope, employeeNumber: 'E002', displayName: 'Weekly Hourly',
      taxResidency: 'za_resident', startDate: '2025-06-01',
      expectedVersion: 0, ...request('emp-w'),
    })
    const employmentW = await service.createEmployment(clerk, {
      id: 'empl-w', ...scope, employeeId: employeeWeekly.id, expectedVersion: 0, ...request('empl-w'),
    })
    const termW = await service.createTermVersion(clerk, {
      id: 'term-w', ...scope, employeeId: employeeWeekly.id, employmentId: employmentW.id,
      versionNumber: 1, workerCategory: 'hourly', frequency: 'weekly',
      rateMinor: 20_000, standardHoursPerPeriod: 40,
      overtimeMultiplierNumerator: 150, overtimeMultiplierDenominator: 100,
      subjectToUif: true, subjectToSdl: true, effectiveFrom: '2025-03-01',
      expectedVersion: 0, ...request('term-w'),
    })

    await service.createPayComponent(clerk, {
      id: 'cmp-bonus', ...scope, code: 'BONUS', name: 'Performance bonus', kind: 'bonus',
      taxTreatment: 'taxable', uifTreatment: 'include', sdlTreatment: 'include',
      jurisdictionCode: 'ZA', expectedVersion: 0, ...request('cmp-bonus'),
    })
    await service.createPayComponent(clerk, {
      id: 'cmp-allow', ...scope, code: 'TRAVEL', name: 'Travel allowance', kind: 'allowance',
      taxTreatment: 'taxable', uifTreatment: 'include', sdlTreatment: 'include',
      jurisdictionCode: 'ZA', expectedVersion: 0, ...request('cmp-allow'),
    })
    await service.createPayComponent(clerk, {
      id: 'cmp-ded', ...scope, code: 'PENSION', name: 'Pension', kind: 'deduction',
      taxTreatment: 'pre_tax_deduction', uifTreatment: 'exclude', sdlTreatment: 'exclude',
      jurisdictionCode: 'ZA', expectedVersion: 0, ...request('cmp-ded'),
    })

    const draftBody = zaPayrollRuleVersionDraft({
      id: 'rule-1', orgId, legalEntityId: scope.legalEntityId, bookId: scope.bookId, versionNumber: 1,
    })
    const draft = await service.createRuleVersion(clerk, {
      ...draftBody, ...scope, expectedVersion: 0, ...request('rule'),
    })
    expect(draft.status).toBe('draft')
    service.registerApproval(makeApproval('ap-rule-1'))
    const approved = await service.approveRuleVersion(approver, {
      ...scope, ruleVersionId: draft.id, expectedVersion: draft.version,
      approvalId: 'ap-rule-1', reason: 'Lock ZA 2025/26 tables', ...request('rule-ap'),
    })
    expect(approved.status).toBe('approved')
    expect(approved.immutable).toBe(true)

    const calM = await service.createCalendar(clerk, {
      id: 'cal-m', ...scope, code: 'MTH', name: 'Monthly', frequency: 'monthly',
      expectedVersion: 0, ...request('cal-m'),
    })
    const periodM = await service.createPayPeriod(clerk, {
      id: 'per-m', ...scope, calendarId: calM.id, label: '2026-03',
      periodStart: '2026-03-01', periodEnd: '2026-03-31', payDate: '2026-03-25',
      taxYearLabel: '2025/26', expectedVersion: 0, ...request('per-m'),
    })
    const calW = await service.createCalendar(clerk, {
      id: 'cal-w', ...scope, code: 'WK', name: 'Weekly', frequency: 'weekly',
      expectedVersion: 0, ...request('cal-w'),
    })
    const periodW = await service.createPayPeriod(clerk, {
      id: 'per-w', ...scope, calendarId: calW.id, label: '2026-W10',
      periodStart: '2026-03-02', periodEnd: '2026-03-08', payDate: '2026-03-06',
      taxYearLabel: '2025/26', expectedVersion: 0, ...request('per-w'),
    })

    const monthlyCalc = await service.calculateEmployee(clerk, {
      id: 'calc-m', ...scope,
      employeeId: employeeMonthly.id, employmentId: employmentM.id, termVersionId: termM.id,
      payPeriodId: periodM.id, ruleVersionId: approved.id,
      overtimeHours: 5,
      leave: [{ id: 'u1', kind: 'unpaid', hours: 8 }],
      components: [
        { componentCode: 'BONUS', quantityMinorUnits: 1, unitAmountMinor: 100_000 },
        { componentCode: 'TRAVEL', quantityMinorUnits: 1, unitAmountMinor: 50_000 },
        { componentCode: 'PENSION', quantityMinorUnits: 1, unitAmountMinor: 150_000 },
      ],
      expectedVersion: 0, ...request('calc-m'),
    })
    expect(monthlyCalc.result.totals.netPayMinor).toBeGreaterThan(0)
    expect(monthlyCalc.result.totals.payeMinor).toBeGreaterThan(0)
    expect(monthlyCalc.result.trace.some((s) => s.code === 'paye')).toBe(true)
    expect(monthlyCalc.externalPaymentInitiated).toBe(false)
    expect(monthlyCalc.sarsSubmissionInitiated).toBe(false)
    expect(monthlyCalc.result.accountantReview.identitiesHold).toBe(true)

    const weeklyCalc = await service.calculateEmployee(clerk, {
      id: 'calc-w', ...scope,
      employeeId: employeeWeekly.id, employmentId: employmentW.id, termVersionId: termW.id,
      payPeriodId: periodW.id, ruleVersionId: approved.id,
      ordinaryHoursWorked: 36, overtimeHours: 4,
      leave: [{ id: 'p1', kind: 'paid', hours: 4 }],
      expectedVersion: 0, ...request('calc-w'),
    })
    expect(weeklyCalc.result.frequency).toBe('weekly')
    expect(weeklyCalc.result.periodsPerYear).toBe(52)
    expect(weeklyCalc.result.totals.leavePaidMinor).toBeGreaterThan(0)

    // idempotent retry
    const retry = await service.calculateEmployee(clerk, {
      id: 'calc-m', ...scope,
      employeeId: employeeMonthly.id, employmentId: employmentM.id, termVersionId: termM.id,
      payPeriodId: periodM.id, ruleVersionId: approved.id,
      overtimeHours: 5,
      leave: [{ id: 'u1', kind: 'unpaid', hours: 8 }],
      components: [
        { componentCode: 'BONUS', quantityMinorUnits: 1, unitAmountMinor: 100_000 },
        { componentCode: 'TRAVEL', quantityMinorUnits: 1, unitAmountMinor: 50_000 },
        { componentCode: 'PENSION', quantityMinorUnits: 1, unitAmountMinor: 150_000 },
      ],
      expectedVersion: 0, ...request('calc-m'),
    })
    expect(retry.id).toBe(monthlyCalc.id)
    expect(retry.result.resultDigest).toBe(monthlyCalc.result.resultDigest)

    // SOD: approver cannot self-approve
    const draft2 = await service.createRuleVersion(admin, {
      ...zaPayrollRuleVersionDraft({
        id: 'rule-2', orgId, legalEntityId: scope.legalEntityId, bookId: scope.bookId, versionNumber: 2,
      }),
      ...scope, expectedVersion: 0, ...request('rule2'),
    })
    const selfBase = {
      orgId,
      legalEntityId: scope.legalEntityId,
      bookId: scope.bookId,
      id: 'ap-self',
      schemaVersion: 1 as const,
      action: 'payroll.rule.approve' as const,
      status: 'approved' as const,
      approvedBy: admin.uid,
      approverRole: 'payroll_approver' as const,
      approverAssignmentId: 'admin-a0',
      approvedAt: now,
      reason: 'self',
      subjectDigest: canonicalDigest({ id: 'ap-self', action: 'payroll.rule.approve' }),
      immutable: true as const,
      canonicalPayloadVersion: 1 as const,
      hashAlgorithmVersion: HASH_ALGORITHM_VERSION,
    }
    service.registerApproval({ ...selfBase, contentHash: canonicalDigest(selfBase) })
    await expect(service.approveRuleVersion(admin, {
      ...scope, ruleVersionId: draft2.id, expectedVersion: draft2.version,
      approvalId: 'ap-self', reason: 'self', ...request('rule2-ap'),
    })).rejects.toThrow(/separation of duties/)

    expect(store.auditEvents.every((e) => e.externalEgressAllowed === false)).toBe(true)
    expect(store.auditEvents.length).toBeGreaterThan(8)
  })
})
