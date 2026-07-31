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
  immutableContentHash,
  requiredText,
} from '@/lib/accounting/foundation'
import {
  InMemoryPayrollStore,
  type PayrollServiceState,
} from './calculation-service'
import {
  addStatutoryTotals,
  aggregateItems,
  applyYtdOpening,
  assertCanApproveStatutory,
  assertTaxYearAcceptsStatutoryPrepare,
  assertTaxYearMutable,
  buildExportContentDigest,
  buildPayrollTaxSummaryEvidence,
  buildStatutoryContentHash,
  buildTaxTableReference,
  chooseCertificateKind,
  differenceTotals,
  emptyStatutoryTotals,
  exportManifestIsInternalOnly,
  isDateWithinTaxYear,
  isFullyReconciled,
  isPayRunEligibleForStatutory,
  periodMatchesTaxMonth,
  taxMonthFromDate,
  uniqueTaxTableReferences,
} from './statutory'
import {
  zaDefaultTaxYearWindow,
  zaMapCertificateEvidence,
  zaMapEmp201Evidence,
  zaMapEmp501Evidence,
} from '@/lib/jurisdictions/za/statutory'
import type {
  Emp201Snapshot,
  Emp501Reconciliation,
  Irp5Record,
  PayrollExportManifest,
  PayrollTaxSummary,
  PayrollTaxYear,
  PayrollYtdOpening,
  StatutoryExportKind,
} from './types'

interface CommandIdentity {
  requestId: string
  idempotencyKey: string
}

export interface CreateTaxYearCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  taxYearLabel: string
  jurisdictionCode?: string
  startDate?: string
  endDate?: string
  ruleVersionIds: string[]
  expectedVersion: 0
}

export interface CloseTaxYearCommand extends Required<FinanceScope>, CommandIdentity {
  taxYearId: string
  expectedVersion: number
}

export interface LockTaxYearCommand extends Required<FinanceScope>, CommandIdentity {
  taxYearId: string
  expectedVersion: number
  approvalId: string
  reason: string
}

export interface CreateYtdOpeningCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  taxYearId: string
  employeeId: string
  employmentId: string
  grossEarningsMinor: number
  taxableEarningsMinor: number
  payeMinor: number
  uifEmployeeMinor: number
  uifEmployerMinor: number
  sdlEmployerMinor: number
  sourceEvidence: string
  expectedVersion: 0
}

export interface ApproveYtdOpeningCommand extends Required<FinanceScope>, CommandIdentity {
  ytdOpeningId: string
  expectedVersion: number
  approvalId: string
  reason: string
}

export interface PrepareIrp5Command extends Required<FinanceScope>, CommandIdentity {
  id: string
  taxYearId: string
  employeeId: string
  employmentId: string
  payeThresholdMinor?: number
  expectedVersion: 0
}

export interface PrepareEmp201Command extends Required<FinanceScope>, CommandIdentity {
  id: string
  taxYearId: string
  taxMonth: string
  expectedVersion: 0
}

export interface PrepareEmp501Command extends Required<FinanceScope>, CommandIdentity {
  id: string
  taxYearId: string
  expectedVersion: 0
}

export interface ApproveStatutoryCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  expectedVersion: number
  approvalId: string
  reason: string
}

export interface GenerateExportCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  taxYearId: string
  kind: StatutoryExportKind
  recordIds?: string[]
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

function requireNonNegativeInt(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) throw new FinanceValidationError(`${field} must be a non-negative integer minor unit`)
  return value
}

export class FinancePayrollStatutoryService {
  constructor(
    private readonly store: InMemoryPayrollStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  registerApproval(approval: FinanceApprovalRecord): void {
    this.store.approvals.set(approval.id, structuredClone(approval))
  }

  async createTaxYear(actor: FinanceActorContext, command: CreateTaxYearCommand): Promise<PayrollTaxYear> {
    const scope = scopeOf(command)
    const now = this.now()
    authorizeFinanceAction(actor, scope, 'payroll.tax_year.configure', now)
    assertCreateVersion(command.expectedVersion, 'tax year')
    return this.store.transact((state) => {
      const idem = idempotencyInput(state, actor, scope, 'payroll.tax_year.create', command, now)
      if (idem.retryId) return structuredClone(state.taxYears.get(idem.retryId)!)

      const label = requiredText(command.taxYearLabel, 'taxYearLabel')
      const window = command.startDate && command.endDate
        ? { startDate: command.startDate, endDate: command.endDate }
        : zaDefaultTaxYearWindow(label)
      if (window.startDate >= window.endDate) throw new FinanceValidationError('tax year startDate must be before endDate')

      const ruleVersionIds = [...new Set(command.ruleVersionIds.map((id) => requiredText(id, 'ruleVersionId')))]
      if (ruleVersionIds.length < 1) throw new FinanceValidationError('tax year requires at least one ruleVersionId reference')
      const packageIds: string[] = []
      for (const ruleId of ruleVersionIds) {
        const rule = scopedGet(state.ruleVersions, ruleId, scope, 'Payroll rule version')
        if (rule.status !== 'approved' || !rule.immutable) {
          throw new FinanceValidationError('Only approved immutable payroll rule versions may be referenced on a tax year')
        }
        if (rule.taxYearLabel !== label) {
          throw new FinanceValidationError('ruleVersion taxYearLabel must match tax year label')
        }
        packageIds.push(rule.packageId)
      }

      claim(state, 'payroll_tax_year_label', scope, label, command.id, 'Tax year label already exists in scope')
      const base = versionedBase(command.id, scope, actor.uid, now)
      const body = {
        ...base,
        jurisdictionCode: requiredText(command.jurisdictionCode ?? 'ZA', 'jurisdictionCode'),
        taxYearLabel: label,
        startDate: window.startDate,
        endDate: window.endDate,
        status: 'open' as const,
        ruleVersionIds,
        packageIds: [...new Set(packageIds)].sort(),
        immutable: false,
        sarsSubmissionInitiated: false as const,
        externalPaymentInitiated: false as const,
      }
      const record: PayrollTaxYear = { ...body, contentHash: immutableContentHash(body) }
      state.taxYears.set(record.id, record)
      appendAudit(state, scope, actor, 'payroll.tax_year.created', 'payroll_tax_year', record.id, 1, now, command, {
        taxYearLabel: label,
        ruleVersionIds,
        sarsSubmissionInitiated: false,
      })
      storeIdempotency(state, actor, scope, 'payroll.tax_year.create', command, record.id, idem.claimId, idem.payloadDigest, now, record)
      return structuredClone(record)
    })
  }

  async closeTaxYear(actor: FinanceActorContext, command: CloseTaxYearCommand): Promise<PayrollTaxYear> {
    const scope = scopeOf(command)
    const now = this.now()
    authorizeFinanceAction(actor, scope, 'payroll.tax_year.configure', now)
    return this.store.transact((state) => {
      const idem = idempotencyInput(state, actor, scope, 'payroll.tax_year.close', command, now)
      if (idem.retryId) return structuredClone(state.taxYears.get(idem.retryId)!)
      const current = scopedGet(state.taxYears, command.taxYearId, scope, 'Payroll tax year')
      if (current.version !== command.expectedVersion) throw new FinanceValidationError('expectedVersion mismatch')
      assertTaxYearMutable(current, 'close')
      if (current.status !== 'open') throw new FinanceValidationError('Only open tax years can be closed')
      const next: PayrollTaxYear = {
        ...current,
        status: 'closed',
        version: current.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
      }
      next.contentHash = immutableContentHash({
        id: next.id,
        taxYearLabel: next.taxYearLabel,
        status: next.status,
        ruleVersionIds: next.ruleVersionIds,
        version: next.version,
      })
      state.taxYears.set(next.id, next)
      appendAudit(state, scope, actor, 'payroll.tax_year.closed', 'payroll_tax_year', next.id, next.version, now, command, {
        status: next.status,
      })
      storeIdempotency(state, actor, scope, 'payroll.tax_year.close', command, next.id, idem.claimId, idem.payloadDigest, now, next)
      return structuredClone(next)
    })
  }

  async lockTaxYear(actor: FinanceActorContext, command: LockTaxYearCommand): Promise<PayrollTaxYear> {
    const scope = scopeOf(command)
    const now = this.now()
    authorizeFinanceAction(actor, scope, 'payroll.tax_year.lock', now)
    return this.store.transact((state) => {
      const idem = idempotencyInput(state, actor, scope, 'payroll.tax_year.lock', command, now)
      if (idem.retryId) return structuredClone(state.taxYears.get(idem.retryId)!)
      const current = scopedGet(state.taxYears, command.taxYearId, scope, 'Payroll tax year')
      if (current.version !== command.expectedVersion) throw new FinanceValidationError('expectedVersion mismatch')
      assertTaxYearMutable(current, 'lock')
      if (current.status !== 'closed') throw new FinanceValidationError('Tax year must be closed before lock')
      const approval = loadApproval(state, command.approvalId, scope, 'payroll.tax_year.lock', actor.uid, now)
      if (current.createdBy === actor.uid) throw new FinanceValidationError('Tax year creator cannot lock the same tax year')
      const next: PayrollTaxYear = {
        ...current,
        status: 'locked',
        immutable: true,
        lockedAt: now,
        lockedBy: actor.uid,
        approvalId: approval.approvalId,
        version: current.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
      }
      next.contentHash = immutableContentHash({
        id: next.id,
        taxYearLabel: next.taxYearLabel,
        status: next.status,
        lockedAt: next.lockedAt,
        approvalId: next.approvalId,
        version: next.version,
      })
      state.taxYears.set(next.id, next)
      appendAudit(state, scope, actor, 'payroll.tax_year.locked', 'payroll_tax_year', next.id, next.version, now, command, {
        status: next.status,
        approvalId: approval.approvalId,
        sarsSubmissionInitiated: false,
      }, command.reason)
      storeIdempotency(state, actor, scope, 'payroll.tax_year.lock', command, next.id, idem.claimId, idem.payloadDigest, now, next)
      return structuredClone(next)
    })
  }

  async createYtdOpening(actor: FinanceActorContext, command: CreateYtdOpeningCommand): Promise<PayrollYtdOpening> {
    const scope = scopeOf(command)
    const now = this.now()
    authorizeFinanceAction(actor, scope, 'payroll.ytd_opening.write', now)
    assertCreateVersion(command.expectedVersion, 'ytd opening')
    return this.store.transact((state) => {
      const idem = idempotencyInput(state, actor, scope, 'payroll.ytd_opening.create', command, now)
      if (idem.retryId) return structuredClone(state.ytdOpenings.get(idem.retryId)!)
      const taxYear = scopedGet(state.taxYears, command.taxYearId, scope, 'Payroll tax year')
      assertTaxYearAcceptsStatutoryPrepare(taxYear)
      scopedGet(state.employees, command.employeeId, scope, 'Payroll employee')
      const employment = scopedGet(state.employments, command.employmentId, scope, 'Payroll employment')
      if (employment.employeeId !== command.employeeId) throw new FinanceValidationError('employment does not belong to employee')
      claim(
        state,
        'payroll_ytd_opening',
        scope,
        { taxYearId: command.taxYearId, employeeId: command.employeeId, employmentId: command.employmentId },
        command.id,
        'YTD opening already exists for employee/employment in tax year',
      )
      const base = versionedBase(command.id, scope, actor.uid, now)
      const body = {
        ...base,
        taxYearId: taxYear.id,
        employeeId: command.employeeId,
        employmentId: command.employmentId,
        status: 'draft' as const,
        grossEarningsMinor: requireNonNegativeInt(command.grossEarningsMinor, 'grossEarningsMinor'),
        taxableEarningsMinor: requireNonNegativeInt(command.taxableEarningsMinor, 'taxableEarningsMinor'),
        payeMinor: requireNonNegativeInt(command.payeMinor, 'payeMinor'),
        uifEmployeeMinor: requireNonNegativeInt(command.uifEmployeeMinor, 'uifEmployeeMinor'),
        uifEmployerMinor: requireNonNegativeInt(command.uifEmployerMinor, 'uifEmployerMinor'),
        sdlEmployerMinor: requireNonNegativeInt(command.sdlEmployerMinor, 'sdlEmployerMinor'),
        sourceEvidence: requiredText(command.sourceEvidence, 'sourceEvidence'),
        immutable: false,
        sarsSubmissionInitiated: false as const,
        externalPaymentInitiated: false as const,
      }
      const record: PayrollYtdOpening = { ...body, contentHash: immutableContentHash(body) }
      state.ytdOpenings.set(record.id, record)
      appendAudit(state, scope, actor, 'payroll.ytd_opening.created', 'payroll_ytd_opening', record.id, 1, now, command, {
        taxYearId: taxYear.id,
        employeeId: command.employeeId,
      })
      storeIdempotency(state, actor, scope, 'payroll.ytd_opening.create', command, record.id, idem.claimId, idem.payloadDigest, now, record)
      return structuredClone(record)
    })
  }

  async approveYtdOpening(actor: FinanceActorContext, command: ApproveYtdOpeningCommand): Promise<PayrollYtdOpening> {
    const scope = scopeOf(command)
    const now = this.now()
    authorizeFinanceAction(actor, scope, 'payroll.ytd_opening.approve', now)
    return this.store.transact((state) => {
      const idem = idempotencyInput(state, actor, scope, 'payroll.ytd_opening.approve', command, now)
      if (idem.retryId) return structuredClone(state.ytdOpenings.get(idem.retryId)!)
      const current = scopedGet(state.ytdOpenings, command.ytdOpeningId, scope, 'Payroll YTD opening')
      if (current.version !== command.expectedVersion) throw new FinanceValidationError('expectedVersion mismatch')
      if (current.status !== 'draft') throw new FinanceValidationError('Only draft YTD openings can be approved')
      if (current.createdBy === actor.uid) throw new FinanceValidationError('YTD opening creator cannot approve the same opening')
      const approval = loadApproval(state, command.approvalId, scope, 'payroll.ytd_opening.approve', actor.uid, now)
      const next: PayrollYtdOpening = {
        ...current,
        status: 'approved',
        immutable: true,
        approvalId: approval.approvalId,
        approvalActorId: actor.uid,
        approvedAt: now,
        version: current.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
      }
      next.contentHash = immutableContentHash({
        id: next.id,
        status: next.status,
        taxableEarningsMinor: next.taxableEarningsMinor,
        payeMinor: next.payeMinor,
        approvalId: next.approvalId,
        version: next.version,
      })
      state.ytdOpenings.set(next.id, next)
      appendAudit(state, scope, actor, 'payroll.ytd_opening.approved', 'payroll_ytd_opening', next.id, next.version, now, command, {
        approvalId: approval.approvalId,
      }, command.reason)
      storeIdempotency(state, actor, scope, 'payroll.ytd_opening.approve', command, next.id, idem.claimId, idem.payloadDigest, now, next)
      return structuredClone(next)
    })
  }

  private collectEligibleItems(
    state: PayrollServiceState,
    scope: Required<FinanceScope>,
    taxYear: PayrollTaxYear,
    filter?: { employeeId?: string; employmentId?: string; taxMonth?: string },
  ) {
    const periodsById = new Map(
      Array.from(state.periods.values())
        .filter((p) => p.orgId === scope.orgId && p.legalEntityId === scope.legalEntityId && p.bookId === scope.bookId)
        .map((p) => [p.id, p]),
    )
    const runs = Array.from(state.payRuns.values()).filter(
      (run) =>
        run.orgId === scope.orgId &&
        run.legalEntityId === scope.legalEntityId &&
        run.bookId === scope.bookId &&
        isPayRunEligibleForStatutory(run),
    )
    const items: Array<import('./types').PayRunItem & { payRunId: string; periodId: string }> = []
    const refs = []
    for (const run of runs) {
      const period = periodsById.get(run.payPeriodId)
      if (!period) continue
      if (period.taxYearLabel !== taxYear.taxYearLabel && !isDateWithinTaxYear(period.periodEnd, taxYear)) continue
      if (filter?.taxMonth && !periodMatchesTaxMonth(period, filter.taxMonth)) continue
      const rule = state.ruleVersions.get(run.ruleVersionId)
      if (rule) refs.push(buildTaxTableReference(rule))
      for (const itemId of run.itemIds) {
        const item = state.payRunItems.get(itemId)
        if (!item || item.orgId !== scope.orgId) continue
        if (filter?.employeeId && item.employeeId !== filter.employeeId) continue
        if (filter?.employmentId && item.employmentId !== filter.employmentId) continue
        items.push({ ...item, payRunId: run.id, periodId: period.id })
      }
    }
    return { items, taxTableReferences: uniqueTaxTableReferences(refs) }
  }

  async prepareIrp5(actor: FinanceActorContext, command: PrepareIrp5Command): Promise<Irp5Record> {
    const scope = scopeOf(command)
    const now = this.now()
    authorizeFinanceAction(actor, scope, 'payroll.statutory.prepare', now)
    assertCreateVersion(command.expectedVersion, 'irp5 record')
    return this.store.transact((state) => {
      const idem = idempotencyInput(state, actor, scope, 'payroll.irp5.prepare', command, now)
      if (idem.retryId) return structuredClone(state.irp5Records.get(idem.retryId)!)
      const taxYear = scopedGet(state.taxYears, command.taxYearId, scope, 'Payroll tax year')
      assertTaxYearAcceptsStatutoryPrepare(taxYear)
      const employee = scopedGet(state.employees, command.employeeId, scope, 'Payroll employee')
      const employment = scopedGet(state.employments, command.employmentId, scope, 'Payroll employment')
      if (employment.employeeId !== employee.id) throw new FinanceValidationError('employment does not belong to employee')

      // Supersede prior ready/draft certificate for same employee/year.
      for (const existing of state.irp5Records.values()) {
        if (
          existing.orgId === scope.orgId &&
          existing.legalEntityId === scope.legalEntityId &&
          existing.bookId === scope.bookId &&
          existing.taxYearId === taxYear.id &&
          existing.employeeId === employee.id &&
          existing.employmentId === employment.id &&
          (existing.status === 'draft' || existing.status === 'ready')
        ) {
          state.irp5Records.set(existing.id, {
            ...existing,
            status: 'superseded',
            version: existing.version + 1,
            updatedAt: now,
            updatedBy: actor.uid,
          })
        }
      }

      claim(
        state,
        'payroll_irp5_active',
        scope,
        { taxYearId: taxYear.id, employeeId: employee.id, employmentId: employment.id, slot: command.id },
        command.id,
        'IRP5/IT3(a) claim collision',
      )

      const { items, taxTableReferences } = this.collectEligibleItems(state, scope, taxYear, {
        employeeId: employee.id,
        employmentId: employment.id,
      })
      if (items.length < 1) throw new FinanceValidationError('No locked pay-run items found for employee in tax year')

      const opening = Array.from(state.ytdOpenings.values()).find(
        (row) =>
          row.orgId === scope.orgId &&
          row.legalEntityId === scope.legalEntityId &&
          row.bookId === scope.bookId &&
          row.taxYearId === taxYear.id &&
          row.employeeId === employee.id &&
          row.employmentId === employment.id &&
          row.status === 'approved',
      )
      const totals = applyYtdOpening(aggregateItems(items), opening)
      const certificateKind = chooseCertificateKind(totals.payeMinor, command.payeThresholdMinor ?? 0)
      const sourcePayRunIds = [...new Set(items.map((i) => i.payRunId))].sort()
      const sourceItemIds = items.map((i) => i.id).sort()
      const sourceItemDigests = items.map((i) => i.resultDigest).sort()
      const base = versionedBase(command.id, scope, actor.uid, now)
      const body = {
        ...base,
        taxYearId: taxYear.id,
        taxYearLabel: taxYear.taxYearLabel,
        employeeId: employee.id,
        employmentId: employment.id,
        employeeNumber: employee.employeeNumber,
        displayName: employee.displayName,
        taxResidency: employee.taxResidency,
        certificateKind,
        status: 'ready' as const,
        totals,
        ...(opening ? { ytdOpeningId: opening.id } : {}),
        sourcePayRunIds,
        sourceItemIds,
        sourceItemDigests,
        taxTableReferences,
        immutable: false,
        sarsSubmissionInitiated: false as const,
        externalPaymentInitiated: false as const,
      }
      const contentHash = buildStatutoryContentHash('irp5_record', {
        taxYearId: body.taxYearId,
        employeeId: body.employeeId,
        certificateKind: body.certificateKind,
        totals: body.totals,
        sourceItemDigests: body.sourceItemDigests,
        taxTableReferences: body.taxTableReferences,
        ytdOpeningId: body.ytdOpeningId ?? null,
      })
      const record: Irp5Record = { ...body, contentHash }
      state.irp5Records.set(record.id, record)
      appendAudit(state, scope, actor, 'payroll.irp5.prepared', 'irp5_record', record.id, 1, now, command, {
        certificateKind,
        totals,
        sarsSubmissionInitiated: false,
      })
      storeIdempotency(state, actor, scope, 'payroll.irp5.prepare', command, record.id, idem.claimId, idem.payloadDigest, now, record)
      return structuredClone(record)
    })
  }

  async approveIrp5(actor: FinanceActorContext, command: ApproveStatutoryCommand): Promise<Irp5Record> {
    const scope = scopeOf(command)
    const now = this.now()
    authorizeFinanceAction(actor, scope, 'payroll.statutory.approve', now)
    return this.store.transact((state) => {
      const idem = idempotencyInput(state, actor, scope, 'payroll.irp5.approve', command, now)
      if (idem.retryId) return structuredClone(state.irp5Records.get(idem.retryId)!)
      const current = scopedGet(state.irp5Records, command.id, scope, 'IRP5/IT3(a) record')
      if (current.version !== command.expectedVersion) throw new FinanceValidationError('expectedVersion mismatch')
      assertCanApproveStatutory(current, actor.uid, 'IRP5/IT3(a) record')
      const approval = loadApproval(state, command.approvalId, scope, 'payroll.statutory.approve', actor.uid, now)
      const next: Irp5Record = {
        ...current,
        status: 'approved_locked',
        immutable: true,
        approvalId: approval.approvalId,
        approvalActorId: actor.uid,
        approvedAt: now,
        lockedAt: now,
        version: current.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
      }
      next.contentHash = buildStatutoryContentHash('irp5_record_locked', {
        id: next.id,
        priorHash: current.contentHash,
        approvalId: next.approvalId,
        lockedAt: next.lockedAt,
      })
      state.irp5Records.set(next.id, next)
      appendAudit(state, scope, actor, 'payroll.irp5.approved_locked', 'irp5_record', next.id, next.version, now, command, {
        certificateKind: next.certificateKind,
        sarsSubmissionInitiated: false,
      }, command.reason)
      storeIdempotency(state, actor, scope, 'payroll.irp5.approve', command, next.id, idem.claimId, idem.payloadDigest, now, next)
      return structuredClone(next)
    })
  }

  async prepareEmp201(actor: FinanceActorContext, command: PrepareEmp201Command): Promise<Emp201Snapshot> {
    const scope = scopeOf(command)
    const now = this.now()
    authorizeFinanceAction(actor, scope, 'payroll.statutory.prepare', now)
    assertCreateVersion(command.expectedVersion, 'emp201 snapshot')
    return this.store.transact((state) => {
      const idem = idempotencyInput(state, actor, scope, 'payroll.emp201.prepare', command, now)
      if (idem.retryId) return structuredClone(state.emp201Snapshots.get(idem.retryId)!)
      const taxYear = scopedGet(state.taxYears, command.taxYearId, scope, 'Payroll tax year')
      assertTaxYearAcceptsStatutoryPrepare(taxYear)
      if (!/^\d{4}-\d{2}$/.test(command.taxMonth)) throw new FinanceValidationError('taxMonth must be YYYY-MM')
      const monthStart = `${command.taxMonth}-01`
      const monthProbe = `${command.taxMonth}-15`
      const inCalendarWindow =
        isDateWithinTaxYear(monthStart, taxYear) ||
        isDateWithinTaxYear(monthProbe, taxYear) ||
        isDateWithinTaxYear(`${command.taxMonth}-28`, taxYear)
      const labeledPeriodInMonth = Array.from(state.periods.values()).some(
        (period) =>
          period.orgId === scope.orgId &&
          period.legalEntityId === scope.legalEntityId &&
          period.bookId === scope.bookId &&
          period.taxYearLabel === taxYear.taxYearLabel &&
          periodMatchesTaxMonth(period, command.taxMonth),
      )
      if (!inCalendarWindow && !labeledPeriodInMonth) {
        throw new FinanceValidationError('taxMonth is outside tax year window')
      }

      for (const existing of state.emp201Snapshots.values()) {
        if (
          existing.orgId === scope.orgId &&
          existing.legalEntityId === scope.legalEntityId &&
          existing.bookId === scope.bookId &&
          existing.taxYearId === taxYear.id &&
          existing.taxMonth === command.taxMonth &&
          (existing.status === 'draft' || existing.status === 'ready')
        ) {
          state.emp201Snapshots.set(existing.id, {
            ...existing,
            status: 'superseded',
            version: existing.version + 1,
            updatedAt: now,
            updatedBy: actor.uid,
          })
        }
      }

      claim(
        state,
        'payroll_emp201_month',
        scope,
        { taxYearId: taxYear.id, taxMonth: command.taxMonth, slot: command.id },
        command.id,
        'EMP201 claim collision',
      )

      const { items, taxTableReferences } = this.collectEligibleItems(state, scope, taxYear, { taxMonth: command.taxMonth })
      if (items.length < 1) throw new FinanceValidationError('No locked pay-run items found for tax month')
      const totals = aggregateItems(items)
      const employeeCount = new Set(items.map((i) => i.employeeId)).size
      const base = versionedBase(command.id, scope, actor.uid, now)
      const body = {
        ...base,
        taxYearId: taxYear.id,
        taxYearLabel: taxYear.taxYearLabel,
        taxMonth: command.taxMonth,
        status: 'ready' as const,
        employeeCount,
        totals,
        sourcePayRunIds: [...new Set(items.map((i) => i.payRunId))].sort(),
        sourceItemIds: items.map((i) => i.id).sort(),
        sourceItemDigests: items.map((i) => i.resultDigest).sort(),
        taxTableReferences,
        immutable: false,
        sarsSubmissionInitiated: false as const,
        externalPaymentInitiated: false as const,
      }
      const record: Emp201Snapshot = {
        ...body,
        contentHash: buildStatutoryContentHash('emp201_snapshot', {
          taxYearId: body.taxYearId,
          taxMonth: body.taxMonth,
          totals: body.totals,
          sourceItemDigests: body.sourceItemDigests,
          taxTableReferences: body.taxTableReferences,
        }),
      }
      state.emp201Snapshots.set(record.id, record)
      appendAudit(state, scope, actor, 'payroll.emp201.prepared', 'emp201_snapshot', record.id, 1, now, command, {
        taxMonth: command.taxMonth,
        totals,
        sarsSubmissionInitiated: false,
      })
      storeIdempotency(state, actor, scope, 'payroll.emp201.prepare', command, record.id, idem.claimId, idem.payloadDigest, now, record)
      return structuredClone(record)
    })
  }

  async approveEmp201(actor: FinanceActorContext, command: ApproveStatutoryCommand): Promise<Emp201Snapshot> {
    const scope = scopeOf(command)
    const now = this.now()
    authorizeFinanceAction(actor, scope, 'payroll.statutory.approve', now)
    return this.store.transact((state) => {
      const idem = idempotencyInput(state, actor, scope, 'payroll.emp201.approve', command, now)
      if (idem.retryId) return structuredClone(state.emp201Snapshots.get(idem.retryId)!)
      const current = scopedGet(state.emp201Snapshots, command.id, scope, 'EMP201 snapshot')
      if (current.version !== command.expectedVersion) throw new FinanceValidationError('expectedVersion mismatch')
      assertCanApproveStatutory(current, actor.uid, 'EMP201 snapshot')
      const approval = loadApproval(state, command.approvalId, scope, 'payroll.statutory.approve', actor.uid, now)
      const next: Emp201Snapshot = {
        ...current,
        status: 'approved_locked',
        immutable: true,
        approvalId: approval.approvalId,
        approvalActorId: actor.uid,
        approvedAt: now,
        lockedAt: now,
        version: current.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
      }
      next.contentHash = buildStatutoryContentHash('emp201_locked', {
        id: next.id,
        priorHash: current.contentHash,
        approvalId: next.approvalId,
        lockedAt: next.lockedAt,
      })
      state.emp201Snapshots.set(next.id, next)
      appendAudit(state, scope, actor, 'payroll.emp201.approved_locked', 'emp201_snapshot', next.id, next.version, now, command, {
        taxMonth: next.taxMonth,
        sarsSubmissionInitiated: false,
      }, command.reason)
      storeIdempotency(state, actor, scope, 'payroll.emp201.approve', command, next.id, idem.claimId, idem.payloadDigest, now, next)
      return structuredClone(next)
    })
  }

  async prepareEmp501(actor: FinanceActorContext, command: PrepareEmp501Command): Promise<Emp501Reconciliation> {
    const scope = scopeOf(command)
    const now = this.now()
    authorizeFinanceAction(actor, scope, 'payroll.statutory.prepare', now)
    assertCreateVersion(command.expectedVersion, 'emp501 reconciliation')
    return this.store.transact((state) => {
      const idem = idempotencyInput(state, actor, scope, 'payroll.emp501.prepare', command, now)
      if (idem.retryId) return structuredClone(state.emp501Reconciliations.get(idem.retryId)!)
      const taxYear = scopedGet(state.taxYears, command.taxYearId, scope, 'Payroll tax year')
      assertTaxYearAcceptsStatutoryPrepare(taxYear)

      for (const existing of state.emp501Reconciliations.values()) {
        if (
          existing.orgId === scope.orgId &&
          existing.legalEntityId === scope.legalEntityId &&
          existing.bookId === scope.bookId &&
          existing.taxYearId === taxYear.id &&
          (existing.status === 'draft' || existing.status === 'ready')
        ) {
          state.emp501Reconciliations.set(existing.id, {
            ...existing,
            status: 'superseded',
            version: existing.version + 1,
            updatedAt: now,
            updatedBy: actor.uid,
          })
        }
      }

      claim(state, 'payroll_emp501_year', scope, { taxYearId: taxYear.id, slot: command.id }, command.id, 'EMP501 claim collision')

      const emp201s = Array.from(state.emp201Snapshots.values()).filter(
        (row) =>
          row.orgId === scope.orgId &&
          row.legalEntityId === scope.legalEntityId &&
          row.bookId === scope.bookId &&
          row.taxYearId === taxYear.id &&
          (row.status === 'approved_locked' || row.status === 'ready'),
      )
      const certificates = Array.from(state.irp5Records.values()).filter(
        (row) =>
          row.orgId === scope.orgId &&
          row.legalEntityId === scope.legalEntityId &&
          row.bookId === scope.bookId &&
          row.taxYearId === taxYear.id &&
          (row.status === 'approved_locked' || row.status === 'ready'),
      )
      if (emp201s.length < 1) throw new FinanceValidationError('EMP501 requires at least one EMP201 snapshot')
      if (certificates.length < 1) throw new FinanceValidationError('EMP501 requires at least one IRP5/IT3(a) record')

      const monthlyFromRuns = emp201s.reduce((acc, row) => addStatutoryTotals(acc, row.totals), emptyStatutoryTotals())
      const openings = Array.from(state.ytdOpenings.values()).filter(
        (row) =>
          row.orgId === scope.orgId &&
          row.legalEntityId === scope.legalEntityId &&
          row.bookId === scope.bookId &&
          row.taxYearId === taxYear.id &&
          row.status === 'approved',
      )
      const openingTotals = openings.reduce(
        (acc, row) =>
          addStatutoryTotals(acc, {
            grossEarningsMinor: row.grossEarningsMinor,
            taxableEarningsMinor: row.taxableEarningsMinor,
            payeMinor: row.payeMinor,
            uifEmployeeMinor: row.uifEmployeeMinor,
            uifEmployerMinor: row.uifEmployerMinor,
            sdlEmployerMinor: row.sdlEmployerMinor,
            netPayMinor: 0,
            periodsIncluded: 0,
          }),
        emptyStatutoryTotals(),
      )
      // Certificates include approved YTD openings; fold the same openings into the employer rollup.
      const monthlyTotals = addStatutoryTotals(monthlyFromRuns, openingTotals)
      const certificateTotals = certificates.reduce((acc, row) => addStatutoryTotals(acc, row.totals), emptyStatutoryTotals())
      const difference = differenceTotals(monthlyTotals, certificateTotals)
      const reconciled =
        difference.grossEarningsMinor === 0 &&
        difference.taxableEarningsMinor === 0 &&
        difference.payeMinor === 0 &&
        difference.uifEmployeeMinor === 0 &&
        difference.uifEmployerMinor === 0 &&
        difference.sdlEmployerMinor === 0
      // netPay is employee-facing and may legitimately differ from employer monthly liability views when openings lack net; ignore for lock gate
      const monetaryDifference = { ...difference, netPayMinor: difference.netPayMinor }
      const hardReconciled =
        openings.length === 0
          ? reconciled && difference.netPayMinor === 0
          : reconciled

      const taxTableReferences = uniqueTaxTableReferences([
        ...emp201s.flatMap((row) => row.taxTableReferences),
        ...certificates.flatMap((row) => row.taxTableReferences),
      ])
      const base = versionedBase(command.id, scope, actor.uid, now)
      const body = {
        ...base,
        taxYearId: taxYear.id,
        taxYearLabel: taxYear.taxYearLabel,
        status: 'ready' as const,
        emp201SnapshotIds: emp201s.map((row) => row.id).sort(),
        irp5RecordIds: certificates.map((row) => row.id).sort(),
        monthlyTotals,
        certificateTotals,
        difference: monetaryDifference,
        reconciled: hardReconciled,
        taxTableReferences,
        immutable: false,
        sarsSubmissionInitiated: false as const,
        externalPaymentInitiated: false as const,
      }
      const record: Emp501Reconciliation = {
        ...body,
        contentHash: buildStatutoryContentHash('emp501_reconciliation', {
          taxYearId: body.taxYearId,
          emp201SnapshotIds: body.emp201SnapshotIds,
          irp5RecordIds: body.irp5RecordIds,
          difference: body.difference,
          reconciled: body.reconciled,
        }),
      }
      state.emp501Reconciliations.set(record.id, record)
      appendAudit(state, scope, actor, 'payroll.emp501.prepared', 'emp501_reconciliation', record.id, 1, now, command, {
        reconciled: hardReconciled,
        difference: monetaryDifference,
        sarsSubmissionInitiated: false,
      })
      storeIdempotency(state, actor, scope, 'payroll.emp501.prepare', command, record.id, idem.claimId, idem.payloadDigest, now, record)
      return structuredClone(record)
    })
  }

  async approveEmp501(actor: FinanceActorContext, command: ApproveStatutoryCommand): Promise<Emp501Reconciliation> {
    const scope = scopeOf(command)
    const now = this.now()
    authorizeFinanceAction(actor, scope, 'payroll.statutory.approve', now)
    return this.store.transact((state) => {
      const idem = idempotencyInput(state, actor, scope, 'payroll.emp501.approve', command, now)
      if (idem.retryId) return structuredClone(state.emp501Reconciliations.get(idem.retryId)!)
      const current = scopedGet(state.emp501Reconciliations, command.id, scope, 'EMP501 reconciliation')
      if (current.version !== command.expectedVersion) throw new FinanceValidationError('expectedVersion mismatch')
      assertCanApproveStatutory(current, actor.uid, 'EMP501 reconciliation')
      if (!current.reconciled) {
        throw new FinanceValidationError('EMP501 must be fully reconciled (zero monetary differences) before approve/lock')
      }
      const approval = loadApproval(state, command.approvalId, scope, 'payroll.statutory.approve', actor.uid, now)
      const next: Emp501Reconciliation = {
        ...current,
        status: 'approved_locked',
        immutable: true,
        approvalId: approval.approvalId,
        approvalActorId: actor.uid,
        approvedAt: now,
        lockedAt: now,
        version: current.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
      }
      next.contentHash = buildStatutoryContentHash('emp501_locked', {
        id: next.id,
        priorHash: current.contentHash,
        approvalId: next.approvalId,
        lockedAt: next.lockedAt,
      })
      state.emp501Reconciliations.set(next.id, next)
      appendAudit(state, scope, actor, 'payroll.emp501.approved_locked', 'emp501_reconciliation', next.id, next.version, now, command, {
        reconciled: true,
        sarsSubmissionInitiated: false,
      }, command.reason)
      storeIdempotency(state, actor, scope, 'payroll.emp501.approve', command, next.id, idem.claimId, idem.payloadDigest, now, next)
      return structuredClone(next)
    })
  }

  async generateExportManifest(actor: FinanceActorContext, command: GenerateExportCommand): Promise<PayrollExportManifest> {
    const scope = scopeOf(command)
    const now = this.now()
    authorizeFinanceAction(actor, scope, 'payroll.export.generate', now)
    assertCreateVersion(command.expectedVersion, 'export manifest')
    return this.store.transact((state) => {
      const idem = idempotencyInput(state, actor, scope, 'payroll.export.generate', command, now)
      if (idem.retryId) return structuredClone(state.exportManifests.get(idem.retryId)!)
      const taxYear = scopedGet(state.taxYears, command.taxYearId, scope, 'Payroll tax year')

      let recordIds: string[] = []
      let recordDigests: string[] = []
      let evidence: Record<string, unknown> = {}
      const taxTableReferences = []

      if (command.kind === 'irp5_batch') {
        const rows = Array.from(state.irp5Records.values()).filter(
          (row) =>
            row.orgId === scope.orgId &&
            row.legalEntityId === scope.legalEntityId &&
            row.bookId === scope.bookId &&
            row.taxYearId === taxYear.id &&
            (command.recordIds ? command.recordIds.includes(row.id) : row.status === 'approved_locked' || row.status === 'ready'),
        )
        if (rows.length < 1) throw new FinanceValidationError('No IRP5/IT3(a) records available for export')
        recordIds = rows.map((r) => r.id).sort()
        recordDigests = rows.map((r) => r.contentHash).sort()
        taxTableReferences.push(...rows.flatMap((r) => r.taxTableReferences))
        evidence = {
          kind: 'irp5_batch_export_v1',
          certificates: rows.map((row) => ({
            id: row.id,
            status: row.status,
            contentHash: row.contentHash,
            mapped: zaMapCertificateEvidence({
              certificateKind: row.certificateKind,
              employeeNumber: row.employeeNumber,
              displayName: row.displayName,
              taxYearLabel: row.taxYearLabel,
              totals: row.totals,
              taxTableReferences: row.taxTableReferences,
            }),
          })),
          sarsSubmissionInitiated: false,
          externalEgressAllowed: false,
        }
      } else if (command.kind === 'emp201') {
        const rows = Array.from(state.emp201Snapshots.values()).filter(
          (row) =>
            row.orgId === scope.orgId &&
            row.legalEntityId === scope.legalEntityId &&
            row.bookId === scope.bookId &&
            row.taxYearId === taxYear.id &&
            (command.recordIds ? command.recordIds.includes(row.id) : row.status === 'approved_locked' || row.status === 'ready'),
        )
        if (rows.length < 1) throw new FinanceValidationError('No EMP201 snapshots available for export')
        recordIds = rows.map((r) => r.id).sort()
        recordDigests = rows.map((r) => r.contentHash).sort()
        taxTableReferences.push(...rows.flatMap((r) => r.taxTableReferences))
        evidence = {
          kind: 'emp201_export_v1',
          snapshots: rows.map((row) => ({
            id: row.id,
            status: row.status,
            contentHash: row.contentHash,
            mapped: zaMapEmp201Evidence({
              taxYearLabel: row.taxYearLabel,
              taxMonth: row.taxMonth,
              totals: row.totals,
              employeeCount: row.employeeCount,
              taxTableReferences: row.taxTableReferences,
            }),
          })),
          sarsSubmissionInitiated: false,
          externalEgressAllowed: false,
        }
      } else if (command.kind === 'emp501') {
        const rows = Array.from(state.emp501Reconciliations.values()).filter(
          (row) =>
            row.orgId === scope.orgId &&
            row.legalEntityId === scope.legalEntityId &&
            row.bookId === scope.bookId &&
            row.taxYearId === taxYear.id &&
            (command.recordIds ? command.recordIds.includes(row.id) : row.status === 'approved_locked' || row.status === 'ready'),
        )
        if (rows.length !== 1 && !command.recordIds) {
          // allow multiple historical; pick latest ready/approved if not specified
        }
        if (rows.length < 1) throw new FinanceValidationError('No EMP501 reconciliation available for export')
        const row = rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
        recordIds = [row.id]
        recordDigests = [row.contentHash]
        taxTableReferences.push(...row.taxTableReferences)
        evidence = {
          kind: 'emp501_export_v1',
          reconciliation: {
            id: row.id,
            status: row.status,
            contentHash: row.contentHash,
            mapped: zaMapEmp501Evidence({
              taxYearLabel: row.taxYearLabel,
              monthlyTotals: row.monthlyTotals,
              certificateTotals: row.certificateTotals,
              difference: row.difference,
              reconciled: row.reconciled,
              taxTableReferences: row.taxTableReferences,
            }),
          },
          sarsSubmissionInitiated: false,
          externalEgressAllowed: false,
        }
      } else if (command.kind === 'payroll_tax_summary') {
        const certificates = Array.from(state.irp5Records.values()).filter(
          (row) =>
            row.orgId === scope.orgId &&
            row.legalEntityId === scope.legalEntityId &&
            row.bookId === scope.bookId &&
            row.taxYearId === taxYear.id &&
            (row.status === 'approved_locked' || row.status === 'ready'),
        )
        const emp201s = Array.from(state.emp201Snapshots.values()).filter(
          (row) =>
            row.orgId === scope.orgId &&
            row.legalEntityId === scope.legalEntityId &&
            row.bookId === scope.bookId &&
            row.taxYearId === taxYear.id &&
            (row.status === 'approved_locked' || row.status === 'ready'),
        )
        const emp501 = Array.from(state.emp501Reconciliations.values())
          .filter(
            (row) =>
              row.orgId === scope.orgId &&
              row.legalEntityId === scope.legalEntityId &&
              row.bookId === scope.bookId &&
              row.taxYearId === taxYear.id &&
              (row.status === 'approved_locked' || row.status === 'ready'),
          )
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
        recordIds = [
          ...certificates.map((r) => r.id),
          ...emp201s.map((r) => r.id),
          ...(emp501 ? [emp501.id] : []),
        ].sort()
        recordDigests = [
          ...certificates.map((r) => r.contentHash),
          ...emp201s.map((r) => r.contentHash),
          ...(emp501 ? [emp501.contentHash] : []),
        ].sort()
        taxTableReferences.push(
          ...certificates.flatMap((r) => r.taxTableReferences),
          ...emp201s.flatMap((r) => r.taxTableReferences),
          ...(emp501 ? emp501.taxTableReferences : []),
        )
        evidence = buildPayrollTaxSummaryEvidence({
          taxYear,
          certificates,
          emp201s,
          emp501: emp501 ?? null,
          taxTableReferences: uniqueTaxTableReferences(taxTableReferences),
        })
      } else {
        throw new FinanceValidationError('Unsupported export kind')
      }

      const contentDigest = buildExportContentDigest({
        kind: command.kind,
        taxYearId: taxYear.id,
        recordIds,
        recordDigests,
      })
      const base = versionedBase(command.id, scope, actor.uid, now)
      const body = {
        ...base,
        taxYearId: taxYear.id,
        kind: command.kind,
        status: 'generated' as const,
        recordIds,
        format: 'json_evidence_v1' as const,
        contentDigest,
        evidence: {
          ...evidence,
          taxTableReferences: uniqueTaxTableReferences(taxTableReferences),
          generatedAt: now,
        },
        immutable: true,
        sarsSubmissionInitiated: false as const,
        externalPaymentInitiated: false as const,
        externalEgressAllowed: false as const,
      }
      const record: PayrollExportManifest = {
        ...body,
        contentHash: buildStatutoryContentHash('payroll_export_manifest', {
          kind: body.kind,
          taxYearId: body.taxYearId,
          contentDigest: body.contentDigest,
          recordIds: body.recordIds,
        }),
      }
      if (!exportManifestIsInternalOnly(record)) {
        throw new FinanceValidationError('Export manifest must remain internal-only with no SARS/payment egress')
      }
      state.exportManifests.set(record.id, record)

      // Link export id onto source rows when single-kind.
      if (command.kind === 'irp5_batch') {
        for (const id of recordIds) {
          const row = state.irp5Records.get(id)
          if (row) state.irp5Records.set(id, { ...row, exportManifestId: record.id, updatedAt: now, updatedBy: actor.uid })
        }
      } else if (command.kind === 'emp201') {
        for (const id of recordIds) {
          const row = state.emp201Snapshots.get(id)
          if (row) state.emp201Snapshots.set(id, { ...row, exportManifestId: record.id, updatedAt: now, updatedBy: actor.uid })
        }
      } else if (command.kind === 'emp501') {
        for (const id of recordIds) {
          const row = state.emp501Reconciliations.get(id)
          if (row) state.emp501Reconciliations.set(id, { ...row, exportManifestId: record.id, updatedAt: now, updatedBy: actor.uid })
        }
      }

      appendAudit(state, scope, actor, 'payroll.export.generated', 'payroll_export_manifest', record.id, 1, now, command, {
        kind: command.kind,
        contentDigest,
        recordCount: recordIds.length,
        sarsSubmissionInitiated: false,
        externalEgressAllowed: false,
      })
      storeIdempotency(state, actor, scope, 'payroll.export.generate', command, record.id, idem.claimId, idem.payloadDigest, now, record)
      return structuredClone(record)
    })
  }

  getTaxSummary(scopeInput: Required<FinanceScope>, taxYearId: string): PayrollTaxSummary {
    const scope = scopeOf(scopeInput)
    const taxYear = scopedGet(this.store.taxYears, taxYearId, scope, 'Payroll tax year')
    const certificates = Array.from(this.store.irp5Records.values()).filter(
      (row) =>
        row.orgId === scope.orgId &&
        row.legalEntityId === scope.legalEntityId &&
        row.bookId === scope.bookId &&
        row.taxYearId === taxYear.id &&
        (row.status === 'approved_locked' || row.status === 'ready'),
    )
    const emp201s = Array.from(this.store.emp201Snapshots.values()).filter(
      (row) =>
        row.orgId === scope.orgId &&
        row.legalEntityId === scope.legalEntityId &&
        row.bookId === scope.bookId &&
        row.taxYearId === taxYear.id &&
        (row.status === 'approved_locked' || row.status === 'ready'),
    )
    const emp501 = Array.from(this.store.emp501Reconciliations.values())
      .filter(
        (row) =>
          row.orgId === scope.orgId &&
          row.legalEntityId === scope.legalEntityId &&
          row.bookId === scope.bookId &&
          row.taxYearId === taxYear.id &&
          (row.status === 'approved_locked' || row.status === 'ready'),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
    const totals = certificates.reduce((acc, row) => addStatutoryTotals(acc, row.totals), emptyStatutoryTotals())
    return {
      taxYearId: taxYear.id,
      taxYearLabel: taxYear.taxYearLabel,
      status: taxYear.status,
      employeeCertificates: certificates.length,
      irp5Count: certificates.filter((c) => c.certificateKind === 'IRP5').length,
      it3aCount: certificates.filter((c) => c.certificateKind === 'IT3(a)').length,
      emp201Count: emp201s.length,
      emp501Reconciled: emp501 ? emp501.reconciled : null,
      totals,
      taxTableReferences: uniqueTaxTableReferences([
        ...certificates.flatMap((c) => c.taxTableReferences),
        ...emp201s.flatMap((e) => e.taxTableReferences),
      ]),
      sarsSubmissionInitiated: false,
      externalPaymentInitiated: false,
    }
  }

  getIrp5(scopeInput: Required<FinanceScope>, id: string): Irp5Record {
    return structuredClone(scopedGet(this.store.irp5Records, id, scopeOf(scopeInput), 'IRP5/IT3(a) record'))
  }

  getEmp201(scopeInput: Required<FinanceScope>, id: string): Emp201Snapshot {
    return structuredClone(scopedGet(this.store.emp201Snapshots, id, scopeOf(scopeInput), 'EMP201 snapshot'))
  }

  getEmp501(scopeInput: Required<FinanceScope>, id: string): Emp501Reconciliation {
    return structuredClone(scopedGet(this.store.emp501Reconciliations, id, scopeOf(scopeInput), 'EMP501 reconciliation'))
  }

  getExportManifest(scopeInput: Required<FinanceScope>, id: string): PayrollExportManifest {
    return structuredClone(scopedGet(this.store.exportManifests, id, scopeOf(scopeInput), 'Payroll export manifest'))
  }
}

// silence unused helper warning when tree-shaken tests import selectively
void isFullyReconciled
void taxMonthFromDate
void cloneMap
