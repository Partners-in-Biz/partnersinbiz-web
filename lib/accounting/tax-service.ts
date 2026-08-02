import { authorizeFinanceAction } from '@/lib/finance/policy'
import { CANONICAL_PAYLOAD_VERSION, HASH_ALGORITHM_VERSION, canonicalDigest, canonicalScopeIdentity, scopedClaimId } from '@/lib/finance/integrity'
import type { AccountingBasis, FinanceActorContext, FinanceApprovalAction, FinanceApprovalRecord, FinanceScope } from '@/lib/finance/types'
import {
  FinanceValidationError,
  assertCreateVersion,
  assertEnumValue,
  assertImmutableContentHash,
  assertSafeInteger,
  immutableContentHash,
  parseCanonicalDate,
  requiredText,
} from './foundation'
import { calculateTaxAmount, resolveEffectiveTaxRule } from './tax'
import type {
  TaxAmountResult,
  TaxCode,
  TaxPeriod,
  TaxPeriodStatus,
  TaxReturnLine,
  TaxReturnSnapshot,
  TaxRuleVersion,
  TaxCategory,
  TaxRecoverability,
} from './tax-types'
import type { PostedJournalEntry } from './types'

interface CommandIdentity { requestId: string; idempotencyKey: string }

export interface CreateTaxCodeCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  code: string
  name: string
  jurisdictionCode: string
  category: TaxCategory
  recoverability: TaxRecoverability
  outputAccountId?: string
  inputAccountId?: string
  active: boolean
  expectedVersion: 0
}

export interface CreateTaxRuleVersionCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  taxCodeId: string
  jurisdictionCode: string
  versionNumber: number
  rateBasisPoints: number
  rateNumerator: number
  rateDenominator: number
  roundingMode: TaxRuleVersion['roundingMode']
  taxPointPolicyId: string
  effectiveFrom: string
  effectiveTo?: string
  sourceCitation: string
  sourceChecksum: string
  approvalId: string
  expectedVersion: 0
}

export interface CreateTaxPeriodCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  jurisdictionCode: string
  label: string
  startsAt: string
  endsAt: string
  status: 'open'
  expectedVersion: 0
}

export interface ChangeTaxPeriodStatusCommand extends Required<FinanceScope>, CommandIdentity {
  taxPeriodId: string
  status: TaxPeriodStatus
  expectedVersion: number
  reason: string
  approvalId?: string
  sourceCutoffAt?: string
}

export interface PrepareTaxReturnCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  taxPeriodId: string
  sourceCutoffAt: string
  accountingBasis: AccountingBasis
  expectedVersion: 0
}

export interface ApproveTaxReturnCommand extends Required<FinanceScope>, CommandIdentity {
  taxReturnId: string
  expectedVersion: number
  approvalId: string
  reason: string
}

export interface CalculateTaxCommand {
  orgId: string
  legalEntityId: string
  bookId: string
  taxCodeId: string
  documentDate: string
  taxableMinorExclusive: number
  taxIncluded: boolean
}

export interface JournalTaxTraceLine {
  journalEntryId: string
  taxCodeId: string
  taxRuleVersionId: string
  category: TaxCategory
  taxableMinor: number
  taxMinor: number
  direction: 'output' | 'input'
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

export interface TaxServiceState {
  taxCodes: Map<string, TaxCode>
  taxRules: Map<string, TaxRuleVersion>
  taxPeriods: Map<string, TaxPeriod>
  taxReturns: Map<string, TaxReturnSnapshot>
  approvals: Map<string, FinanceApprovalRecord>
  uniqueClaims: Map<string, string>
  idempotency: Map<string, IdempotencyRecord>
  journalTaxTraces: JournalTaxTraceLine[]
}

function cloneMap<T>(source: Map<string, T>): Map<string, T> {
  return new Map(Array.from(source, ([key, value]) => [key, structuredClone(value)]))
}

function cloneState(state: TaxServiceState): TaxServiceState {
  return {
    taxCodes: cloneMap(state.taxCodes),
    taxRules: cloneMap(state.taxRules),
    taxPeriods: cloneMap(state.taxPeriods),
    taxReturns: cloneMap(state.taxReturns),
    approvals: cloneMap(state.approvals),
    uniqueClaims: new Map(state.uniqueClaims),
    idempotency: cloneMap(state.idempotency),
    journalTaxTraces: structuredClone(state.journalTaxTraces),
  }
}

export class InMemoryTaxStore implements TaxServiceState {
  taxCodes = new Map<string, TaxCode>()
  taxRules = new Map<string, TaxRuleVersion>()
  taxPeriods = new Map<string, TaxPeriod>()
  taxReturns = new Map<string, TaxReturnSnapshot>()
  approvals = new Map<string, FinanceApprovalRecord>()
  uniqueClaims = new Map<string, string>()
  idempotency = new Map<string, IdempotencyRecord>()
  journalTaxTraces: JournalTaxTraceLine[] = []
  private transactionTail: Promise<void> = Promise.resolve()

  async transact<T>(operation: (state: TaxServiceState) => T | Promise<T>): Promise<T> {
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

function normalizeCode(value: string, field: string): string {
  return requiredText(value, field).toUpperCase()
}

function claim(state: TaxServiceState, type: string, scope: FinanceScope, key: unknown, id: string, message: string): void {
  const claimId = scopedClaimId(type, scope, key)
  const existing = state.uniqueClaims.get(claimId)
  if (existing && existing !== id) throw new FinanceValidationError(message)
  state.uniqueClaims.set(claimId, id)
}

function idempotencyInput(
  state: TaxServiceState,
  actor: FinanceActorContext,
  scope: FinanceScope,
  operation: string,
  command: unknown,
  now: string,
): { retryId?: string; claimId: string; payloadDigest: string } {
  const payloadDigest = canonicalDigest(command)
  const claimId = scopedClaimId('tax_idempotency', scope, { actorId: actor.uid, key: (command as CommandIdentity).idempotencyKey, operation })
  const retry = state.idempotency.get(claimId)
  if (!retry) return { claimId, payloadDigest }
  if (retry.schemaVersion !== 1 || retry.canonicalPayloadVersion !== CANONICAL_PAYLOAD_VERSION ||
      retry.hashAlgorithmVersion !== HASH_ALGORITHM_VERSION || retry.actorId !== actor.uid ||
      retry.orgId !== scope.orgId || retry.scopeIdentity !== canonicalScopeIdentity(scope) ||
      retry.operation !== operation || retry.requestId !== (command as CommandIdentity).requestId ||
      retry.expiresAt <= now) {
    throw new FinanceValidationError('Idempotency metadata is invalid, mismatched, or expired')
  }
  if (retry.payloadDigest !== payloadDigest) throw new FinanceValidationError('Idempotency key payload mismatch')
  return { retryId: retry.aggregateId, claimId, payloadDigest }
}

function compactUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}

function storeIdempotency(
  state: TaxServiceState,
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
  state: TaxServiceState,
  approvalId: string | undefined,
  scope: Required<FinanceScope>,
  action: FinanceApprovalAction,
  actorId: string,
  now: string,
): { approvalId: string; approvedBy: string; approvedAt: string; action: FinanceApprovalAction; reason: string } {
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

export function taxRuleRangesOverlap(
  left: Pick<TaxRuleVersion, 'effectiveFrom' | 'effectiveTo'>,
  right: Pick<TaxRuleVersion, 'effectiveFrom' | 'effectiveTo'>,
): boolean {
  const leftFrom = parseCanonicalDate(left.effectiveFrom, 'rule.effectiveFrom')
  const leftTo = left.effectiveTo ? parseCanonicalDate(left.effectiveTo, 'rule.effectiveTo') : Number.POSITIVE_INFINITY
  const rightFrom = parseCanonicalDate(right.effectiveFrom, 'rule.effectiveFrom')
  const rightTo = right.effectiveTo ? parseCanonicalDate(right.effectiveTo, 'rule.effectiveTo') : Number.POSITIVE_INFINITY
  return leftFrom <= rightTo && rightFrom <= leftTo
}

export type TaxTransactionalStore = TaxServiceState & {
  transact<T>(operation: (state: TaxServiceState) => T | Promise<T>): Promise<T>
}

export class FinanceTaxService {
  constructor(
    private readonly store: TaxTransactionalStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** Register an already-persisted finance approval for tax mutations that require SOD. */
  registerApproval(approval: FinanceApprovalRecord): void {
    this.store.approvals.set(approval.id, approval)
  }

  recordJournalTaxTrace(trace: JournalTaxTraceLine): void {
    this.store.journalTaxTraces.push(trace)
  }

  async createTaxCode(actor: FinanceActorContext, command: CreateTaxCodeCommand): Promise<TaxCode> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    assertCreateVersion(command.expectedVersion, 'Tax code')
    authorizeFinanceAction(actor, scope, 'tax.configure', this.now())
    assertEnumValue(command.category, ['output_vat', 'input_vat', 'zero_rated', 'exempt', 'out_of_scope', 'withholding'], 'category')
    assertEnumValue(command.recoverability, ['full', 'partial', 'none', 'not_applicable'], 'recoverability')
    if (typeof command.active !== 'boolean') throw new FinanceValidationError('active must be boolean')
    return this.store.transact((state) => {
      const now = this.now()
      const idem = idempotencyInput(state, actor, scope, 'tax-code.create', command, now)
      if (idem.retryId) {
        const stored = state.taxCodes.get(idem.retryId)
        if (!stored || stored.id !== command.id) throw new FinanceValidationError('Idempotency tax code result is corrupt')
        return stored
      }
      if (state.taxCodes.get(command.id)) throw new FinanceValidationError('Tax code already exists')
      const code = normalizeCode(command.code, 'code')
      claim(state, 'tax_code', scope, code, command.id, 'Tax code already exists')
      const taxCode: TaxCode = {
        ...scope,
        id: command.id,
        code,
        name: requiredText(command.name, 'name'),
        jurisdictionCode: normalizeCode(command.jurisdictionCode, 'jurisdictionCode'),
        category: command.category,
        recoverability: command.recoverability,
        active: command.active,
        schemaVersion: 1,
        version: 1,
        createdAt: now,
        createdBy: actor.uid,
        updatedAt: now,
        updatedBy: actor.uid,
        ...(command.outputAccountId ? { outputAccountId: command.outputAccountId } : {}),
        ...(command.inputAccountId ? { inputAccountId: command.inputAccountId } : {}),
      }
      state.taxCodes.set(taxCode.id, taxCode)
      storeIdempotency(state, actor, scope, 'tax-code.create', command, taxCode.id, idem.claimId, idem.payloadDigest, now, taxCode)
      return taxCode
    })
  }

  async createTaxRuleVersion(actor: FinanceActorContext, command: CreateTaxRuleVersionCommand): Promise<TaxRuleVersion> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    assertCreateVersion(command.expectedVersion, 'Tax rule version')
    authorizeFinanceAction(actor, scope, 'tax.configure', this.now())
    assertSafeInteger(command.versionNumber, 'versionNumber', 1)
    assertSafeInteger(command.rateBasisPoints, 'rateBasisPoints', 0)
    assertSafeInteger(command.rateNumerator, 'rateNumerator', 0)
    assertSafeInteger(command.rateDenominator, 'rateDenominator', 1)
    assertEnumValue(command.roundingMode, ['half_up', 'half_even', 'floor', 'ceil'], 'roundingMode')
    parseCanonicalDate(command.effectiveFrom, 'effectiveFrom')
    if (command.effectiveTo) parseCanonicalDate(command.effectiveTo, 'effectiveTo')
    return this.store.transact((state) => {
      const now = this.now()
      const idem = idempotencyInput(state, actor, scope, 'tax-rule.create', command, now)
      if (idem.retryId) {
        const stored = state.taxRules.get(idem.retryId)
        if (!stored || stored.id !== command.id) throw new FinanceValidationError('Idempotency tax rule result is corrupt')
        return stored
      }
      if (state.taxRules.get(command.id)) throw new FinanceValidationError('Tax rule version already exists')
      const taxCode = state.taxCodes.get(command.taxCodeId)
      if (!taxCode || taxCode.orgId !== scope.orgId || taxCode.legalEntityId !== scope.legalEntityId || taxCode.bookId !== scope.bookId) {
        throw new FinanceValidationError('Tax code not found in exact scope')
      }
      if (taxCode.jurisdictionCode !== normalizeCode(command.jurisdictionCode, 'jurisdictionCode')) {
        throw new FinanceValidationError('Tax rule jurisdiction does not match tax code')
      }
      const approval = loadApproval(state, command.approvalId, scope, 'tax-rule.approve', actor.uid, now)
      claim(state, 'tax_rule_version', scope, [command.taxCodeId, command.versionNumber], command.id, 'Tax rule version number already exists')
      for (const existing of state.taxRules.values()) {
        if (existing.taxCodeId !== command.taxCodeId) continue
        if (existing.orgId !== scope.orgId || existing.legalEntityId !== scope.legalEntityId || existing.bookId !== scope.bookId) continue
        if (taxRuleRangesOverlap(existing, command)) {
          throw new FinanceValidationError('Tax rule effective range overlaps an existing approved version')
        }
      }
      const base: Omit<TaxRuleVersion, 'contentHash'> = {
        ...scope,
        id: command.id,
        taxCodeId: command.taxCodeId,
        jurisdictionCode: normalizeCode(command.jurisdictionCode, 'jurisdictionCode'),
        versionNumber: command.versionNumber,
        rateBasisPoints: command.rateBasisPoints,
        rateNumerator: command.rateNumerator,
        rateDenominator: command.rateDenominator,
        roundingMode: command.roundingMode,
        taxPointPolicyId: requiredText(command.taxPointPolicyId, 'taxPointPolicyId'),
        effectiveFrom: command.effectiveFrom,
        status: 'approved',
        approvalId: approval.approvalId,
        approvalActorId: approval.approvedBy,
        approvedAt: approval.approvedAt,
        sourceCitation: requiredText(command.sourceCitation, 'sourceCitation'),
        sourceChecksum: requiredText(command.sourceChecksum, 'sourceChecksum'),
        immutable: true,
        schemaVersion: 1,
        version: 1,
        createdAt: now,
        createdBy: actor.uid,
        updatedAt: now,
        updatedBy: actor.uid,
        ...(command.effectiveTo ? { effectiveTo: command.effectiveTo } : {}),
      }
      const rule: TaxRuleVersion = { ...base, contentHash: immutableContentHash(base) }
      assertImmutableContentHash(rule, 'Tax rule version')
      // Validate rate consistency via calculate path for zero and non-zero codes.
      if (rule.rateNumerator > 0) {
        const expectedBps = Math.round((rule.rateNumerator * 10_000) / rule.rateDenominator)
        if (expectedBps !== rule.rateBasisPoints) {
          throw new FinanceValidationError('Tax rule basis points do not match rational rate components')
        }
      }
      state.taxRules.set(rule.id, rule)
      storeIdempotency(state, actor, scope, 'tax-rule.create', command, rule.id, idem.claimId, idem.payloadDigest, now, rule)
      return rule
    })
  }

  calculateTax(actor: FinanceActorContext, command: CalculateTaxCommand): TaxAmountResult {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    authorizeFinanceAction(actor, scope, 'tax.read', this.now())
    const taxCode = this.store.taxCodes.get(command.taxCodeId)
    if (!taxCode || taxCode.orgId !== scope.orgId || taxCode.legalEntityId !== scope.legalEntityId || taxCode.bookId !== scope.bookId) {
      throw new FinanceValidationError('Tax code not found in exact scope')
    }
    const rule = resolveEffectiveTaxRule([...this.store.taxRules.values()].filter((candidate) =>
      candidate.orgId === scope.orgId && candidate.legalEntityId === scope.legalEntityId && candidate.bookId === scope.bookId),
    command.taxCodeId, command.documentDate)
    return calculateTaxAmount({
      taxCode,
      rule,
      taxableMinorExclusive: command.taxableMinorExclusive,
      taxIncluded: command.taxIncluded,
      documentDate: command.documentDate,
    })
  }

  async createTaxPeriod(actor: FinanceActorContext, command: CreateTaxPeriodCommand): Promise<TaxPeriod> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    assertCreateVersion(command.expectedVersion, 'Tax period')
    authorizeFinanceAction(actor, scope, 'tax.configure', this.now())
    assertEnumValue(command.status, ['open'], 'taxPeriod.status')
    const startsEpoch = parseCanonicalDate(command.startsAt, 'startsAt')
    const endsEpoch = parseCanonicalDate(command.endsAt, 'endsAt')
    if (startsEpoch > endsEpoch) throw new FinanceValidationError('Tax period start must not be after period end')
    return this.store.transact((state) => {
      const now = this.now()
      const idem = idempotencyInput(state, actor, scope, 'tax-period.create', command, now)
      if (idem.retryId) {
        const stored = state.taxPeriods.get(idem.retryId)
        if (!stored || stored.id !== command.id) throw new FinanceValidationError('Idempotency tax period result is corrupt')
        return stored
      }
      if (state.taxPeriods.get(command.id)) throw new FinanceValidationError('Tax period already exists')
      for (const existing of state.taxPeriods.values()) {
        if (existing.orgId !== scope.orgId || existing.legalEntityId !== scope.legalEntityId || existing.bookId !== scope.bookId) continue
        if (existing.jurisdictionCode !== normalizeCode(command.jurisdictionCode, 'jurisdictionCode')) continue
        const existingStart = parseCanonicalDate(existing.startsAt, 'period.startsAt')
        const existingEnd = parseCanonicalDate(existing.endsAt, 'period.endsAt')
        if (startsEpoch <= existingEnd && endsEpoch >= existingStart) {
          throw new FinanceValidationError('Tax period overlaps an existing period')
        }
      }
      const period: TaxPeriod = {
        ...scope,
        id: command.id,
        jurisdictionCode: normalizeCode(command.jurisdictionCode, 'jurisdictionCode'),
        label: requiredText(command.label, 'label'),
        startsAt: command.startsAt,
        endsAt: command.endsAt,
        status: command.status,
        schemaVersion: 1,
        version: 1,
        createdAt: now,
        createdBy: actor.uid,
        updatedAt: now,
        updatedBy: actor.uid,
      }
      state.taxPeriods.set(period.id, period)
      storeIdempotency(state, actor, scope, 'tax-period.create', command, period.id, idem.claimId, idem.payloadDigest, now, period)
      return period
    })
  }

  async changeTaxPeriodStatus(actor: FinanceActorContext, command: ChangeTaxPeriodStatusCommand): Promise<TaxPeriod> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    const action = command.status === 'approved_locked' ? 'tax.return.approve' as const : 'tax.return.prepare' as const
    authorizeFinanceAction(actor, scope, action, this.now())
    requiredText(command.reason, 'reason')
    return this.store.transact((state) => {
      const now = this.now()
      const idem = idempotencyInput(state, actor, scope, 'tax-period.status', command, now)
      if (idem.retryId) {
        const stored = state.taxPeriods.get(idem.retryId)
        if (!stored || stored.id !== command.taxPeriodId) throw new FinanceValidationError('Idempotency tax period result is corrupt')
        return stored
      }
      const period = state.taxPeriods.get(command.taxPeriodId)
      if (!period || period.orgId !== scope.orgId || period.legalEntityId !== scope.legalEntityId || period.bookId !== scope.bookId) {
        throw new FinanceValidationError('Tax period not found in exact scope')
      }
      if (period.version !== command.expectedVersion) throw new FinanceValidationError('Tax period version conflict')
      const transitions: Record<TaxPeriodStatus, TaxPeriodStatus[]> = {
        open: ['prepared'],
        prepared: ['approved_locked', 'open'],
        approved_locked: ['adjusted'],
        adjusted: ['prepared'],
      }
      if (!transitions[period.status].includes(command.status)) {
        throw new FinanceValidationError('Invalid tax period transition')
      }
      const needsApproval = command.status === 'approved_locked' || command.status === 'adjusted' ||
        (period.status !== 'open' && command.status === 'open')
      const approvalAction: FinanceApprovalAction = command.status === 'approved_locked' || command.status === 'adjusted'
        ? 'tax.return.approve'
        : 'tax.return.prepare'
      const approval = needsApproval
        ? loadApproval(state, command.approvalId, scope, approvalAction, actor.uid, now)
        : undefined
      if (command.sourceCutoffAt) parseCanonicalDate(command.sourceCutoffAt, 'sourceCutoffAt')
      const updated: TaxPeriod = {
        ...period,
        status: command.status,
        version: period.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
        sourceCutoffAt: command.sourceCutoffAt ?? period.sourceCutoffAt,
        ...(command.status === 'prepared' ? { prepareApprovalId: approval?.approvalId } : {}),
        ...(command.status === 'approved_locked' ? { lockApprovalId: approval?.approvalId } : {}),
      }
      state.taxPeriods.set(period.id, updated)
      storeIdempotency(state, actor, scope, 'tax-period.status', command, updated.id, idem.claimId, idem.payloadDigest, now, updated)
      return updated
    })
  }

  async prepareTaxReturn(actor: FinanceActorContext, command: PrepareTaxReturnCommand): Promise<TaxReturnSnapshot> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    assertCreateVersion(command.expectedVersion, 'Tax return')
    authorizeFinanceAction(actor, scope, 'tax.return.prepare', this.now())
    parseCanonicalDate(command.sourceCutoffAt, 'sourceCutoffAt')
    assertEnumValue(command.accountingBasis, ['cash', 'accrual'], 'accountingBasis')
    return this.store.transact((state) => {
      const now = this.now()
      const idem = idempotencyInput(state, actor, scope, 'tax-return.prepare', command, now)
      if (idem.retryId) {
        const stored = state.taxReturns.get(idem.retryId)
        if (!stored || stored.id !== command.id) throw new FinanceValidationError('Idempotency tax return result is corrupt')
        return stored
      }
      if (state.taxReturns.get(command.id)) throw new FinanceValidationError('Tax return already exists')
      const period = state.taxPeriods.get(command.taxPeriodId)
      if (!period || period.orgId !== scope.orgId || period.legalEntityId !== scope.legalEntityId || period.bookId !== scope.bookId) {
        throw new FinanceValidationError('Tax period not found in exact scope')
      }
      if (period.status !== 'open' && period.status !== 'prepared' && period.status !== 'adjusted') {
        throw new FinanceValidationError('Tax return can only be prepared for open, prepared, or adjusted tax periods')
      }
      const cutoff = parseCanonicalDate(command.sourceCutoffAt, 'sourceCutoffAt')
      const periodStart = parseCanonicalDate(period.startsAt, 'taxPeriod.startsAt')
      const periodEnd = parseCanonicalDate(period.endsAt, 'taxPeriod.endsAt')
      if (cutoff < periodStart || cutoff > periodEnd) {
        throw new FinanceValidationError('Tax return source cutoff must fall within the tax period')
      }

      const traces = state.journalTaxTraces.filter((trace) => {
        // traces are already scoped when recorded; filter by known codes in book
        const code = state.taxCodes.get(trace.taxCodeId)
        return Boolean(code && code.orgId === scope.orgId && code.legalEntityId === scope.legalEntityId && code.bookId === scope.bookId)
      })

      const byKey = new Map<string, TaxReturnLine>()
      const sourceJournalEntryIds = new Set<string>()
      const ruleVersionIds = new Set<string>()
      let taxableOutputMinor = 0
      let outputTaxMinor = 0
      let taxableInputMinor = 0
      let inputTaxMinor = 0

      for (const trace of traces) {
        sourceJournalEntryIds.add(trace.journalEntryId)
        ruleVersionIds.add(trace.taxRuleVersionId)
        const key = `${trace.taxCodeId}|${trace.taxRuleVersionId}|${trace.direction}`
        const existing = byKey.get(key)
        if (existing) {
          existing.taxableMinor += trace.taxableMinor
          existing.taxMinor += trace.taxMinor
          if (!existing.sourceJournalEntryIds.includes(trace.journalEntryId)) {
            existing.sourceJournalEntryIds.push(trace.journalEntryId)
          }
        } else {
          byKey.set(key, {
            id: `${command.id}_${byKey.size + 1}`,
            taxReturnId: command.id,
            taxCodeId: trace.taxCodeId,
            taxRuleVersionId: trace.taxRuleVersionId,
            category: trace.category,
            label: `${trace.direction}:${trace.taxCodeId}`,
            taxableMinor: trace.taxableMinor,
            taxMinor: trace.taxMinor,
            sourceJournalEntryIds: [trace.journalEntryId],
          })
        }
        if (trace.direction === 'output') {
          taxableOutputMinor += trace.taxableMinor
          outputTaxMinor += trace.taxMinor
        } else {
          taxableInputMinor += trace.taxableMinor
          inputTaxMinor += trace.taxMinor
        }
      }

      const lines = [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label))
      const sourceIds = [...sourceJournalEntryIds].sort()
      const ruleIds = [...ruleVersionIds].sort()
      const inputDigest = canonicalDigest({
        taxPeriodId: period.id,
        sourceCutoffAt: command.sourceCutoffAt,
        accountingBasis: command.accountingBasis,
        sourceJournalEntryIds: sourceIds,
        ruleVersionIds: ruleIds,
        lines: lines.map((line) => ({
          taxCodeId: line.taxCodeId,
          taxRuleVersionId: line.taxRuleVersionId,
          taxableMinor: line.taxableMinor,
          taxMinor: line.taxMinor,
        })),
      })
      const base: Omit<TaxReturnSnapshot, 'contentHash'> = {
        ...scope,
        id: command.id,
        taxPeriodId: period.id,
        jurisdictionCode: period.jurisdictionCode,
        status: 'prepared',
        sourceCutoffAt: command.sourceCutoffAt,
        accountingBasis: command.accountingBasis,
        taxableOutputMinor,
        outputTaxMinor,
        taxableInputMinor,
        inputTaxMinor,
        netTaxMinor: outputTaxMinor - inputTaxMinor,
        lines,
        sourceJournalEntryIds: sourceIds,
        ruleVersionIds: ruleIds,
        preparerActorId: actor.uid,
        preparedAt: now,
        immutable: false,
        inputDigest,
        schemaVersion: 1,
        version: 1,
        createdAt: now,
        createdBy: actor.uid,
        updatedAt: now,
        updatedBy: actor.uid,
      }
      const snapshot: TaxReturnSnapshot = { ...base, contentHash: immutableContentHash(base) }
      state.taxReturns.set(snapshot.id, snapshot)
      const updatedPeriod: TaxPeriod = {
        ...period,
        status: 'prepared',
        sourceCutoffAt: command.sourceCutoffAt,
        version: period.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
      }
      state.taxPeriods.set(period.id, updatedPeriod)
      storeIdempotency(state, actor, scope, 'tax-return.prepare', command, snapshot.id, idem.claimId, idem.payloadDigest, now, snapshot)
      return snapshot
    })
  }

  async approveTaxReturn(actor: FinanceActorContext, command: ApproveTaxReturnCommand): Promise<TaxReturnSnapshot> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    authorizeFinanceAction(actor, scope, 'tax.return.approve', this.now())
    requiredText(command.reason, 'reason')
    return this.store.transact((state) => {
      const now = this.now()
      const idem = idempotencyInput(state, actor, scope, 'tax-return.approve', command, now)
      if (idem.retryId) {
        const stored = state.taxReturns.get(idem.retryId)
        if (!stored || stored.id !== command.taxReturnId) throw new FinanceValidationError('Idempotency tax return result is corrupt')
        return stored
      }
      const existing = state.taxReturns.get(command.taxReturnId)
      if (!existing || existing.orgId !== scope.orgId || existing.legalEntityId !== scope.legalEntityId || existing.bookId !== scope.bookId) {
        throw new FinanceValidationError('Tax return not found in exact scope')
      }
      if (existing.version !== command.expectedVersion) throw new FinanceValidationError('Tax return version conflict')
      if (existing.status !== 'prepared') throw new FinanceValidationError('Only prepared tax returns can be approved')
      if (existing.immutable) throw new FinanceValidationError('Tax return is already immutable')
      const approval = loadApproval(state, command.approvalId, scope, 'tax.return.approve', actor.uid, now)
      const unlocked: Omit<TaxReturnSnapshot, 'contentHash'> = {
        ...existing,
        status: 'approved_locked',
        approvalId: approval.approvalId,
        approvalActorId: approval.approvedBy,
        approvedAt: approval.approvedAt,
        immutable: true,
        version: existing.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
      }
      // strip previous contentHash before rehash
      const { contentHash: _ignored, ...withoutHash } = unlocked as TaxReturnSnapshot
      void _ignored
      const locked: TaxReturnSnapshot = {
        ...withoutHash,
        contentHash: immutableContentHash(withoutHash),
      }
      assertImmutableContentHash(locked, 'Tax return snapshot')
      state.taxReturns.set(locked.id, locked)
      const period = state.taxPeriods.get(existing.taxPeriodId)
      if (period) {
        state.taxPeriods.set(period.id, {
          ...period,
          status: 'approved_locked',
          lockApprovalId: approval.approvalId,
          version: period.version + 1,
          updatedAt: now,
          updatedBy: actor.uid,
        })
      }
      storeIdempotency(state, actor, scope, 'tax-return.approve', command, locked.id, idem.claimId, idem.payloadDigest, now, locked)
      return locked
    })
  }

  /**
   * Build tax traces from posted journals that already embed tax metadata on line descriptions
   * is not used. Prefer explicit recordJournalTaxTrace at posting time.
   * This helper exists for tests and adapters that pass structured traces with journals.
   */
  static tracesFromJournals(
    journals: readonly (PostedJournalEntry & { taxTraces?: JournalTaxTraceLine[] })[],
  ): JournalTaxTraceLine[] {
    return journals.flatMap((journal) => journal.taxTraces ?? [])
  }
}
