import { existsSync, readFileSync } from 'fs'
import path from 'path'
import {
  ESS_BLOCKED_ADMIN_COMMANDS,
  ESS_HARD_GATES,
  emptyEssBundle,
  isEssAllowedCommand,
  isEssBlockedAdminCommand,
} from '@/lib/payroll/ess'
import { FinancePayrollCalculationService, InMemoryPayrollStore } from '@/lib/payroll/calculation-service'
import { FinancePayRunService } from '@/lib/payroll/pay-run-service'
import { FinancePayrollLeaveService } from '@/lib/payroll/leave-service'
import { zaPayrollRuleVersionDraft } from '@/lib/jurisdictions/za/payroll'
import { canonicalDigest, HASH_ALGORITHM_VERSION } from '@/lib/finance/integrity'
import type { FinanceActorContext, FinanceApprovalRecord } from '@/lib/finance/types'

const root = process.cwd()
const orgId = 'org-ess'
const scope = { orgId, legalEntityId: 'entity-a', bookId: 'book-a' }
const request = (key: string) => ({ requestId: `req-${key}`, idempotencyKey: `idem-${key}` })

function actorFor(uid: string, role: FinanceActorContext['assignments'][number]['role']): FinanceActorContext {
  return {
    uid,
    orgId,
    membershipRole: 'member',
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

function approval(id: string, action: FinanceApprovalRecord['action']): FinanceApprovalRecord {
  const base = {
    orgId,
    legalEntityId: scope.legalEntityId,
    bookId: scope.bookId,
    id,
    schemaVersion: 1 as const,
    action,
    status: 'approved' as const,
    approvedBy: 'external-approver',
    approverRole: 'payroll_approver' as const,
    approverAssignmentId: 'external-a0',
    approvedAt: '2026-08-01T10:00:00.000Z',
    reason: `Approve ${action}`,
    subjectDigest: canonicalDigest({ id, action }),
    immutable: true as const,
    canonicalPayloadVersion: 1 as const,
    hashAlgorithmVersion: HASH_ALGORITHM_VERSION,
  }
  return { ...base, contentHash: canonicalDigest(base) }
}

describe('payroll ESS contracts', () => {
  test('hard gates and command allowlist keep admin payroll off ESS', () => {
    expect(ESS_HARD_GATES.massEmailAllowed).toBe(false)
    expect(ESS_HARD_GATES.externalEgressAllowed).toBe(false)
    expect(ESS_HARD_GATES.adminPayrollControls).toBe(false)
    expect(isEssAllowedCommand('leave.request')).toBe(true)
    expect(isEssAllowedCommand('payslip.pack')).toBe(true)
    expect(isEssAllowedCommand('employee.create')).toBe(false)
    expect(isEssBlockedAdminCommand('pay-run.create')).toBe(true)
    expect(ESS_BLOCKED_ADMIN_COMMANDS).toContain('payslip.bulk-pack')
    const empty = emptyEssBundle()
    expect(empty.surface).toBe('employee_self_service')
    expect(empty.a11y.payslipListLabel).toMatch(/payslip/i)
    expect(empty.pwa.startPath).toBe('/portal/finance/ess')
  })

  test('ESS portal page + PWA shortcut + query surface exist with a11y landmarks', () => {
    const page = path.join(root, 'app/(portal)/portal/finance/ess/page.tsx')
    expect(existsSync(page)).toBe(true)
    const src = readFileSync(page, 'utf8')
    expect(src).toMatch(/FinanceModuleFrame/)
    expect(src).toMatch(/useFinanceBookScope/)
    expect(src).toMatch(/ess-bundle/)
    expect(src).toMatch(/aria-label/)
    expect(src).toMatch(/InstallPrompt/)
    expect(src).toMatch(/ess-no-admin-controls/)
    expect(src).not.toMatch(/pay-run\.create|employee\.create|payslip\.bulk-pack/)

    const queries = readFileSync(path.join(root, 'app/api/v1/finance/payroll/queries/route.ts'), 'utf8')
    expect(queries).toMatch(/ess-bundle/)

    const manifest = readFileSync(path.join(root, 'public/manifest.webmanifest'), 'utf8')
    expect(manifest).toMatch(/portal\/finance\/ess/)
    expect(manifest).toMatch(/Employee self-service/)
  })
})

describe('payroll ESS service least privilege', () => {
  test('linked employee sees own balances/payslips; stranger empty; request routes pending; approver decides', async () => {
    let now = '2026-08-15T10:00:00.000Z'
    const store = new InMemoryPayrollStore()
    const calc = new FinancePayrollCalculationService(store, () => now)
    const leave = new FinancePayrollLeaveService(store, () => now)
    const runs = new FinancePayRunService(store, () => now)

    const clerk = actorFor('clerk-1', 'payroll_clerk')
    const approver = actorFor('approver-1', 'payroll_approver')
    const employeeUser = actorFor('emp-user-1', 'finance_viewer')
    const stranger = actorFor('stranger', 'finance_viewer')

    const employee = await calc.createEmployee(clerk, {
      id: 'emp-1',
      ...scope,
      employeeNumber: 'E1',
      displayName: 'Ada Lovelace',
      taxResidency: 'za_resident',
      dateOfBirth: '1990-01-01',
      startDate: '2025-01-01',
      linkedUserId: 'emp-user-1',
      expectedVersion: 0,
      ...request('emp'),
    })
    const other = await calc.createEmployee(clerk, {
      id: 'emp-2',
      ...scope,
      employeeNumber: 'E2',
      displayName: 'Other Person',
      taxResidency: 'za_resident',
      startDate: '2025-01-01',
      linkedUserId: 'someone-else',
      expectedVersion: 0,
      ...request('emp2'),
    })
    const employment = await calc.createEmployment(clerk, {
      id: 'empl-1',
      ...scope,
      employeeId: employee.id,
      expectedVersion: 0,
      ...request('empl'),
    })
    const term = await calc.createTermVersion(clerk, {
      id: 'term-1',
      ...scope,
      employeeId: employee.id,
      employmentId: employment.id,
      versionNumber: 1,
      workerCategory: 'salaried',
      frequency: 'monthly',
      rateMinor: 4_000_000,
      standardHoursPerPeriod: 160,
      overtimeMultiplierNumerator: 150,
      overtimeMultiplierDenominator: 100,
      subjectToUif: true,
      subjectToSdl: true,
      effectiveFrom: '2025-03-01',
      expectedVersion: 0,
      ...request('term'),
    })
    const draft = await calc.createRuleVersion(clerk, {
      ...zaPayrollRuleVersionDraft({
        id: 'rule-1',
        orgId,
        legalEntityId: scope.legalEntityId,
        bookId: scope.bookId,
        versionNumber: 1,
      }),
      ...scope,
      expectedVersion: 0,
      ...request('rule'),
    })
    calc.registerApproval(approval('ap-rule', 'payroll.rule.approve'))
    const rule = await calc.approveRuleVersion(approver, {
      ...scope,
      ruleVersionId: draft.id,
      expectedVersion: draft.version,
      approvalId: 'ap-rule',
      reason: 'tables',
      ...request('rule-ap'),
    })
    const calendar = await calc.createCalendar(clerk, {
      id: 'cal-1',
      ...scope,
      code: 'M',
      name: 'Monthly',
      frequency: 'monthly',
      expectedVersion: 0,
      ...request('cal'),
    })
    const period = await calc.createPayPeriod(clerk, {
      id: 'per-1',
      ...scope,
      calendarId: calendar.id,
      label: '2026-08',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      payDate: '2026-08-25',
      cutOffAt: '2026-08-20T12:00:00.000Z',
      taxYearLabel: '2025/26',
      expectedVersion: 0,
      ...request('per'),
    })

    const leaveType = await leave.createLeaveType(clerk, {
      id: 'lt-annual',
      ...scope,
      code: 'ANNUAL',
      name: 'Annual leave',
      unit: 'days',
      payEffect: 'paid',
      hoursPerDay: 8,
      accrues: true,
      expectedVersion: 0,
      ...request('lt'),
    })
    await leave.setLeaveBalance(clerk, {
      id: 'lb-1',
      ...scope,
      employeeId: employee.id,
      leaveTypeId: leaveType.id,
      balanceQuantity: 12,
      asOfDate: '2026-08-01',
      expectedVersion: 0,
      ...request('lb'),
    })
    await leave.setLeaveBalance(clerk, {
      id: 'lb-2',
      ...scope,
      employeeId: other.id,
      leaveTypeId: leaveType.id,
      balanceQuantity: 99,
      asOfDate: '2026-08-01',
      expectedVersion: 0,
      ...request('lb2'),
    })

    const selfRequest = await leave.requestLeave(employeeUser, {
      id: 'lv-self',
      ...scope,
      employeeId: employee.id,
      leaveTypeId: leaveType.id,
      startDate: '2026-08-18',
      endDate: '2026-08-18',
      unit: 'days',
      quantity: 1,
      note: 'Family day',
      expectedVersion: 0,
      ...request('lv-self'),
    })
    expect(selfRequest.status).toBe('pending')

    const baseline = await calc.calculateEmployee(clerk, {
      id: 'calc-1',
      ...scope,
      employeeId: employee.id,
      employmentId: employment.id,
      termVersionId: term.id,
      payPeriodId: period.id,
      ruleVersionId: rule.id,
      expectedVersion: 0,
      ...request('calc'),
    })
    now = '2026-08-21T10:00:00.000Z'
    let run = await runs.createPayRun(clerk, {
      id: 'run-1',
      ...scope,
      calendarId: calendar.id,
      payPeriodId: period.id,
      ruleVersionId: rule.id,
      label: 'Aug 2026',
      expectedVersion: 0,
      ...request('run'),
    })
    run = await runs.addItem(clerk, {
      id: 'item-1',
      ...scope,
      payRunId: run.id,
      calculationId: baseline.id,
      expectedVersion: run.version,
      ...request('item'),
    })
    run = await runs.freezeInputs(clerk, { ...scope, payRunId: run.id, expectedVersion: run.version, ...request('freeze') })
    run = await runs.submitForReview(clerk, { ...scope, payRunId: run.id, expectedVersion: run.version, ...request('submit') })
    runs.registerApproval(approval('ap-run', 'payroll.run.approve'))
    const locked = await runs.approveAndLock(approver, {
      ...scope,
      payRunId: run.id,
      expectedVersion: run.version,
      approvalId: 'ap-run',
      reason: 'ok',
      ...request('lock'),
    })
    const payslipId = locked.payslipIds[0]
    expect(payslipId).toBeTruthy()

    const ess = leave.listEssBundle(employeeUser, scope)
    expect(ess.surface).toBe('employee_self_service')
    expect(ess.linked).toBe(true)
    expect(ess.hardGates.massEmailAllowed).toBe(false)
    expect(ess.hardGates.adminPayrollControls).toBe(false)
    expect(ess.employees.map((e) => e.id)).toEqual(['emp-1'])
    expect(ess.leaveBalances).toHaveLength(1)
    expect(ess.leaveBalances[0].balanceQuantity).toBe(12)
    expect(ess.leaveRecords.some((r) => r.id === 'lv-self' && r.status === 'pending')).toBe(true)
    expect(ess.payslips.map((p) => p.id)).toContain(payslipId)
    expect(ess.canApproveLeave).toBe(false)
    expect(ess.pendingApprovals).toEqual([])
    expect(JSON.stringify(ess)).not.toMatch(/bankAccount|taxNumber|nationalId/i)

    const strangerBundle = leave.listEssBundle(stranger, scope)
    expect(strangerBundle.linked).toBe(false)
    expect(strangerBundle.payslips).toEqual([])
    expect(strangerBundle.leaveBalances).toEqual([])

    const approverBundle = leave.listEssBundle(approver, scope)
    expect(approverBundle.canApproveLeave).toBe(true)
    expect(approverBundle.pendingApprovals.some((r) => r.id === 'lv-self')).toBe(true)

    const decided = await leave.decideLeave(approver, {
      ...scope,
      leaveRecordId: 'lv-self',
      decision: 'approve',
      expectedVersion: selfRequest.version,
      ...request('lv-dec'),
    })
    expect(decided.status).toBe('approved')

    const pack = await leave.buildPayslipPack(employeeUser, {
      id: 'pack-ess',
      ...scope,
      payslipId,
      expectedVersion: 0,
      ...request('pack'),
    })
    expect(pack.externalEgressAllowed).toBe(false)
    expect(pack.autoSent).toBe(false)
    expect(pack.sarsSubmissionInitiated).toBe(false)
  })
})
