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
  requiredText,
} from '@/lib/accounting/foundation'
import {
  InMemoryPayrollStore,
  type PayrollServiceState,
} from './calculation-service'
import {
  aggregatePayRunTotals,
  assertCanApprovePayRun,
  assertCanSubmitPayRun,
  assertPayRunMutable,
  buildInputSetHash,
  buildPayRunLockHash,
  buildPayslipGenerationChecksum,
  emptyPayRunTotals,
  negateLines,
  negateTotals,
  payRunHistoryEntry,
} from './pay-run'
import type {
  ExternalSalaryPaymentObservation,
  PayRun,
  PayRunItem,
  PayRunKind,
  PayrollAdjustment,
  PayrollAdjustmentKind,
  Payslip,
  PeriodComponentInput,
} from './types'

interface CommandIdentity {
  requestId: string
  idempotencyKey: string
}

export interface CreatePayRunCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  calendarId: string
  payPeriodId: string
  ruleVersionId: string
  label: string
  kind?: PayRunKind
  expectedVersion: 0
}

export interface AddPayRunItemCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  payRunId: string
  calculationId: string
  expectedVersion: number
}

export interface FreezePayRunInputsCommand extends Required<FinanceScope>, CommandIdentity {
  payRunId: string
  expectedVersion: number
}

export interface SubmitPayRunCommand extends Required<FinanceScope>, CommandIdentity {
  payRunId: string
  expectedVersion: number
}

export interface ApproveLockPayRunCommand extends Required<FinanceScope>, CommandIdentity {
  payRunId: string
  expectedVersion: number
  approvalId: string
  reason: string
}

export interface ReversePayRunCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  originalPayRunId: string
  expectedVersion: number
  approvalId: string
  reason: string
}

export interface CreateCorrectionPayRunCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  originalPayRunId: string
  kind: Exclude<PayRunKind, 'regular' | 'full_reversal'>
  label: string
  expectedVersion: 0
}

export interface ApplyIndividualAdjustmentCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  payRunId: string
  originalPayRunId: string
  originalItemId: string
  employeeId: string
  employmentId: string
  kind: PayrollAdjustmentKind
  deltaComponents: PeriodComponentInput[]
  reason: string
  expectedVersion: number
}

export interface ObserveExternalSalaryPaymentCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  payRunId: string
  amountMinor: number
  reference: string
  bankAccountHint?: string
  expectedVersion: number
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

function cloneMap<T>(source: Map<string, T>): Map<string, T> {
  return new Map(Array.from(source, ([key, value]) => [key, structuredClone(value)]))
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

function claim(state: PayrollServiceState, type: string, scope: FinanceScope, key: unknown, id: string, message: string): void {
  const claimId = scopedClaimId(type, scope, key)
  const existing = state.uniqueClaims.get(claimId)
  if (existing && existing !== id) throw new FinanceValidationError(message)
  state.uniqueClaims.set(claimId, id)
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
  const record: IdempotencyRecord = {
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
  }
  state.idempotency.set(claimId, record)
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
  state.auditEvents.push({ ...base, eventHash: canonicalDigest(base) })
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

function recomputeRunFromItems(state: PayrollServiceState, run: PayRun): PayRun {
  const items = run.itemIds.map((id) => scopedGet(state.payRunItems, id, run, 'Pay run item'))
  const totals = aggregatePayRunTotals(items)
  const digests = items.map((item) => item.resultDigest)
  const inputSetHash = items.length ? buildInputSetHash(digests) : undefined
  return {
    ...run,
    totals,
    inputSetHash,
  }
}

function hashRun(run: Omit<PayRun, 'contentHash'> & { contentHash?: string }): PayRun {
  const { contentHash: _drop, ...rest } = run
  return { ...rest, contentHash: immutableContentHash(rest) }
}

function hashItem(item: Omit<PayRunItem, 'contentHash'> & { contentHash?: string }): PayRunItem {
  const { contentHash: _drop, ...rest } = item
  return { ...rest, contentHash: immutableContentHash(rest) }
}

function hashPayslip(payslip: Omit<Payslip, 'contentHash'> & { contentHash?: string }): Payslip {
  const { contentHash: _drop, ...rest } = payslip
  return { ...rest, contentHash: immutableContentHash(rest) }
}

function hashAdjustment(row: Omit<PayrollAdjustment, 'contentHash'> & { contentHash?: string }): PayrollAdjustment {
  const { contentHash: _drop, ...rest } = row
  return { ...rest, contentHash: immutableContentHash(rest) }
}

export class FinancePayRunService {
  constructor(
    private readonly store: InMemoryPayrollStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  registerApproval(approval: FinanceApprovalRecord): void {
    this.store.approvals.set(approval.id, structuredClone(approval))
  }

  async createPayRun(actor: FinanceActorContext, command: CreatePayRunCommand): Promise<PayRun> {
    const now = this.now()
    return this.store.transact((state) => {
      assertCreateVersion(command.expectedVersion, 'pay run')
      const scope = scopeOf(command)
      authorizeFinanceAction(actor, scope, 'payroll.run.create', now)
      const kind = command.kind ?? 'regular'
      assertEnumValue(
        kind,
        [
          'regular',
          'correction',
          'individual_adjustment',
          'back_pay',
          'overpayment_recovery',
          'amended_deduction_tax',
          'full_reversal',
        ] as const,
        'kind',
      )
      const idem = idempotencyInput(state, actor, scope, 'payroll.run.create', command, now)
      if (idem.retryId) return structuredClone(state.payRuns.get(idem.retryId)!)
      const calendar = scopedGet(state.calendars, command.calendarId, scope, 'Payroll calendar')
      if (calendar.status !== 'active') throw new FinanceValidationError('Payroll calendar is not active')
      const period = scopedGet(state.periods, command.payPeriodId, scope, 'Pay period')
      if (period.calendarId !== calendar.id) throw new FinanceValidationError('Pay period does not belong to calendar')
      if (period.status === 'locked') throw new FinanceValidationError('Pay period is locked')
      const rule = scopedGet(state.ruleVersions, command.ruleVersionId, scope, 'Payroll rule version')
      if (rule.status !== 'approved' || !rule.immutable) {
        throw new FinanceValidationError('Only approved immutable payroll rule versions may back a pay run')
      }
      claim(state, 'payroll_pay_run_id', scope, command.id, command.id, 'Pay run id already exists')
      if (kind === 'regular') {
        claim(
          state,
          'payroll_regular_run_period',
          scope,
          { payPeriodId: period.id, ruleVersionId: rule.id },
          command.id,
          'A regular pay run already exists for this period and rule version',
        )
      }
      const draft = {
        ...versionedBase(command.id, scope, actor.uid, now),
        calendarId: calendar.id,
        payPeriodId: period.id,
        ruleVersionId: rule.id,
        kind,
        status: 'draft' as const,
        label: requiredText(command.label, 'label'),
        inputCutoffAt: period.cutOffAt,
        inputsFrozen: false,
        totals: emptyPayRunTotals(),
        itemIds: [] as string[],
        payslipIds: [] as string[],
        immutable: false,
        externalPaymentInitiated: false as const,
        sarsSubmissionInitiated: false as const,
        externalSalaryPaymentObservations: [] as ExternalSalaryPaymentObservation[],
      }
      const run = hashRun(draft)
      state.payRuns.set(run.id, run)
      appendAudit(state, scope, actor, 'payroll.run.created', 'pay_run', run.id, run.version, now, command, {
        payPeriodId: period.id,
        ruleVersionId: rule.id,
        kind,
        inputCutoffAt: run.inputCutoffAt,
        externalPaymentInitiated: false,
        sarsSubmissionInitiated: false,
      })
      storeIdempotency(state, actor, scope, 'payroll.run.create', command, run.id, idem.claimId, idem.payloadDigest, now, run)
      return structuredClone(run)
    })
  }

  async addItem(actor: FinanceActorContext, command: AddPayRunItemCommand): Promise<PayRun> {
    const now = this.now()
    return this.store.transact((state) => {
      const scope = scopeOf(command)
      authorizeFinanceAction(actor, scope, 'payroll.run.create', now)
      const idem = idempotencyInput(state, actor, scope, 'payroll.run.add_item', command, now)
      if (idem.retryId) return structuredClone(state.payRuns.get(idem.retryId)!)
      const run = scopedGet(state.payRuns, command.payRunId, scope, 'Pay run')
      if (run.version !== command.expectedVersion) throw new FinanceValidationError('Pay run version conflict')
      assertPayRunMutable(run, 'add items')
      if (run.inputsFrozen) throw new FinanceValidationError('Pay run inputs are frozen after cut-off')
      if (run.status !== 'draft' && run.status !== 'calculating' && run.status !== 'calculated' && run.status !== 'correction') {
        throw new FinanceValidationError('Pay run cannot accept items in current status')
      }
      const calc = scopedGet(state.calculations, command.calculationId, scope, 'Payroll calculation')
      if (calc.payPeriodId !== run.payPeriodId) throw new FinanceValidationError('Calculation period does not match pay run')
      if (calc.ruleVersionId !== run.ruleVersionId) throw new FinanceValidationError('Calculation rule version does not match pay run')
      claim(
        state,
        'payroll_run_employee',
        scope,
        { payRunId: run.id, employeeId: calc.employeeId },
        command.id,
        'Employee already included on this pay run',
      )
      claim(state, 'payroll_run_item_id', scope, command.id, command.id, 'Pay run item id already exists')
      const itemDraft = {
        ...versionedBase(command.id, scope, actor.uid, now),
        payRunId: run.id,
        employeeId: calc.employeeId,
        employmentId: calc.employmentId,
        calculationId: calc.id,
        status: 'calculated' as const,
        resultDigest: calc.result.resultDigest,
        inputDigest: calc.result.inputDigest,
        totals: structuredClone(calc.result.totals),
        lines: structuredClone(calc.result.lines),
        immutable: true as const,
        externalPaymentInitiated: false as const,
        sarsSubmissionInitiated: false as const,
      }
      const item = hashItem(itemDraft)
      state.payRunItems.set(item.id, item)
      const next = recomputeRunFromItems(state, {
        ...run,
        status: 'calculated',
        itemIds: [...run.itemIds, item.id],
        version: run.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
      })
      const saved = hashRun(next)
      state.payRuns.set(saved.id, saved)
      appendAudit(state, scope, actor, 'payroll.run.item_added', 'pay_run', saved.id, saved.version, now, command, {
        itemId: item.id,
        employeeId: item.employeeId,
        calculationId: calc.id,
        resultDigest: item.resultDigest,
        netPayMinor: item.totals.netPayMinor,
      })
      storeIdempotency(state, actor, scope, 'payroll.run.add_item', command, saved.id, idem.claimId, idem.payloadDigest, now, saved)
      return structuredClone(saved)
    })
  }

  async freezeInputs(actor: FinanceActorContext, command: FreezePayRunInputsCommand): Promise<PayRun> {
    const now = this.now()
    return this.store.transact((state) => {
      const scope = scopeOf(command)
      authorizeFinanceAction(actor, scope, 'payroll.run.submit', now)
      const idem = idempotencyInput(state, actor, scope, 'payroll.run.freeze', command, now)
      if (idem.retryId) return structuredClone(state.payRuns.get(idem.retryId)!)
      const run = scopedGet(state.payRuns, command.payRunId, scope, 'Pay run')
      if (run.version !== command.expectedVersion) throw new FinanceValidationError('Pay run version conflict')
      assertPayRunMutable(run, 'freeze inputs')
      if (run.itemIds.length < 1) throw new FinanceValidationError('Cannot freeze empty pay run')
      if (now < run.inputCutoffAt) throw new FinanceValidationError('Cannot freeze inputs before period cut-off')
      if (run.inputsFrozen) {
        storeIdempotency(state, actor, scope, 'payroll.run.freeze', command, run.id, idem.claimId, idem.payloadDigest, now, run)
        return structuredClone(run)
      }
      const recomputed = recomputeRunFromItems(state, run)
      const next = hashRun({
        ...recomputed,
        inputsFrozen: true,
        frozenAt: now,
        status: 'calculated',
        version: run.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
      })
      state.payRuns.set(next.id, next)
      appendAudit(state, scope, actor, 'payroll.run.inputs_frozen', 'pay_run', next.id, next.version, now, command, {
        inputCutoffAt: next.inputCutoffAt,
        inputSetHash: next.inputSetHash,
        itemCount: next.itemIds.length,
      })
      storeIdempotency(state, actor, scope, 'payroll.run.freeze', command, next.id, idem.claimId, idem.payloadDigest, now, next)
      return structuredClone(next)
    })
  }

  async submitForReview(actor: FinanceActorContext, command: SubmitPayRunCommand): Promise<PayRun> {
    const now = this.now()
    return this.store.transact((state) => {
      const scope = scopeOf(command)
      authorizeFinanceAction(actor, scope, 'payroll.run.submit', now)
      const idem = idempotencyInput(state, actor, scope, 'payroll.run.submit', command, now)
      if (idem.retryId) return structuredClone(state.payRuns.get(idem.retryId)!)
      const run = scopedGet(state.payRuns, command.payRunId, scope, 'Pay run')
      if (run.version !== command.expectedVersion) throw new FinanceValidationError('Pay run version conflict')
      assertPayRunMutable(run, 'submit for review')
      if (run.status === 'in_review') {
        storeIdempotency(state, actor, scope, 'payroll.run.submit', command, run.id, idem.claimId, idem.payloadDigest, now, run)
        return structuredClone(run)
      }
      assertCanSubmitPayRun(run, run.itemIds.length, now)
      const next = hashRun({
        ...run,
        status: 'in_review',
        submittedBy: actor.uid,
        submittedAt: now,
        version: run.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
      })
      state.payRuns.set(next.id, next)
      appendAudit(state, scope, actor, 'payroll.run.submitted', 'pay_run', next.id, next.version, now, command, {
        submittedBy: actor.uid,
        inputSetHash: next.inputSetHash,
        totals: next.totals,
      })
      storeIdempotency(state, actor, scope, 'payroll.run.submit', command, next.id, idem.claimId, idem.payloadDigest, now, next)
      return structuredClone(next)
    })
  }

  async approveAndLock(actor: FinanceActorContext, command: ApproveLockPayRunCommand): Promise<PayRun> {
    const now = this.now()
    return this.store.transact((state) => {
      const scope = scopeOf(command)
      authorizeFinanceAction(actor, scope, 'payroll.run.approve', now)
      const idem = idempotencyInput(state, actor, scope, 'payroll.run.approve_lock', command, now)
      if (idem.retryId) return structuredClone(state.payRuns.get(idem.retryId)!)
      const run = scopedGet(state.payRuns, command.payRunId, scope, 'Pay run')
      if (run.version !== command.expectedVersion) throw new FinanceValidationError('Pay run version conflict')
      if (run.status === 'approved_locked' && run.immutable) {
        storeIdempotency(state, actor, scope, 'payroll.run.approve_lock', command, run.id, idem.claimId, idem.payloadDigest, now, run)
        return structuredClone(run)
      }
      assertCanApprovePayRun(run, actor.uid)
      const approval = loadApproval(state, command.approvalId, scope, 'payroll.run.approve', actor.uid, now)
      const items = run.itemIds.map((id) => scopedGet(state.payRunItems, id, scope, 'Pay run item'))
      const lockHash = buildPayRunLockHash({
        payRunId: run.id,
        payPeriodId: run.payPeriodId,
        ruleVersionId: run.ruleVersionId,
        inputCutoffAt: run.inputCutoffAt,
        inputSetHash: run.inputSetHash!,
        totals: run.totals,
        itemIds: run.itemIds,
        itemResultDigests: items.map((item) => item.resultDigest),
      })

      const payslipIds: string[] = []
      for (const item of items) {
        const employee = scopedGet(state.employees, item.employeeId, scope, 'Employee')
        const period = scopedGet(state.periods, run.payPeriodId, scope, 'Pay period')
        const generationChecksum = buildPayslipGenerationChecksum({
          payRunId: run.id,
          payRunItemId: item.id,
          employeeId: item.employeeId,
          resultDigest: item.resultDigest,
          totals: item.totals,
          lines: item.lines,
        })
        const payslipId = `ps_${item.id}`
        claim(state, 'payroll_payslip_id', scope, payslipId, payslipId, 'Payslip id already exists')
        const payslipDraft = {
          ...versionedBase(payslipId, scope, actor.uid, now),
          payRunId: run.id,
          payRunItemId: item.id,
          employeeId: item.employeeId,
          employmentId: item.employmentId,
          payPeriodId: run.payPeriodId,
          payDate: period.payDate,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          status: 'generated' as const,
          publicationStatus: 'internal_only' as const,
          accessVersion: 1,
          generationChecksum,
          rendered: {
            employeeDisplayName: employee.displayName,
            employeeNumber: employee.employeeNumber,
            currency: 'ZAR' as const,
            lines: structuredClone(item.lines),
            totals: structuredClone(item.totals),
            netPayMinor: item.totals.netPayMinor,
          },
          immutable: true as const,
          externalPaymentInitiated: false as const,
          sarsSubmissionInitiated: false as const,
          autoSent: false as const,
        }
        const payslip = hashPayslip(payslipDraft)
        state.payslips.set(payslip.id, payslip)
        payslipIds.push(payslip.id)
        const lockedItem = hashItem({
          ...item,
          status: 'approved_locked',
          payslipId: payslip.id,
          version: item.version + 1,
          updatedAt: now,
          updatedBy: actor.uid,
        })
        state.payRunItems.set(lockedItem.id, lockedItem)
      }

      const period = scopedGet(state.periods, run.payPeriodId, scope, 'Pay period')
      if (period.status === 'open' && run.kind === 'regular') {
        state.periods.set(period.id, {
          ...period,
          status: 'locked',
          version: period.version + 1,
          updatedAt: now,
          updatedBy: actor.uid,
        })
      }

      const locked = hashRun({
        ...run,
        status: run.kind === 'correction' || run.kind === 'individual_adjustment' || run.kind === 'back_pay' || run.kind === 'overpayment_recovery' || run.kind === 'amended_deduction_tax'
          ? 'approved_locked'
          : 'approved_locked',
        immutable: true,
        approvalId: approval.approvalId,
        approvalActorId: approval.approvedBy,
        approvedAt: approval.approvedAt,
        lockedAt: now,
        lockedBy: actor.uid,
        lockHash,
        payslipIds,
        reason: requiredText(command.reason, 'reason'),
        version: run.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
        externalPaymentInitiated: false,
        sarsSubmissionInitiated: false,
      })
      state.payRuns.set(locked.id, locked)
      appendAudit(state, scope, actor, 'payroll.run.approved_locked', 'pay_run', locked.id, locked.version, now, command, {
        approvalId: approval.approvalId,
        lockHash,
        payslipCount: payslipIds.length,
        totals: locked.totals,
        externalPaymentInitiated: false,
        sarsSubmissionInitiated: false,
      }, command.reason)
      storeIdempotency(state, actor, scope, 'payroll.run.approve_lock', command, locked.id, idem.claimId, idem.payloadDigest, now, locked)
      return structuredClone(locked)
    })
  }

  async reversePayRun(actor: FinanceActorContext, command: ReversePayRunCommand): Promise<PayRun> {
    const now = this.now()
    return this.store.transact((state) => {
      const scope = scopeOf(command)
      authorizeFinanceAction(actor, scope, 'payroll.run.reverse', now)
      const idem = idempotencyInput(state, actor, scope, 'payroll.run.reverse', command, now)
      if (idem.retryId) return structuredClone(state.payRuns.get(idem.retryId)!)
      const original = scopedGet(state.payRuns, command.originalPayRunId, scope, 'Pay run')
      if (original.version !== command.expectedVersion) throw new FinanceValidationError('Pay run version conflict')
      if (original.status !== 'approved_locked' || !original.immutable) {
        throw new FinanceValidationError('Only approved_locked pay runs can be fully reversed')
      }
      if (original.reversalPayRunId) throw new FinanceValidationError('Pay run already has a full reversal')
      const approval = loadApproval(state, command.approvalId, scope, 'payroll.run.reverse', actor.uid, now)
      claim(state, 'payroll_pay_run_id', scope, command.id, command.id, 'Pay run id already exists')
      claim(state, 'payroll_full_reversal_of', scope, original.id, command.id, 'Full reversal already exists for original pay run')

      const originalItems = original.itemIds.map((id) => scopedGet(state.payRunItems, id, scope, 'Pay run item'))
      const reverseItemIds: string[] = []
      for (const item of originalItems) {
        const reverseItemId = `ri_${command.id}_${item.id}`
        const reverseItem = hashItem({
          ...versionedBase(reverseItemId, scope, actor.uid, now),
          payRunId: command.id,
          employeeId: item.employeeId,
          employmentId: item.employmentId,
          calculationId: item.calculationId,
          status: 'reversed',
          resultDigest: canonicalDigest({ reverseOf: item.resultDigest }),
          inputDigest: canonicalDigest({ reverseOf: item.inputDigest }),
          totals: negateTotals(item.totals),
          lines: negateLines(item.lines),
          originalItemId: item.id,
          immutable: true,
          externalPaymentInitiated: false,
          sarsSubmissionInitiated: false,
        })
        state.payRunItems.set(reverseItem.id, reverseItem)
        reverseItemIds.push(reverseItem.id)
        const marked = hashItem({
          ...item,
          status: 'reversed',
          version: item.version + 1,
          updatedAt: now,
          updatedBy: actor.uid,
        })
        // Original item content (totals/lines) stay; status projection marks reversed.
        state.payRunItems.set(marked.id, marked)
      }

      const reverseTotals = aggregatePayRunTotals(reverseItemIds.map((id) => state.payRunItems.get(id)!))
      const reverseRun = hashRun({
        ...versionedBase(command.id, scope, actor.uid, now),
        calendarId: original.calendarId,
        payPeriodId: original.payPeriodId,
        ruleVersionId: original.ruleVersionId,
        kind: 'full_reversal',
        status: 'approved_locked',
        label: `REVERSAL of ${original.label}`,
        inputCutoffAt: original.inputCutoffAt,
        inputsFrozen: true,
        frozenAt: now,
        inputSetHash: buildInputSetHash(reverseItemIds.map((id) => state.payRunItems.get(id)!.resultDigest)),
        lockHash: buildPayRunLockHash({
          payRunId: command.id,
          payPeriodId: original.payPeriodId,
          ruleVersionId: original.ruleVersionId,
          inputCutoffAt: original.inputCutoffAt,
          inputSetHash: buildInputSetHash(reverseItemIds.map((id) => state.payRunItems.get(id)!.resultDigest)),
          totals: reverseTotals,
          itemIds: reverseItemIds,
          itemResultDigests: reverseItemIds.map((id) => state.payRunItems.get(id)!.resultDigest),
        }),
        totals: reverseTotals,
        itemIds: reverseItemIds,
        payslipIds: [],
        originalPayRunId: original.id,
        approvalId: approval.approvalId,
        approvalActorId: approval.approvedBy,
        approvedAt: approval.approvedAt,
        lockedAt: now,
        lockedBy: actor.uid,
        reason: requiredText(command.reason, 'reason'),
        immutable: true,
        externalPaymentInitiated: false,
        sarsSubmissionInitiated: false,
        externalSalaryPaymentObservations: [],
      })
      state.payRuns.set(reverseRun.id, reverseRun)

      // Preserve original locked content; mark status reversed with link (status change only + link).
      const originalSnapshot = structuredClone(original)
      const originalUpdated = hashRun({
        ...original,
        status: 'reversed',
        reversalPayRunId: reverseRun.id,
        version: original.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
        immutable: true,
      })
      // Ensure original totals/items/lockHash unchanged from snapshot
      originalUpdated.totals = originalSnapshot.totals
      originalUpdated.itemIds = originalSnapshot.itemIds
      originalUpdated.payslipIds = originalSnapshot.payslipIds
      originalUpdated.lockHash = originalSnapshot.lockHash
      originalUpdated.inputSetHash = originalSnapshot.inputSetHash
      originalUpdated.contentHash = immutableContentHash((({ contentHash: _c, ...rest }) => rest)(originalUpdated))
      state.payRuns.set(originalUpdated.id, originalUpdated)

      const adjustment = hashAdjustment({
        ...versionedBase(`adj_${command.id}`, scope, actor.uid, now),
        kind: 'full_run_reversal',
        status: 'approved_locked',
        payRunId: reverseRun.id,
        originalPayRunId: original.id,
        deltaComponents: [],
        reason: command.reason,
        approvalId: approval.approvalId,
        approvalActorId: approval.approvedBy,
        approvedAt: approval.approvedAt,
        immutable: true,
        externalPaymentInitiated: false,
        sarsSubmissionInitiated: false,
      })
      state.adjustments.set(adjustment.id, adjustment)

      appendAudit(state, scope, actor, 'payroll.run.reversed', 'pay_run', originalUpdated.id, originalUpdated.version, now, command, {
        originalPayRunId: original.id,
        reversalPayRunId: reverseRun.id,
        originalLockHash: originalSnapshot.lockHash,
        reversalLockHash: reverseRun.lockHash,
        externalPaymentInitiated: false,
        sarsSubmissionInitiated: false,
      }, command.reason)
      storeIdempotency(state, actor, scope, 'payroll.run.reverse', command, reverseRun.id, idem.claimId, idem.payloadDigest, now, reverseRun)
      return structuredClone(reverseRun)
    })
  }

  async createCorrectionRun(actor: FinanceActorContext, command: CreateCorrectionPayRunCommand): Promise<PayRun> {
    const now = this.now()
    return this.store.transact((state) => {
      assertCreateVersion(command.expectedVersion, 'correction pay run')
      const scope = scopeOf(command)
      authorizeFinanceAction(actor, scope, 'payroll.run.correct', now)
      const idem = idempotencyInput(state, actor, scope, 'payroll.run.correct_create', command, now)
      if (idem.retryId) return structuredClone(state.payRuns.get(idem.retryId)!)
      const original = scopedGet(state.payRuns, command.originalPayRunId, scope, 'Pay run')
      if (original.status !== 'approved_locked' && original.status !== 'reversed') {
        throw new FinanceValidationError('Corrections require an approved_locked or reversed original pay run')
      }
      assertEnumValue(
        command.kind,
        ['correction', 'individual_adjustment', 'back_pay', 'overpayment_recovery', 'amended_deduction_tax'] as const,
        'kind',
      )
      claim(state, 'payroll_pay_run_id', scope, command.id, command.id, 'Pay run id already exists')
      const draft = hashRun({
        ...versionedBase(command.id, scope, actor.uid, now),
        calendarId: original.calendarId,
        payPeriodId: original.payPeriodId,
        ruleVersionId: original.ruleVersionId,
        kind: command.kind,
        status: 'correction',
        label: requiredText(command.label, 'label'),
        inputCutoffAt: now,
        inputsFrozen: false,
        totals: emptyPayRunTotals(),
        itemIds: [],
        payslipIds: [],
        originalPayRunId: original.id,
        correctionOfPayRunId: original.id,
        immutable: false,
        externalPaymentInitiated: false,
        sarsSubmissionInitiated: false,
        externalSalaryPaymentObservations: [],
      })
      state.payRuns.set(draft.id, draft)
      appendAudit(state, scope, actor, 'payroll.run.correction_created', 'pay_run', draft.id, draft.version, now, command, {
        originalPayRunId: original.id,
        kind: command.kind,
      })
      storeIdempotency(state, actor, scope, 'payroll.run.correct_create', command, draft.id, idem.claimId, idem.payloadDigest, now, draft)
      return structuredClone(draft)
    })
  }

  async applyIndividualAdjustment(actor: FinanceActorContext, command: ApplyIndividualAdjustmentCommand): Promise<PayRun> {
    const now = this.now()
    return this.store.transact((state) => {
      const scope = scopeOf(command)
      authorizeFinanceAction(actor, scope, 'payroll.run.correct', now)
      const idem = idempotencyInput(state, actor, scope, 'payroll.run.apply_adjustment', command, now)
      if (idem.retryId) return structuredClone(state.payRuns.get(idem.retryId)!)
      const run = scopedGet(state.payRuns, command.payRunId, scope, 'Pay run')
      if (run.version !== command.expectedVersion) throw new FinanceValidationError('Pay run version conflict')
      assertPayRunMutable(run, 'apply adjustment')
      if (run.inputsFrozen) throw new FinanceValidationError('Correction run inputs are frozen')
      if (run.correctionOfPayRunId !== command.originalPayRunId && run.originalPayRunId !== command.originalPayRunId) {
        throw new FinanceValidationError('Adjustment original pay run does not match correction run')
      }
      const originalItem = scopedGet(state.payRunItems, command.originalItemId, scope, 'Pay run item')
      if (originalItem.payRunId !== command.originalPayRunId) {
        throw new FinanceValidationError('Original item does not belong to original pay run')
      }
      if (originalItem.employeeId !== command.employeeId) {
        throw new FinanceValidationError('Adjustment employee does not match original item')
      }
      assertEnumValue(
        command.kind,
        [
          'back_pay',
          'overpayment_recovery',
          'missed_deduction',
          'amended_tax',
          'amended_deduction',
          'individual_correction',
          'full_run_reversal',
        ] as const,
        'kind',
      )
      if (!command.deltaComponents.length) throw new FinanceValidationError('Adjustment requires delta components')
      claim(state, 'payroll_adjustment_id', scope, command.id, command.id, 'Adjustment id already exists')

      // Build synthetic delta totals from signed component amounts (tax already amended via components when provided).
      let gross = 0
      let taxable = 0
      let preTax = 0
      let postTax = 0
      let paye = 0
      let uifEmp = 0
      let uifEr = 0
      let sdl = 0
      const lines = command.deltaComponents.map((component, index) => {
        const amount = Math.round(component.quantityMinorUnits * component.unitAmountMinor)
        const kind = component.kind ?? 'deduction'
        if (kind === 'statutory_paye') paye += amount
        else if (kind === 'statutory_uif_employee') uifEmp += amount
        else if (kind === 'statutory_uif_employer') uifEr += amount
        else if (kind === 'statutory_sdl') sdl += amount
        else if (component.taxTreatment === 'pre_tax_deduction' || kind === 'deduction' && component.taxTreatment === 'pre_tax_deduction') {
          preTax += Math.abs(amount)
          if (amount < 0) preTax = preTax // keep positive bucket; net uses signed below
        } else if (component.taxTreatment === 'post_tax_deduction') {
          postTax += amount
        } else {
          gross += amount
          if ((component.taxTreatment ?? 'taxable') === 'taxable') taxable += amount
        }
        return {
          lineId: `adj_${command.id}_${index}`,
          componentCode: component.componentCode.toUpperCase(),
          kind,
          description: component.description ?? `${command.kind}:${component.componentCode}`,
          quantity: component.quantityMinorUnits,
          unitAmountMinor: component.unitAmountMinor,
          amountMinor: amount,
          taxTreatment: component.taxTreatment ?? 'taxable',
          uifTreatment: component.uifTreatment ?? 'exclude',
          sdlTreatment: component.sdlTreatment ?? 'exclude',
          employeeFacing: true,
          employerFacing: kind === 'statutory_uif_employer' || kind === 'statutory_sdl' || kind === 'employer_contribution',
        }
      })

      // Recompute pre/post from lines more carefully
      preTax = 0
      postTax = 0
      gross = 0
      taxable = 0
      paye = 0
      uifEmp = 0
      uifEr = 0
      sdl = 0
      for (const line of lines) {
        if (line.kind === 'statutory_paye') paye += line.amountMinor
        else if (line.kind === 'statutory_uif_employee') uifEmp += line.amountMinor
        else if (line.kind === 'statutory_uif_employer') uifEr += line.amountMinor
        else if (line.kind === 'statutory_sdl') sdl += line.amountMinor
        else if (line.taxTreatment === 'pre_tax_deduction') preTax += line.amountMinor
        else if (line.taxTreatment === 'post_tax_deduction') postTax += line.amountMinor
        else {
          gross += line.amountMinor
          if (line.taxTreatment === 'taxable') taxable += line.amountMinor
        }
      }
      const netPayMinor = gross - preTax - paye - uifEmp - postTax
      const employerCostMinor = gross + uifEr + sdl

      const adjustment = hashAdjustment({
        ...versionedBase(command.id, scope, actor.uid, now),
        kind: command.kind,
        status: 'applied',
        payRunId: run.id,
        originalPayRunId: command.originalPayRunId,
        originalItemId: originalItem.id,
        employeeId: command.employeeId,
        employmentId: command.employmentId,
        deltaComponents: structuredClone(command.deltaComponents),
        reason: requiredText(command.reason, 'reason'),
        immutable: false,
        externalPaymentInitiated: false,
        sarsSubmissionInitiated: false,
      })
      state.adjustments.set(adjustment.id, adjustment)

      const itemId = `item_${command.id}`
      claim(state, 'payroll_run_item_id', scope, itemId, itemId, 'Pay run item id already exists')
      claim(
        state,
        'payroll_run_employee',
        scope,
        { payRunId: run.id, employeeId: command.employeeId },
        itemId,
        'Employee already included on this correction run',
      )
      const item = hashItem({
        ...versionedBase(itemId, scope, actor.uid, now),
        payRunId: run.id,
        employeeId: command.employeeId,
        employmentId: command.employmentId,
        calculationId: originalItem.calculationId,
        status: 'calculated',
        resultDigest: canonicalDigest({ adjustmentId: adjustment.id, lines }),
        inputDigest: canonicalDigest({ adjustmentId: adjustment.id, delta: command.deltaComponents }),
        totals: {
          grossEarningsMinor: gross,
          taxableEarningsMinor: taxable,
          preTaxDeductionsMinor: preTax,
          postTaxDeductionsMinor: postTax,
          payeMinor: paye,
          uifEmployeeMinor: uifEmp,
          uifEmployerMinor: uifEr,
          sdlEmployerMinor: sdl,
          netPayMinor,
          employerCostMinor,
          benefitsMinor: 0,
          allowancesMinor: 0,
          overtimeMinor: 0,
          bonusMinor: 0,
          commissionMinor: 0,
          leavePaidMinor: 0,
          leaveUnpaidReductionMinor: 0,
        },
        lines,
        originalItemId: originalItem.id,
        adjustmentId: adjustment.id,
        immutable: true,
        externalPaymentInitiated: false,
        sarsSubmissionInitiated: false,
      })
      state.payRunItems.set(item.id, item)

      const next = recomputeRunFromItems(state, {
        ...run,
        status: 'calculated',
        itemIds: [...run.itemIds, item.id],
        version: run.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
      })
      const saved = hashRun(next)
      state.payRuns.set(saved.id, saved)
      appendAudit(state, scope, actor, 'payroll.run.adjustment_applied', 'pay_run', saved.id, saved.version, now, command, {
        adjustmentId: adjustment.id,
        kind: command.kind,
        originalItemId: originalItem.id,
        employeeId: command.employeeId,
        netPayDeltaMinor: netPayMinor,
      }, command.reason)
      storeIdempotency(state, actor, scope, 'payroll.run.apply_adjustment', command, saved.id, idem.claimId, idem.payloadDigest, now, saved)
      return structuredClone(saved)
    })
  }

  async observeExternalSalaryPayment(
    actor: FinanceActorContext,
    command: ObserveExternalSalaryPaymentCommand,
  ): Promise<PayRun> {
    const now = this.now()
    return this.store.transact((state) => {
      const scope = scopeOf(command)
      authorizeFinanceAction(actor, scope, 'payroll.payment.observe', now)
      const idem = idempotencyInput(state, actor, scope, 'payroll.payment.observe', command, now)
      if (idem.retryId) return structuredClone(state.payRuns.get(idem.retryId)!)
      const run = scopedGet(state.payRuns, command.payRunId, scope, 'Pay run')
      if (run.version !== command.expectedVersion) throw new FinanceValidationError('Pay run version conflict')
      if (run.status !== 'approved_locked' && run.status !== 'reversed') {
        throw new FinanceValidationError('External salary payment observations require an approved/reversed pay run')
      }
      if (!Number.isInteger(command.amountMinor) || command.amountMinor <= 0) {
        throw new FinanceValidationError('amountMinor must be a positive integer')
      }
      claim(state, 'payroll_external_payment_obs', scope, command.id, command.id, 'Observation id already exists')
      const observation: ExternalSalaryPaymentObservation = {
        id: command.id,
        observedAt: now,
        amountMinor: command.amountMinor,
        currency: 'ZAR',
        reference: requiredText(command.reference, 'reference'),
        ...(command.bankAccountHint ? { bankAccountHint: command.bankAccountHint } : {}),
        externalPaymentInitiated: false,
        recordedBy: actor.uid,
      }
      const next = hashRun({
        ...run,
        externalSalaryPaymentObservations: [...run.externalSalaryPaymentObservations, observation],
        // Keep immutable lock metadata; observation is append-only on locked run.
        immutable: true,
        version: run.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
        externalPaymentInitiated: false,
        sarsSubmissionInitiated: false,
      })
      state.payRuns.set(next.id, next)
      appendAudit(state, scope, actor, 'payroll.payment.observed', 'pay_run', next.id, next.version, now, command, {
        observationId: observation.id,
        amountMinor: observation.amountMinor,
        reference: observation.reference,
        externalPaymentInitiated: false,
        sarsSubmissionInitiated: false,
      })
      storeIdempotency(state, actor, scope, 'payroll.payment.observe', command, next.id, idem.claimId, idem.payloadDigest, now, next)
      return structuredClone(next)
    })
  }

  listPayRunHistory(scope: Required<FinanceScope>, payPeriodId?: string) {
    return [...this.store.payRuns.values()]
      .filter(
        (run) =>
          run.orgId === scope.orgId &&
          run.legalEntityId === scope.legalEntityId &&
          run.bookId === scope.bookId &&
          (!payPeriodId || run.payPeriodId === payPeriodId),
      )
      .map(payRunHistoryEntry)
      .sort((a, b) => a.payRunId.localeCompare(b.payRunId))
  }

  getPayslip(scope: Required<FinanceScope>, payslipId: string): Payslip {
    return structuredClone(scopedGet(this.store.payslips, payslipId, scope, 'Payslip'))
  }
}
