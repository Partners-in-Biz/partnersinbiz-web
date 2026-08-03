import type { DocumentData, Firestore } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { authorizeFinanceAction } from '@/lib/finance/policy'
import { canonicalDigest, scopedStorageId } from '@/lib/finance/integrity'
import type { FinanceActorContext, FinanceApprovalRecord, FinanceScope } from '@/lib/finance/types'
import {
  FinancePayrollCalculationService,
  InMemoryPayrollStore,
  type ApprovePayrollRuleVersionCommand,
  type CalculateEmployeePayrollCommand,
  type CreateEmploymentTermVersionCommand,
  type CreatePayComponentCommand,
  type CreatePayPeriodCommand,
  type CreatePayrollCalendarCommand,
  type CreatePayrollEmployeeCommand,
  type CreatePayrollEmploymentCommand,
  type CreatePayrollRuleVersionCommand,
  type PayrollServiceState,
} from './calculation-service'
import {
  FinancePayRunService,
  type AddPayRunItemCommand,
  type ApproveLockPayRunCommand,
  type ApplyIndividualAdjustmentCommand,
  type CreateCorrectionPayRunCommand,
  type CreatePayRunCommand,
  type FreezePayRunInputsCommand,
  type ObserveExternalSalaryPaymentCommand,
  type ReversePayRunCommand,
  type SubmitPayRunCommand,
} from './pay-run-service'
import {
  FinancePayrollStatutoryService,
  type ApproveStatutoryCommand,
  type ApproveYtdOpeningCommand,
  type CloseTaxYearCommand,
  type CreateTaxYearCommand,
  type CreateYtdOpeningCommand,
  type GenerateExportCommand,
  type LockTaxYearCommand,
  type PrepareEmp201Command,
  type PrepareEmp501Command,
  type PrepareIrp5Command,
} from './statutory-service'
import {
  FinancePayrollLeaveService,
  type BuildPayslipPackCommand,
  type CreateLeaveTypeCommand,
  type DecideLeaveCommand,
  type LinkEmployeeUserCommand,
  type RequestLeaveCommand,
  type SetLeaveBalanceCommand,
} from './leave-service'
import {
  FinancePayrollBureauService,
  type ActivateSalaryStructureCommand,
  type BuildBulkPayslipRunPackCommand,
  type BuildEmp501AnnualPackCommand,
  type CreateSalaryStructureCommand,
  type ExpandSalaryStructureCommand,
  type MarkBulkPayslipRunPackDownloadedCommand,
} from './bureau-service'
import type {
  BulkPayslipRunPack,
  SalaryStructureTemplate,
} from './bureau-types'
import { FinanceNotFoundError } from '@/lib/finance/errors'
import type {
  Emp201Snapshot,
  Emp501Reconciliation,
  EmploymentTermVersion,
  Irp5Record,
  LeaveBalance,
  LeaveRecord,
  LeaveType,
  PayComponentDefinition,
  PayPeriod,
  PayRun,
  PayRunItem,
  PayrollAdjustment,
  PayrollCalendar,
  PayrollCalculationRecord,
  PayrollEmployee,
  PayrollEmployment,
  PayrollExportManifest,
  PayrollRuleVersion,
  PayrollTaxYear,
  PayrollYtdOpening,
  Payslip,
  PayslipDownloadPack,
} from './types'

export type {
  AddPayRunItemCommand,
  ApplyIndividualAdjustmentCommand,
  ApproveLockPayRunCommand,
  ApprovePayrollRuleVersionCommand,
  ApproveStatutoryCommand,
  ApproveYtdOpeningCommand,
  BuildPayslipPackCommand,
  CalculateEmployeePayrollCommand,
  CloseTaxYearCommand,
  CreateCorrectionPayRunCommand,
  CreateEmploymentTermVersionCommand,
  CreateLeaveTypeCommand,
  CreatePayComponentCommand,
  CreatePayPeriodCommand,
  CreatePayRunCommand,
  CreatePayrollCalendarCommand,
  CreatePayrollEmployeeCommand,
  CreatePayrollEmploymentCommand,
  CreatePayrollRuleVersionCommand,
  CreateTaxYearCommand,
  CreateYtdOpeningCommand,
  DecideLeaveCommand,
  FreezePayRunInputsCommand,
  GenerateExportCommand,
  LinkEmployeeUserCommand,
  LockTaxYearCommand,
  ObserveExternalSalaryPaymentCommand,
  PrepareEmp201Command,
  PrepareEmp501Command,
  PrepareIrp5Command,
  RequestLeaveCommand,
  ReversePayRunCommand,
  SetLeaveBalanceCommand,
  SubmitPayRunCommand,
  ActivateSalaryStructureCommand,
  BuildBulkPayslipRunPackCommand,
  BuildEmp501AnnualPackCommand,
  CreateSalaryStructureCommand,
  ExpandSalaryStructureCommand,
  MarkBulkPayslipRunPackDownloadedCommand,
}

function clean<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clean) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, clean(item)]),
    ) as T
  }
  return value
}

function matchesScope(data: DocumentData | undefined, scope: Required<FinanceScope>): boolean {
  return Boolean(
    data
    && data.orgId === scope.orgId
    && data.legalEntityId === scope.legalEntityId
    && data.bookId === scope.bookId,
  )
}

async function hydratePayrollStore(db: Firestore, scope: Required<FinanceScope>): Promise<InMemoryPayrollStore> {
  const store = new InMemoryPayrollStore()
  const loads = await Promise.all([
    db.collection('payroll_employees').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('payroll_employments').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('employment_term_versions').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('pay_components').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('payroll_rule_versions').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('payroll_calendars').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('pay_periods').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('payroll_calculations').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('pay_runs').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('pay_run_items').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('payslips').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('payroll_adjustments').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('payroll_tax_years').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('payroll_ytd_openings').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('irp5_records').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('emp201_snapshots').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('emp501_reconciliations').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('payroll_export_manifests').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('leave_types').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('leave_balances').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('leave_records').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('payslip_download_packs').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('salary_structure_templates').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('bulk_payslip_run_packs').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('finance_approvals').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('finance_unique_claims').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).get(),
    db.collection('finance_idempotency_claims').where('orgId', '==', scope.orgId).get(),
    db.collection('finance_audit_events').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
  ])

  const [
    employees, employments, terms, components, rules, calendars, periods, calcs,
    runs, items, payslips, adjustments, taxYears, ytd, irp5, emp201, emp501, exports,
    leaveTypes, leaveBalances, leaveRecords, payslipPacks,
    salaryStructures, bulkPayslipPacks,
    approvals, claims, idempotency, audit,
  ] = loads

  const put = <T extends { id: string }>(snap: { docs: Array<{ data: () => DocumentData }> }, map: Map<string, T>, cast: (d: DocumentData) => T) => {
    for (const doc of snap.docs) {
      const value = cast(doc.data())
      if (matchesScope(value as unknown as DocumentData, scope)) map.set(value.id, value)
    }
  }

  put(employees, store.employees, (d) => d as PayrollEmployee)
  put(employments, store.employments, (d) => d as PayrollEmployment)
  put(terms, store.termVersions, (d) => d as EmploymentTermVersion)
  put(components, store.components, (d) => d as PayComponentDefinition)
  put(rules, store.ruleVersions, (d) => d as PayrollRuleVersion)
  put(calendars, store.calendars, (d) => d as PayrollCalendar)
  put(periods, store.periods, (d) => d as PayPeriod)
  put(calcs, store.calculations, (d) => d as PayrollCalculationRecord)
  put(runs, store.payRuns, (d) => d as PayRun)
  put(items, store.payRunItems, (d) => d as PayRunItem)
  put(payslips, store.payslips, (d) => d as Payslip)
  put(adjustments, store.adjustments, (d) => d as PayrollAdjustment)
  put(taxYears, store.taxYears, (d) => d as PayrollTaxYear)
  put(ytd, store.ytdOpenings, (d) => d as PayrollYtdOpening)
  put(irp5, store.irp5Records, (d) => d as Irp5Record)
  put(emp201, store.emp201Snapshots, (d) => d as Emp201Snapshot)
  put(emp501, store.emp501Reconciliations, (d) => d as Emp501Reconciliation)
  put(exports, store.exportManifests, (d) => d as PayrollExportManifest)
  put(leaveTypes, store.leaveTypes, (d) => d as LeaveType)
  put(leaveBalances, store.leaveBalances, (d) => d as LeaveBalance)
  put(leaveRecords, store.leaveRecords, (d) => d as LeaveRecord)
  put(payslipPacks, store.payslipPacks, (d) => d as PayslipDownloadPack)
  put(salaryStructures, store.salaryStructures, (d) => d as SalaryStructureTemplate)
  put(bulkPayslipPacks, store.bulkPayslipPacks, (d) => d as BulkPayslipRunPack)
  put(approvals, store.approvals, (d) => d as FinanceApprovalRecord)

  for (const doc of claims.docs) {
    const data = doc.data()
    if (!data || data.orgId !== scope.orgId) continue
    if (data.bookId && data.bookId !== scope.bookId) continue
    if (typeof data.aggregateId === 'string') store.uniqueClaims.set(doc.id, data.aggregateId)
  }
  for (const doc of idempotency.docs) {
    const data = doc.data()
    if (!data || data.orgId !== scope.orgId) continue
    store.idempotency.set(doc.id, data as PayrollServiceState['idempotency'] extends Map<string, infer V> ? V : never)
  }
  for (const doc of audit.docs) {
    const data = doc.data()
    if (!matchesScope(data, scope)) continue
    const et = String(data.eventType || '')
    if (et.startsWith('payroll.') || et.startsWith('pay_run') || et.startsWith('payslip') || et.startsWith('irp5') || et.startsWith('emp')) {
      store.auditEvents.push(data as PayrollServiceState['auditEvents'][number])
    }
  }
  store.auditEvents.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
  return store
}

async function persistPayrollStore(
  db: Firestore,
  scope: Required<FinanceScope>,
  before: PayrollServiceState,
  after: PayrollServiceState,
  actor: FinanceActorContext,
): Promise<void> {
  const batch = db.batch()
  const now = new Date().toISOString()

  const writeMap = <T extends { id: string }>(
    collection: string,
    previous: Map<string, T>,
    next: Map<string, T>,
  ) => {
    for (const [id, value] of next) {
      const prev = previous.get(id)
      if (prev && canonicalDigest(clean(prev)) === canonicalDigest(clean(value))) continue
      batch.set(db.collection(collection).doc(scopedStorageId(scope, id)), clean(value), { merge: false })
    }
  }

  writeMap('payroll_employees', before.employees, after.employees)
  writeMap('payroll_employments', before.employments, after.employments)
  writeMap('employment_term_versions', before.termVersions, after.termVersions)
  writeMap('pay_components', before.components, after.components)
  writeMap('payroll_rule_versions', before.ruleVersions, after.ruleVersions)
  writeMap('payroll_calendars', before.calendars, after.calendars)
  writeMap('pay_periods', before.periods, after.periods)
  writeMap('payroll_calculations', before.calculations, after.calculations)
  writeMap('pay_runs', before.payRuns, after.payRuns)
  writeMap('pay_run_items', before.payRunItems, after.payRunItems)
  writeMap('payslips', before.payslips, after.payslips)
  writeMap('payroll_adjustments', before.adjustments, after.adjustments)
  writeMap('payroll_tax_years', before.taxYears, after.taxYears)
  writeMap('payroll_ytd_openings', before.ytdOpenings, after.ytdOpenings)
  writeMap('irp5_records', before.irp5Records, after.irp5Records)
  writeMap('emp201_snapshots', before.emp201Snapshots, after.emp201Snapshots)
  writeMap('emp501_reconciliations', before.emp501Reconciliations, after.emp501Reconciliations)
  writeMap('payroll_export_manifests', before.exportManifests, after.exportManifests)
  writeMap('leave_types', before.leaveTypes, after.leaveTypes)
  writeMap('leave_balances', before.leaveBalances, after.leaveBalances)
  writeMap('leave_records', before.leaveRecords, after.leaveRecords)
  writeMap('payslip_download_packs', before.payslipPacks, after.payslipPacks)
  writeMap('salary_structure_templates', before.salaryStructures, after.salaryStructures)
  writeMap('bulk_payslip_run_packs', before.bulkPayslipPacks, after.bulkPayslipPacks)

  for (const [claimId, aggregateId] of after.uniqueClaims) {
    if (before.uniqueClaims.get(claimId) === aggregateId) continue
    batch.set(db.collection('finance_unique_claims').doc(claimId), clean({
      schemaVersion: 1,
      claimType: 'payroll',
      orgId: scope.orgId,
      legalEntityId: scope.legalEntityId,
      bookId: scope.bookId,
      aggregateId,
      createdAt: now,
      createdBy: actor.uid,
    }), { merge: true })
  }

  for (const [idemId, record] of after.idempotency) {
    if (before.idempotency.has(idemId)) continue
    batch.set(db.collection('finance_idempotency_claims').doc(idemId), clean(record), { merge: false })
  }

  if (after.auditEvents.length > before.auditEvents.length) {
    const added = after.auditEvents.slice(before.auditEvents.length)
    for (const event of added) {
      const id = event.id || `praud_${canonicalDigest(event).slice(0, 24)}`
      batch.set(db.collection('finance_audit_events').doc(scopedStorageId(scope, id)), clean({ ...event, id }), { merge: false })
    }
  }

  await batch.commit()
}

function snapshotState(store: InMemoryPayrollStore): PayrollServiceState {
  return {
    employees: new Map(store.employees),
    employments: new Map(store.employments),
    termVersions: new Map(store.termVersions),
    components: new Map(store.components),
    ruleVersions: new Map(store.ruleVersions),
    calendars: new Map(store.calendars),
    periods: new Map(store.periods),
    calculations: new Map(store.calculations),
    payRuns: new Map(store.payRuns),
    payRunItems: new Map(store.payRunItems),
    payslips: new Map(store.payslips),
    adjustments: new Map(store.adjustments),
    leaveTypes: new Map(store.leaveTypes),
    leaveBalances: new Map(store.leaveBalances),
    leaveRecords: new Map(store.leaveRecords),
    payslipPacks: new Map(store.payslipPacks),
    salaryStructures: new Map(store.salaryStructures),
    bulkPayslipPacks: new Map(store.bulkPayslipPacks),
    taxYears: new Map(store.taxYears),
    ytdOpenings: new Map(store.ytdOpenings),
    irp5Records: new Map(store.irp5Records),
    emp201Snapshots: new Map(store.emp201Snapshots),
    emp501Reconciliations: new Map(store.emp501Reconciliations),
    exportManifests: new Map(store.exportManifests),
    approvals: new Map(store.approvals),
    uniqueClaims: new Map(store.uniqueClaims),
    idempotency: new Map(store.idempotency),
    auditEvents: structuredClone(store.auditEvents),
  }
}

export class FirestoreFinancePayrollGateway {
  private readonly db: Firestore

  constructor(options: { db?: Firestore } = {}) {
    this.db = options.db ?? adminDb
  }

  private scopeOf(command: { orgId: string; legalEntityId: string; bookId: string }): Required<FinanceScope> {
    return { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
  }

  private async withStore<T>(
    actor: FinanceActorContext,
    scope: Required<FinanceScope>,
    run: (store: InMemoryPayrollStore) => Promise<T> | T,
  ): Promise<T> {
    const store = await hydratePayrollStore(this.db, scope)
    const before = snapshotState(store)
    const result = await run(store)
    await persistPayrollStore(this.db, scope, before, store, actor)
    return result
  }

  // Calculation
  createEmployee(actor: FinanceActorContext, command: CreatePayrollEmployeeCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayrollCalculationService(store).createEmployee(actor, command))
  }
  createEmployment(actor: FinanceActorContext, command: CreatePayrollEmploymentCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayrollCalculationService(store).createEmployment(actor, command))
  }
  createTermVersion(actor: FinanceActorContext, command: CreateEmploymentTermVersionCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayrollCalculationService(store).createTermVersion(actor, command))
  }
  createPayComponent(actor: FinanceActorContext, command: CreatePayComponentCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayrollCalculationService(store).createPayComponent(actor, command))
  }
  createRuleVersion(actor: FinanceActorContext, command: CreatePayrollRuleVersionCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayrollCalculationService(store).createRuleVersion(actor, command))
  }
  approveRuleVersion(actor: FinanceActorContext, command: ApprovePayrollRuleVersionCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayrollCalculationService(store).approveRuleVersion(actor, command))
  }
  createCalendar(actor: FinanceActorContext, command: CreatePayrollCalendarCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayrollCalculationService(store).createCalendar(actor, command))
  }
  createPayPeriod(actor: FinanceActorContext, command: CreatePayPeriodCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayrollCalculationService(store).createPayPeriod(actor, command))
  }
  calculateEmployee(actor: FinanceActorContext, command: CalculateEmployeePayrollCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayrollCalculationService(store).calculateEmployee(actor, command))
  }

  // Pay runs
  createPayRun(actor: FinanceActorContext, command: CreatePayRunCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayRunService(store).createPayRun(actor, command))
  }
  addPayRunItem(actor: FinanceActorContext, command: AddPayRunItemCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayRunService(store).addItem(actor, command))
  }
  freezePayRunInputs(actor: FinanceActorContext, command: FreezePayRunInputsCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayRunService(store).freezeInputs(actor, command))
  }
  submitPayRun(actor: FinanceActorContext, command: SubmitPayRunCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayRunService(store).submitForReview(actor, command))
  }
  approveLockPayRun(actor: FinanceActorContext, command: ApproveLockPayRunCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayRunService(store).approveAndLock(actor, command))
  }
  reversePayRun(actor: FinanceActorContext, command: ReversePayRunCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayRunService(store).reversePayRun(actor, command))
  }
  createCorrectionRun(actor: FinanceActorContext, command: CreateCorrectionPayRunCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayRunService(store).createCorrectionRun(actor, command))
  }
  applyIndividualAdjustment(actor: FinanceActorContext, command: ApplyIndividualAdjustmentCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayRunService(store).applyIndividualAdjustment(actor, command))
  }
  observeExternalSalaryPayment(actor: FinanceActorContext, command: ObserveExternalSalaryPaymentCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayRunService(store).observeExternalSalaryPayment(actor, command))
  }

  // Statutory
  createTaxYear(actor: FinanceActorContext, command: CreateTaxYearCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayrollStatutoryService(store).createTaxYear(actor, command))
  }
  closeTaxYear(actor: FinanceActorContext, command: CloseTaxYearCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayrollStatutoryService(store).closeTaxYear(actor, command))
  }
  lockTaxYear(actor: FinanceActorContext, command: LockTaxYearCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayrollStatutoryService(store).lockTaxYear(actor, command))
  }
  createYtdOpening(actor: FinanceActorContext, command: CreateYtdOpeningCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayrollStatutoryService(store).createYtdOpening(actor, command))
  }
  approveYtdOpening(actor: FinanceActorContext, command: ApproveYtdOpeningCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayrollStatutoryService(store).approveYtdOpening(actor, command))
  }
  prepareIrp5(actor: FinanceActorContext, command: PrepareIrp5Command) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayrollStatutoryService(store).prepareIrp5(actor, command))
  }
  approveIrp5(actor: FinanceActorContext, command: ApproveStatutoryCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayrollStatutoryService(store).approveIrp5(actor, command))
  }
  prepareEmp201(actor: FinanceActorContext, command: PrepareEmp201Command) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayrollStatutoryService(store).prepareEmp201(actor, command))
  }
  approveEmp201(actor: FinanceActorContext, command: ApproveStatutoryCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayrollStatutoryService(store).approveEmp201(actor, command))
  }
  prepareEmp501(actor: FinanceActorContext, command: PrepareEmp501Command) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayrollStatutoryService(store).prepareEmp501(actor, command))
  }
  approveEmp501(actor: FinanceActorContext, command: ApproveStatutoryCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayrollStatutoryService(store).approveEmp501(actor, command))
  }
  generateExportManifest(actor: FinanceActorContext, command: GenerateExportCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayrollStatutoryService(store).generateExportManifest(actor, command))
  }

  createLeaveType(actor: FinanceActorContext, command: CreateLeaveTypeCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayrollLeaveService(store).createLeaveType(actor, command))
  }
  setLeaveBalance(actor: FinanceActorContext, command: SetLeaveBalanceCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayrollLeaveService(store).setLeaveBalance(actor, command))
  }
  requestLeave(actor: FinanceActorContext, command: RequestLeaveCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayrollLeaveService(store).requestLeave(actor, command))
  }
  decideLeave(actor: FinanceActorContext, command: DecideLeaveCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayrollLeaveService(store).decideLeave(actor, command))
  }
  linkEmployeeUser(actor: FinanceActorContext, command: LinkEmployeeUserCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayrollLeaveService(store).linkEmployeeUser(actor, command))
  }
  buildPayslipPack(actor: FinanceActorContext, command: BuildPayslipPackCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayrollLeaveService(store).buildPayslipPack(actor, command))
  }
  markPayslipPackDownloaded(
    actor: FinanceActorContext,
    command: Required<FinanceScope> & { packId: string; requestId: string; idempotencyKey: string },
  ) {
    return this.withStore(actor, this.scopeOf(command), (store) =>
      new FinancePayrollLeaveService(store).markPayslipPackDownloaded(actor, this.scopeOf(command), command.packId, {
        requestId: command.requestId,
        idempotencyKey: command.idempotencyKey,
      }),
    )
  }

  createSalaryStructure(actor: FinanceActorContext, command: CreateSalaryStructureCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayrollBureauService(store).createSalaryStructure(actor, command))
  }
  activateSalaryStructure(actor: FinanceActorContext, command: ActivateSalaryStructureCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayrollBureauService(store).activateSalaryStructure(actor, command))
  }
  expandSalaryStructure(actor: FinanceActorContext, command: ExpandSalaryStructureCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayrollBureauService(store).expandSalaryStructure(actor, command))
  }
  buildBulkPayslipRunPack(actor: FinanceActorContext, command: BuildBulkPayslipRunPackCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayrollBureauService(store).buildBulkPayslipRunPack(actor, command))
  }
  markBulkPayslipRunPackDownloaded(actor: FinanceActorContext, command: MarkBulkPayslipRunPackDownloadedCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayrollBureauService(store).markBulkPayslipRunPackDownloaded(actor, command))
  }
  buildEmp501AnnualPack(actor: FinanceActorContext, command: BuildEmp501AnnualPackCommand) {
    return this.withStore(actor, this.scopeOf(command), (store) => new FinancePayrollBureauService(store).buildEmp501AnnualPack(actor, command))
  }

  async listBundle(actor: FinanceActorContext, scope: Required<FinanceScope>) {
    authorizeFinanceAction(actor, scope, 'payroll.employee.read')
    const store = await hydratePayrollStore(this.db, scope)
    const payRuns = new FinancePayRunService(store)
    const statutory = new FinancePayrollStatutoryService(store)
    const leave = new FinancePayrollLeaveService(store)
    const bureau = new FinancePayrollBureauService(store)
    const leaveBundle = leave.listLeaveBundle(scope)
    const board = bureau.projectPayRunBoard(actor, scope)
    const now = new Date()
    const leaveMonth = bureau.projectLeaveMonth(actor, scope, now.getUTCFullYear(), now.getUTCMonth() + 1)
    return {
      employees: [...store.employees.values()].map((e) => ({
        id: e.id,
        employeeNumber: e.employeeNumber,
        displayName: e.displayName,
        status: e.status,
        startDate: e.startDate,
        taxResidency: e.taxResidency,
        linkedUserId: e.linkedUserId ?? null,
        version: e.version,
      })),
      employments: [...store.employments.values()],
      termVersions: [...store.termVersions.values()],
      components: [...store.components.values()],
      ruleVersions: [...store.ruleVersions.values()],
      calendars: [...store.calendars.values()],
      periods: [...store.periods.values()],
      calendarProjection: leaveBundle.calendarProjection,
      leaveTypes: leaveBundle.leaveTypes,
      leaveBalances: leaveBundle.leaveBalances,
      leaveRecords: leaveBundle.leaveRecords,
      leaveMonth,
      payRunBoard: board,
      salaryStructures: bureau.listSalaryStructures(actor, scope),
      bulkPayslipPackCount: store.bulkPayslipPacks.size,
      calculations: [...store.calculations.values()],
      payRuns: [...store.payRuns.values()],
      payRunItems: [...store.payRunItems.values()],
      adjustments: [...store.adjustments.values()],
      taxYears: [...store.taxYears.values()],
      ytdOpenings: [...store.ytdOpenings.values()],
      payslipCount: store.payslips.size,
      irp5Count: store.irp5Records.size,
      emp201Count: store.emp201Snapshots.size,
      emp501Count: store.emp501Reconciliations.size,
      exportManifestCount: store.exportManifests.size,
      veraFixtureIds: bureau.listVeraFixtures(actor, scope).fixtureIds,
      externalPaymentInitiated: false,
      sarsSubmissionInitiated: false,
      externalEgressAllowed: false,
      autoSent: false,
      massEmailAllowed: false,
      payRunsService: Boolean(payRuns),
      statutoryService: Boolean(statutory),
    }
  }

  async getPayslip(actor: FinanceActorContext, scope: Required<FinanceScope>, payslipId: string) {
    const store = await hydratePayrollStore(this.db, scope)
    return new FinancePayRunService(store).getPayslip(actor, scope, payslipId)
  }

  async listMyPayslips(actor: FinanceActorContext, scope: Required<FinanceScope>) {
    const store = await hydratePayrollStore(this.db, scope)
    return new FinancePayrollLeaveService(store).listMyPayslips(actor, scope)
  }

  async listEssBundle(actor: FinanceActorContext, scope: Required<FinanceScope>) {
    const store = await hydratePayrollStore(this.db, scope)
    return new FinancePayrollLeaveService(store).listEssBundle(actor, scope)
  }

  async getPayslipPack(actor: FinanceActorContext, scope: Required<FinanceScope>, packId: string) {
    const store = await hydratePayrollStore(this.db, scope)
    const pack = store.payslipPacks.get(packId)
    if (!pack || pack.orgId !== scope.orgId || pack.legalEntityId !== scope.legalEntityId || pack.bookId !== scope.bookId) {
      throw new FinanceNotFoundError('Payslip pack not found')
    }
    new FinancePayRunService(store).getPayslip(actor, scope, pack.payslipId)
    return structuredClone(pack)
  }

  async getBulkPayslipRunPack(actor: FinanceActorContext, scope: Required<FinanceScope>, packId: string) {
    const store = await hydratePayrollStore(this.db, scope)
    authorizeFinanceAction(actor, scope, 'payroll.payslip.read')
    const pack = store.bulkPayslipPacks.get(packId)
    if (!pack || pack.orgId !== scope.orgId || pack.legalEntityId !== scope.legalEntityId || pack.bookId !== scope.bookId) {
      throw new FinanceNotFoundError('Bulk payslip pack not found')
    }
    return structuredClone(pack)
  }

  async getPayRunBoard(actor: FinanceActorContext, scope: Required<FinanceScope>, options?: { windowStart?: string; windowEnd?: string }) {
    const store = await hydratePayrollStore(this.db, scope)
    return new FinancePayrollBureauService(store).projectPayRunBoard(actor, scope, options)
  }

  async getLeaveMonth(actor: FinanceActorContext, scope: Required<FinanceScope>, year: number, month: number) {
    const store = await hydratePayrollStore(this.db, scope)
    return new FinancePayrollBureauService(store).projectLeaveMonth(actor, scope, year, month)
  }

  async listSalaryStructures(actor: FinanceActorContext, scope: Required<FinanceScope>) {
    const store = await hydratePayrollStore(this.db, scope)
    return new FinancePayrollBureauService(store).listSalaryStructures(actor, scope)
  }

  async listVeraFixtures(actor: FinanceActorContext, scope: Required<FinanceScope>) {
    const store = await hydratePayrollStore(this.db, scope)
    return new FinancePayrollBureauService(store).listVeraFixtures(actor, scope)
  }

  async runVeraFixture(actor: FinanceActorContext, scope: Required<FinanceScope>, fixtureId: string) {
    const store = await hydratePayrollStore(this.db, scope)
    return new FinancePayrollBureauService(store).runVeraFixture(actor, scope, fixtureId)
  }

  async getIrp5(actor: FinanceActorContext, scope: Required<FinanceScope>, id: string) {
    const store = await hydratePayrollStore(this.db, scope)
    return new FinancePayrollStatutoryService(store).getIrp5(actor, scope, id)
  }

  async getEmp201(actor: FinanceActorContext, scope: Required<FinanceScope>, id: string) {
    const store = await hydratePayrollStore(this.db, scope)
    return new FinancePayrollStatutoryService(store).getEmp201(actor, scope, id)
  }

  async getEmp501(actor: FinanceActorContext, scope: Required<FinanceScope>, id: string) {
    const store = await hydratePayrollStore(this.db, scope)
    return new FinancePayrollStatutoryService(store).getEmp501(actor, scope, id)
  }

  async getExportManifest(actor: FinanceActorContext, scope: Required<FinanceScope>, id: string) {
    const store = await hydratePayrollStore(this.db, scope)
    return new FinancePayrollStatutoryService(store).getExportManifest(actor, scope, id)
  }
}
