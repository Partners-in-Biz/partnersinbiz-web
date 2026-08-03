import { authorizeFinanceAction } from '@/lib/finance/policy'
import {
  CANONICAL_PAYLOAD_VERSION,
  HASH_ALGORITHM_VERSION,
  canonicalDigest,
  canonicalScopeIdentity,
  scopedClaimId,
} from '@/lib/finance/integrity'
import type {
  FinanceActorContext,
  FinanceApprovalAction,
  FinanceApprovalRecord,
  FinanceScope,
} from '@/lib/finance/types'
import {
  FinanceValidationError,
  assertCreateVersion,
  assertEnumValue,
  immutableContentHash,
  parseCanonicalDate,
  requiredText,
} from '@/lib/accounting/foundation'
import {
  assertPayrollRuleVersionHash,
  calculatePayrollPeriod,
  buildPayrollRuleContentHash,
} from './calculation'
import { approvedLeaveToCalcInputs, mergeLeaveInputs } from './leave'
import type {
  EmploymentTermVersion,
  PayComponentDefinition,
  PayComponentKind,
  PayFrequency,
  PayPeriod,
  PayrollAuditEvent,
  PayrollCalculationInput,
  PayrollCalculationRecord,
  PayrollCalendar,
  PayrollEmployee,
  PayrollEmployment,
  PayrollRuleVersion,
  PeriodComponentInput,
  LeaveRecordInput,
  WorkerCategory,
} from './types'

interface CommandIdentity { requestId: string; idempotencyKey: string }

export interface CreatePayrollEmployeeCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  employeeNumber: string
  displayName: string
  taxResidency: 'za_resident' | 'non_resident'
  dateOfBirth?: string
  startDate: string
  linkedUserId?: string
  expectedVersion: 0
}

export interface CreatePayrollEmploymentCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  employeeId: string
  branchId?: string
  expectedVersion: 0
}

export interface CreateEmploymentTermVersionCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  employeeId: string
  employmentId: string
  versionNumber: number
  workerCategory: WorkerCategory
  frequency: PayFrequency
  rateMinor: number
  standardHoursPerPeriod: number
  overtimeMultiplierNumerator: number
  overtimeMultiplierDenominator: number
  subjectToUif: boolean
  subjectToSdl: boolean
  effectiveFrom: string
  effectiveTo?: string
  expectedVersion: 0
}

export interface CreatePayComponentCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  code: string
  name: string
  kind: PayComponentKind
  taxTreatment: PayComponentDefinition['taxTreatment']
  uifTreatment: PayComponentDefinition['uifTreatment']
  sdlTreatment: PayComponentDefinition['sdlTreatment']
  jurisdictionCode: string
  expectedVersion: 0
}

export interface CreatePayrollRuleVersionCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  jurisdictionCode: string
  versionNumber: number
  packageId: string
  taxYearLabel: string
  effectiveFrom: string
  effectiveTo?: string
  payeBrackets: PayrollRuleVersion['payeBrackets']
  uif: PayrollRuleVersion['uif']
  sdl: PayrollRuleVersion['sdl']
  primaryRebateMinor: number
  secondaryRebateMinor: number
  tertiaryRebateMinor: number
  secondaryAgeFrom: number
  tertiaryAgeFrom: number
  periodsPerYearMonthly: number
  periodsPerYearWeekly: number
  roundingMode: 'half_up'
  sourceCitation: string
  sourceChecksum: string
  expectedVersion: 0
}

export interface ApprovePayrollRuleVersionCommand extends Required<FinanceScope>, CommandIdentity {
  ruleVersionId: string
  expectedVersion: number
  approvalId: string
  reason: string
}

export interface CreatePayrollCalendarCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  code: string
  name: string
  frequency: PayFrequency
  expectedVersion: 0
}

export interface CreatePayPeriodCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  calendarId: string
  label: string
  periodStart: string
  periodEnd: string
  /** ISO cut-off instant; defaults to payDate T23:59:59.000Z when omitted. */
  cutOffAt?: string
  payDate: string
  taxYearLabel: string
  expectedVersion: 0
}

export interface CalculateEmployeePayrollCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  employeeId: string
  employmentId: string
  termVersionId: string
  payPeriodId: string
  ruleVersionId: string
  ordinaryHoursWorked?: number
  overtimeHours?: number
  components?: PeriodComponentInput[]
  leave?: LeaveRecordInput[]
  ageYears?: number
  expectedVersion: 0
}

interface IdempotencyRecord {
  schemaVersion: 1
  canonicalPayloadVersion: 1
  hashAlgorithmVersion: typeof HASH_ALGORITHM_VERSION
  payloadDigest: string
  aggregateId: string
  operation: string
  actorId: string
  orgId: string
  scopeIdentity: string
  requestId: string
  expiresAt: string
  resultSnapshot: unknown
  resultDigest: string
}

export interface PayrollServiceState {
  employees: Map<string, PayrollEmployee>
  employments: Map<string, PayrollEmployment>
  termVersions: Map<string, EmploymentTermVersion>
  components: Map<string, PayComponentDefinition>
  ruleVersions: Map<string, PayrollRuleVersion>
  calendars: Map<string, PayrollCalendar>
  periods: Map<string, PayPeriod>
  calculations: Map<string, PayrollCalculationRecord>
  payRuns: Map<string, import('./types').PayRun>
  payRunItems: Map<string, import('./types').PayRunItem>
  payslips: Map<string, import('./types').Payslip>
  adjustments: Map<string, import('./types').PayrollAdjustment>
  leaveTypes: Map<string, import('./types').LeaveType>
  leaveBalances: Map<string, import('./types').LeaveBalance>
  leaveRecords: Map<string, import('./types').LeaveRecord>
  payslipPacks: Map<string, import('./types').PayslipDownloadPack>
  salaryStructures: Map<string, import('./bureau-types').SalaryStructureTemplate>
  bulkPayslipPacks: Map<string, import('./bureau-types').BulkPayslipRunPack>
  taxYears: Map<string, import('./types').PayrollTaxYear>
  ytdOpenings: Map<string, import('./types').PayrollYtdOpening>
  irp5Records: Map<string, import('./types').Irp5Record>
  emp201Snapshots: Map<string, import('./types').Emp201Snapshot>
  emp501Reconciliations: Map<string, import('./types').Emp501Reconciliation>
  exportManifests: Map<string, import('./types').PayrollExportManifest>
  approvals: Map<string, FinanceApprovalRecord>
  uniqueClaims: Map<string, string>
  idempotency: Map<string, IdempotencyRecord>
  auditEvents: PayrollAuditEvent[]
}

function cloneMap<T>(source: Map<string, T>): Map<string, T> {
  return new Map(Array.from(source, ([key, value]) => [key, structuredClone(value)]))
}

function cloneState(state: PayrollServiceState): PayrollServiceState {
  return {
    employees: cloneMap(state.employees),
    employments: cloneMap(state.employments),
    termVersions: cloneMap(state.termVersions),
    components: cloneMap(state.components),
    ruleVersions: cloneMap(state.ruleVersions),
    calendars: cloneMap(state.calendars),
    periods: cloneMap(state.periods),
    calculations: cloneMap(state.calculations),
    payRuns: cloneMap(state.payRuns),
    payRunItems: cloneMap(state.payRunItems),
    payslips: cloneMap(state.payslips),
    adjustments: cloneMap(state.adjustments),
    leaveTypes: cloneMap(state.leaveTypes),
    leaveBalances: cloneMap(state.leaveBalances),
    leaveRecords: cloneMap(state.leaveRecords),
    payslipPacks: cloneMap(state.payslipPacks),
    salaryStructures: cloneMap(state.salaryStructures),
    bulkPayslipPacks: cloneMap(state.bulkPayslipPacks),
    taxYears: cloneMap(state.taxYears),
    ytdOpenings: cloneMap(state.ytdOpenings),
    irp5Records: cloneMap(state.irp5Records),
    emp201Snapshots: cloneMap(state.emp201Snapshots),
    emp501Reconciliations: cloneMap(state.emp501Reconciliations),
    exportManifests: cloneMap(state.exportManifests),
    approvals: cloneMap(state.approvals),
    uniqueClaims: new Map(state.uniqueClaims),
    idempotency: cloneMap(state.idempotency),
    auditEvents: structuredClone(state.auditEvents),
  }
}

export class InMemoryPayrollStore implements PayrollServiceState {
  employees = new Map<string, PayrollEmployee>()
  employments = new Map<string, PayrollEmployment>()
  termVersions = new Map<string, EmploymentTermVersion>()
  components = new Map<string, PayComponentDefinition>()
  ruleVersions = new Map<string, PayrollRuleVersion>()
  calendars = new Map<string, PayrollCalendar>()
  periods = new Map<string, PayPeriod>()
  calculations = new Map<string, PayrollCalculationRecord>()
  payRuns = new Map<string, import('./types').PayRun>()
  payRunItems = new Map<string, import('./types').PayRunItem>()
  payslips = new Map<string, import('./types').Payslip>()
  adjustments = new Map<string, import('./types').PayrollAdjustment>()
  leaveTypes = new Map<string, import('./types').LeaveType>()
  leaveBalances = new Map<string, import('./types').LeaveBalance>()
  leaveRecords = new Map<string, import('./types').LeaveRecord>()
  payslipPacks = new Map<string, import('./types').PayslipDownloadPack>()
  salaryStructures = new Map<string, import('./bureau-types').SalaryStructureTemplate>()
  bulkPayslipPacks = new Map<string, import('./bureau-types').BulkPayslipRunPack>()
  taxYears = new Map<string, import('./types').PayrollTaxYear>()
  ytdOpenings = new Map<string, import('./types').PayrollYtdOpening>()
  irp5Records = new Map<string, import('./types').Irp5Record>()
  emp201Snapshots = new Map<string, import('./types').Emp201Snapshot>()
  emp501Reconciliations = new Map<string, import('./types').Emp501Reconciliation>()
  exportManifests = new Map<string, import('./types').PayrollExportManifest>()
  approvals = new Map<string, FinanceApprovalRecord>()
  uniqueClaims = new Map<string, string>()
  idempotency = new Map<string, IdempotencyRecord>()
  auditEvents: PayrollAuditEvent[] = []
  private transactionTail: Promise<void> = Promise.resolve()

  async transact<T>(operation: (state: PayrollServiceState) => T | Promise<T>): Promise<T> {
    let release!: () => void
    const predecessor = this.transactionTail
    this.transactionTail = new Promise<void>((resolve) => { release = resolve })
    await predecessor
    try {
      const draft = cloneState(this)
      const result = await operation(draft)
      Object.assign(this, draft)
      return result
    } finally {
      release()
    }
  }
}

function claim(state: PayrollServiceState, type: string, scope: FinanceScope, key: unknown, id: string, message: string): void {
  const claimId = scopedClaimId(type, scope, key)
  const existing = state.uniqueClaims.get(claimId)
  if (existing && existing !== id) throw new FinanceValidationError(message)
  state.uniqueClaims.set(claimId, id)
}

function compactUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}

function scopeOf(command: Required<FinanceScope>): Required<FinanceScope> {
  return {
    orgId: requiredText(command.orgId, 'orgId'),
    legalEntityId: requiredText(command.legalEntityId, 'legalEntityId'),
    bookId: requiredText(command.bookId, 'bookId'),
  }
}

function scopedGet<T extends { orgId: string; legalEntityId: string; bookId: string }>(
  map: Map<string, T>,
  id: string,
  scope: Required<FinanceScope>,
  label: string,
): T {
  const row = map.get(id)
  if (!row || row.orgId !== scope.orgId || row.legalEntityId !== scope.legalEntityId || row.bookId !== scope.bookId) {
    throw new FinanceValidationError(`${label} not found in scope`)
  }
  return row
}

function idempotencyInput(
  state: PayrollServiceState,
  actor: FinanceActorContext,
  scope: FinanceScope,
  operation: string,
  command: unknown,
  now: string,
): { retryId?: string; claimId: string; payloadDigest: string } {
  const payloadDigest = canonicalDigest(command)
  const claimId = scopedClaimId('payroll_idempotency', scope, {
    actorId: actor.uid,
    key: (command as CommandIdentity).idempotencyKey,
    operation,
  })
  const retry = state.idempotency.get(claimId)
  if (!retry) return { claimId, payloadDigest }
  if (
    retry.schemaVersion !== 1 ||
    retry.canonicalPayloadVersion !== CANONICAL_PAYLOAD_VERSION ||
    retry.hashAlgorithmVersion !== HASH_ALGORITHM_VERSION ||
    retry.actorId !== actor.uid ||
    retry.orgId !== scope.orgId ||
    retry.scopeIdentity !== canonicalScopeIdentity(scope) ||
    retry.operation !== operation ||
    retry.requestId !== (command as CommandIdentity).requestId ||
    retry.expiresAt <= now
  ) {
    throw new FinanceValidationError('Idempotency metadata is invalid, mismatched, or expired')
  }
  if (retry.payloadDigest !== payloadDigest) throw new FinanceValidationError('Idempotency key payload mismatch')
  return { retryId: retry.aggregateId, claimId, payloadDigest }
}

function storeIdempotency(
  state: PayrollServiceState,
  actor: FinanceActorContext,
  scope: FinanceScope,
  operation: string,
  command: unknown,
  aggregateId: string,
  claimId: string,
  payloadDigest: string,
  now: string,
  result: unknown,
): void {
  const compactResult = compactUndefined(result as Record<string, unknown>)
  state.idempotency.set(claimId, {
    schemaVersion: 1,
    canonicalPayloadVersion: CANONICAL_PAYLOAD_VERSION,
    hashAlgorithmVersion: HASH_ALGORITHM_VERSION,
    payloadDigest,
    aggregateId,
    operation,
    actorId: actor.uid,
    orgId: scope.orgId,
    scopeIdentity: canonicalScopeIdentity(scope),
    requestId: (command as CommandIdentity).requestId,
    expiresAt: new Date(Date.parse(now) + 24 * 60 * 60 * 1000).toISOString(),
    resultSnapshot: structuredClone(compactResult),
    resultDigest: canonicalDigest(compactResult),
  })
}

function loadApproval(
  state: PayrollServiceState,
  approvalId: string | undefined,
  scope: Required<FinanceScope>,
  action: FinanceApprovalAction,
  actorId: string,
  now: string,
) {
  if (!approvalId) throw new FinanceValidationError(`${action} approval evidence is required`)
  const approval = state.approvals.get(approvalId)
  if (!approval) throw new FinanceValidationError('Finance approval not found in scope')
  if (approval.orgId !== scope.orgId || approval.legalEntityId !== scope.legalEntityId || approval.bookId !== scope.bookId) {
    throw new FinanceValidationError('Finance approval scope does not match')
  }
  if (approval.action !== action || approval.status !== 'approved') {
    throw new FinanceValidationError(`approval action must be ${action}`)
  }
  if (approval.approvedBy === actorId) throw new FinanceValidationError('Approval violates separation of duties')
  if (approval.expiresAt && approval.expiresAt <= now) throw new FinanceValidationError('Finance approval has expired')
  return {
    approvalId: approval.id,
    approvedBy: approval.approvedBy,
    approvedAt: approval.approvedAt,
    action: approval.action,
    reason: approval.reason,
  }
}

function appendAudit(
  state: PayrollServiceState,
  scope: FinanceScope,
  actor: FinanceActorContext,
  eventType: string,
  aggregateType: string,
  aggregateId: string,
  aggregateVersion: number,
  now: string,
  command: CommandIdentity,
  payload: Record<string, unknown>,
  reason?: string,
): void {
  const scopeIdentity = canonicalScopeIdentity(scope)
  const previous = [...state.auditEvents].reverse().find((event) => canonicalScopeIdentity(event) === scopeIdentity)
  const sequence = (previous?.sequence ?? 0) + 1
  const base = {
    id: `praud_${scope.orgId}_${sequence}`,
    schemaVersion: 1 as const,
    orgId: scope.orgId,
    legalEntityId: scope.legalEntityId,
    ...(scope.bookId ? { bookId: scope.bookId } : {}),
    aggregateType,
    aggregateId,
    aggregateVersion,
    eventType,
    actorId: actor.uid,
    requestId: command.requestId,
    idempotencyKey: command.idempotencyKey,
    occurredAt: now,
    sequence,
    ...(previous ? { previousEventId: previous.id, previousEventHash: previous.eventHash } : {}),
    payload: compactUndefined(payload),
    externalEgressAllowed: false as const,
    canonicalPayloadVersion: 1 as const,
    hashAlgorithmVersion: HASH_ALGORITHM_VERSION,
    ...(reason ? { reason } : {}),
  }
  const event: PayrollAuditEvent = { ...base, eventHash: canonicalDigest(base) }
  state.auditEvents.push(event)
}

function versionedBase(id: string, scope: Required<FinanceScope>, actorId: string, now: string) {
  return {
    id,
    schemaVersion: 1 as const,
    orgId: scope.orgId,
    legalEntityId: scope.legalEntityId,
    bookId: scope.bookId,
    version: 1,
    createdAt: now,
    createdBy: actorId,
    updatedAt: now,
    updatedBy: actorId,
  }
}

function ageYearsFromDob(dateOfBirth: string | undefined, onDate: string): number | undefined {
  if (!dateOfBirth) return undefined
  parseCanonicalDate(dateOfBirth, 'dateOfBirth')
  parseCanonicalDate(onDate, 'onDate')
  const [by, bm, bd] = dateOfBirth.split('-').map(Number)
  const [oy, om, od] = onDate.split('-').map(Number)
  let age = oy - by
  if (om < bm || (om === bm && od < bd)) age -= 1
  return age
}

export class FinancePayrollCalculationService {
  constructor(
    private readonly store: InMemoryPayrollStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  registerApproval(approval: FinanceApprovalRecord): void {
    this.store.approvals.set(approval.id, structuredClone(approval))
  }

  async createEmployee(actor: FinanceActorContext, command: CreatePayrollEmployeeCommand): Promise<PayrollEmployee> {
    const now = this.now()
    return this.store.transact((state) => {
      assertCreateVersion(command.expectedVersion, 'payroll employee')
      const scope = scopeOf(command)
      authorizeFinanceAction(actor, scope, 'payroll.employee.write', now)
      const idem = idempotencyInput(state, actor, scope, 'payroll.employee.create', command, now)
      if (idem.retryId) return structuredClone(state.employees.get(idem.retryId)!)
      parseCanonicalDate(command.startDate, 'startDate')
      if (command.dateOfBirth) parseCanonicalDate(command.dateOfBirth, 'dateOfBirth')
      claim(state, 'payroll_employee_number', scope, command.employeeNumber.trim().toUpperCase(), command.id, 'Employee number already exists')
      claim(state, 'payroll_employee_id', scope, command.id, command.id, 'Employee id already exists')
      if (command.linkedUserId) {
        claim(state, 'payroll_employee_linked_user', scope, command.linkedUserId, command.id, 'User already linked to another employee')
      }
      const employee: PayrollEmployee = {
        ...versionedBase(command.id, scope, actor.uid, now),
        employeeNumber: requiredText(command.employeeNumber, 'employeeNumber'),
        displayName: requiredText(command.displayName, 'displayName'),
        status: 'active',
        taxResidency: command.taxResidency,
        ...(command.dateOfBirth ? { dateOfBirth: command.dateOfBirth } : {}),
        ...(command.linkedUserId ? { linkedUserId: command.linkedUserId } : {}),
        startDate: command.startDate,
      }
      state.employees.set(employee.id, employee)
      appendAudit(state, scope, actor, 'payroll.employee.created', 'payroll_employee', employee.id, employee.version, now, command, {
        employeeNumber: employee.employeeNumber,
      })
      storeIdempotency(state, actor, scope, 'payroll.employee.create', command, employee.id, idem.claimId, idem.payloadDigest, now, employee)
      return structuredClone(employee)
    })
  }

  async createEmployment(actor: FinanceActorContext, command: CreatePayrollEmploymentCommand): Promise<PayrollEmployment> {
    const now = this.now()
    return this.store.transact((state) => {
      assertCreateVersion(command.expectedVersion, 'payroll employment')
      const scope = scopeOf(command)
      authorizeFinanceAction(actor, scope, 'payroll.employee.write', now)
      const idem = idempotencyInput(state, actor, scope, 'payroll.employment.create', command, now)
      if (idem.retryId) return structuredClone(state.employments.get(idem.retryId)!)
      scopedGet(state.employees, command.employeeId, scope, 'Employee')
      claim(state, 'payroll_employment_id', scope, command.id, command.id, 'Employment id already exists')
      const employment: PayrollEmployment = {
        ...versionedBase(command.id, scope, actor.uid, now),
        employeeId: command.employeeId,
        ...(command.branchId ? { branchId: command.branchId } : {}),
        status: 'active',
      }
      state.employments.set(employment.id, employment)
      appendAudit(state, scope, actor, 'payroll.employment.created', 'payroll_employment', employment.id, employment.version, now, command, {
        employeeId: employment.employeeId,
      })
      storeIdempotency(state, actor, scope, 'payroll.employment.create', command, employment.id, idem.claimId, idem.payloadDigest, now, employment)
      return structuredClone(employment)
    })
  }

  async createTermVersion(actor: FinanceActorContext, command: CreateEmploymentTermVersionCommand): Promise<EmploymentTermVersion> {
    const now = this.now()
    return this.store.transact((state) => {
      assertCreateVersion(command.expectedVersion, 'employment term version')
      const scope = scopeOf(command)
      authorizeFinanceAction(actor, scope, 'payroll.employee.write', now)
      if (!(command.standardHoursPerPeriod > 0)) throw new FinanceValidationError('standardHoursPerPeriod must be positive')
      const standardHoursCenti = Math.round(command.standardHoursPerPeriod * 100)
      if (!Number.isSafeInteger(standardHoursCenti) || standardHoursCenti <= 0) {
        throw new FinanceValidationError('standardHoursPerPeriod must resolve to positive centi-hours')
      }
      const normalizedCommand = { ...command, standardHoursPerPeriod: standardHoursCenti }
      const idem = idempotencyInput(state, actor, scope, 'payroll.term.create', normalizedCommand, now)
      if (idem.retryId) return structuredClone(state.termVersions.get(idem.retryId)!)
      const employment = scopedGet(state.employments, command.employmentId, scope, 'Employment')
      if (employment.employeeId !== command.employeeId) throw new FinanceValidationError('Employment does not belong to employee')
      assertEnumValue(command.workerCategory, ['salaried', 'hourly'] as const, 'workerCategory')
      assertEnumValue(command.frequency, ['monthly', 'weekly'] as const, 'frequency')
      parseCanonicalDate(command.effectiveFrom, 'effectiveFrom')
      if (command.effectiveTo) parseCanonicalDate(command.effectiveTo, 'effectiveTo')
      if (!Number.isSafeInteger(command.rateMinor) || command.rateMinor <= 0) {
        throw new FinanceValidationError('rateMinor must be a positive safe integer')
      }
      if (!Number.isSafeInteger(command.overtimeMultiplierNumerator) || command.overtimeMultiplierNumerator <= 0) {
        throw new FinanceValidationError('overtimeMultiplierNumerator is invalid')
      }
      if (!Number.isSafeInteger(command.overtimeMultiplierDenominator) || command.overtimeMultiplierDenominator <= 0) {
        throw new FinanceValidationError('overtimeMultiplierDenominator is invalid')
      }
      claim(state, 'payroll_term_id', scope, command.id, command.id, 'Term version id already exists')
      claim(
        state,
        'payroll_term_version_number',
        scope,
        { employmentId: command.employmentId, versionNumber: command.versionNumber },
        command.id,
        'Term version number already exists for employment',
      )
      const draft = {
        ...versionedBase(command.id, scope, actor.uid, now),
        employeeId: command.employeeId,
        employmentId: command.employmentId,
        versionNumber: command.versionNumber,
        workerCategory: command.workerCategory,
        frequency: command.frequency,
        rateMinor: command.rateMinor,
        standardHoursCenti,
        overtimeMultiplierNumerator: command.overtimeMultiplierNumerator,
        overtimeMultiplierDenominator: command.overtimeMultiplierDenominator,
        subjectToUif: command.subjectToUif,
        subjectToSdl: command.subjectToSdl,
        effectiveFrom: command.effectiveFrom,
        ...(command.effectiveTo ? { effectiveTo: command.effectiveTo } : {}),
        status: 'active' as const,
        immutable: true as const,
      }
      const term: EmploymentTermVersion = { ...draft, contentHash: immutableContentHash(draft) }
      // supersede previous current
      if (employment.currentTermVersionId) {
        const previous = state.termVersions.get(employment.currentTermVersionId)
        if (previous && previous.orgId === scope.orgId) {
          state.termVersions.set(previous.id, {
            ...previous,
            status: 'superseded',
            version: previous.version + 1,
            updatedAt: now,
            updatedBy: actor.uid,
          })
        }
      }
      state.termVersions.set(term.id, term)
      state.employments.set(employment.id, {
        ...employment,
        currentTermVersionId: term.id,
        version: employment.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
      })
      appendAudit(state, scope, actor, 'payroll.term.created', 'employment_term_version', term.id, term.version, now, command, {
        employmentId: term.employmentId,
        workerCategory: term.workerCategory,
        frequency: term.frequency,
        rateMinor: term.rateMinor,
      })
      storeIdempotency(state, actor, scope, 'payroll.term.create', normalizedCommand, term.id, idem.claimId, idem.payloadDigest, now, term)
      return structuredClone(term)
    })
  }

  async createPayComponent(actor: FinanceActorContext, command: CreatePayComponentCommand): Promise<PayComponentDefinition> {
    const now = this.now()
    return this.store.transact((state) => {
      assertCreateVersion(command.expectedVersion, 'pay component')
      const scope = scopeOf(command)
      authorizeFinanceAction(actor, scope, 'payroll.component.configure', now)
      const idem = idempotencyInput(state, actor, scope, 'payroll.component.create', command, now)
      if (idem.retryId) return structuredClone(state.components.get(idem.retryId)!)
      claim(state, 'payroll_component_code', scope, command.code.trim().toUpperCase(), command.id, 'Pay component code already exists')
      const component: PayComponentDefinition = {
        ...versionedBase(command.id, scope, actor.uid, now),
        code: requiredText(command.code, 'code').toUpperCase(),
        name: requiredText(command.name, 'name'),
        kind: command.kind,
        taxTreatment: command.taxTreatment,
        uifTreatment: command.uifTreatment,
        sdlTreatment: command.sdlTreatment,
        active: true,
        jurisdictionCode: requiredText(command.jurisdictionCode, 'jurisdictionCode'),
      }
      state.components.set(component.id, component)
      appendAudit(state, scope, actor, 'payroll.component.created', 'pay_component', component.id, component.version, now, command, {
        code: component.code,
        kind: component.kind,
      })
      storeIdempotency(state, actor, scope, 'payroll.component.create', command, component.id, idem.claimId, idem.payloadDigest, now, component)
      return structuredClone(component)
    })
  }

  async createRuleVersion(actor: FinanceActorContext, command: CreatePayrollRuleVersionCommand): Promise<PayrollRuleVersion> {
    const now = this.now()
    return this.store.transact((state) => {
      assertCreateVersion(command.expectedVersion, 'payroll rule version')
      const scope = scopeOf(command)
      authorizeFinanceAction(actor, scope, 'payroll.rule.configure', now)
      const idem = idempotencyInput(state, actor, scope, 'payroll.rule.create', command, now)
      if (idem.retryId) return structuredClone(state.ruleVersions.get(idem.retryId)!)
      parseCanonicalDate(command.effectiveFrom, 'effectiveFrom')
      if (command.effectiveTo) parseCanonicalDate(command.effectiveTo, 'effectiveTo')
      if (!Array.isArray(command.payeBrackets) || command.payeBrackets.length === 0) {
        throw new FinanceValidationError('payeBrackets are required')
      }
      claim(state, 'payroll_rule_id', scope, command.id, command.id, 'Payroll rule version id already exists')
      claim(
        state,
        'payroll_rule_version_number',
        scope,
        { jurisdictionCode: command.jurisdictionCode, versionNumber: command.versionNumber },
        command.id,
        'Payroll rule version number already exists',
      )
      const draft = {
        ...versionedBase(command.id, scope, actor.uid, now),
        jurisdictionCode: requiredText(command.jurisdictionCode, 'jurisdictionCode'),
        versionNumber: command.versionNumber,
        packageId: requiredText(command.packageId, 'packageId'),
        taxYearLabel: requiredText(command.taxYearLabel, 'taxYearLabel'),
        effectiveFrom: command.effectiveFrom,
        ...(command.effectiveTo ? { effectiveTo: command.effectiveTo } : {}),
        payeBrackets: command.payeBrackets.map((b) => ({ ...b })),
        uif: { ...command.uif },
        sdl: { ...command.sdl },
        primaryRebateMinor: command.primaryRebateMinor,
        secondaryRebateMinor: command.secondaryRebateMinor,
        tertiaryRebateMinor: command.tertiaryRebateMinor,
        secondaryAgeFrom: command.secondaryAgeFrom,
        tertiaryAgeFrom: command.tertiaryAgeFrom,
        periodsPerYearMonthly: command.periodsPerYearMonthly,
        periodsPerYearWeekly: command.periodsPerYearWeekly,
        roundingMode: command.roundingMode,
        status: 'draft' as const,
        sourceCitation: requiredText(command.sourceCitation, 'sourceCitation'),
        sourceChecksum: requiredText(command.sourceChecksum, 'sourceChecksum'),
        immutable: false as const,
      }
      const rule: PayrollRuleVersion = { ...draft, contentHash: buildPayrollRuleContentHash(draft) }
      state.ruleVersions.set(rule.id, rule)
      appendAudit(state, scope, actor, 'payroll.rule.created', 'payroll_rule_version', rule.id, rule.version, now, command, {
        packageId: rule.packageId,
        versionNumber: rule.versionNumber,
        status: rule.status,
      })
      storeIdempotency(state, actor, scope, 'payroll.rule.create', command, rule.id, idem.claimId, idem.payloadDigest, now, rule)
      return structuredClone(rule)
    })
  }

  async approveRuleVersion(actor: FinanceActorContext, command: ApprovePayrollRuleVersionCommand): Promise<PayrollRuleVersion> {
    const now = this.now()
    return this.store.transact((state) => {
      const scope = scopeOf(command)
      authorizeFinanceAction(actor, scope, 'payroll.rule.approve', now)
      const idem = idempotencyInput(state, actor, scope, 'payroll.rule.approve', command, now)
      if (idem.retryId) return structuredClone(state.ruleVersions.get(idem.retryId)!)
      const existing = scopedGet(state.ruleVersions, command.ruleVersionId, scope, 'Payroll rule version')
      if (existing.version !== command.expectedVersion) throw new FinanceValidationError('Payroll rule version conflict')
      if (existing.status === 'approved' && existing.immutable) {
        storeIdempotency(state, actor, scope, 'payroll.rule.approve', command, existing.id, idem.claimId, idem.payloadDigest, now, existing)
        return structuredClone(existing)
      }
      if (existing.status !== 'draft') throw new FinanceValidationError('Only draft payroll rule versions can be approved')
      const approval = loadApproval(state, command.approvalId, scope, 'payroll.rule.approve', actor.uid, now)
      const draft = {
        ...existing,
        status: 'approved' as const,
        immutable: true as const,
        approvalId: approval.approvalId,
        approvalActorId: approval.approvedBy,
        approvedAt: approval.approvedAt,
        version: existing.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
        contentHash: '',
      }
      const { contentHash: _drop, ...forHash } = draft
      const approved: PayrollRuleVersion = { ...forHash, contentHash: buildPayrollRuleContentHash(forHash) }
      assertPayrollRuleVersionHash(approved)
      state.ruleVersions.set(approved.id, approved)
      appendAudit(state, scope, actor, 'payroll.rule.approved', 'payroll_rule_version', approved.id, approved.version, now, command, {
        approvalId: approval.approvalId,
        packageId: approved.packageId,
      }, command.reason)
      storeIdempotency(state, actor, scope, 'payroll.rule.approve', command, approved.id, idem.claimId, idem.payloadDigest, now, approved)
      return structuredClone(approved)
    })
  }

  async createCalendar(actor: FinanceActorContext, command: CreatePayrollCalendarCommand): Promise<PayrollCalendar> {
    const now = this.now()
    return this.store.transact((state) => {
      assertCreateVersion(command.expectedVersion, 'payroll calendar')
      const scope = scopeOf(command)
      authorizeFinanceAction(actor, scope, 'payroll.calendar.configure', now)
      const idem = idempotencyInput(state, actor, scope, 'payroll.calendar.create', command, now)
      if (idem.retryId) return structuredClone(state.calendars.get(idem.retryId)!)
      assertEnumValue(command.frequency, ['monthly', 'weekly'] as const, 'frequency')
      claim(state, 'payroll_calendar_code', scope, command.code.trim().toUpperCase(), command.id, 'Calendar code already exists')
      const calendar: PayrollCalendar = {
        ...versionedBase(command.id, scope, actor.uid, now),
        code: requiredText(command.code, 'code').toUpperCase(),
        name: requiredText(command.name, 'name'),
        frequency: command.frequency,
        status: 'active',
      }
      state.calendars.set(calendar.id, calendar)
      appendAudit(state, scope, actor, 'payroll.calendar.created', 'payroll_calendar', calendar.id, calendar.version, now, command, {
        code: calendar.code,
        frequency: calendar.frequency,
      })
      storeIdempotency(state, actor, scope, 'payroll.calendar.create', command, calendar.id, idem.claimId, idem.payloadDigest, now, calendar)
      return structuredClone(calendar)
    })
  }

  async createPayPeriod(actor: FinanceActorContext, command: CreatePayPeriodCommand): Promise<PayPeriod> {
    const now = this.now()
    return this.store.transact((state) => {
      assertCreateVersion(command.expectedVersion, 'pay period')
      const scope = scopeOf(command)
      authorizeFinanceAction(actor, scope, 'payroll.calendar.configure', now)
      const idem = idempotencyInput(state, actor, scope, 'payroll.period.create', command, now)
      if (idem.retryId) return structuredClone(state.periods.get(idem.retryId)!)
      const calendar = scopedGet(state.calendars, command.calendarId, scope, 'Payroll calendar')
      parseCanonicalDate(command.periodStart, 'periodStart')
      parseCanonicalDate(command.periodEnd, 'periodEnd')
      parseCanonicalDate(command.payDate, 'payDate')
      if (command.periodEnd < command.periodStart) throw new FinanceValidationError('periodEnd must be on or after periodStart')
      const cutOffAt = command.cutOffAt?.trim()
        ? command.cutOffAt.trim()
        : `${command.payDate}T23:59:59.000Z`
      // Validate ISO shape loosely via Date parse after optional date-only accept
      if (Number.isNaN(Date.parse(cutOffAt))) throw new FinanceValidationError('cutOffAt must be a valid ISO timestamp')
      claim(state, 'payroll_period_id', scope, command.id, command.id, 'Pay period id already exists')
      const period: PayPeriod = {
        ...versionedBase(command.id, scope, actor.uid, now),
        calendarId: calendar.id,
        frequency: calendar.frequency,
        label: requiredText(command.label, 'label'),
        periodStart: command.periodStart,
        periodEnd: command.periodEnd,
        cutOffAt,
        payDate: command.payDate,
        taxYearLabel: requiredText(command.taxYearLabel, 'taxYearLabel'),
        status: 'open',
      }
      state.periods.set(period.id, period)
      appendAudit(state, scope, actor, 'payroll.period.created', 'pay_period', period.id, period.version, now, command, {
        calendarId: period.calendarId,
        label: period.label,
      })
      storeIdempotency(state, actor, scope, 'payroll.period.create', command, period.id, idem.claimId, idem.payloadDigest, now, period)
      return structuredClone(period)
    })
  }

  async calculateEmployee(
    actor: FinanceActorContext,
    command: CalculateEmployeePayrollCommand,
  ): Promise<PayrollCalculationRecord> {
    const now = this.now()
    return this.store.transact((state) => {
      assertCreateVersion(command.expectedVersion, 'payroll calculation')
      const scope = scopeOf(command)
      authorizeFinanceAction(actor, scope, 'payroll.calculate', now)
      const normalizedCommand = compactUndefined({
        ...command,
        ordinaryHoursWorked: command.ordinaryHoursWorked === undefined ? undefined : Math.round(command.ordinaryHoursWorked * 100),
        overtimeHours: command.overtimeHours === undefined ? undefined : Math.round(command.overtimeHours * 100),
        leave: (command.leave ?? []).map((row) => ({ ...row, hours: Math.round(row.hours * 100) })),
        components: (command.components ?? []).map((row) => ({
          ...row,
          quantityMinorUnits: Math.round(row.quantityMinorUnits * 100),
        })),
      })
      const idem = idempotencyInput(state, actor, scope, 'payroll.calculate', normalizedCommand, now)
      if (idem.retryId) return structuredClone(state.calculations.get(idem.retryId)!)

      const employee = scopedGet(state.employees, command.employeeId, scope, 'Employee')
      const employment = scopedGet(state.employments, command.employmentId, scope, 'Employment')
      if (employment.employeeId !== employee.id) throw new FinanceValidationError('Employment does not belong to employee')
      const term = scopedGet(state.termVersions, command.termVersionId, scope, 'Employment term version')
      if (term.employmentId !== employment.id || term.status !== 'active') {
        throw new FinanceValidationError('Employment term version is not active for employment')
      }
      if (immutableContentHash(term) !== term.contentHash) {
        throw new FinanceValidationError('Employment term version content hash is invalid')
      }
      const period = scopedGet(state.periods, command.payPeriodId, scope, 'Pay period')
      if (period.status !== 'open') throw new FinanceValidationError('Pay period is not open for calculation')
      if (period.frequency !== term.frequency) {
        throw new FinanceValidationError('Pay period frequency does not match employment term frequency')
      }
      const rule = scopedGet(state.ruleVersions, command.ruleVersionId, scope, 'Payroll rule version')
      assertPayrollRuleVersionHash(rule)
      // effective window
      if (period.payDate < rule.effectiveFrom || (rule.effectiveTo && period.payDate > rule.effectiveTo)) {
        throw new FinanceValidationError('Pay date is outside payroll rule version effective dates')
      }

      const components = [...(command.components ?? [])]
      for (const [index, component] of components.entries()) {
        const def = [...state.components.values()].find(
          (row) =>
            row.orgId === scope.orgId &&
            row.legalEntityId === scope.legalEntityId &&
            row.bookId === scope.bookId &&
            row.code === component.componentCode.toUpperCase() &&
            row.active,
        )
        if (!def) throw new FinanceValidationError(`components[${index}] code is not a configured active pay component`)
        components[index] = {
          ...component,
          componentCode: def.code,
          kind: component.kind ?? def.kind,
          taxTreatment: component.taxTreatment ?? def.taxTreatment,
          uifTreatment: component.uifTreatment ?? def.uifTreatment,
          sdlTreatment: component.sdlTreatment ?? def.sdlTreatment,
        }
      }

      const approvedLeave = approvedLeaveToCalcInputs(
        [...state.leaveRecords.values()].filter(
          (row) =>
            row.orgId === scope.orgId &&
            row.legalEntityId === scope.legalEntityId &&
            row.bookId === scope.bookId &&
            row.employeeId === employee.id,
        ),
        period.periodStart,
        period.periodEnd,
      )
      const leaveForCalc = mergeLeaveInputs(command.leave, approvedLeave)

      const calcInput: PayrollCalculationInput = {
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
        ageYears: command.ageYears ?? ageYearsFromDob(employee.dateOfBirth, period.periodEnd),
        ordinaryHoursWorked: command.ordinaryHoursWorked ?? (term.workerCategory === 'hourly' ? term.standardHoursCenti / 100 : 0),
        overtimeHours: command.overtimeHours ?? 0,
        components,
        leave: leaveForCalc,
      }

      const result = calculatePayrollPeriod(calcInput, rule)
      claim(
        state,
        'payroll_calculation_period_employee',
        scope,
        { payPeriodId: period.id, employeeId: employee.id, ruleVersionId: rule.id, inputDigest: result.inputDigest },
        command.id,
        'Duplicate calculation identity for period/employee/input',
      )

      const recordDraft = {
        ...versionedBase(command.id, scope, actor.uid, now),
        employeeId: employee.id,
        employmentId: employment.id,
        payPeriodId: period.id,
        ruleVersionId: rule.id,
        status: 'calculated' as const,
        result,
        immutable: true as const,
        externalPaymentInitiated: false as const,
        sarsSubmissionInitiated: false as const,
      }
      const record: PayrollCalculationRecord = {
        ...recordDraft,
        contentHash: immutableContentHash(recordDraft),
      }
      state.calculations.set(record.id, record)
      appendAudit(state, scope, actor, 'payroll.calculation.created', 'payroll_calculation', record.id, record.version, now, command, {
        employeeId: employee.id,
        payPeriodId: period.id,
        ruleVersionId: rule.id,
        inputDigest: result.inputDigest,
        resultDigest: result.resultDigest,
        netPayMinor: result.totals.netPayMinor,
        payeMinor: result.totals.payeMinor,
        externalPaymentInitiated: false,
        sarsSubmissionInitiated: false,
      })
      storeIdempotency(state, actor, scope, 'payroll.calculate', normalizedCommand, record.id, idem.claimId, idem.payloadDigest, now, record)
      return structuredClone(record)
    })
  }
}
