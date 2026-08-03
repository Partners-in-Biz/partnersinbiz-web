import { authorizeFinanceAction } from '@/lib/finance/policy'
import { authorizePayslipRead, redactSensitivePayrollRecord } from '@/lib/finance/payroll-access'
import { FinanceNotFoundError } from '@/lib/finance/errors'
import {
  CANONICAL_PAYLOAD_VERSION,
  HASH_ALGORITHM_VERSION,
  canonicalDigest,
  canonicalScopeIdentity,
  scopedClaimId,
} from '@/lib/finance/integrity'
import type { FinanceActorContext, FinanceScope } from '@/lib/finance/types'
import {
  FinanceValidationError,
  assertCreateVersion,
  assertEnumValue,
  parseCanonicalDate,
  requiredText,
} from '@/lib/accounting/foundation'
import {
  approvedLeaveToCalcInputs,
  buildPayslipDownloadPack,
  leaveDurationToHours,
  projectPayCalendar,
  type LeavePayEffect,
  type LeaveRequestStatus,
  type LeaveUnit,
} from './leave'
import type {
  LeaveBalance,
  LeaveRecord,
  LeaveType,
  Payslip,
  PayslipDownloadPack,
  PayrollEmployee,
} from './types'
import type { InMemoryPayrollStore, PayrollServiceState } from './calculation-service'

interface CommandIdentity { requestId: string; idempotencyKey: string }

export interface CreateLeaveTypeCommand extends Required<FinanceScope>, CommandIdentity {
  id: string; code: string; name: string; unit: LeaveUnit; payEffect: LeavePayEffect
  hoursPerDay?: number; componentCode?: string; accrues: boolean; expectedVersion: 0
}
export interface SetLeaveBalanceCommand extends Required<FinanceScope>, CommandIdentity {
  id: string; employeeId: string; leaveTypeId: string; balanceQuantity: number; asOfDate: string; expectedVersion: 0
}
export interface RequestLeaveCommand extends Required<FinanceScope>, CommandIdentity {
  id: string; employeeId: string; leaveTypeId: string; startDate: string; endDate: string
  unit: LeaveUnit; quantity: number; note?: string; expectedVersion: 0
}
export interface DecideLeaveCommand extends Required<FinanceScope>, CommandIdentity {
  leaveRecordId: string; decision: 'approve' | 'reject' | 'cancel'; expectedVersion: number; reason?: string
}
export interface LinkEmployeeUserCommand extends Required<FinanceScope>, CommandIdentity {
  employeeId: string; linkedUserId: string | null; expectedVersion: number
}
export interface BuildPayslipPackCommand extends Required<FinanceScope>, CommandIdentity {
  id: string; payslipId: string; expectedVersion: 0
}

function compactUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}
function scopeOf(command: Required<FinanceScope>): Required<FinanceScope> {
  return { orgId: requiredText(command.orgId, 'orgId'), legalEntityId: requiredText(command.legalEntityId, 'legalEntityId'), bookId: requiredText(command.bookId, 'bookId') }
}
function scopedGet<T extends { orgId: string; legalEntityId: string; bookId: string }>(map: Map<string, T>, id: string, scope: Required<FinanceScope>, label: string): T {
  const row = map.get(id)
  if (!row || row.orgId !== scope.orgId || row.legalEntityId !== scope.legalEntityId || row.bookId !== scope.bookId) throw new FinanceValidationError(`${label} not found in scope`)
  return row
}
function claim(state: PayrollServiceState, type: string, scope: FinanceScope, key: unknown, id: string, message: string): void {
  const claimId = scopedClaimId(type, scope, key)
  const existing = state.uniqueClaims.get(claimId)
  if (existing && existing !== id) throw new FinanceValidationError(message)
  state.uniqueClaims.set(claimId, id)
}
function idempotencyInput(state: PayrollServiceState, actor: FinanceActorContext, scope: FinanceScope, operation: string, command: unknown, now: string) {
  const payloadDigest = canonicalDigest(command)
  const claimId = scopedClaimId('payroll_idempotency', scope, { actorId: actor.uid, key: (command as CommandIdentity).idempotencyKey, operation })
  const retry = state.idempotency.get(claimId)
  if (!retry) return { claimId, payloadDigest }
  if (retry.schemaVersion !== 1 || retry.canonicalPayloadVersion !== CANONICAL_PAYLOAD_VERSION || retry.hashAlgorithmVersion !== HASH_ALGORITHM_VERSION || retry.actorId !== actor.uid || retry.orgId !== scope.orgId || retry.scopeIdentity !== canonicalScopeIdentity(scope) || retry.operation !== operation || retry.requestId !== (command as CommandIdentity).requestId || retry.expiresAt <= now) {
    throw new FinanceValidationError('Idempotency metadata is invalid, mismatched, or expired')
  }
  if (retry.payloadDigest !== payloadDigest) throw new FinanceValidationError('Idempotency key payload mismatch')
  return { retryId: retry.aggregateId, claimId, payloadDigest }
}
function storeIdempotency(state: PayrollServiceState, actor: FinanceActorContext, scope: FinanceScope, operation: string, command: unknown, aggregateId: string, claimId: string, payloadDigest: string, now: string, result: unknown): void {
  const compactResult = compactUndefined(result as Record<string, unknown>)
  state.idempotency.set(claimId, {
    schemaVersion: 1, canonicalPayloadVersion: CANONICAL_PAYLOAD_VERSION, hashAlgorithmVersion: HASH_ALGORITHM_VERSION,
    payloadDigest, aggregateId, operation, actorId: actor.uid, orgId: scope.orgId, scopeIdentity: canonicalScopeIdentity(scope),
    requestId: (command as CommandIdentity).requestId, expiresAt: new Date(Date.parse(now) + 24 * 60 * 60 * 1000).toISOString(),
    resultSnapshot: structuredClone(compactResult), resultDigest: canonicalDigest(compactResult),
  })
}
function appendAudit(state: PayrollServiceState, scope: FinanceScope, actor: FinanceActorContext, eventType: string, aggregateType: string, aggregateId: string, aggregateVersion: number, now: string, command: CommandIdentity, payload: Record<string, unknown>, reason?: string): void {
  const scopeIdentity = canonicalScopeIdentity(scope)
  const previous = [...state.auditEvents].reverse().find((event) => canonicalScopeIdentity(event) === scopeIdentity)
  const sequence = (previous?.sequence ?? 0) + 1
  const base = {
    id: `praud_${scope.orgId}_${sequence}`, schemaVersion: 1 as const, orgId: scope.orgId, legalEntityId: scope.legalEntityId,
    ...(scope.bookId ? { bookId: scope.bookId } : {}), aggregateType, aggregateId, aggregateVersion, eventType, actorId: actor.uid,
    requestId: command.requestId, idempotencyKey: command.idempotencyKey, occurredAt: now, sequence,
    ...(previous ? { previousEventId: previous.id, previousEventHash: previous.eventHash } : {}),
    payload: compactUndefined(payload), externalEgressAllowed: false as const, canonicalPayloadVersion: 1 as const, hashAlgorithmVersion: HASH_ALGORITHM_VERSION,
    ...(reason ? { reason } : {}),
  }
  state.auditEvents.push({ ...base, eventHash: canonicalDigest(base) })
}
function versionedBase(id: string, scope: Required<FinanceScope>, actorId: string, now: string) {
  return { id, schemaVersion: 1 as const, orgId: scope.orgId, legalEntityId: scope.legalEntityId, bookId: scope.bookId, version: 1, createdAt: now, createdBy: actorId, updatedAt: now, updatedBy: actorId }
}

export class FinancePayrollLeaveService {
  constructor(private readonly store: InMemoryPayrollStore, private readonly now: () => string = () => new Date().toISOString()) {}

  async createLeaveType(actor: FinanceActorContext, command: CreateLeaveTypeCommand): Promise<LeaveType> {
    const now = this.now()
    return this.store.transact((state) => {
      assertCreateVersion(command.expectedVersion, 'leave type')
      const scope = scopeOf(command)
      authorizeFinanceAction(actor, scope, 'payroll.leave.configure', now)
      const idem = idempotencyInput(state, actor, scope, 'payroll.leave_type.create', command, now)
      if (idem.retryId) return structuredClone(state.leaveTypes.get(idem.retryId)!)
      assertEnumValue(command.unit, ['hours', 'days'] as const, 'unit')
      assertEnumValue(command.payEffect, ['paid', 'unpaid', 'none'] as const, 'payEffect')
      claim(state, 'leave_type_code', scope, command.code.trim().toUpperCase(), command.id, 'Leave type code already exists')
      const leaveType: LeaveType = {
        ...versionedBase(command.id, scope, actor.uid, now),
        code: requiredText(command.code, 'code').toUpperCase(), name: requiredText(command.name, 'name'),
        unit: command.unit, payEffect: command.payEffect, hoursPerDay: command.hoursPerDay ?? 8,
        ...(command.componentCode ? { componentCode: command.componentCode.toUpperCase() } : {}),
        accrues: Boolean(command.accrues), active: true,
      }
      state.leaveTypes.set(leaveType.id, leaveType)
      appendAudit(state, scope, actor, 'payroll.leave_type.created', 'leave_type', leaveType.id, leaveType.version, now, command, { code: leaveType.code, payEffect: leaveType.payEffect })
      storeIdempotency(state, actor, scope, 'payroll.leave_type.create', command, leaveType.id, idem.claimId, idem.payloadDigest, now, leaveType)
      return structuredClone(leaveType)
    })
  }

  async setLeaveBalance(actor: FinanceActorContext, command: SetLeaveBalanceCommand): Promise<LeaveBalance> {
    const now = this.now()
    return this.store.transact((state) => {
      assertCreateVersion(command.expectedVersion, 'leave balance')
      const scope = scopeOf(command)
      authorizeFinanceAction(actor, scope, 'payroll.leave.write', now)
      const idem = idempotencyInput(state, actor, scope, 'payroll.leave_balance.set', command, now)
      if (idem.retryId) return structuredClone(state.leaveBalances.get(idem.retryId)!)
      scopedGet(state.employees, command.employeeId, scope, 'Employee')
      const leaveType = scopedGet(state.leaveTypes, command.leaveTypeId, scope, 'Leave type')
      parseCanonicalDate(command.asOfDate, 'asOfDate')
      if (!Number.isFinite(command.balanceQuantity) || command.balanceQuantity < 0) throw new FinanceValidationError('balanceQuantity must be a non-negative number')
      claim(state, 'leave_balance_employee_type', scope, { employeeId: command.employeeId, leaveTypeId: command.leaveTypeId }, command.id, 'Leave balance already exists for employee/type')
      const hours = leaveDurationToHours({ unit: leaveType.unit, quantity: command.balanceQuantity, hoursPerDay: leaveType.hoursPerDay })
      const balance: LeaveBalance = {
        ...versionedBase(command.id, scope, actor.uid, now), employeeId: command.employeeId, leaveTypeId: leaveType.id,
        unit: leaveType.unit, balanceQuantity: Math.round(command.balanceQuantity * 100) / 100, balanceHours: hours, asOfDate: command.asOfDate,
      }
      state.leaveBalances.set(balance.id, balance)
      appendAudit(state, scope, actor, 'payroll.leave_balance.set', 'leave_balance', balance.id, balance.version, now, command, { employeeId: balance.employeeId, leaveTypeId: balance.leaveTypeId, balanceHours: balance.balanceHours })
      storeIdempotency(state, actor, scope, 'payroll.leave_balance.set', command, balance.id, idem.claimId, idem.payloadDigest, now, balance)
      return structuredClone(balance)
    })
  }

  private debitBalance(state: PayrollServiceState, scope: Required<FinanceScope>, record: LeaveRecord, now: string, actorId: string): void {
    const balance = [...state.leaveBalances.values()].find((row) => row.orgId === scope.orgId && row.legalEntityId === scope.legalEntityId && row.bookId === scope.bookId && row.employeeId === record.employeeId && row.leaveTypeId === record.leaveTypeId)
    if (!balance) return
    if (balance.balanceHours + 1e-9 < record.hours) throw new FinanceValidationError('Insufficient leave balance')
    const nextHours = Math.round((balance.balanceHours - record.hours) * 100) / 100
    const nextQty = balance.unit === 'hours' ? nextHours : Math.round((balance.balanceQuantity - record.quantity) * 100) / 100
    state.leaveBalances.set(balance.id, { ...balance, balanceHours: nextHours, balanceQuantity: nextQty, version: balance.version + 1, updatedAt: now, updatedBy: actorId })
  }

  async requestLeave(actor: FinanceActorContext, command: RequestLeaveCommand): Promise<LeaveRecord> {
    const now = this.now()
    return this.store.transact((state) => {
      assertCreateVersion(command.expectedVersion, 'leave record')
      const scope = scopeOf(command)
      const employee = scopedGet(state.employees, command.employeeId, scope, 'Employee')
      const isSelf = employee.linkedUserId === actor.uid
      if (!isSelf) authorizeFinanceAction(actor, scope, 'payroll.leave.write', now)
      else if (!actor.membershipActive || actor.orgId !== scope.orgId || !actor.financeModuleEnabled) throw new FinanceNotFoundError('Employee not found')
      const idem = idempotencyInput(state, actor, scope, 'payroll.leave.request', command, now)
      if (idem.retryId) return structuredClone(state.leaveRecords.get(idem.retryId)!)
      const leaveType = scopedGet(state.leaveTypes, command.leaveTypeId, scope, 'Leave type')
      if (!leaveType.active) throw new FinanceValidationError('Leave type is not active')
      parseCanonicalDate(command.startDate, 'startDate'); parseCanonicalDate(command.endDate, 'endDate')
      if (command.endDate < command.startDate) throw new FinanceValidationError('endDate must be on or after startDate')
      assertEnumValue(command.unit, ['hours', 'days'] as const, 'unit')
      const hours = leaveDurationToHours({ unit: command.unit, quantity: command.quantity, hoursPerDay: leaveType.hoursPerDay })
      claim(state, 'leave_record_id', scope, command.id, command.id, 'Leave record id already exists')
      const record: LeaveRecord = {
        ...versionedBase(command.id, scope, actor.uid, now), employeeId: employee.id, leaveTypeId: leaveType.id, leaveTypeCode: leaveType.code,
        startDate: command.startDate, endDate: command.endDate, unit: command.unit, quantity: Math.round(command.quantity * 100) / 100, hours,
        payEffect: leaveType.payEffect, ...(leaveType.componentCode ? { componentCode: leaveType.componentCode } : {}),
        status: isSelf ? 'pending' : 'approved', ...(command.note ? { note: command.note } : {}), requestedBy: actor.uid,
        ...(isSelf ? {} : { decidedBy: actor.uid, decidedAt: now }),
      }
      if (record.status === 'approved' && leaveType.payEffect !== 'none') this.debitBalance(state, scope, record, now, actor.uid)
      state.leaveRecords.set(record.id, record)
      appendAudit(state, scope, actor, 'payroll.leave.requested', 'leave_record', record.id, record.version, now, command, { employeeId: record.employeeId, leaveTypeId: record.leaveTypeId, status: record.status, hours: record.hours, payEffect: record.payEffect })
      storeIdempotency(state, actor, scope, 'payroll.leave.request', command, record.id, idem.claimId, idem.payloadDigest, now, record)
      return structuredClone(record)
    })
  }

  async decideLeave(actor: FinanceActorContext, command: DecideLeaveCommand): Promise<LeaveRecord> {
    const now = this.now()
    return this.store.transact((state) => {
      const scope = scopeOf(command)
      authorizeFinanceAction(actor, scope, 'payroll.leave.approve', now)
      const idem = idempotencyInput(state, actor, scope, 'payroll.leave.decide', command, now)
      if (idem.retryId) return structuredClone(state.leaveRecords.get(idem.retryId)!)
      const existing = scopedGet(state.leaveRecords, command.leaveRecordId, scope, 'Leave record')
      if (existing.version !== command.expectedVersion) throw new FinanceValidationError('Leave record version conflict')
      assertEnumValue(command.decision, ['approve', 'reject', 'cancel'] as const, 'decision')
      if (existing.status !== 'pending' && existing.status !== 'draft') throw new FinanceValidationError('Only pending/draft leave can be decided')
      let status: LeaveRequestStatus = existing.status
      if (command.decision === 'approve') status = 'approved'
      if (command.decision === 'reject') status = 'rejected'
      if (command.decision === 'cancel') status = 'cancelled'
      const next: LeaveRecord = { ...existing, status, decidedBy: actor.uid, decidedAt: now, ...(command.reason ? { decisionReason: command.reason } : {}), version: existing.version + 1, updatedAt: now, updatedBy: actor.uid }
      if (status === 'approved' && next.payEffect !== 'none') this.debitBalance(state, scope, next, now, actor.uid)
      state.leaveRecords.set(next.id, next)
      appendAudit(state, scope, actor, 'payroll.leave.decided', 'leave_record', next.id, next.version, now, command, { decision: command.decision, status: next.status, employeeId: next.employeeId }, command.reason)
      storeIdempotency(state, actor, scope, 'payroll.leave.decide', command, next.id, idem.claimId, idem.payloadDigest, now, next)
      return structuredClone(next)
    })
  }

  async linkEmployeeUser(actor: FinanceActorContext, command: LinkEmployeeUserCommand): Promise<PayrollEmployee> {
    const now = this.now()
    return this.store.transact((state) => {
      const scope = scopeOf(command)
      authorizeFinanceAction(actor, scope, 'payroll.employee.write', now)
      const idem = idempotencyInput(state, actor, scope, 'payroll.employee.link_user', command, now)
      if (idem.retryId) return structuredClone(state.employees.get(idem.retryId)!)
      const existing = scopedGet(state.employees, command.employeeId, scope, 'Employee')
      if (existing.version !== command.expectedVersion) throw new FinanceValidationError('Employee version conflict')
      if (command.linkedUserId) claim(state, 'payroll_employee_linked_user', scope, command.linkedUserId, existing.id, 'User already linked to another employee')
      const next: PayrollEmployee = { ...existing, ...(command.linkedUserId ? { linkedUserId: command.linkedUserId } : {}), version: existing.version + 1, updatedAt: now, updatedBy: actor.uid }
      if (!command.linkedUserId) delete (next as { linkedUserId?: string }).linkedUserId
      state.employees.set(next.id, next)
      appendAudit(state, scope, actor, 'payroll.employee.linked_user', 'payroll_employee', next.id, next.version, now, command, { linked: Boolean(command.linkedUserId) })
      storeIdempotency(state, actor, scope, 'payroll.employee.link_user', command, next.id, idem.claimId, idem.payloadDigest, now, next)
      return structuredClone(next)
    })
  }

  listLeaveBundle(scope: Required<FinanceScope>) {
    const filter = <T extends { orgId: string; legalEntityId: string; bookId: string }>(map: Map<string, T>) => [...map.values()].filter((row) => row.orgId === scope.orgId && row.legalEntityId === scope.legalEntityId && row.bookId === scope.bookId)
    return {
      leaveTypes: filter(this.store.leaveTypes), leaveBalances: filter(this.store.leaveBalances), leaveRecords: filter(this.store.leaveRecords),
      calendarProjection: projectPayCalendar({ calendars: filter(this.store.calendars), periods: filter(this.store.periods), nowIso: this.now() }),
    }
  }

  leaveInputsForPeriod(scope: Required<FinanceScope>, employeeId: string, periodStart: string, periodEnd: string) {
    const rows = [...this.store.leaveRecords.values()].filter((row) => row.orgId === scope.orgId && row.legalEntityId === scope.legalEntityId && row.bookId === scope.bookId && row.employeeId === employeeId)
    return approvedLeaveToCalcInputs(rows, periodStart, periodEnd)
  }

  listMyPayslips(actor: FinanceActorContext, scope: Required<FinanceScope>): Payslip[] {
    if (!actor.membershipActive || actor.orgId !== scope.orgId || !actor.financeModuleEnabled) throw new FinanceNotFoundError('Payslip not found')
    const mine = [...this.store.employees.values()].filter((row) => row.orgId === scope.orgId && row.legalEntityId === scope.legalEntityId && row.bookId === scope.bookId && row.linkedUserId === actor.uid)
    if (mine.length === 0) return []
    const employeeIds = new Set(mine.map((e) => e.id))
    return [...this.store.payslips.values()]
      .filter((p) => p.orgId === scope.orgId && p.legalEntityId === scope.legalEntityId && p.bookId === scope.bookId && employeeIds.has(p.employeeId) && p.status === 'generated')
      .map((p) => {
        authorizePayslipRead(actor, scope, { payslipId: p.id, employeeLinkedUserId: actor.uid })
        return redactSensitivePayrollRecord(structuredClone(p) as unknown as Record<string, unknown>) as unknown as Payslip
      })
      .sort((a, b) => b.payDate.localeCompare(a.payDate) || a.id.localeCompare(b.id))
  }

  async buildPayslipPack(actor: FinanceActorContext, command: BuildPayslipPackCommand): Promise<PayslipDownloadPack> {
    const now = this.now()
    return this.store.transact((state) => {
      assertCreateVersion(command.expectedVersion, 'payslip download pack')
      const scope = scopeOf(command)
      const payslip = scopedGet(state.payslips, command.payslipId, scope, 'Payslip')
      const employee = scopedGet(state.employees, payslip.employeeId, scope, 'Employee')
      authorizePayslipRead(actor, scope, { payslipId: payslip.id, employeeLinkedUserId: employee.linkedUserId })
      const idem = idempotencyInput(state, actor, scope, 'payroll.payslip.pack', command, now)
      if (idem.retryId) return structuredClone(state.payslipPacks.get(idem.retryId)!)
      const built = buildPayslipDownloadPack(payslip)
      claim(state, 'payslip_pack_id', scope, command.id, command.id, 'Payslip pack id already exists')
      const pack: PayslipDownloadPack = {
        ...versionedBase(command.id, scope, actor.uid, now), payslipId: payslip.id, employeeId: payslip.employeeId, payRunId: payslip.payRunId,
        files: built.files, rowCount: built.rowCount, status: 'ready', publicationStatus: 'internal_only', autoSent: false,
        externalEgressAllowed: false, sarsSubmissionInitiated: false, externalPaymentInitiated: false,
        contentHash: canonicalDigest({ payslipId: payslip.id, generationChecksum: payslip.generationChecksum, files: built.files.map((f) => ({ name: f.name, content: f.content })) }),
      }
      state.payslipPacks.set(pack.id, pack)
      appendAudit(state, scope, actor, 'payroll.payslip.pack_built', 'payslip_download_pack', pack.id, pack.version, now, command, { payslipId: pack.payslipId, fileCount: pack.files.length, externalEgressAllowed: false, autoSent: false })
      storeIdempotency(state, actor, scope, 'payroll.payslip.pack', command, pack.id, idem.claimId, idem.payloadDigest, now, pack)
      return structuredClone(pack)
    })
  }

  async markPayslipPackDownloaded(actor: FinanceActorContext, scope: Required<FinanceScope>, packId: string, command: CommandIdentity): Promise<PayslipDownloadPack> {
    const now = this.now()
    return this.store.transact((state) => {
      const pack = scopedGet(state.payslipPacks, packId, scope, 'Payslip pack')
      const payslip = scopedGet(state.payslips, pack.payslipId, scope, 'Payslip')
      const employee = scopedGet(state.employees, pack.employeeId, scope, 'Employee')
      authorizePayslipRead(actor, scope, { payslipId: payslip.id, employeeLinkedUserId: employee.linkedUserId })
      const next: PayslipDownloadPack = {
        ...pack, status: 'downloaded', downloadedAt: now, downloadedBy: actor.uid, version: pack.version + 1, updatedAt: now, updatedBy: actor.uid,
        autoSent: false, externalEgressAllowed: false, sarsSubmissionInitiated: false, externalPaymentInitiated: false,
      }
      state.payslipPacks.set(next.id, next)
      appendAudit(state, scope, actor, 'payroll.payslip.pack_downloaded', 'payslip_download_pack', next.id, next.version, now, command, { payslipId: next.payslipId, externalEgressAllowed: false, autoSent: false })
      return structuredClone(next)
    })
  }
}
