import { FinancePayrollCalculationService, InMemoryPayrollStore } from '@/lib/payroll/calculation-service'
import { FinancePayRunService } from '@/lib/payroll/pay-run-service'
import { FinancePayrollStatutoryService } from '@/lib/payroll/statutory-service'
import { zaPayrollRuleVersionDraft } from '@/lib/jurisdictions/za/payroll'
import { canonicalDigest, HASH_ALGORITHM_VERSION } from '@/lib/finance/integrity'
import type { FinanceActorContext, FinanceApprovalRecord } from '@/lib/finance/types'

const orgId = 'org-statutory'
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

async function seedLockedRun(store: InMemoryPayrollStore, now: string) {
  const calcService = new FinancePayrollCalculationService(store, () => now)
  const payRuns = new FinancePayRunService(store, () => now)
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
  let run = await payRuns.createPayRun(clerk, {
    id: 'run-1', ...scope, calendarId: calendar.id, payPeriodId: period.id,
    ruleVersionId: rule.id, label: 'March 2026', expectedVersion: 0, ...request('run'),
  })
  run = await payRuns.addItem(clerk, {
    id: 'item-1', ...scope, payRunId: run.id, calculationId: calculation.id,
    expectedVersion: run.version, ...request('item'),
  })
  const later = '2026-03-21T09:00:00.000Z'
  const payRunsLater = new FinancePayRunService(store, () => later)
  run = await payRunsLater.freezeInputs(clerk, {
    ...scope, payRunId: run.id, expectedVersion: run.version, ...request('freeze'),
  })
  run = await payRunsLater.submitForReview(clerk, {
    ...scope, payRunId: run.id, expectedVersion: run.version, ...request('submit'),
  })
  payRunsLater.registerApproval(approval('ap-run', 'payroll.run.approve'))
  const locked = await payRunsLater.approveAndLock(approver, {
    ...scope, payRunId: run.id, expectedVersion: run.version,
    approvalId: 'ap-run', reason: 'Approved March payroll', ...request('approve'),
  })
  return { employee, employment, rule, period, calculation, locked, later }
}

describe('payroll statutory service integration', () => {
  test('tax year controls, IRP5/IT3(a), EMP201/EMP501, export evidence, no SARS/payment egress', async () => {
    const store = new InMemoryPayrollStore()
    const seeded = await seedLockedRun(store, '2026-03-19T10:00:00.000Z')
    const statutory = new FinancePayrollStatutoryService(store, () => seeded.later)

    const taxYear = await statutory.createTaxYear(clerk, {
      id: 'ty-1', ...scope, taxYearLabel: '2025/26', ruleVersionIds: [seeded.rule.id],
      expectedVersion: 0, ...request('ty'),
    })
    expect(taxYear.status).toBe('open')
    expect(taxYear.startDate).toBe('2025-03-01')
    expect(taxYear.sarsSubmissionInitiated).toBe(false)

    const irp5 = await statutory.prepareIrp5(clerk, {
      id: 'irp5-1', ...scope, taxYearId: taxYear.id,
      employeeId: seeded.employee.id, employmentId: seeded.employment.id,
      expectedVersion: 0, ...request('irp5'),
    })
    expect(irp5.status).toBe('ready')
    expect(irp5.certificateKind).toBe(seeded.locked.totals.payeMinor > 0 ? 'IRP5' : 'IT3(a)')
    expect(irp5.totals.payeMinor).toBe(seeded.locked.totals.payeMinor)
    expect(irp5.taxTableReferences[0]?.packageId).toBe(seeded.rule.packageId)
    expect(irp5.sarsSubmissionInitiated).toBe(false)

    await expect(statutory.approveIrp5(clerk, {
      id: irp5.id, ...scope, expectedVersion: irp5.version,
      approvalId: 'ap-irp5', reason: 'self', ...request('irp5-self'),
    })).rejects.toThrow()

    statutory.registerApproval(approval('ap-irp5', 'payroll.statutory.approve'))
    const lockedIrp5 = await statutory.approveIrp5(approver, {
      id: irp5.id, ...scope, expectedVersion: irp5.version,
      approvalId: 'ap-irp5', reason: 'Certificate ready', ...request('irp5-ap'),
    })
    expect(lockedIrp5.status).toBe('approved_locked')
    expect(lockedIrp5.immutable).toBe(true)

    const emp201 = await statutory.prepareEmp201(clerk, {
      id: 'emp201-1', ...scope, taxYearId: taxYear.id, taxMonth: '2026-03',
      expectedVersion: 0, ...request('emp201'),
    })
    expect(emp201.employeeCount).toBe(1)
    expect(emp201.totals.payeMinor).toBe(seeded.locked.totals.payeMinor)
    statutory.registerApproval(approval('ap-emp201', 'payroll.statutory.approve'))
    const lockedEmp201 = await statutory.approveEmp201(approver, {
      id: emp201.id, ...scope, expectedVersion: emp201.version,
      approvalId: 'ap-emp201', reason: 'Monthly return ready', ...request('emp201-ap'),
    })
    expect(lockedEmp201.status).toBe('approved_locked')

    const emp501 = await statutory.prepareEmp501(clerk, {
      id: 'emp501-1', ...scope, taxYearId: taxYear.id, expectedVersion: 0, ...request('emp501'),
    })
    expect(emp501.reconciled).toBe(true)
    expect(emp501.difference.payeMinor).toBe(0)
    statutory.registerApproval(approval('ap-emp501', 'payroll.statutory.approve'))
    const lockedEmp501 = await statutory.approveEmp501(approver, {
      id: emp501.id, ...scope, expectedVersion: emp501.version,
      approvalId: 'ap-emp501', reason: 'Year reconcile', ...request('emp501-ap'),
    })
    expect(lockedEmp501.status).toBe('approved_locked')
    expect(lockedEmp501.sarsSubmissionInitiated).toBe(false)

    const exportManifest = await statutory.generateExportManifest(clerk, {
      id: 'exp-1', ...scope, taxYearId: taxYear.id, kind: 'payroll_tax_summary',
      expectedVersion: 0, ...request('export'),
    })
    expect(exportManifest.format).toBe('json_evidence_v1')
    expect(exportManifest.sarsSubmissionInitiated).toBe(false)
    expect(exportManifest.externalEgressAllowed).toBe(false)
    expect(exportManifest.externalPaymentInitiated).toBe(false)
    expect(exportManifest.contentDigest).toHaveLength(64)

    const summary = statutory.getTaxSummary(clerk, scope, taxYear.id)
    expect(summary.employeeCertificates).toBe(1)
    expect(summary.emp201Count).toBe(1)
    expect(summary.emp501Reconciled).toBe(true)
    expect(summary.sarsSubmissionInitiated).toBe(false)

    const closed = await statutory.closeTaxYear(clerk, {
      ...scope, taxYearId: taxYear.id, expectedVersion: taxYear.version, ...request('close'),
    })
    expect(closed.status).toBe('closed')
    statutory.registerApproval(approval('ap-ty-lock', 'payroll.tax_year.lock'))
    const lockedYear = await statutory.lockTaxYear(approver, {
      ...scope, taxYearId: closed.id, expectedVersion: closed.version,
      approvalId: 'ap-ty-lock', reason: 'Year end lock', ...request('ty-lock'),
    })
    expect(lockedYear.status).toBe('locked')
    expect(lockedYear.immutable).toBe(true)

    await expect(statutory.prepareIrp5(clerk, {
      id: 'irp5-2', ...scope, taxYearId: lockedYear.id,
      employeeId: seeded.employee.id, employmentId: seeded.employment.id,
      expectedVersion: 0, ...request('irp5-locked'),
    })).rejects.toThrow(/locked/)

    expect(store.auditEvents.every((e) => e.externalEgressAllowed === false)).toBe(true)
    expect(store.auditEvents.some((e) => e.eventType === 'payroll.irp5.approved_locked')).toBe(true)
    expect(store.auditEvents.some((e) => e.eventType === 'payroll.emp501.approved_locked')).toBe(true)
  })
})
