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
} from './foundation'
import {
  assertDistinctLegalEntities,
  assertEliminationLinesBalanced,
  assertEliminationTargetIsConsolidationBook,
  assertEntityBookNotMutatedByElimination,
  assertPairedAmountsReconcile,
  assertReceiveApproverIsNotSourceActor,
  buildChargeReceivingLines,
  buildChargeSourceLines,
  buildDueToDueFromEliminationLines,
  computeDueToDueFromBalance,
  normalizeIntercompanyPairKey,
  projectConsolidatedReportingBoundary,
  projectIntercompanyStatusAfterReceivePost,
  projectIntercompanyStatusAfterSourcePost,
} from './intercompany'
import type {
  ConsolidationEntry,
  ConsolidationRun,
  DueToDueFromBalance,
  EliminationRule,
  IntercompanyAuditEvent,
  IntercompanyAuditEventType,
  IntercompanyPair,
  IntercompanyTransaction,
  IntercompanyTransactionType,
} from './intercompany-types'

interface CommandIdentity { requestId: string; idempotencyKey: string }

export interface CreateIntercompanyPairCommand extends CommandIdentity {
  id: string
  orgId: string
  groupOrgId: string
  sourceLegalEntityId: string
  sourceBookId: string
  receivingLegalEntityId: string
  receivingBookId: string
  sourceDueFromAccountId: string
  sourceDueToAccountId: string
  receivingDueFromAccountId: string
  receivingDueToAccountId: string
  enabledTransactionTypes: IntercompanyTransactionType[]
  requireReceiveApproval?: boolean
  currency: string
  expectedVersion: 0
}

export interface ActivateIntercompanyPairCommand extends CommandIdentity {
  orgId: string
  pairId: string
  expectedVersion: number
}

export interface ProposeIntercompanyTransactionCommand extends CommandIdentity {
  id: string
  orgId: string
  pairId: string
  transactionType: IntercompanyTransactionType
  transactionDate: string
  amountMinor: number
  currency: string
  description: string
  sourcePnlAccountId: string
  receivingPnlAccountId: string
  expectedVersion: 0
}

export interface PostIntercompanySourceCommand extends CommandIdentity {
  orgId: string
  transactionId: string
  expectedVersion: number
  sourceJournalEntryId?: string
}

export interface ApproveIntercompanyReceiveCommand extends CommandIdentity {
  orgId: string
  transactionId: string
  expectedVersion: number
  approvalId: string
  reason: string
}

export interface PostIntercompanyReceivingCommand extends CommandIdentity {
  orgId: string
  transactionId: string
  expectedVersion: number
  receivingJournalEntryId?: string
}

export interface RejectIntercompanyTransactionCommand extends CommandIdentity {
  orgId: string
  transactionId: string
  expectedVersion: number
  reason: string
}

export interface CreateEliminationRuleCommand extends CommandIdentity {
  id: string
  orgId: string
  groupOrgId: string
  code: string
  name: string
  dimension: EliminationRule['dimension']
  pairId?: string
  consolidationLegalEntityId: string
  consolidationBookId: string
  debitAccountId: string
  creditAccountId: string
  expectedVersion: 0
}

export interface ApproveEliminationRuleCommand extends CommandIdentity {
  orgId: string
  ruleId: string
  expectedVersion: number
  approvalId: string
  reason: string
}

export interface CreateConsolidationRunCommand extends CommandIdentity {
  id: string
  orgId: string
  groupOrgId: string
  consolidationLegalEntityId: string
  consolidationBookId: string
  consolidationPeriodId: string
  asOfDate: string
  memberBooks: ConsolidationRun['memberBooks']
  eliminationRuleIds: string[]
  rateSetId?: string
  expectedVersion: 0
}

export interface PinConsolidationRunCommand extends CommandIdentity {
  orgId: string
  runId: string
  expectedVersion: number
  sourceCutoffDigest: string
}

export interface PostConsolidationEliminationsCommand extends CommandIdentity {
  orgId: string
  runId: string
  expectedVersion: number
  pairId: string
  amountMinor: number
  currency: string
  description: string
  sourceTransactionIds: string[]
  consolidationJournalEntryId?: string
}

export interface ApproveConsolidationRunCommand extends CommandIdentity {
  orgId: string
  runId: string
  expectedVersion: number
  approvalId: string
  reason: string
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

export interface IntercompanyServiceState {
  pairs: Map<string, IntercompanyPair>
  transactions: Map<string, IntercompanyTransaction>
  eliminationRules: Map<string, EliminationRule>
  consolidationRuns: Map<string, ConsolidationRun>
  consolidationEntries: Map<string, ConsolidationEntry>
  controlBalances: Map<string, { dueFromMinor: number; dueToMinor: number }>
  bookTypes: Map<string, 'primary' | 'branch' | 'management' | 'consolidation'>
  approvals: Map<string, FinanceApprovalRecord>
  uniqueClaims: Map<string, string>
  idempotency: Map<string, IdempotencyRecord>
  auditEvents: IntercompanyAuditEvent[]
}

function cloneMap<T>(source: Map<string, T>): Map<string, T> {
  return new Map(Array.from(source, ([key, value]) => [key, structuredClone(value)]))
}

function cloneState(state: IntercompanyServiceState): IntercompanyServiceState {
  return {
    pairs: cloneMap(state.pairs),
    transactions: cloneMap(state.transactions),
    eliminationRules: cloneMap(state.eliminationRules),
    consolidationRuns: cloneMap(state.consolidationRuns),
    consolidationEntries: cloneMap(state.consolidationEntries),
    controlBalances: cloneMap(state.controlBalances),
    bookTypes: new Map(state.bookTypes),
    approvals: cloneMap(state.approvals),
    uniqueClaims: new Map(state.uniqueClaims),
    idempotency: cloneMap(state.idempotency),
    auditEvents: structuredClone(state.auditEvents),
  }
}

export class InMemoryIntercompanyStore implements IntercompanyServiceState {
  pairs = new Map<string, IntercompanyPair>()
  transactions = new Map<string, IntercompanyTransaction>()
  eliminationRules = new Map<string, EliminationRule>()
  consolidationRuns = new Map<string, ConsolidationRun>()
  consolidationEntries = new Map<string, ConsolidationEntry>()
  controlBalances = new Map<string, { dueFromMinor: number; dueToMinor: number }>()
  bookTypes = new Map<string, 'primary' | 'branch' | 'management' | 'consolidation'>()
  approvals = new Map<string, FinanceApprovalRecord>()
  uniqueClaims = new Map<string, string>()
  idempotency = new Map<string, IdempotencyRecord>()
  auditEvents: IntercompanyAuditEvent[] = []
  private transactionTail: Promise<void> = Promise.resolve()

  async transact<T>(operation: (state: IntercompanyServiceState) => T | Promise<T>): Promise<T> {
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

function claim(state: IntercompanyServiceState, type: string, scope: FinanceScope, key: unknown, id: string, message: string): void {
  const claimId = scopedClaimId(type, scope, key)
  const existing = state.uniqueClaims.get(claimId)
  if (existing && existing !== id) throw new FinanceValidationError(message)
  state.uniqueClaims.set(claimId, id)
}

function compactUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}

function scopeOf(orgId: string, legalEntityId: string, bookId?: string): Required<FinanceScope> | FinanceScope {
  return bookId ? { orgId, legalEntityId, bookId } : { orgId, legalEntityId }
}

function controlKey(orgId: string, legalEntityId: string, bookId: string, accountId: string): string {
  return `${orgId}|${legalEntityId}|${bookId}|${accountId}`
}

function idempotencyInput(
  state: IntercompanyServiceState,
  actor: FinanceActorContext,
  scope: FinanceScope,
  operation: string,
  command: unknown,
  now: string,
): { retryId?: string; claimId: string; payloadDigest: string } {
  const payloadDigest = canonicalDigest(command)
  const claimId = scopedClaimId('intercompany_idempotency', scope, {
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
  state: IntercompanyServiceState,
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
  state: IntercompanyServiceState,
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
  state: IntercompanyServiceState,
  scope: FinanceScope,
  actor: FinanceActorContext,
  eventType: IntercompanyAuditEventType,
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
    id: `icaud_${scope.orgId}_${sequence}`,
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
  const event: IntercompanyAuditEvent = { ...base, eventHash: canonicalDigest(base) }
  state.auditEvents.push(event)
}

function bumpControl(
  state: IntercompanyServiceState,
  orgId: string,
  legalEntityId: string,
  bookId: string,
  accountId: string,
  debitMinor: number,
  creditMinor: number,
  role: 'due_from' | 'due_to',
): void {
  const key = controlKey(orgId, legalEntityId, bookId, accountId)
  const current = state.controlBalances.get(key) ?? { dueFromMinor: 0, dueToMinor: 0 }
  if (role === 'due_from') {
    current.dueFromMinor += debitMinor - creditMinor
  } else {
    current.dueToMinor += creditMinor - debitMinor
  }
  if (!Number.isSafeInteger(current.dueFromMinor) || !Number.isSafeInteger(current.dueToMinor)) {
    throw new FinanceValidationError('Control balance exceeds safe integer precision')
  }
  if (current.dueFromMinor < 0 || current.dueToMinor < 0) {
    throw new FinanceValidationError('Control balance cannot go negative without reverse flow')
  }
  state.controlBalances.set(key, current)
}

function readControl(
  state: IntercompanyServiceState,
  orgId: string,
  legalEntityId: string,
  bookId: string,
  accountId: string,
): { dueFromMinor: number; dueToMinor: number } {
  return state.controlBalances.get(controlKey(orgId, legalEntityId, bookId, accountId))
    ?? { dueFromMinor: 0, dueToMinor: 0 }
}

export class FinanceIntercompanyService {
  constructor(
    private readonly store: InMemoryIntercompanyStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  registerApproval(approval: FinanceApprovalRecord): void {
    this.store.approvals.set(approval.id, structuredClone(approval))
  }

  registerBookType(bookId: string, bookType: 'primary' | 'branch' | 'management' | 'consolidation'): void {
    this.store.bookTypes.set(bookId, bookType)
  }

  async createPair(actor: FinanceActorContext, command: CreateIntercompanyPairCommand): Promise<IntercompanyPair> {
    const now = this.now()
    return this.store.transact((state) => {
      assertCreateVersion(command.expectedVersion, 'intercompany pair')
      const sourceScope = { orgId: command.orgId, legalEntityId: command.sourceLegalEntityId, bookId: command.sourceBookId }
      const receivingScope = { orgId: command.orgId, legalEntityId: command.receivingLegalEntityId, bookId: command.receivingBookId }
      authorizeFinanceAction(actor, sourceScope, 'intercompany.pair.configure', now)
      authorizeFinanceAction(actor, receivingScope, 'intercompany.pair.configure', now)
      assertDistinctLegalEntities(command.sourceLegalEntityId, command.receivingLegalEntityId)
      if (command.groupOrgId !== command.orgId) throw new FinanceValidationError('groupOrgId must match orgId')
      const pairKey = normalizeIntercompanyPairKey(
        command.sourceLegalEntityId, command.sourceBookId, command.receivingLegalEntityId, command.receivingBookId,
      )
      const groupScope = { orgId: command.orgId, legalEntityId: command.sourceLegalEntityId }
      const idem = idempotencyInput(state, actor, groupScope, 'intercompany.pair.create', command, now)
      if (idem.retryId) return structuredClone(state.pairs.get(idem.retryId)!)
      claim(state, 'intercompany_pair_key', groupScope, pairKey, command.id, 'Intercompany pair already exists for these books')
      claim(state, 'intercompany_pair_id', groupScope, command.id, command.id, 'Intercompany pair id already exists')
      const types = command.enabledTransactionTypes
      if (!Array.isArray(types) || types.length === 0) throw new FinanceValidationError('enabledTransactionTypes is required')
      for (const type of types) assertEnumValue(type, ['charge', 'recharge', 'loan', 'equity_contribution', 'other'], 'transactionType')
      const pair: IntercompanyPair = {
        id: requiredText(command.id, 'id'),
        orgId: command.orgId,
        legalEntityId: command.sourceLegalEntityId,
        bookId: command.sourceBookId,
        schemaVersion: 1,
        version: 1,
        createdAt: now,
        createdBy: actor.uid,
        updatedAt: now,
        updatedBy: actor.uid,
        groupOrgId: command.groupOrgId,
        sourceLegalEntityId: command.sourceLegalEntityId,
        sourceBookId: command.sourceBookId,
        receivingLegalEntityId: command.receivingLegalEntityId,
        receivingBookId: command.receivingBookId,
        sourceDueFromAccountId: requiredText(command.sourceDueFromAccountId, 'sourceDueFromAccountId'),
        sourceDueToAccountId: requiredText(command.sourceDueToAccountId, 'sourceDueToAccountId'),
        receivingDueFromAccountId: requiredText(command.receivingDueFromAccountId, 'receivingDueFromAccountId'),
        receivingDueToAccountId: requiredText(command.receivingDueToAccountId, 'receivingDueToAccountId'),
        enabledTransactionTypes: [...types],
        requireReceiveApproval: command.requireReceiveApproval !== false,
        status: 'draft',
        pairKey,
        currency: requiredText(command.currency, 'currency').toUpperCase(),
      }
      state.pairs.set(pair.id, pair)
      appendAudit(state, sourceScope, actor, 'intercompany_pair.created', 'intercompany_pair', pair.id, pair.version, now, command, {
        pairKey, receivingLegalEntityId: pair.receivingLegalEntityId, receivingBookId: pair.receivingBookId,
      })
      storeIdempotency(state, actor, groupScope, 'intercompany.pair.create', command, pair.id, idem.claimId, idem.payloadDigest, now, pair)
      return structuredClone(pair)
    })
  }

  async activatePair(actor: FinanceActorContext, command: ActivateIntercompanyPairCommand): Promise<IntercompanyPair> {
    const now = this.now()
    return this.store.transact((state) => {
      const pair = state.pairs.get(command.pairId)
      if (!pair || pair.orgId !== command.orgId) throw new FinanceValidationError('Intercompany pair not found in exact scope')
      const sourceScope = { orgId: pair.orgId, legalEntityId: pair.sourceLegalEntityId, bookId: pair.sourceBookId }
      authorizeFinanceAction(actor, sourceScope, 'intercompany.pair.configure', now)
      const groupScope = { orgId: pair.orgId, legalEntityId: pair.sourceLegalEntityId }
      const idem = idempotencyInput(state, actor, groupScope, 'intercompany.pair.activate', command, now)
      if (idem.retryId) return structuredClone(state.pairs.get(idem.retryId)!)
      if (pair.version !== command.expectedVersion) throw new FinanceValidationError('Intercompany pair version mismatch')
      if (pair.status === 'active') throw new FinanceValidationError('Intercompany pair is already active')
      const next: IntercompanyPair = {
        ...pair,
        status: 'active',
        version: pair.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
      }
      state.pairs.set(next.id, next)
      appendAudit(state, sourceScope, actor, 'intercompany_pair.activated', 'intercompany_pair', next.id, next.version, now, command, { status: next.status })
      storeIdempotency(state, actor, groupScope, 'intercompany.pair.activate', command, next.id, idem.claimId, idem.payloadDigest, now, next)
      return structuredClone(next)
    })
  }

  async proposeTransaction(actor: FinanceActorContext, command: ProposeIntercompanyTransactionCommand): Promise<IntercompanyTransaction> {
    const now = this.now()
    return this.store.transact((state) => {
      assertCreateVersion(command.expectedVersion, 'intercompany transaction')
      const pair = state.pairs.get(command.pairId)
      if (!pair || pair.orgId !== command.orgId) throw new FinanceValidationError('Intercompany pair not found in exact scope')
      if (pair.status !== 'active') throw new FinanceValidationError('Intercompany pair is not active')
      const sourceScope = { orgId: pair.orgId, legalEntityId: pair.sourceLegalEntityId, bookId: pair.sourceBookId }
      authorizeFinanceAction(actor, sourceScope, 'intercompany.propose', now)
      parseCanonicalDate(command.transactionDate, 'transactionDate')
      assertEnumValue(command.transactionType, pair.enabledTransactionTypes, 'transactionType')
      if (command.currency.toUpperCase() !== pair.currency) throw new FinanceValidationError('Transaction currency must match pair currency')
      assertPairedAmountsReconcile(command.amountMinor, command.amountMinor, command.currency, command.currency)
      const groupScope = { orgId: pair.orgId, legalEntityId: pair.sourceLegalEntityId }
      const idem = idempotencyInput(state, actor, groupScope, 'intercompany.transaction.propose', command, now)
      if (idem.retryId) return structuredClone(state.transactions.get(idem.retryId)!)
      claim(state, 'intercompany_tx_id', groupScope, command.id, command.id, 'Intercompany transaction id already exists')

      const description = requiredText(command.description, 'description')
      const sourceLines = buildChargeSourceLines({
        amountMinor: command.amountMinor,
        dueFromAccountId: pair.sourceDueFromAccountId,
        revenueAccountId: command.sourcePnlAccountId,
        description,
      })
      const receivingLines = buildChargeReceivingLines({
        amountMinor: command.amountMinor,
        dueToAccountId: pair.receivingDueToAccountId,
        expenseAccountId: command.receivingPnlAccountId,
        description,
      })
      assertEliminationLinesBalanced(sourceLines)
      assertEliminationLinesBalanced(receivingLines)

      const tx: IntercompanyTransaction = {
        id: requiredText(command.id, 'id'),
        orgId: pair.orgId,
        legalEntityId: pair.sourceLegalEntityId,
        bookId: pair.sourceBookId,
        schemaVersion: 1,
        version: 1,
        createdAt: now,
        createdBy: actor.uid,
        updatedAt: now,
        updatedBy: actor.uid,
        pairId: pair.id,
        transactionType: command.transactionType,
        status: 'proposed',
        transactionDate: command.transactionDate,
        currency: command.currency.toUpperCase(),
        amountMinor: command.amountMinor,
        description,
        source: {
          legalEntityId: pair.sourceLegalEntityId,
          bookId: pair.sourceBookId,
          amountMinor: command.amountMinor,
          currency: command.currency.toUpperCase(),
          counterpartyAccountId: pair.sourceDueFromAccountId,
          pnlAccountId: requiredText(command.sourcePnlAccountId, 'sourcePnlAccountId'),
          description,
          journalLines: sourceLines,
        },
        receiving: {
          legalEntityId: pair.receivingLegalEntityId,
          bookId: pair.receivingBookId,
          amountMinor: command.amountMinor,
          currency: command.currency.toUpperCase(),
          counterpartyAccountId: pair.receivingDueToAccountId,
          pnlAccountId: requiredText(command.receivingPnlAccountId, 'receivingPnlAccountId'),
          description,
          journalLines: receivingLines,
        },
        immutable: false,
      }
      state.transactions.set(tx.id, tx)
      appendAudit(state, sourceScope, actor, 'intercompany_transaction.proposed', 'intercompany_transaction', tx.id, tx.version, now, command, {
        pairId: pair.id, amountMinor: tx.amountMinor, transactionType: tx.transactionType,
      })
      storeIdempotency(state, actor, groupScope, 'intercompany.transaction.propose', command, tx.id, idem.claimId, idem.payloadDigest, now, tx)
      return structuredClone(tx)
    })
  }

  async postSource(actor: FinanceActorContext, command: PostIntercompanySourceCommand): Promise<IntercompanyTransaction> {
    const now = this.now()
    return this.store.transact((state) => {
      const tx = state.transactions.get(command.transactionId)
      if (!tx || tx.orgId !== command.orgId) throw new FinanceValidationError('Intercompany transaction not found in exact scope')
      const pair = state.pairs.get(tx.pairId)
      if (!pair) throw new FinanceValidationError('Intercompany pair not found in exact scope')
      const sourceScope = { orgId: tx.orgId, legalEntityId: tx.source.legalEntityId, bookId: tx.source.bookId }
      authorizeFinanceAction(actor, sourceScope, 'intercompany.post_source', now)
      const groupScope = { orgId: tx.orgId, legalEntityId: tx.source.legalEntityId }
      const idem = idempotencyInput(state, actor, groupScope, 'intercompany.transaction.post_source', command, now)
      if (idem.retryId) return structuredClone(state.transactions.get(idem.retryId)!)
      if (tx.version !== command.expectedVersion) throw new FinanceValidationError('Intercompany transaction version mismatch')
      if (tx.status !== 'proposed') throw new FinanceValidationError('Only proposed intercompany transactions can post source side')
      const journalEntryId = command.sourceJournalEntryId ?? `icj_src_${tx.id}`
      for (const line of tx.source.journalLines ?? []) {
        if (line.accountId === pair.sourceDueFromAccountId || line.accountId === pair.sourceDueToAccountId) {
          const role = line.accountId === pair.sourceDueFromAccountId ? 'due_from' : 'due_to'
          bumpControl(state, tx.orgId, tx.source.legalEntityId, tx.source.bookId, line.accountId, line.debitMinor, line.creditMinor, role)
        }
      }
      const next: IntercompanyTransaction = {
        ...tx,
        status: projectIntercompanyStatusAfterSourcePost(pair.requireReceiveApproval),
        sourcePostedAt: now,
        source: {
          ...tx.source,
          journalEntryId,
          postedAt: now,
          postedBy: actor.uid,
        },
        version: tx.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
      }
      state.transactions.set(next.id, next)
      appendAudit(state, sourceScope, actor, 'intercompany_transaction.source_posted', 'intercompany_transaction', next.id, next.version, now, command, {
        journalEntryId, status: next.status,
      })
      storeIdempotency(state, actor, groupScope, 'intercompany.transaction.post_source', command, next.id, idem.claimId, idem.payloadDigest, now, next)
      return structuredClone(next)
    })
  }

  async approveReceive(actor: FinanceActorContext, command: ApproveIntercompanyReceiveCommand): Promise<IntercompanyTransaction> {
    const now = this.now()
    return this.store.transact((state) => {
      const tx = state.transactions.get(command.transactionId)
      if (!tx || tx.orgId !== command.orgId) throw new FinanceValidationError('Intercompany transaction not found in exact scope')
      const receivingScope = { orgId: tx.orgId, legalEntityId: tx.receiving.legalEntityId, bookId: tx.receiving.bookId }
      authorizeFinanceAction(actor, receivingScope, 'intercompany.receive_approve', now)
      const groupScope = { orgId: tx.orgId, legalEntityId: tx.receiving.legalEntityId }
      const idem = idempotencyInput(state, actor, groupScope, 'intercompany.transaction.approve_receive', command, now)
      if (idem.retryId) return structuredClone(state.transactions.get(idem.retryId)!)
      if (tx.version !== command.expectedVersion) throw new FinanceValidationError('Intercompany transaction version mismatch')
      if (tx.status !== 'pending_receive' && tx.status !== 'source_posted') {
        throw new FinanceValidationError('Intercompany transaction is not awaiting receive approval')
      }
      assertReceiveApproverIsNotSourceActor(tx.createdBy, actor.uid)
      if (tx.source.postedBy) assertReceiveApproverIsNotSourceActor(tx.source.postedBy, actor.uid)
      const approval = loadApproval(state, command.approvalId, receivingScope as Required<FinanceScope>, 'intercompany.receive', actor.uid, now)
      requiredText(command.reason, 'reason')
      const next: IntercompanyTransaction = {
        ...tx,
        receiveApprovalId: approval.approvalId,
        receiveApprovedAt: approval.approvedAt,
        receiveApprovedBy: approval.approvedBy,
        version: tx.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
      }
      state.transactions.set(next.id, next)
      appendAudit(state, receivingScope, actor, 'intercompany_transaction.receive_approved', 'intercompany_transaction', next.id, next.version, now, command, {
        approvalId: approval.approvalId,
      }, command.reason)
      storeIdempotency(state, actor, groupScope, 'intercompany.transaction.approve_receive', command, next.id, idem.claimId, idem.payloadDigest, now, next)
      return structuredClone(next)
    })
  }

  async postReceiving(actor: FinanceActorContext, command: PostIntercompanyReceivingCommand): Promise<IntercompanyTransaction> {
    const now = this.now()
    return this.store.transact((state) => {
      const tx = state.transactions.get(command.transactionId)
      if (!tx || tx.orgId !== command.orgId) throw new FinanceValidationError('Intercompany transaction not found in exact scope')
      const pair = state.pairs.get(tx.pairId)
      if (!pair) throw new FinanceValidationError('Intercompany pair not found in exact scope')
      const receivingScope = { orgId: tx.orgId, legalEntityId: tx.receiving.legalEntityId, bookId: tx.receiving.bookId }
      authorizeFinanceAction(actor, receivingScope, 'intercompany.post_receiving', now)
      const groupScope = { orgId: tx.orgId, legalEntityId: tx.receiving.legalEntityId }
      const idem = idempotencyInput(state, actor, groupScope, 'intercompany.transaction.post_receiving', command, now)
      if (idem.retryId) return structuredClone(state.transactions.get(idem.retryId)!)
      if (tx.version !== command.expectedVersion) throw new FinanceValidationError('Intercompany transaction version mismatch')
      if (tx.status !== 'pending_receive' && tx.status !== 'source_posted') {
        throw new FinanceValidationError('Intercompany transaction is not ready for receiving post')
      }
      if (pair.requireReceiveApproval && !tx.receiveApprovalId) {
        throw new FinanceValidationError('Receiving entry requires authorised receive approval before posting')
      }
      assertPairedAmountsReconcile(tx.source.amountMinor, tx.receiving.amountMinor, tx.source.currency, tx.receiving.currency)
      const journalEntryId = command.receivingJournalEntryId ?? `icj_rcv_${tx.id}`
      for (const line of tx.receiving.journalLines ?? []) {
        if (line.accountId === pair.receivingDueFromAccountId || line.accountId === pair.receivingDueToAccountId) {
          const role = line.accountId === pair.receivingDueFromAccountId ? 'due_from' : 'due_to'
          bumpControl(state, tx.orgId, tx.receiving.legalEntityId, tx.receiving.bookId, line.accountId, line.debitMinor, line.creditMinor, role)
        }
      }
      const next: IntercompanyTransaction = {
        ...tx,
        status: projectIntercompanyStatusAfterReceivePost(),
        matchedAt: now,
        receiving: {
          ...tx.receiving,
          journalEntryId,
          postedAt: now,
          postedBy: actor.uid,
        },
        version: tx.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
        immutable: true,
        contentHash: undefined,
      }
      next.contentHash = immutableContentHash(next)
      state.transactions.set(next.id, next)
      appendAudit(state, receivingScope, actor, 'intercompany_transaction.receiving_posted', 'intercompany_transaction', next.id, next.version, now, command, {
        journalEntryId,
      })
      appendAudit(state, receivingScope, actor, 'intercompany_transaction.matched', 'intercompany_transaction', next.id, next.version, now, command, {
        sourceJournalEntryId: next.source.journalEntryId,
        receivingJournalEntryId: journalEntryId,
      })
      storeIdempotency(state, actor, groupScope, 'intercompany.transaction.post_receiving', command, next.id, idem.claimId, idem.payloadDigest, now, next)
      return structuredClone(next)
    })
  }

  async rejectTransaction(actor: FinanceActorContext, command: RejectIntercompanyTransactionCommand): Promise<IntercompanyTransaction> {
    const now = this.now()
    return this.store.transact((state) => {
      const tx = state.transactions.get(command.transactionId)
      if (!tx || tx.orgId !== command.orgId) throw new FinanceValidationError('Intercompany transaction not found in exact scope')
      const receivingScope = { orgId: tx.orgId, legalEntityId: tx.receiving.legalEntityId, bookId: tx.receiving.bookId }
      authorizeFinanceAction(actor, receivingScope, 'intercompany.receive_approve', now)
      const groupScope = { orgId: tx.orgId, legalEntityId: tx.receiving.legalEntityId }
      const idem = idempotencyInput(state, actor, groupScope, 'intercompany.transaction.reject', command, now)
      if (idem.retryId) return structuredClone(state.transactions.get(idem.retryId)!)
      if (tx.version !== command.expectedVersion) throw new FinanceValidationError('Intercompany transaction version mismatch')
      if (tx.status === 'matched' || tx.status === 'reversed' || tx.status === 'rejected') {
        throw new FinanceValidationError('Intercompany transaction cannot be rejected in its current status')
      }
      const next: IntercompanyTransaction = {
        ...tx,
        status: 'rejected',
        rejectedReason: requiredText(command.reason, 'reason'),
        rejectedAt: now,
        rejectedBy: actor.uid,
        version: tx.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
        immutable: true,
      }
      next.contentHash = immutableContentHash(next)
      state.transactions.set(next.id, next)
      appendAudit(state, receivingScope, actor, 'intercompany_transaction.rejected', 'intercompany_transaction', next.id, next.version, now, command, {
        status: next.status,
      }, command.reason)
      storeIdempotency(state, actor, groupScope, 'intercompany.transaction.reject', command, next.id, idem.claimId, idem.payloadDigest, now, next)
      return structuredClone(next)
    })
  }

  reconcilePairBalances(actor: FinanceActorContext, orgId: string, pairId: string): DueToDueFromBalance {
    const now = this.now()
    const pair = this.store.pairs.get(pairId)
    if (!pair || pair.orgId !== orgId) throw new FinanceValidationError('Intercompany pair not found in exact scope')
    const sourceScope = { orgId: pair.orgId, legalEntityId: pair.sourceLegalEntityId, bookId: pair.sourceBookId }
    authorizeFinanceAction(actor, sourceScope, 'intercompany.read', now)
    const sourceDueFrom = readControl(this.store, pair.orgId, pair.sourceLegalEntityId, pair.sourceBookId, pair.sourceDueFromAccountId)
    const sourceDueTo = readControl(this.store, pair.orgId, pair.sourceLegalEntityId, pair.sourceBookId, pair.sourceDueToAccountId)
    const receivingDueFrom = readControl(this.store, pair.orgId, pair.receivingLegalEntityId, pair.receivingBookId, pair.receivingDueFromAccountId)
    const receivingDueTo = readControl(this.store, pair.orgId, pair.receivingLegalEntityId, pair.receivingBookId, pair.receivingDueToAccountId)
    const matchedTransactionIds: string[] = []
    const openTransactionIds: string[] = []
    for (const tx of this.store.transactions.values()) {
      if (tx.pairId !== pair.id || tx.orgId !== pair.orgId) continue
      if (tx.status === 'matched') matchedTransactionIds.push(tx.id)
      else if (tx.status !== 'rejected' && tx.status !== 'reversed') openTransactionIds.push(tx.id)
    }
    return computeDueToDueFromBalance({
      pairId: pair.id,
      orgId: pair.orgId,
      currency: pair.currency,
      sourceLegalEntityId: pair.sourceLegalEntityId,
      sourceBookId: pair.sourceBookId,
      receivingLegalEntityId: pair.receivingLegalEntityId,
      receivingBookId: pair.receivingBookId,
      sourceDueFromMinor: sourceDueFrom.dueFromMinor,
      sourceDueToMinor: sourceDueTo.dueToMinor,
      receivingDueFromMinor: receivingDueFrom.dueFromMinor,
      receivingDueToMinor: receivingDueTo.dueToMinor,
      matchedTransactionIds,
      openTransactionIds,
    })
  }

  async createEliminationRule(actor: FinanceActorContext, command: CreateEliminationRuleCommand): Promise<EliminationRule> {
    const now = this.now()
    return this.store.transact((state) => {
      assertCreateVersion(command.expectedVersion, 'elimination rule')
      const scope = { orgId: command.orgId, legalEntityId: command.consolidationLegalEntityId, bookId: command.consolidationBookId }
      authorizeFinanceAction(actor, scope, 'consolidation.configure', now)
      const bookType = state.bookTypes.get(command.consolidationBookId) ?? 'primary'
      assertEliminationTargetIsConsolidationBook({
        bookType,
        consolidationBookId: command.consolidationBookId,
        targetBookId: command.consolidationBookId,
      })
      if (command.pairId) {
        const pair = state.pairs.get(command.pairId)
        if (!pair || pair.orgId !== command.orgId) throw new FinanceValidationError('Intercompany pair not found in exact scope')
      }
      const groupScope = { orgId: command.orgId, legalEntityId: command.consolidationLegalEntityId }
      const idem = idempotencyInput(state, actor, groupScope, 'elimination.rule.create', command, now)
      if (idem.retryId) return structuredClone(state.eliminationRules.get(idem.retryId)!)
      claim(state, 'elimination_rule_code', groupScope, command.code.toUpperCase(), command.id, 'Elimination rule code already exists')
      const rule: EliminationRule = {
        id: requiredText(command.id, 'id'),
        orgId: command.orgId,
        legalEntityId: command.consolidationLegalEntityId,
        bookId: command.consolidationBookId,
        schemaVersion: 1,
        version: 1,
        createdAt: now,
        createdBy: actor.uid,
        updatedAt: now,
        updatedBy: actor.uid,
        groupOrgId: command.groupOrgId,
        code: requiredText(command.code, 'code').toUpperCase(),
        name: requiredText(command.name, 'name'),
        status: 'draft',
        dimension: command.dimension,
        ...(command.pairId ? { pairId: command.pairId } : {}),
        consolidationBookId: command.consolidationBookId,
        consolidationLegalEntityId: command.consolidationLegalEntityId,
        debitAccountId: requiredText(command.debitAccountId, 'debitAccountId'),
        creditAccountId: requiredText(command.creditAccountId, 'creditAccountId'),
        versionNumber: 1,
        immutable: false,
      }
      state.eliminationRules.set(rule.id, rule)
      appendAudit(state, scope, actor, 'elimination_rule.created', 'elimination_rule', rule.id, rule.version, now, command, {
        code: rule.code, dimension: rule.dimension,
      })
      storeIdempotency(state, actor, groupScope, 'elimination.rule.create', command, rule.id, idem.claimId, idem.payloadDigest, now, rule)
      return structuredClone(rule)
    })
  }

  async approveEliminationRule(actor: FinanceActorContext, command: ApproveEliminationRuleCommand): Promise<EliminationRule> {
    const now = this.now()
    return this.store.transact((state) => {
      const rule = state.eliminationRules.get(command.ruleId)
      if (!rule || rule.orgId !== command.orgId) throw new FinanceValidationError('Elimination rule not found in exact scope')
      const scope = { orgId: rule.orgId, legalEntityId: rule.consolidationLegalEntityId, bookId: rule.consolidationBookId }
      authorizeFinanceAction(actor, scope, 'consolidation.approve', now)
      const groupScope = { orgId: rule.orgId, legalEntityId: rule.consolidationLegalEntityId }
      const idem = idempotencyInput(state, actor, groupScope, 'elimination.rule.approve', command, now)
      if (idem.retryId) return structuredClone(state.eliminationRules.get(idem.retryId)!)
      if (rule.version !== command.expectedVersion) throw new FinanceValidationError('Elimination rule version mismatch')
      if (rule.status !== 'draft') throw new FinanceValidationError('Only draft elimination rules can be approved')
      const approval = loadApproval(state, command.approvalId, scope as Required<FinanceScope>, 'elimination.rule.approve', actor.uid, now)
      const next: EliminationRule = {
        ...rule,
        status: 'approved',
        approvalId: approval.approvalId,
        approvedAt: approval.approvedAt,
        approvedBy: approval.approvedBy,
        immutable: true,
        version: rule.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
      }
      next.contentHash = immutableContentHash(next)
      state.eliminationRules.set(next.id, next)
      appendAudit(state, scope, actor, 'elimination_rule.approved', 'elimination_rule', next.id, next.version, now, command, {
        approvalId: approval.approvalId,
      }, command.reason)
      storeIdempotency(state, actor, groupScope, 'elimination.rule.approve', command, next.id, idem.claimId, idem.payloadDigest, now, next)
      return structuredClone(next)
    })
  }

  async createConsolidationRun(actor: FinanceActorContext, command: CreateConsolidationRunCommand): Promise<ConsolidationRun> {
    const now = this.now()
    return this.store.transact((state) => {
      assertCreateVersion(command.expectedVersion, 'consolidation run')
      const scope = { orgId: command.orgId, legalEntityId: command.consolidationLegalEntityId, bookId: command.consolidationBookId }
      authorizeFinanceAction(actor, scope, 'consolidation.run', now)
      parseCanonicalDate(command.asOfDate, 'asOfDate')
      const bookType = state.bookTypes.get(command.consolidationBookId) ?? 'primary'
      assertEliminationTargetIsConsolidationBook({
        bookType,
        consolidationBookId: command.consolidationBookId,
        targetBookId: command.consolidationBookId,
      })
      const memberBookIds = command.memberBooks.map((member) => member.bookId)
      projectConsolidatedReportingBoundary({
        groupOrgId: command.groupOrgId,
        consolidationLegalEntityId: command.consolidationLegalEntityId,
        consolidationBookId: command.consolidationBookId,
        memberBookIds,
      })
      for (const member of command.memberBooks) {
        authorizeFinanceAction(actor, {
          orgId: command.orgId,
          legalEntityId: member.legalEntityId,
          bookId: member.bookId,
        }, 'consolidation.run', now)
      }
      for (const ruleId of command.eliminationRuleIds) {
        const rule = state.eliminationRules.get(ruleId)
        if (!rule || rule.orgId !== command.orgId || rule.status !== 'approved') {
          throw new FinanceValidationError('Consolidation run requires approved elimination rules')
        }
      }
      const groupScope = { orgId: command.orgId, legalEntityId: command.consolidationLegalEntityId }
      const idem = idempotencyInput(state, actor, groupScope, 'consolidation.run.create', command, now)
      if (idem.retryId) return structuredClone(state.consolidationRuns.get(idem.retryId)!)
      claim(state, 'consolidation_run_id', groupScope, command.id, command.id, 'Consolidation run id already exists')
      const run: ConsolidationRun = {
        id: requiredText(command.id, 'id'),
        orgId: command.orgId,
        legalEntityId: command.consolidationLegalEntityId,
        bookId: command.consolidationBookId,
        schemaVersion: 1,
        version: 1,
        createdAt: now,
        createdBy: actor.uid,
        updatedAt: now,
        updatedBy: actor.uid,
        groupOrgId: command.groupOrgId,
        consolidationLegalEntityId: command.consolidationLegalEntityId,
        consolidationBookId: command.consolidationBookId,
        consolidationPeriodId: requiredText(command.consolidationPeriodId, 'consolidationPeriodId'),
        asOfDate: command.asOfDate,
        status: 'draft',
        memberBooks: structuredClone(command.memberBooks),
        eliminationRuleIds: [...command.eliminationRuleIds],
        eliminationRuleVersions: command.eliminationRuleIds.map((ruleId) => {
          const rule = state.eliminationRules.get(ruleId)!
          return { ruleId, versionNumber: rule.versionNumber, contentHash: rule.contentHash }
        }),
        ...(command.rateSetId ? { rateSetId: command.rateSetId } : {}),
        sourceCutoffDigest: '',
        entryIds: [],
        immutable: false,
      }
      state.consolidationRuns.set(run.id, run)
      appendAudit(state, scope, actor, 'consolidation_run.created', 'consolidation_run', run.id, run.version, now, command, {
        memberBookCount: run.memberBooks.length,
        eliminationRuleCount: run.eliminationRuleIds.length,
      })
      storeIdempotency(state, actor, groupScope, 'consolidation.run.create', command, run.id, idem.claimId, idem.payloadDigest, now, run)
      return structuredClone(run)
    })
  }

  async pinConsolidationRun(actor: FinanceActorContext, command: PinConsolidationRunCommand): Promise<ConsolidationRun> {
    const now = this.now()
    return this.store.transact((state) => {
      const run = state.consolidationRuns.get(command.runId)
      if (!run || run.orgId !== command.orgId) throw new FinanceValidationError('Consolidation run not found in exact scope')
      const scope = { orgId: run.orgId, legalEntityId: run.consolidationLegalEntityId, bookId: run.consolidationBookId }
      authorizeFinanceAction(actor, scope, 'consolidation.run', now)
      const groupScope = { orgId: run.orgId, legalEntityId: run.consolidationLegalEntityId }
      const idem = idempotencyInput(state, actor, groupScope, 'consolidation.run.pin', command, now)
      if (idem.retryId) return structuredClone(state.consolidationRuns.get(idem.retryId)!)
      if (run.version !== command.expectedVersion) throw new FinanceValidationError('Consolidation run version mismatch')
      if (run.status !== 'draft') throw new FinanceValidationError('Only draft consolidation runs can be pinned')
      const next: ConsolidationRun = {
        ...run,
        status: 'pinned',
        sourceCutoffDigest: requiredText(command.sourceCutoffDigest, 'sourceCutoffDigest'),
        version: run.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
      }
      state.consolidationRuns.set(next.id, next)
      appendAudit(state, scope, actor, 'consolidation_run.pinned', 'consolidation_run', next.id, next.version, now, command, {
        sourceCutoffDigest: next.sourceCutoffDigest,
      })
      storeIdempotency(state, actor, groupScope, 'consolidation.run.pin', command, next.id, idem.claimId, idem.payloadDigest, now, next)
      return structuredClone(next)
    })
  }

  async postEliminations(actor: FinanceActorContext, command: PostConsolidationEliminationsCommand): Promise<{ run: ConsolidationRun; entry: ConsolidationEntry }> {
    const now = this.now()
    return this.store.transact((state) => {
      const run = state.consolidationRuns.get(command.runId)
      if (!run || run.orgId !== command.orgId) throw new FinanceValidationError('Consolidation run not found in exact scope')
      const scope = { orgId: run.orgId, legalEntityId: run.consolidationLegalEntityId, bookId: run.consolidationBookId }
      authorizeFinanceAction(actor, scope, 'consolidation.run', now)
      const groupScope = { orgId: run.orgId, legalEntityId: run.consolidationLegalEntityId }
      const idem = idempotencyInput(state, actor, groupScope, 'consolidation.run.post_eliminations', command, now)
      if (idem.retryId) {
        const existingRun = state.consolidationRuns.get(idem.retryId)!
        const entryId = existingRun.entryIds[existingRun.entryIds.length - 1]
        return {
          run: structuredClone(existingRun),
          entry: structuredClone(state.consolidationEntries.get(entryId)!),
        }
      }
      if (run.version !== command.expectedVersion) throw new FinanceValidationError('Consolidation run version mismatch')
      if (run.status !== 'pinned' && run.status !== 'posted') {
        throw new FinanceValidationError('Consolidation run must be pinned before posting eliminations')
      }
      const bookType = state.bookTypes.get(run.consolidationBookId) ?? 'primary'
      assertEliminationTargetIsConsolidationBook({
        bookType,
        consolidationBookId: run.consolidationBookId,
        targetBookId: run.consolidationBookId,
      })
      assertEntityBookNotMutatedByElimination(run.memberBooks.map((member) => member.bookId), run.consolidationBookId)
      const ruleId = run.eliminationRuleIds[0]
      if (!ruleId) throw new FinanceValidationError('Consolidation run has no elimination rules')
      const rule = state.eliminationRules.get(ruleId)
      if (!rule || rule.status !== 'approved') throw new FinanceValidationError('Approved elimination rule is required')
      if (command.pairId && rule.pairId && rule.pairId !== command.pairId) {
        throw new FinanceValidationError('Elimination rule pair does not match command pair')
      }
      for (const txId of command.sourceTransactionIds) {
        const tx = state.transactions.get(txId)
        if (!tx || tx.orgId !== command.orgId || tx.status !== 'matched') {
          throw new FinanceValidationError('Elimination source transactions must be matched intercompany entries')
        }
      }
      const lines = buildDueToDueFromEliminationLines({
        amountMinor: command.amountMinor,
        dueToAccountId: rule.debitAccountId,
        dueFromAccountId: rule.creditAccountId,
        description: requiredText(command.description, 'description'),
      })
      assertEliminationLinesBalanced(lines)
      const entryId = `ce_${run.id}_${run.entryIds.length + 1}`
      const journalEntryId = command.consolidationJournalEntryId ?? `icj_elim_${entryId}`
      const entry: ConsolidationEntry = {
        id: entryId,
        orgId: run.orgId,
        legalEntityId: run.consolidationLegalEntityId,
        bookId: run.consolidationBookId,
        schemaVersion: 1,
        version: 1,
        createdAt: now,
        createdBy: actor.uid,
        updatedAt: now,
        updatedBy: actor.uid,
        runId: run.id,
        consolidationLegalEntityId: run.consolidationLegalEntityId,
        consolidationBookId: run.consolidationBookId,
        consolidationPeriodId: run.consolidationPeriodId,
        ruleId: rule.id,
        ruleVersionNumber: rule.versionNumber,
        ...(command.pairId ? { pairId: command.pairId } : {}),
        status: 'posted',
        description: command.description,
        amountMinor: command.amountMinor,
        currency: requiredText(command.currency, 'currency').toUpperCase(),
        lines,
        journalEntryId,
        sourceTransactionIds: [...command.sourceTransactionIds],
        immutable: true,
      }
      entry.contentHash = immutableContentHash(entry)
      state.consolidationEntries.set(entry.id, entry)
      const nextRun: ConsolidationRun = {
        ...run,
        status: 'posted',
        entryIds: [...run.entryIds, entry.id],
        version: run.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
      }
      state.consolidationRuns.set(nextRun.id, nextRun)
      appendAudit(state, scope, actor, 'consolidation_entry.posted', 'consolidation_entry', entry.id, entry.version, now, command, {
        runId: run.id, journalEntryId, amountMinor: entry.amountMinor,
      })
      appendAudit(state, scope, actor, 'consolidation_run.posted', 'consolidation_run', nextRun.id, nextRun.version, now, command, {
        entryId: entry.id,
      })
      storeIdempotency(state, actor, groupScope, 'consolidation.run.post_eliminations', command, nextRun.id, idem.claimId, idem.payloadDigest, now, {
        run: nextRun, entry,
      })
      return { run: structuredClone(nextRun), entry: structuredClone(entry) }
    })
  }

  async approveConsolidationRun(actor: FinanceActorContext, command: ApproveConsolidationRunCommand): Promise<ConsolidationRun> {
    const now = this.now()
    return this.store.transact((state) => {
      const run = state.consolidationRuns.get(command.runId)
      if (!run || run.orgId !== command.orgId) throw new FinanceValidationError('Consolidation run not found in exact scope')
      const scope = { orgId: run.orgId, legalEntityId: run.consolidationLegalEntityId, bookId: run.consolidationBookId }
      authorizeFinanceAction(actor, scope, 'consolidation.approve', now)
      const groupScope = { orgId: run.orgId, legalEntityId: run.consolidationLegalEntityId }
      const idem = idempotencyInput(state, actor, groupScope, 'consolidation.run.approve', command, now)
      if (idem.retryId) return structuredClone(state.consolidationRuns.get(idem.retryId)!)
      if (run.version !== command.expectedVersion) throw new FinanceValidationError('Consolidation run version mismatch')
      if (run.status !== 'posted') throw new FinanceValidationError('Only posted consolidation runs can be approved')
      if (run.entryIds.length === 0) throw new FinanceValidationError('Consolidation run has no elimination entries')
      const approval = loadApproval(state, command.approvalId, scope as Required<FinanceScope>, 'consolidation.run.approve', actor.uid, now)
      const next: ConsolidationRun = {
        ...run,
        status: 'approved',
        approvalId: approval.approvalId,
        approvedAt: approval.approvedAt,
        approvedBy: approval.approvedBy,
        immutable: true,
        version: run.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
      }
      next.contentHash = immutableContentHash(next)
      state.consolidationRuns.set(next.id, next)
      appendAudit(state, scope, actor, 'consolidation_run.approved', 'consolidation_run', next.id, next.version, now, command, {
        approvalId: approval.approvalId,
      }, command.reason)
      storeIdempotency(state, actor, groupScope, 'consolidation.run.approve', command, next.id, idem.claimId, idem.payloadDigest, now, next)
      return structuredClone(next)
    })
  }

  reportingBoundary(actor: FinanceActorContext, orgId: string, runId: string) {
    const now = this.now()
    const run = this.store.consolidationRuns.get(runId)
    if (!run || run.orgId !== orgId) throw new FinanceValidationError('Consolidation run not found in exact scope')
    const scope = { orgId: run.orgId, legalEntityId: run.consolidationLegalEntityId, bookId: run.consolidationBookId }
    authorizeFinanceAction(actor, scope, 'consolidation.read', now)
    return projectConsolidatedReportingBoundary({
      groupOrgId: run.groupOrgId,
      consolidationLegalEntityId: run.consolidationLegalEntityId,
      consolidationBookId: run.consolidationBookId,
      memberBookIds: run.memberBooks.map((member) => member.bookId),
    })
  }
}
