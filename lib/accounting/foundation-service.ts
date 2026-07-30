import { authorizeFinanceAction, effectiveFinanceAssignments, parseIsoTimestamp } from '@/lib/finance/policy'
import {
  CANONICAL_PAYLOAD_VERSION,
  HASH_ALGORITHM_VERSION,
  canonicalDigest,
  canonicalScopeIdentity,
  scopedClaimId,
} from '@/lib/finance/integrity'
import type {
  AccountingBasis,
  FinanceActorContext,
  FinanceApprovalAction,
  FinanceApprovalEvidence,
  FinanceApprovalRecord,
  FinanceScope,
} from '@/lib/finance/types'
import {
  buildReversalLines,
  FinanceValidationError,
  allowlistedJournalLine,
  assertClosedPostJournalCommand,
  assertCreateVersion,
  assertDefaultControlAccountConfiguration,
  assertPostedJournalContentHash,
  assertSafeInteger,
  parseCanonicalDate,
  policyRangesOverlap,
  requiredText,
  resolveUniqueEffectivePolicy,
  validatePostingContext,
} from './foundation'
import type {
  AccountingBook,
  AccountingPeriod,
  BookPolicyVersion,
  FinanceAuditEvent,
  FinanceBranch,
  FinanceOutboxEvent,
  JournalLine,
  LedgerAccount,
  LegalEntity,
  PostedJournalEntry,
} from './types'

interface CommandIdentity { requestId: string; idempotencyKey: string }

export interface CreateLegalEntityCommand extends CommandIdentity {
  id: string; orgId: string; code: string; legalName: string; jurisdictionCode: string
  functionalCurrency: string; defaultAccountingBasis: AccountingBasis; fiscalYearStartMonth: number
  timezone: string; status: LegalEntity['status']; expectedVersion: 0
}
export interface CreateBranchCommand extends FinanceScope, CommandIdentity {
  id: string; code: string; name: string; status: FinanceBranch['status']; reportingOnly: boolean; expectedVersion: 0
}
export interface CreateBookCommand extends FinanceScope, CommandIdentity {
  id: string; code: string; name: string; branchId?: string; bookType: AccountingBook['bookType']
  functionalCurrency: string; accountingBasis: AccountingBasis; jurisdictionCode: string
  taxPointPolicyId: string; defaultControlAccountIds: AccountingBook['defaultControlAccountIds']
  status: AccountingBook['status']; cutoverAt?: string; expectedVersion: 0
}
export interface CreateBookPolicyVersionCommand extends Required<FinanceScope>, CommandIdentity {
  id: string; versionNumber: number; accountingBasis: AccountingBasis; taxPointPolicyId: string
  currencyPrecision: number; roundingMode: BookPolicyVersion['roundingMode']; effectiveFrom: string
  effectiveTo?: string; approvalId: string; expectedVersion: 0
}
export interface CreatePeriodCommand extends Required<FinanceScope>, CommandIdentity {
  id: string; fiscalYear: number; periodNumber: number; startsAt: string; endsAt: string
  status: AccountingPeriod['status']; expectedVersion: 0
}
export interface CreateAccountCommand extends Required<FinanceScope>, CommandIdentity {
  id: string; code: string; name: string; accountType: LedgerAccount['accountType']
  normalBalance: LedgerAccount['normalBalance']; parentAccountId?: string
  controlAccountRole?: LedgerAccount['controlAccountRole']; currency: string
  currencyPolicy: LedgerAccount['currencyPolicy']; reportMapping: string; postingAllowed: boolean
  activeFrom: string; activeTo?: string; expectedVersion: 0
}
export interface PostJournalCommand extends Required<FinanceScope> {
  id: string; periodId: string; sourceType: string; sourceId: string; sourceVersion: number
  postingPurpose: string; entryType: string; postingDate: string; documentDate: string
  description: string; currency: string; policyVersionId: string; expectedVersion: 0
  requestId: string; idempotencyKey: string; approvalId?: string; adjustmentApprovalId?: string
  lines: readonly { accountId: string; debitMinor: number; creditMinor: number; description?: string }[]
  reversesJournalEntryId?: string; reversalReason?: string
}
export interface ReverseJournalCommand extends Required<FinanceScope> {
  originalJournalId: string; reversalJournalId: string; periodId: string; postingDate: string
  reason: string; approvalId?: string; requestId: string; idempotencyKey: string; expectedVersion: 0
}
export interface ChangePeriodStatusCommand extends Required<FinanceScope> {
  periodId: string; status: AccountingPeriod['status']; expectedVersion: number; reason: string
  approvalId?: string; requestId: string; idempotencyKey: string
}

export interface CreateFinanceApprovalCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  action: FinanceApprovalAction
  subjectDigest: string
  reason: string
  expiresAt?: string
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
}
interface FoundationState {
  legalEntities: Map<string, LegalEntity>; branches: Map<string, FinanceBranch>; books: Map<string, AccountingBook>
  policies: Map<string, BookPolicyVersion>; periods: Map<string, AccountingPeriod>; accounts: Map<string, LedgerAccount>
  approvals: Map<string, FinanceApprovalRecord>
  journals: Map<string, PostedJournalEntry>; uniqueClaims: Map<string, string>; idempotency: Map<string, IdempotencyRecord>
  sequenceByBook: Map<string, number>; calendarHeads: Map<string, number>
  auditEvents: FinanceAuditEvent[]; outboxEvents: FinanceOutboxEvent[]
}

function cloneMap<T>(source: Map<string, T>): Map<string, T> {
  return new Map(Array.from(source, ([key, value]) => [key, structuredClone(value)]))
}
function cloneState(state: FoundationState): FoundationState {
  return {
    legalEntities: cloneMap(state.legalEntities), branches: cloneMap(state.branches), books: cloneMap(state.books),
    policies: cloneMap(state.policies), periods: cloneMap(state.periods), accounts: cloneMap(state.accounts),
    approvals: cloneMap(state.approvals),
    journals: cloneMap(state.journals), uniqueClaims: new Map(state.uniqueClaims), idempotency: cloneMap(state.idempotency),
    sequenceByBook: new Map(state.sequenceByBook), calendarHeads: new Map(state.calendarHeads),
    auditEvents: structuredClone(state.auditEvents), outboxEvents: structuredClone(state.outboxEvents),
  }
}

export class InMemoryFinanceFoundationStore {
  legalEntities = new Map<string, LegalEntity>(); branches = new Map<string, FinanceBranch>()
  books = new Map<string, AccountingBook>(); policies = new Map<string, BookPolicyVersion>()
  periods = new Map<string, AccountingPeriod>(); accounts = new Map<string, LedgerAccount>()
  approvals = new Map<string, FinanceApprovalRecord>()
  journals = new Map<string, PostedJournalEntry>(); uniqueClaims = new Map<string, string>()
  idempotency = new Map<string, IdempotencyRecord>(); sequenceByBook = new Map<string, number>()
  calendarHeads = new Map<string, number>(); auditEvents: FinanceAuditEvent[] = []; outboxEvents: FinanceOutboxEvent[] = []
  private transactionTail: Promise<void> = Promise.resolve()

  async transact<T>(operation: (state: FoundationState) => T | Promise<T>): Promise<T> {
    let release!: () => void
    const predecessor = this.transactionTail
    this.transactionTail = new Promise<void>((resolve) => { release = resolve })
    await predecessor
    try {
      const draft = cloneState(this)
      const result = await operation(draft)
      Object.assign(this, draft)
      return result
    } finally { release() }
  }
  unsafeUpdatePostedJournal(id: string, update: Partial<PostedJournalEntry>): void {
    const existing = this.journals.get(id)
    if (!existing) throw new Error('Journal not found')
    if (existing.immutable) throw new Error('Posted journals are immutable')
    this.journals.set(id, { ...existing, ...update })
  }
  unsafeUpdateBookPolicyVersion(id: string, update: Partial<BookPolicyVersion>): void {
    const existing = this.policies.get(id)
    if (!existing) throw new Error('Book policy version not found')
    if (existing.immutable) throw new Error('Approved book policy versions are immutable')
    this.policies.set(id, { ...existing, ...update })
  }
}

function normalizeCode(value: string, field: string): string { return requiredText(value, field).toUpperCase() }
function assertCreate(expectedVersion: number, existing: unknown, resource: string): void {
  assertCreateVersion(expectedVersion, resource)
  if (existing) throw new FinanceValidationError(`${resource} already exists`)
}
function assertExactScope(record: FinanceScope, scope: FinanceScope, resource: string): void {
  if (record.orgId !== scope.orgId || record.legalEntityId !== scope.legalEntityId || record.bookId !== scope.bookId) {
    throw new FinanceValidationError(`${resource} scope does not match`)
  }
}
function claim(state: FoundationState, type: string, scope: FinanceScope, key: unknown, id: string, message: string): void {
  const claimId = scopedClaimId(type, scope, key)
  const existing = state.uniqueClaims.get(claimId)
  if (existing && existing !== id) throw new FinanceValidationError(message)
  state.uniqueClaims.set(claimId, id)
}

function compact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compact)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, compact(item)]))
  }
  return value
}

export function financeApprovalSubjectDigest(action: FinanceApprovalAction, command: object): string {
  const excluded = new Set(['approval', 'approvalId', 'adjustmentApprovalId', 'authorizedAdjustment', 'requestId', 'idempotencyKey'])
  const payload = Object.fromEntries(Object.entries(command).filter(([key]) => !excluded.has(key)))
  return canonicalDigest(compact({ action, payload }))
}

function idempotencyClaimId(actor: FinanceActorContext, orgId: string, key: string): string {
  return scopedClaimId('command_idempotency', { orgId, legalEntityId: '__org_command_scope__' }, { actorId: actor.uid, key })
}

function idempotencyInput(
  state: FoundationState,
  actor: FinanceActorContext,
  scope: FinanceScope,
  operation: string,
  command: CommandIdentity & object,
  now: string,
): { claimId: string; payloadDigest: string; retryId?: string } {
  const requestId = requiredText(command.requestId, 'requestId')
  const key = requiredText(command.idempotencyKey, 'idempotencyKey')
  const payloadDigest = canonicalDigest(compact(command))
  const claimId = idempotencyClaimId(actor, scope.orgId, key)
  const existing = state.idempotency.get(claimId)
  if (existing) {
    if (existing.schemaVersion !== 1 || existing.canonicalPayloadVersion !== CANONICAL_PAYLOAD_VERSION ||
        existing.hashAlgorithmVersion !== HASH_ALGORITHM_VERSION || existing.actorId !== actor.uid ||
        existing.orgId !== scope.orgId || existing.scopeIdentity !== canonicalScopeIdentity(scope) ||
        existing.operation !== operation || existing.requestId !== requestId || existing.expiresAt <= now) {
      throw new FinanceValidationError('Idempotency metadata is invalid, mismatched, or expired')
    }
    if (existing.payloadDigest !== payloadDigest) throw new FinanceValidationError('Idempotency key payload mismatch')
    return { claimId, payloadDigest, retryId: existing.aggregateId }
  }
  return { claimId, payloadDigest }
}

function storeIdempotency(
  state: FoundationState,
  actor: FinanceActorContext,
  scope: FinanceScope,
  operation: string,
  command: CommandIdentity,
  aggregateId: string,
  claimId: string,
  payloadDigest: string,
  now: string,
): void {
  state.idempotency.set(claimId, {
    schemaVersion: 1, canonicalPayloadVersion: CANONICAL_PAYLOAD_VERSION,
    hashAlgorithmVersion: HASH_ALGORITHM_VERSION, payloadDigest, aggregateId, operation,
    actorId: actor.uid, orgId: scope.orgId, scopeIdentity: canonicalScopeIdentity(scope),
    requestId: command.requestId, expiresAt: new Date(Date.parse(now) + 24 * 60 * 60 * 1000).toISOString(),
  })
}

function approvalEvidence(record: FinanceApprovalRecord): FinanceApprovalEvidence {
  return { approvalId: record.id, approvedBy: record.approvedBy, approvedAt: record.approvedAt,
    action: record.action, reason: record.reason }
}

function assertFutureApprovalExpiry(expiresAt: string | undefined, now: string): void {
  if (!expiresAt) return
  try {
    if (parseIsoTimestamp(expiresAt, 'approval.expiresAt') <= parseIsoTimestamp(now, 'approval timestamp')) {
      throw new Error('expired')
    }
  } catch {
    throw new FinanceValidationError('Approval expiry must be a future ISO timestamp')
  }
}

function loadApproval(
  state: FoundationState,
  approvalId: string | undefined,
  scope: Required<FinanceScope>,
  action: FinanceApprovalAction,
  actorId: string,
  subjectDigest: string,
  now: string,
): FinanceApprovalEvidence {
  const id = requiredText(approvalId ?? '', 'approvalId')
  const approval = state.approvals.get(id)
  if (!approval || approval.status !== 'approved' || !approval.immutable || approval.schemaVersion !== 1 ||
      approval.canonicalPayloadVersion !== CANONICAL_PAYLOAD_VERSION || approval.hashAlgorithmVersion !== HASH_ALGORITHM_VERSION ||
      approval.orgId !== scope.orgId || approval.legalEntityId !== scope.legalEntityId || approval.bookId !== scope.bookId ||
      approval.action !== action || approval.subjectDigest !== subjectDigest ||
      !approval.approverAssignmentId || !['finance_approver', 'finance_admin'].includes(approval.approverRole)) {
    throw new FinanceValidationError('Persisted approval is missing, expired, mismatched, or invalid')
  }
  try {
    if (approval.expiresAt && parseIsoTimestamp(approval.expiresAt, 'approval.expiresAt') <= parseIsoTimestamp(now, 'approval timestamp')) {
      throw new Error('expired')
    }
  } catch {
    throw new FinanceValidationError('Persisted approval is missing, expired, mismatched, or invalid')
  }
  if (approval.approvedBy === actorId) throw new FinanceValidationError('Approval violates separation of duties')
  return approvalEvidence(approval)
}

interface EvidenceMetadata {
  requestId?: string; idempotencyKey?: string; reason?: string; approval?: FinanceApprovalEvidence; aggregateDigest?: string
}
function appendEvidence(
  state: FoundationState, actor: FinanceActorContext, scope: FinanceScope, aggregateType: string,
  aggregateId: string, aggregateVersion: number, eventType: string, now: string, metadata: EvidenceMetadata = {},
): void {
  const scopeIdentity = canonicalScopeIdentity(scope)
  const previous = [...state.auditEvents].reverse().find((event) => canonicalScopeIdentity(event) === scopeIdentity)
  const sequence = previous ? previous.sequence + 1 : 0
  const eventWithoutHash = compact({
    ...scope, id: `audit_${canonicalDigest({ scopeIdentity, sequence, aggregateType, aggregateId, eventType }).slice(0, 40)}`,
    schemaVersion: 1 as const, aggregateType, aggregateId, aggregateVersion,
    aggregateDigest: metadata.aggregateDigest ?? canonicalDigest({ aggregateType, aggregateId, aggregateVersion }),
    eventType, actorId: actor.uid, requestId: metadata.requestId, idempotencyKey: metadata.idempotencyKey,
    correlationId: actor.correlationId, delegationId: actor.delegationId, reason: metadata.reason,
    approvalReference: metadata.approval?.approvalId, approvalAction: metadata.approval?.action,
    occurredAt: now, sequence, previousEventId: previous?.id, previousEventHash: previous?.eventHash,
    canonicalPayloadVersion: CANONICAL_PAYLOAD_VERSION, hashAlgorithmVersion: HASH_ALGORITHM_VERSION,
  }) as Omit<FinanceAuditEvent, 'eventHash'>
  const event: FinanceAuditEvent = { ...eventWithoutHash, eventHash: canonicalDigest(eventWithoutHash) }
  state.auditEvents.push(event)
  state.outboxEvents.push({
    ...scope, id: `outbox_${event.id.slice(6)}`, schemaVersion: 1, eventType, aggregateType, aggregateId,
    payload: { aggregateId, aggregateVersion, aggregateDigest: event.aggregateDigest, requestId: metadata.requestId },
    deliveryStatus: 'internal_pending', externalEgressAllowed: false, createdAt: now,
  })
}

export class FinanceFoundationService {
  constructor(private readonly store: InMemoryFinanceFoundationStore, private readonly now = () => new Date().toISOString()) {}

  async createFinanceApproval(approver: FinanceActorContext, command: CreateFinanceApprovalCommand): Promise<FinanceApprovalRecord> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    const policyAction = command.action === 'journal.reverse' ? 'journal.reverse' :
      command.action === 'journal.post' ? 'journal.post' :
        command.action === 'period.adjust' ? 'period.adjust' : 'period.close'
    const authorizationAt = this.now()
    assertCreateVersion(command.expectedVersion, 'Finance approval')
    authorizeFinanceAction(approver, scope, policyAction, authorizationAt)
    const assignment = effectiveFinanceAssignments(approver, scope, authorizationAt)
      .find((candidate) => candidate.role === 'finance_approver' || candidate.role === 'finance_admin')
    if (!assignment) throw new FinanceValidationError('Approval requires an effective finance approver assignment')
    requiredText(command.subjectDigest, 'subjectDigest'); requiredText(command.reason, 'reason')
    if (!/^[a-f0-9]{64}$/.test(command.subjectDigest)) throw new FinanceValidationError('subjectDigest must be SHA-256')
    assertFutureApprovalExpiry(command.expiresAt, authorizationAt)
    return this.store.transact((state) => {
      const now = this.now()
      const idem = idempotencyInput(state, approver, scope, 'finance.approval.create', command, now)
      if (idem.retryId) {
        const stored = state.approvals.get(idem.retryId)
        if (!stored || stored.id !== command.id || stored.orgId !== scope.orgId || stored.legalEntityId !== scope.legalEntityId ||
            stored.bookId !== scope.bookId || stored.schemaVersion !== 1 || !stored.immutable) {
          throw new FinanceValidationError('Idempotency approval result is corrupt')
        }
        return stored
      }
      assertCreate(command.expectedVersion, state.approvals.get(command.id), 'Finance approval')
      const book = state.books.get(command.bookId)
      if (!book) throw new FinanceValidationError('Accounting book not found in scope')
      assertExactScope(book, scope, 'Accounting book')
      const approval: FinanceApprovalRecord = {
        ...scope, id: command.id, schemaVersion: 1, action: command.action, status: 'approved',
        approvedBy: approver.uid, approverRole: assignment.role, approverAssignmentId: assignment.id,
        approvedAt: now, reason: command.reason.trim(), subjectDigest: command.subjectDigest,
        expiresAt: command.expiresAt, immutable: true, canonicalPayloadVersion: CANONICAL_PAYLOAD_VERSION,
        hashAlgorithmVersion: HASH_ALGORITHM_VERSION,
      }
      state.approvals.set(approval.id, approval)
      storeIdempotency(state, approver, scope, 'finance.approval.create', command, approval.id,
        idem.claimId, idem.payloadDigest, now)
      appendEvidence(state, approver, scope, 'finance_approval', approval.id, 1,
        'finance.approval.recorded.v1', now, { reason: approval.reason, aggregateDigest: canonicalDigest(compact(approval)) })
      return approval
    })
  }

  async createLegalEntity(actor: FinanceActorContext, command: CreateLegalEntityCommand): Promise<LegalEntity> {
    const scope = { orgId: command.orgId, legalEntityId: command.id }
    assertCreateVersion(command.expectedVersion, 'Legal entity')
    authorizeFinanceAction(actor, scope, 'foundation.configure', this.now())
    if (!Number.isInteger(command.fiscalYearStartMonth) || command.fiscalYearStartMonth < 1 || command.fiscalYearStartMonth > 12) {
      throw new FinanceValidationError('fiscalYearStartMonth must be between 1 and 12')
    }
    return this.store.transact((state) => {
      const now = this.now()
      const idem = idempotencyInput(state, actor, scope, 'legal-entity.create', command, now)
      if (idem.retryId) {
        const stored = state.legalEntities.get(idem.retryId)
        if (!stored || stored.id !== command.id || stored.orgId !== scope.orgId || stored.legalEntityId !== scope.legalEntityId || stored.schemaVersion !== 1) {
          throw new FinanceValidationError('Idempotency legal entity result is corrupt')
        }
        return stored
      }
      assertCreate(command.expectedVersion, state.legalEntities.get(command.id), 'Legal entity')
      const code = normalizeCode(command.code, 'code')
      claim(state, 'entity_code', { orgId: scope.orgId, legalEntityId: '__organization_scope__' }, code, command.id, 'Legal entity code already exists')
      const entity: LegalEntity = {
        ...scope, id: command.id, code, legalName: requiredText(command.legalName, 'legalName'),
        jurisdictionCode: normalizeCode(command.jurisdictionCode, 'jurisdictionCode'),
        functionalCurrency: normalizeCode(command.functionalCurrency, 'functionalCurrency'),
        defaultAccountingBasis: command.defaultAccountingBasis, fiscalYearStartMonth: command.fiscalYearStartMonth,
        timezone: requiredText(command.timezone, 'timezone'), status: command.status, schemaVersion: 1, version: 1,
        createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid,
      }
      state.legalEntities.set(entity.id, entity)
      storeIdempotency(state, actor, scope, 'legal-entity.create', command, entity.id, idem.claimId, idem.payloadDigest, now)
      appendEvidence(state, actor, scope, 'legal_entity', entity.id, 1, 'finance.legal-entity.created.v1', now)
      return entity
    })
  }

  async createBranch(actor: FinanceActorContext, command: CreateBranchCommand): Promise<FinanceBranch> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId }
    assertCreateVersion(command.expectedVersion, 'Branch')
    authorizeFinanceAction(actor, scope, 'foundation.configure', this.now())
    return this.store.transact((state) => {
      const now = this.now()
      const idem = idempotencyInput(state, actor, scope, 'branch.create', command, now)
      if (idem.retryId) {
        const stored = state.branches.get(idem.retryId)
        if (!stored || stored.id !== command.id || stored.orgId !== scope.orgId || stored.legalEntityId !== scope.legalEntityId || stored.schemaVersion !== 1) {
          throw new FinanceValidationError('Idempotency branch result is corrupt')
        }
        return stored
      }
      assertCreate(command.expectedVersion, state.branches.get(command.id), 'Branch')
      const entity = state.legalEntities.get(command.legalEntityId)
      if (!entity || entity.orgId !== command.orgId) throw new FinanceValidationError('Legal entity not found in scope')
      const code = normalizeCode(command.code, 'code')
      claim(state, 'branch_code', scope, code, command.id, 'Branch code already exists')
      const branch: FinanceBranch = { ...scope, id: command.id, code, name: requiredText(command.name, 'name'),
        status: command.status, reportingOnly: command.reportingOnly, schemaVersion: 1, version: 1,
        createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid }
      state.branches.set(branch.id, branch)
      storeIdempotency(state, actor, scope, 'branch.create', command, branch.id, idem.claimId, idem.payloadDigest, now)
      appendEvidence(state, actor, scope, 'finance_branch', branch.id, 1, 'finance.branch.created.v1', now)
      return branch
    })
  }

  async createBook(actor: FinanceActorContext, command: CreateBookCommand): Promise<AccountingBook> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.id }
    assertCreateVersion(command.expectedVersion, 'Accounting book')
    authorizeFinanceAction(actor, scope, 'foundation.configure', this.now())
    return this.store.transact((state) => {
      const now = this.now()
      const idem = idempotencyInput(state, actor, scope, 'book.create', command, now)
      if (idem.retryId) {
        const stored = state.books.get(idem.retryId)
        if (!stored || stored.id !== command.id || stored.orgId !== scope.orgId || stored.legalEntityId !== scope.legalEntityId ||
            stored.bookId !== scope.bookId || stored.schemaVersion !== 1) throw new FinanceValidationError('Idempotency book result is corrupt')
        return stored
      }
      assertCreate(command.expectedVersion, state.books.get(command.id), 'Accounting book')
      const entity = state.legalEntities.get(command.legalEntityId)
      if (!entity || entity.orgId !== command.orgId) throw new FinanceValidationError('Legal entity not found in scope')
      if (command.branchId) {
        const branch = state.branches.get(command.branchId)
        if (!branch) throw new FinanceValidationError('Branch not found in scope')
        assertExactScope(branch, { orgId: command.orgId, legalEntityId: command.legalEntityId }, 'Branch')
      }
      const code = normalizeCode(command.code, 'code')
      claim(state, 'book_code', { orgId: command.orgId, legalEntityId: command.legalEntityId }, code, command.id, 'Accounting book code already exists')
      const book: AccountingBook = {
        ...scope, id: command.id, code, name: requiredText(command.name, 'name'), branchId: command.branchId,
        bookType: command.bookType, functionalCurrency: normalizeCode(command.functionalCurrency, 'functionalCurrency'),
        accountingBasis: command.accountingBasis, jurisdictionCode: normalizeCode(command.jurisdictionCode, 'jurisdictionCode'),
        taxPointPolicyId: requiredText(command.taxPointPolicyId, 'taxPointPolicyId'),
        defaultControlAccountIds: structuredClone(command.defaultControlAccountIds), status: command.status,
        schemaVersion: 1, version: 1, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid,
      }
      state.books.set(book.id, book)
      storeIdempotency(state, actor, scope, 'book.create', command, book.id, idem.claimId, idem.payloadDigest, now)
      appendEvidence(state, actor, scope, 'accounting_book', book.id, 1, 'finance.book.created.v1', now)
      return book
    })
  }

  async createBookPolicyVersion(actor: FinanceActorContext, command: CreateBookPolicyVersionCommand): Promise<BookPolicyVersion> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    assertCreateVersion(command.expectedVersion, 'Book policy version')
    authorizeFinanceAction(actor, scope, 'foundation.configure', this.now())
    assertSafeInteger(command.versionNumber, 'versionNumber', 1)
    if (!Number.isInteger(command.currencyPrecision) || command.currencyPrecision < 0 || command.currencyPrecision > 6) {
      throw new FinanceValidationError('Policy currencyPrecision is invalid')
    }
    const effectiveFrom = parseCanonicalDate(command.effectiveFrom, 'effectiveFrom')
    const effectiveTo = command.effectiveTo ? parseCanonicalDate(command.effectiveTo, 'effectiveTo') : undefined
    if (effectiveTo !== undefined && effectiveTo < effectiveFrom) throw new FinanceValidationError('Policy effective range is invalid')
    return this.store.transact((state) => {
      const now = this.now()
      const idem = idempotencyInput(state, actor, scope, 'book-policy.create', command, now)
      if (idem.retryId) {
        const stored = state.policies.get(idem.retryId)
        if (!stored || stored.id !== command.id || stored.orgId !== scope.orgId || stored.legalEntityId !== scope.legalEntityId ||
            stored.bookId !== scope.bookId || stored.schemaVersion !== 1 || !stored.immutable) {
          throw new FinanceValidationError('Idempotency policy result is corrupt')
        }
        return stored
      }
      const approval = loadApproval(state, command.approvalId, scope, 'book-policy.approve', actor.uid,
        financeApprovalSubjectDigest('book-policy.approve', command), now)
      assertCreate(command.expectedVersion, state.policies.get(command.id), 'Book policy version')
      const book = state.books.get(command.bookId)
      if (!book) throw new FinanceValidationError('Accounting book not found in scope')
      assertExactScope(book, scope, 'Accounting book')
      if (book.accountingBasis !== command.accountingBasis || book.taxPointPolicyId !== command.taxPointPolicyId) {
        throw new FinanceValidationError('Policy does not match book accounting basis and tax point policy')
      }
      if ([...state.policies.values()].some((candidate) => candidate.orgId === scope.orgId &&
        candidate.legalEntityId === scope.legalEntityId && candidate.bookId === scope.bookId &&
        policyRangesOverlap(candidate, command))) {
        throw new FinanceValidationError('Approved book policy effective range overlaps an existing policy')
      }
      claim(state, 'book_policy_version', scope, command.versionNumber, command.id, 'Book policy version already exists')
      const policy: BookPolicyVersion = {
        ...scope, id: command.id, versionNumber: command.versionNumber, accountingBasis: command.accountingBasis,
        taxPointPolicyId: command.taxPointPolicyId, currencyPrecision: command.currencyPrecision,
        roundingMode: command.roundingMode, effectiveFrom: command.effectiveFrom, effectiveTo: command.effectiveTo,
        status: 'approved', approvalId: approval.approvalId, approvalActorId: approval.approvedBy,
        approvedAt: approval.approvedAt, immutable: true, schemaVersion: 1, version: 1,
        createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid,
      }
      state.policies.set(policy.id, policy)
      storeIdempotency(state, actor, scope, 'book-policy.create', command, policy.id, idem.claimId, idem.payloadDigest, now)
      appendEvidence(state, actor, scope, 'book_policy_version', policy.id, 1, 'finance.book-policy.approved.v1', now,
        { reason: approval.reason, approval, aggregateDigest: canonicalDigest(compact(policy)) })
      return policy
    })
  }

  async createPeriod(actor: FinanceActorContext, command: CreatePeriodCommand): Promise<AccountingPeriod> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    assertCreateVersion(command.expectedVersion, 'Accounting period')
    authorizeFinanceAction(actor, scope, 'foundation.configure', this.now())
    assertSafeInteger(command.fiscalYear, 'fiscalYear', 1)
    assertSafeInteger(command.periodNumber, 'periodNumber', 1)
    const startsEpoch = parseCanonicalDate(command.startsAt, 'startsAt')
    const endsEpoch = parseCanonicalDate(command.endsAt, 'endsAt')
    if (startsEpoch > endsEpoch) throw new FinanceValidationError('Period start must not be after period end')
    return this.store.transact((state) => {
      const now = this.now()
      const idem = idempotencyInput(state, actor, scope, 'period.create', command, now)
      if (idem.retryId) {
        const stored = state.periods.get(idem.retryId)
        if (!stored || stored.id !== command.id || stored.orgId !== scope.orgId || stored.legalEntityId !== scope.legalEntityId ||
            stored.bookId !== scope.bookId || stored.schemaVersion !== 1) throw new FinanceValidationError('Idempotency period result is corrupt')
        return stored
      }
      assertCreate(command.expectedVersion, state.periods.get(command.id), 'Accounting period')
      const book = state.books.get(command.bookId)
      if (!book) throw new FinanceValidationError('Accounting book not found in scope')
      assertExactScope(book, scope, 'Accounting book')
      if ([...state.periods.values()].some((period) => period.orgId === scope.orgId &&
          period.legalEntityId === scope.legalEntityId && period.bookId === scope.bookId &&
          startsEpoch <= parseCanonicalDate(period.endsAt, 'period.endsAt') &&
          endsEpoch >= parseCanonicalDate(period.startsAt, 'period.startsAt'))) {
        throw new FinanceValidationError('Accounting period overlaps an existing period')
      }
      claim(state, 'book_period_number', scope, [command.fiscalYear, command.periodNumber], command.id, 'Accounting period number already exists')
      const period: AccountingPeriod = { ...scope, id: command.id, fiscalYear: command.fiscalYear,
        periodNumber: command.periodNumber, startsAt: command.startsAt, endsAt: command.endsAt, status: command.status,
        schemaVersion: 1, version: 1, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid }
      state.calendarHeads.set(canonicalScopeIdentity(scope), (state.calendarHeads.get(canonicalScopeIdentity(scope)) ?? 0) + 1)
      state.periods.set(period.id, period)
      storeIdempotency(state, actor, scope, 'period.create', command, period.id, idem.claimId, idem.payloadDigest, now)
      if (command.status === 'open' && !book.currentPeriodId) state.books.set(book.id, { ...book, currentPeriodId: period.id })
      appendEvidence(state, actor, scope, 'accounting_period', period.id, 1, 'finance.period.created.v1', now)
      return period
    })
  }

  async changePeriodStatus(actor: FinanceActorContext, command: ChangePeriodStatusCommand): Promise<AccountingPeriod> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    authorizeFinanceAction(actor, scope, 'period.close', this.now())
    const reason = requiredText(command.reason, 'reason')
    return this.store.transact((state) => {
      const now = this.now()
      const operation = command.status === 'open' ? 'period.reopen' : 'period.close'
      const idem = idempotencyInput(state, actor, scope, operation, command, now)
      if (idem.retryId) {
        const stored = state.periods.get(idem.retryId)
        if (!stored || stored.id !== command.periodId) throw new FinanceValidationError('Idempotency period result is corrupt')
        assertExactScope(stored, scope, 'Idempotency period result')
        return stored
      }
      const period = state.periods.get(command.periodId)
      if (!period) throw new FinanceValidationError('Accounting period not found in scope')
      assertExactScope(period, scope, 'Accounting period')
      if (period.version !== command.expectedVersion) throw new FinanceValidationError('Accounting period version conflict')
      const reopening = period.status !== 'open' && command.status === 'open'
      const approvalAction = reopening ? 'period.reopen' as const : 'period.close' as const
      const approval = loadApproval(state, command.approvalId, scope, approvalAction, actor.uid,
        financeApprovalSubjectDigest(approvalAction, command), now)
      const transitions: Record<AccountingPeriod['status'], AccountingPeriod['status'][]> = {
        open: ['soft_closed', 'hard_closed'], soft_closed: ['open', 'hard_closed'], hard_closed: ['open'],
      }
      if (!transitions[period.status].includes(command.status)) throw new FinanceValidationError('Invalid accounting period transition')
      const updated: AccountingPeriod = { ...period, status: command.status, version: period.version + 1,
        updatedAt: now, updatedBy: actor.uid,
        ...(reopening ? { reopenedAt: now, reopenApprovalId: approval.approvalId } : { closeApprovalId: approval.approvalId }) }
      state.periods.set(period.id, updated)
      storeIdempotency(state, actor, scope, operation, command, updated.id, idem.claimId, idem.payloadDigest, now)
      appendEvidence(state, actor, scope, 'accounting_period', period.id, updated.version,
        'finance.period.status-changed.v1', now, { requestId: command.requestId, idempotencyKey: command.idempotencyKey,
          reason, approval, aggregateDigest: canonicalDigest(updated) })
      return updated
    })
  }

  async createAccount(actor: FinanceActorContext, command: CreateAccountCommand): Promise<LedgerAccount> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    assertCreateVersion(command.expectedVersion, 'Ledger account')
    authorizeFinanceAction(actor, scope, 'foundation.configure', this.now())
    const activeFrom = parseCanonicalDate(command.activeFrom, 'activeFrom')
    const activeTo = command.activeTo ? parseCanonicalDate(command.activeTo, 'activeTo') : undefined
    if (activeTo !== undefined && activeTo < activeFrom) throw new FinanceValidationError('Account active range is invalid')
    return this.store.transact((state) => {
      const now = this.now()
      const idem = idempotencyInput(state, actor, scope, 'account.create', command, now)
      if (idem.retryId) {
        const stored = state.accounts.get(idem.retryId)
        if (!stored || stored.id !== command.id || stored.orgId !== scope.orgId || stored.legalEntityId !== scope.legalEntityId ||
            stored.bookId !== scope.bookId || stored.schemaVersion !== 1) throw new FinanceValidationError('Idempotency account result is corrupt')
        return stored
      }
      assertCreate(command.expectedVersion, state.accounts.get(command.id), 'Ledger account')
      const book = state.books.get(command.bookId)
      if (!book) throw new FinanceValidationError('Accounting book not found in scope')
      assertExactScope(book, scope, 'Accounting book')
      const code = normalizeCode(command.code, 'code')
      claim(state, 'account_code', scope, code, command.id, 'Ledger account code already exists')
      if (command.parentAccountId) {
        const parent = state.accounts.get(command.parentAccountId)
        if (!parent) throw new FinanceValidationError('Parent account not found in scope')
        assertExactScope(parent, scope, 'Parent account')
      }
      const account: LedgerAccount = { ...scope, id: command.id, code, name: requiredText(command.name, 'name'),
        accountType: command.accountType, normalBalance: command.normalBalance, parentAccountId: command.parentAccountId,
        controlAccountRole: command.controlAccountRole, currency: normalizeCode(command.currency, 'currency'),
        currencyPolicy: command.currencyPolicy, reportMapping: requiredText(command.reportMapping, 'reportMapping'),
        postingAllowed: command.postingAllowed, activeFrom: command.activeFrom, activeTo: command.activeTo,
        schemaVersion: 1, version: 1, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid }
      assertDefaultControlAccountConfiguration(book, account)
      state.accounts.set(account.id, account)
      storeIdempotency(state, actor, scope, 'account.create', command, account.id, idem.claimId, idem.payloadDigest, now)
      appendEvidence(state, actor, scope, 'ledger_account', account.id, 1, 'finance.account.created.v1', now)
      return account
    })
  }

  async postJournal(actor: FinanceActorContext, command: PostJournalCommand): Promise<PostedJournalEntry> {
    if (command.reversesJournalEntryId) {
      throw new FinanceValidationError('Reversals must use reverseJournal so lines are derived from the stored original')
    }
    return this.commitJournal(actor, command)
  }

  private async commitJournal(
    actor: FinanceActorContext,
    command: PostJournalCommand,
    approvedSubjectDigest?: string,
  ): Promise<PostedJournalEntry> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    assertClosedPostJournalCommand(command)
    assertCreateVersion(command.expectedVersion, 'Journal')
    authorizeFinanceAction(actor, scope, command.reversesJournalEntryId ? 'journal.reverse' : 'journal.post', this.now())
    requiredText(command.requestId, 'requestId'); requiredText(command.idempotencyKey, 'idempotencyKey')
    assertSafeInteger(command.sourceVersion, 'sourceVersion', 1)
    if (command.sourceType === 'journal_reversal' && !command.reversesJournalEntryId) {
      throw new FinanceValidationError('journal_reversal sourceType must use reverseJournal')
    }
    const payloadDigest = canonicalDigest(command)
    const idempotencyClaim = scopedClaimId('journal_idempotency', scope, { actorId: actor.uid, key: command.idempotencyKey })
    return this.store.transact((state) => {
      const retry = state.idempotency.get(idempotencyClaim)
      if (retry) {
        if (retry.schemaVersion !== 1 || retry.canonicalPayloadVersion !== CANONICAL_PAYLOAD_VERSION ||
            retry.hashAlgorithmVersion !== HASH_ALGORITHM_VERSION || retry.actorId !== actor.uid ||
            retry.orgId !== scope.orgId || retry.scopeIdentity !== canonicalScopeIdentity(scope) ||
            retry.operation !== 'journal.post' || retry.requestId !== command.requestId || retry.expiresAt <= this.now()) {
          throw new FinanceValidationError('Idempotency metadata is invalid, mismatched, or expired')
        }
        if (retry.payloadDigest !== payloadDigest) throw new FinanceValidationError('Idempotency key payload mismatch')
        const originalResult = state.journals.get(retry.aggregateId)
        if (!originalResult || originalResult.orgId !== scope.orgId || originalResult.legalEntityId !== scope.legalEntityId ||
            originalResult.bookId !== scope.bookId || originalResult.idempotencyKey !== command.idempotencyKey ||
            canonicalDigest(originalResult.lines) !== originalResult.lineDigest) {
          throw new FinanceValidationError('Idempotency result is missing or corrupt')
        }
        return originalResult
      }
      assertCreate(command.expectedVersion, state.journals.get(command.id), 'Journal')
      const book = state.books.get(command.bookId)
      const period = state.periods.get(command.periodId)
      if (!book) throw new FinanceValidationError('Accounting book not found in scope')
      if (!period) throw new FinanceValidationError('Accounting period not found in scope')
      const policy = resolveUniqueEffectivePolicy([...state.policies.values()].filter((candidate) =>
        candidate.orgId === scope.orgId && candidate.legalEntityId === scope.legalEntityId && candidate.bookId === scope.bookId),
      command.postingDate, command.policyVersionId)
      const accounts = command.lines.map((line) => state.accounts.get(line.accountId)).filter(Boolean) as LedgerAccount[]
      const expectedApprovalAction = command.reversesJournalEntryId ? 'journal.reverse' as const : 'journal.post' as const
      const approvalSubject = approvedSubjectDigest ?? financeApprovalSubjectDigest(expectedApprovalAction, command)
      const approval = loadApproval(state, command.approvalId, scope, expectedApprovalAction, actor.uid, approvalSubject, this.now())
      const adjustmentApproval = command.adjustmentApprovalId
        ? loadApproval(state, command.adjustmentApprovalId, scope, 'period.adjust', actor.uid,
          financeApprovalSubjectDigest('period.adjust', command), this.now())
        : undefined
      validatePostingContext({ scope, journalId: command.id, periodId: command.periodId,
        postingDate: command.postingDate, currency: command.currency, sourceType: command.sourceType, actorId: actor.uid,
        approval, adjustmentApproved: Boolean(adjustmentApproval), expectedApprovalAction,
        book, period, policy, lines: command.lines, accounts })
      const sourceKey = [command.sourceType, command.sourceId, command.sourceVersion, command.postingPurpose]
      claim(state, 'posting_source', scope, sourceKey, command.id, 'Posting source already exists')
      if (command.reversesJournalEntryId) claim(state, 'journal_reversal', scope, command.reversesJournalEntryId,
        command.id, 'Journal already has a direct reversal')
      const entryNumber = (state.sequenceByBook.get(canonicalScopeIdentity(scope)) ?? 0) + 1
      state.sequenceByBook.set(canonicalScopeIdentity(scope), entryNumber)
      const now = this.now()
      const lines: JournalLine[] = command.lines.map((line, index) => ({ ...allowlistedJournalLine(line), ...scope,
        periodId: command.periodId, id: `${command.id}_${String(index + 1).padStart(4, '0')}`,
        journalEntryId: command.id, sequence: index + 1 }))
      const lineDigest = canonicalDigest(lines)
      const base = compact({ ...scope, id: command.id, periodId: command.periodId,
        sourceType: requiredText(command.sourceType, 'sourceType'), sourceId: requiredText(command.sourceId, 'sourceId'),
        sourceVersion: command.sourceVersion, postingPurpose: requiredText(command.postingPurpose, 'postingPurpose'),
        entryNumber, entryType: requiredText(command.entryType, 'entryType'), postingDate: command.postingDate,
        documentDate: command.documentDate, status: 'posted' as const, description: requiredText(command.description, 'description'),
        currency: command.currency.toUpperCase(), policyVersionId: policy.id, accountingBasis: policy.accountingBasis,
        totalDebitMinor: lines.reduce((total, line) => total + line.debitMinor, 0),
        totalCreditMinor: lines.reduce((total, line) => total + line.creditMinor, 0), lines, lineDigest,
        reversesJournalEntryId: command.reversesJournalEntryId, reversalReason: command.reversalReason,
        approvalId: approval.approvalId, approvalActorId: approval.approvedBy, approvedAt: approval.approvedAt,
        requestId: command.requestId, idempotencyKey: command.idempotencyKey, correlationId: actor.correlationId,
        delegationId: actor.delegationId, immutable: true as const, canonicalPayloadVersion: CANONICAL_PAYLOAD_VERSION,
        hashAlgorithmVersion: HASH_ALGORITHM_VERSION, schemaVersion: 1 as const, version: 1,
        createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid }) as Omit<PostedJournalEntry, 'contentHash'>
      const journal: PostedJournalEntry = { ...base, contentHash: canonicalDigest(base) }
      state.journals.set(journal.id, journal)
      storeIdempotency(state, actor, scope, 'journal.post', command, journal.id,
        idempotencyClaim, payloadDigest, now)
      appendEvidence(state, actor, scope, 'journal_entry', journal.id, 1, 'finance.journal.posted.v1', now,
        { requestId: command.requestId, idempotencyKey: command.idempotencyKey, reason: approval.reason,
          approval, aggregateDigest: journal.contentHash })
      return journal
    })
  }

  async reverseJournal(actor: FinanceActorContext, command: ReverseJournalCommand): Promise<PostedJournalEntry> {
    assertCreateVersion(command.expectedVersion, 'Journal reversal')
    const original = this.store.journals.get(command.originalJournalId)
    if (!original || original.status !== 'posted' || !original.immutable ||
        original.orgId !== command.orgId || original.legalEntityId !== command.legalEntityId || original.bookId !== command.bookId) {
      throw new FinanceValidationError('Original posted journal not found in exact scope')
    }
    assertPostedJournalContentHash(original)
    authorizeFinanceAction(actor, original, 'journal.reverse', this.now())
    const reason = requiredText(command.reason, 'reason')
    return this.commitJournal(actor, {
      id: command.reversalJournalId, orgId: original.orgId, legalEntityId: original.legalEntityId,
      bookId: original.bookId, periodId: command.periodId, sourceType: 'journal_reversal', sourceId: original.id,
      sourceVersion: original.version, postingPurpose: 'reversal', entryType: 'reversal', postingDate: command.postingDate,
      documentDate: command.postingDate, description: `Reversal of ${original.description}`, currency: original.currency,
      policyVersionId: original.policyVersionId, expectedVersion: command.expectedVersion, requestId: command.requestId,
      idempotencyKey: command.idempotencyKey, approvalId: command.approvalId, lines: buildReversalLines(original.lines),
      reversesJournalEntryId: original.id, reversalReason: reason,
    }, financeApprovalSubjectDigest('journal.reverse', command))
  }
}
