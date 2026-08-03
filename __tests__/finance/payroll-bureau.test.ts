import {
  buildBulkPayslipRunPackFiles,
  buildEmp501AnnualReadinessPack,
  buildLeaveMonthCalendar,
  buildMultiEntityPayRunBoard,
  buildZipBase64,
  salaryStructureToPeriodComponents,
} from '@/lib/payroll/bureau'
import { FinancePayrollBureauService } from '@/lib/payroll/bureau-service'
import { FinancePayrollCalculationService, InMemoryPayrollStore } from '@/lib/payroll/calculation-service'
import { FinancePayRunService } from '@/lib/payroll/pay-run-service'
import { runAllVeraCalcFixtures, runVeraCalcFixture } from '@/lib/payroll/vera-calc-fixtures'
import { zaPayrollRuleVersionDraft } from '@/lib/jurisdictions/za/payroll'
import { canonicalDigest, HASH_ALGORITHM_VERSION } from '@/lib/finance/integrity'
import type { FinanceActorContext, FinanceApprovalRecord } from '@/lib/finance/types'
import type {
  Emp201Snapshot,
  Emp501Reconciliation,
  Irp5Record,
  LeaveBalance,
  LeaveRecord,
  LeaveType,
  PayPeriod,
  PayRun,
  PayrollEmployee,
  PayrollTaxYear,
  Payslip,
} from '@/lib/payroll/types'

const orgId = 'org-bureau'
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

describe('payroll bureau pure helpers', () => {
  test('multi-entity board aggregates status and calendar density', () => {
    const periodA: PayPeriod = {
      id: 'p-a',
      orgId,
      legalEntityId: 'le-a',
      bookId: 'b-a',
      schemaVersion: 1,
      version: 1,
      createdAt: '',
      createdBy: '',
      updatedAt: '',
      updatedBy: '',
      calendarId: 'c1',
      frequency: 'monthly',
      label: 'Aug A',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      cutOffAt: '2026-08-20T12:00:00.000Z',
      payDate: '2026-08-25',
      taxYearLabel: '2025/26',
      status: 'open',
    }
    const periodB: PayPeriod = {
      ...periodA,
      id: 'p-b',
      legalEntityId: 'le-b',
      bookId: 'b-b',
      label: 'Aug B',
      payDate: '2026-08-26',
      cutOffAt: '2026-08-21T12:00:00.000Z',
    }
    const runA = {
      id: 'run-a',
      orgId,
      legalEntityId: 'le-a',
      bookId: 'b-a',
      payPeriodId: 'p-a',
      label: 'A locked',
      status: 'approved_locked',
      kind: 'regular',
      itemIds: ['i1'],
      payslipIds: ['ps1'],
      totals: { grossEarningsMinor: 100, netPayMinor: 80, payeMinor: 10 },
      createdAt: '2026-08-01T00:00:00.000Z',
    } as unknown as PayRun
    const runB = {
      id: 'run-b',
      orgId,
      legalEntityId: 'le-b',
      bookId: 'b-b',
      payPeriodId: 'p-b',
      label: 'B review',
      status: 'in_review',
      kind: 'regular',
      itemIds: [],
      payslipIds: [],
      totals: { grossEarningsMinor: 50, netPayMinor: 40, payeMinor: 5 },
      createdAt: '2026-08-01T00:00:00.000Z',
    } as unknown as PayRun

    const board = buildMultiEntityPayRunBoard({
      entities: [
        { legalEntityId: 'le-a', legalEntityLabel: 'Entity A', bookId: 'b-a', payRuns: [runA], periods: [periodA] },
        { legalEntityId: 'le-b', legalEntityLabel: 'Entity B', bookId: 'b-b', payRuns: [runB], periods: [periodB] },
      ],
      nowIso: '2026-08-18T00:00:00.000Z',
    })

    expect(board.summary.entityCount).toBe(2)
    expect(board.summary.runCount).toBe(2)
    expect(board.summary.lockedCount).toBe(1)
    expect(board.summary.inReviewCount).toBe(1)
    expect(board.hardGates.externalPaymentInitiated).toBe(false)
    expect(board.hardGates.sarsSubmissionInitiated).toBe(false)
    expect(board.hardGates.massEmailAllowed).toBe(false)
    expect(board.density.some((d) => d.date === '2026-08-25' && d.lockedRunCount === 1)).toBe(true)
  })

  test('leave month calendar shows balances, pending, and accrual summary', () => {
    const employees: Array<Pick<PayrollEmployee, 'id' | 'displayName' | 'employeeNumber'>> = [
      { id: 'emp1', displayName: 'Ada', employeeNumber: 'E1' },
    ]
    const leaveTypes = [{
      id: 'lt1',
      orgId,
      legalEntityId: scope.legalEntityId,
      bookId: scope.bookId,
      code: 'ANNUAL',
      accrues: true,
      unit: 'days',
    }] as unknown as LeaveType[]
    const leaveRecords = [{
      id: 'lv1',
      orgId,
      legalEntityId: scope.legalEntityId,
      bookId: scope.bookId,
      employeeId: 'emp1',
      leaveTypeCode: 'ANNUAL',
      status: 'pending',
      payEffect: 'paid',
      hours: 24,
      quantity: 3,
      unit: 'days',
      startDate: '2026-08-10',
      endDate: '2026-08-12',
    }] as unknown as LeaveRecord[]
    const leaveBalances = [{
      id: 'lb1',
      orgId,
      legalEntityId: scope.legalEntityId,
      bookId: scope.bookId,
      employeeId: 'emp1',
      leaveTypeId: 'lt1',
      unit: 'days',
      balanceQuantity: 12,
      balanceHours: 96,
      asOfDate: '2026-08-01',
    }] as unknown as LeaveBalance[]

    const cal = buildLeaveMonthCalendar({
      year: 2026,
      month: 8,
      leaveRecords,
      leaveBalances,
      leaveTypes,
      employees,
    })
    expect(cal.monthKey).toBe('2026-08')
    expect(cal.pendingRequests).toHaveLength(1)
    expect(cal.days.find((d) => d.date === '2026-08-11')?.entries).toHaveLength(1)
    expect(cal.accrualSummary[0].leaveTypeCode).toBe('ANNUAL')
    expect(cal.hardGates.externalEgressAllowed).toBe(false)
  })

  test('bulk payslip ZIP pack is download-only with hard gates false', () => {
    const payRun = {
      id: 'run1',
      label: 'Aug',
      status: 'approved_locked',
      payPeriodId: 'per1',
      payslipIds: ['ps1'],
    } as unknown as PayRun
    const payslip = {
      id: 'ps1',
      orgId,
      legalEntityId: scope.legalEntityId,
      bookId: scope.bookId,
      payRunId: 'run1',
      payRunItemId: 'item1',
      employeeId: 'emp1',
      employmentId: 'empl1',
      payPeriodId: 'per1',
      payDate: '2026-08-25',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      status: 'generated',
      publicationStatus: 'internal_only',
      accessVersion: 1,
      generationChecksum: 'abc',
      rendered: {
        employeeDisplayName: 'Ada',
        employeeNumber: 'E1',
        currency: 'ZAR',
        lines: [{
          lineId: 'l1',
          componentCode: 'BASE',
          kind: 'base_salary',
          description: 'Salary',
          quantity: 1,
          unitAmountMinor: 100000,
          amountMinor: 100000,
          taxTreatment: 'taxable',
          uifTreatment: 'include',
          sdlTreatment: 'include',
        }],
        totals: {
          ordinaryMinor: 100000,
          overtimeMinor: 0,
          leavePaidMinor: 0,
          leaveUnpaidReductionMinor: 0,
          bonusMinor: 0,
          commissionMinor: 0,
          allowancesMinor: 0,
          benefitsMinor: 0,
          grossEarningsMinor: 100000,
          taxableEarningsMinor: 100000,
          preTaxDeductionsMinor: 0,
          postTaxDeductionsMinor: 0,
          payeMinor: 10000,
          uifEmployeeMinor: 1000,
          uifEmployerMinor: 1000,
          sdlEmployerMinor: 1000,
          netPayMinor: 89000,
          employerCostMinor: 102000,
        },
        netPayMinor: 89000,
      },
      immutable: true,
      contentHash: 'x',
      externalPaymentInitiated: false,
      sarsSubmissionInitiated: false,
      autoSent: false,
      schemaVersion: 1,
      version: 1,
      createdAt: '',
      createdBy: '',
      updatedAt: '',
      updatedBy: '',
    } as unknown as Payslip

    const pack = buildBulkPayslipRunPackFiles({ payRun, payslips: [payslip] })
    expect(pack.externalEgressAllowed).toBe(false)
    expect(pack.autoSent).toBe(false)
    expect(pack.sarsSubmissionInitiated).toBe(false)
    expect(pack.externalPaymentInitiated).toBe(false)
    expect(pack.zipBase64.length).toBeGreaterThan(20)
    expect(pack.files.some((f) => f.name === 'bulk-manifest.json')).toBe(true)
    const zipAgain = buildZipBase64([{ name: 'a.txt', content: 'hello' }])
    expect(zipAgain.length).toBeGreaterThan(10)
  })

  test('EMP501 annual pack polish marks batch export readiness without SARS submit', () => {
    const taxYear = {
      id: 'ty1',
      taxYearLabel: '2025/26',
    } as unknown as PayrollTaxYear
    const emp501 = {
      id: 'e501',
      status: 'approved_locked',
      reconciled: true,
      difference: { payeMinor: 0, uifMinor: 0, sdlMinor: 0 },
      sarsSubmissionInitiated: false,
    } as unknown as Emp501Reconciliation
    const irp5 = [{
      id: 'irp1',
      taxYearId: 'ty1',
      certificateKind: 'IRP5',
      employeeId: 'emp1',
      status: 'approved_locked',
      totals: { taxableEarningsMinor: 100, payeMinor: 10, uifEmployeeMinor: 1 },
      sarsSubmissionInitiated: false,
    }] as unknown as Irp5Record[]
    const emp201 = [{
      id: 'e201',
      taxYearId: 'ty1',
      status: 'approved_locked',
    }] as unknown as Emp201Snapshot[]

    const pack = buildEmp501AnnualReadinessPack({
      id: 'pack1',
      taxYear,
      emp501,
      irp5Records: irp5,
      emp201Snapshots: emp201,
    })
    expect(pack.readiness.batchExportReady).toBe(true)
    expect(pack.sarsSubmissionInitiated).toBe(false)
    expect(pack.externalPaymentInitiated).toBe(false)
    expect(pack.autoSent).toBe(false)
    expect(pack.files.some((f) => f.name === 'irp5-batch.csv')).toBe(true)
  })

  test('salary structure expands to period components', () => {
    const components = salaryStructureToPeriodComponents([{
      lineId: 'l1',
      componentCode: 'ALLOW',
      kind: 'allowance',
      description: 'Travel',
      unitAmountMinor: 50_000,
      quantityMinorUnits: 1,
      taxTreatment: 'taxable',
      uifTreatment: 'include',
      sdlTreatment: 'include',
    }])
    expect(components[0].componentCode).toBe('ALLOW')
    expect(components[0].unitAmountMinor).toBe(50_000)
  })
})

describe('Vera calc fixtures', () => {
  test('all PAYE/UIF/SDL edge fixtures pass hard gates and identities', () => {
    const results = runAllVeraCalcFixtures()
    expect(results.length).toBeGreaterThanOrEqual(6)
    for (const row of results) {
      expect(row.identitiesHold).toBe(true)
      expect(row.externalPaymentInitiated).toBe(false)
      expect(row.sarsSubmissionInitiated).toBe(false)
      expect(row.totals.netPayMinor).toBeGreaterThanOrEqual(0)
    }
    const uif = runVeraCalcFixture('uif-at-monthly-ceiling')
    expect(uif.totals.uifEmployeeMinor).toBeLessThanOrEqual(20_000)
  })
})

describe('payroll bureau service integration', () => {
  test('salary structures + bulk pack + leave month + board + EMP501 pack gates', async () => {
    let now = '2026-08-15T10:00:00.000Z'
    const store = new InMemoryPayrollStore()
    const calc = new FinancePayrollCalculationService(store, () => now)
    const runs = new FinancePayRunService(store, () => now)
    const bureau = new FinancePayrollBureauService(store, () => now)

    const employee = await calc.createEmployee(clerk, {
      id: 'emp-1',
      ...scope,
      employeeNumber: 'E1',
      displayName: 'Ada Lovelace',
      taxResidency: 'za_resident',
      dateOfBirth: '1990-01-01',
      startDate: '2025-01-01',
      expectedVersion: 0,
      ...request('emp'),
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
    await calc.createPayComponent(clerk, {
      id: 'pc-travel',
      ...scope,
      code: 'TRAVEL',
      name: 'Travel',
      kind: 'allowance',
      taxTreatment: 'taxable',
      uifTreatment: 'include',
      sdlTreatment: 'include',
      jurisdictionCode: 'ZA',
      expectedVersion: 0,
      ...request('pc'),
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
      ruleVersionId: draft.id,
      approvalId: 'ap-rule',
      reason: 'tables',
      expectedVersion: draft.version,
      ...scope,
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
      cutOffAt: '2026-08-14T12:00:00.000Z',
      taxYearLabel: '2025/26',
      expectedVersion: 0,
      ...request('per'),
    })

    const structure = await bureau.createSalaryStructure(clerk, {
      id: 'ss-1',
      ...scope,
      code: 'STD',
      name: 'Standard package',
      frequency: 'monthly',
      lines: [{
        lineId: 'l1',
        componentCode: 'TRAVEL',
        kind: 'allowance',
        description: 'Travel',
        unitAmountMinor: 100_000,
        quantityMinorUnits: 1,
        taxTreatment: 'taxable',
        uifTreatment: 'include',
        sdlTreatment: 'include',
      }],
      expectedVersion: 0,
      ...request('ss'),
    })
    expect(structure.status).toBe('draft')
    const active = await bureau.activateSalaryStructure(clerk, {
      structureId: structure.id,
      expectedVersion: structure.version,
      ...scope,
      ...request('ss-act'),
    })
    expect(active.status).toBe('active')
    const expanded = bureau.expandSalaryStructure(clerk, {
      structureId: structure.id,
      ...scope,
      ...request('ss-exp'),
    })
    expect(expanded.components).toHaveLength(1)
    expect(expanded.externalPaymentInitiated).toBe(false)

    const calculation = await calc.calculateEmployee(clerk, {
      id: 'calc-1',
      ...scope,
      employeeId: employee.id,
      employmentId: employment.id,
      termVersionId: term.id,
      payPeriodId: period.id,
      ruleVersionId: rule.id,
      components: expanded.components,
      expectedVersion: 0,
      ...request('calc'),
    })

    now = '2026-08-15T10:00:00.000Z'
    let payRun = await runs.createPayRun(clerk, {
      id: 'run-1',
      ...scope,
      calendarId: calendar.id,
      payPeriodId: period.id,
      ruleVersionId: rule.id,
      label: 'Aug regular',
      kind: 'regular',
      expectedVersion: 0,
      ...request('run'),
    })
    payRun = await runs.addItem(clerk, {
      id: 'item-1',
      ...scope,
      payRunId: payRun.id,
      calculationId: calculation.id,
      expectedVersion: payRun.version,
      ...request('item'),
    })
    payRun = await runs.freezeInputs(clerk, { payRunId: payRun.id, expectedVersion: payRun.version, ...scope, ...request('freeze') })
    payRun = await runs.submitForReview(clerk, { payRunId: payRun.id, expectedVersion: payRun.version, ...scope, ...request('submit') })
    runs.registerApproval(approval('ap-run', 'payroll.run.approve'))
    const locked = await runs.approveAndLock(approver, {
      payRunId: payRun.id,
      approvalId: 'ap-run',
      reason: 'ok',
      expectedVersion: payRun.version,
      ...scope,
      ...request('lock'),
    })
    expect(locked.status).toBe('approved_locked')
    expect(locked.payslipIds.length).toBe(1)

    const bulk = await bureau.buildBulkPayslipRunPack(clerk, {
      id: 'bulk-1',
      ...scope,
      payRunId: locked.id,
      expectedVersion: 0,
      ...request('bulk'),
    })
    expect(bulk.autoSent).toBe(false)
    expect(bulk.externalEgressAllowed).toBe(false)
    expect(bulk.sarsSubmissionInitiated).toBe(false)
    expect(bulk.externalPaymentInitiated).toBe(false)
    expect(bulk.zipBase64.length).toBeGreaterThan(20)
    const downloaded = await bureau.markBulkPayslipRunPackDownloaded(clerk, {
      packId: bulk.id,
      ...scope,
      ...request('bulk-dl'),
    })
    expect(downloaded.status).toBe('downloaded')
    expect(downloaded.autoSent).toBe(false)

    store.leaveTypes.set('lt-1', {
      id: 'lt-1',
      orgId,
      legalEntityId: scope.legalEntityId,
      bookId: scope.bookId,
      schemaVersion: 1,
      version: 1,
      createdAt: now,
      createdBy: clerk.uid,
      updatedAt: now,
      updatedBy: clerk.uid,
      code: 'ANNUAL',
      name: 'Annual',
      unit: 'days',
      payEffect: 'paid',
      hoursPerDay: 8,
      accrues: true,
      status: 'active',
    } as LeaveType)
    store.leaveBalances.set('lb-1', {
      id: 'lb-1',
      orgId,
      legalEntityId: scope.legalEntityId,
      bookId: scope.bookId,
      schemaVersion: 1,
      version: 1,
      createdAt: now,
      createdBy: clerk.uid,
      updatedAt: now,
      updatedBy: clerk.uid,
      employeeId: employee.id,
      leaveTypeId: 'lt-1',
      unit: 'days',
      balanceQuantity: 10,
      balanceHours: 80,
      asOfDate: '2026-08-01',
    } as LeaveBalance)
    store.leaveRecords.set('lv-1', {
      id: 'lv-1',
      orgId,
      legalEntityId: scope.legalEntityId,
      bookId: scope.bookId,
      schemaVersion: 1,
      version: 1,
      createdAt: now,
      createdBy: clerk.uid,
      updatedAt: now,
      updatedBy: clerk.uid,
      employeeId: employee.id,
      leaveTypeId: 'lt-1',
      leaveTypeCode: 'ANNUAL',
      status: 'pending',
      payEffect: 'paid',
      unit: 'days',
      quantity: 2,
      hours: 16,
      startDate: '2026-08-18',
      endDate: '2026-08-19',
      requestedBy: clerk.uid,
    } as LeaveRecord)

    const leaveMonth = bureau.projectLeaveMonth(clerk, scope, 2026, 8)
    expect(leaveMonth.pendingRequests).toHaveLength(1)
    expect(leaveMonth.balances[0].balanceQuantity).toBe(10)

    const board = bureau.projectPayRunBoard(clerk, scope)
    expect(board.summary.runCount).toBeGreaterThanOrEqual(1)
    expect(board.summary.lockedCount).toBeGreaterThanOrEqual(1)
    expect(board.hardGates.massEmailAllowed).toBe(false)

    store.taxYears.set('ty-1', {
      id: 'ty-1',
      orgId,
      legalEntityId: scope.legalEntityId,
      bookId: scope.bookId,
      schemaVersion: 1,
      version: 1,
      createdAt: now,
      createdBy: clerk.uid,
      updatedAt: now,
      updatedBy: clerk.uid,
      taxYearLabel: '2025/26',
      startDate: '2025-03-01',
      endDate: '2026-02-28',
      status: 'open',
    } as PayrollTaxYear)
    store.emp501Reconciliations.set('e501', {
      id: 'e501',
      orgId,
      legalEntityId: scope.legalEntityId,
      bookId: scope.bookId,
      schemaVersion: 1,
      version: 1,
      createdAt: now,
      createdBy: clerk.uid,
      updatedAt: now,
      updatedBy: clerk.uid,
      taxYearId: 'ty-1',
      status: 'ready',
      reconciled: false,
      difference: { payeMinor: 1, uifMinor: 0, sdlMinor: 0 },
      sarsSubmissionInitiated: false,
      contentHash: 'x',
    } as Emp501Reconciliation)
    store.irp5Records.set('irp1', {
      id: 'irp1',
      orgId,
      legalEntityId: scope.legalEntityId,
      bookId: scope.bookId,
      schemaVersion: 1,
      version: 1,
      createdAt: now,
      createdBy: clerk.uid,
      updatedAt: now,
      updatedBy: clerk.uid,
      taxYearId: 'ty-1',
      employeeId: employee.id,
      certificateKind: 'IRP5',
      status: 'draft',
      totals: { taxableEarningsMinor: 1, payeMinor: 1, uifEmployeeMinor: 1 },
      sarsSubmissionInitiated: false,
      contentHash: 'y',
    } as Irp5Record)

    const emp501Pack = bureau.buildEmp501AnnualPack(clerk, {
      id: 'ann-1',
      ...scope,
      emp501Id: 'e501',
      expectedVersion: 0,
      ...request('ann'),
    })
    expect(emp501Pack.readiness.batchExportReady).toBe(false)
    expect(emp501Pack.readiness.blockers.length).toBeGreaterThan(0)
    expect(emp501Pack.sarsSubmissionInitiated).toBe(false)
    expect(emp501Pack.externalPaymentInitiated).toBe(false)

    const vera = bureau.runAllVeraFixtures(clerk, scope)
    expect(vera.length).toBeGreaterThanOrEqual(6)
  })
})
