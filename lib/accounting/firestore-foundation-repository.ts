import type { DocumentData, DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { authorizeFinanceAction, effectiveFinanceAssignments, parseIsoTimestamp, type FinanceAction } from '@/lib/finance/policy'
import { revalidateFinanceActorInTransaction } from '@/lib/finance/firestore-context'
import {
  CANONICAL_PAYLOAD_VERSION,
  HASH_ALGORITHM_VERSION,
  canonicalDigest,
  canonicalScopeIdentity,
  financeScopeKey,
  scopedClaimId,
  scopedStorageId,
} from '@/lib/finance/integrity'
import type {
  FinanceActorContext,
  FinanceApprovalAction,
  FinanceApprovalEvidence,
  FinanceApprovalRecord,
  FinanceScope,
} from '@/lib/finance/types'
import {
  assertSafeInteger,
  allowlistedJournalLine,
  assertClosedPostJournalCommand,
  assertCreateVersion,
  assertDefaultControlAccountConfiguration,
  assertEnumValue,
  assertImmutableContentHash,
  assertPostedJournalContentHash,
  assertStoredLineIdentity,
  buildReversalLines,
  FinanceValidationError,
  immutableContentHash,
  parseCanonicalDate,
  policyRangesOverlap,
  requiredText,
  resolveUniqueEffectivePolicy,
  validatePostingContext,
} from './foundation'
import type {
  ChangePeriodStatusCommand,
  CreateAccountCommand,
  CreateBookCommand,
  CreateBookPolicyVersionCommand,
  CreateBranchCommand,
  CreateFinanceApprovalCommand,
  CreateLegalEntityCommand,
  CreatePeriodCommand,
  PostJournalCommand,
  ReverseJournalCommand,
} from './foundation-service'
import { financeApprovalSubjectDigest } from './foundation-service'
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

interface FirestoreRepositoryOptions { db?: Firestore; now?: () => string }
interface EvidenceMetadata {
  requestId?: string; idempotencyKey?: string; reason?: string
  approval?: FinanceApprovalEvidence; aggregateDigest?: string
  deferredWrite?: (tx: Transaction) => void
}
interface CommandIdentity { requestId: string; idempotencyKey: string }

function exactScope(data: DocumentData | undefined, scope: FinanceScope, resource: string, expectedId?: string): void {
  if (!data || data.orgId !== scope.orgId || data.legalEntityId !== scope.legalEntityId ||
      data.bookId !== scope.bookId || (expectedId !== undefined && data.id !== expectedId)) {
    throw new FinanceValidationError(`${resource} not found in exact scope`)
  }
}
function entityScope(data: DocumentData | undefined, scope: Omit<FinanceScope, 'bookId'>, resource: string, expectedId?: string): void {
  if (!data || data.orgId !== scope.orgId || data.legalEntityId !== scope.legalEntityId ||
      (expectedId !== undefined && data.id !== expectedId)) {
    throw new FinanceValidationError(`${resource} not found in entity scope`)
  }
}
function record<T>(snapshot: { exists: boolean; data(): DocumentData | undefined }, resource: string): T {
  if (!snapshot.exists) throw new FinanceValidationError(`${resource} not found in scope`)
  return snapshot.data() as T
}
function clean<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clean) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined).map(([key, item]) => [key, clean(item)])) as T
  }
  return value
}
function storageRef(db: Firestore, collection: string, scope: FinanceScope, logicalId: string): DocumentReference {
  return db.collection(collection).doc(scopedStorageId(scope, logicalId))
}
function approvalPolicyAction(action: FinanceApprovalAction): FinanceAction {
  return action
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

export class FirestoreFinanceFoundationRepository {
  private readonly db: Firestore
  private readonly now: () => string

  constructor(options: FirestoreRepositoryOptions = {}) {
    this.db = options.db ?? adminDb
    this.now = options.now ?? (() => new Date().toISOString())
  }

  async createLegalEntity(actor: FinanceActorContext, command: CreateLegalEntityCommand): Promise<LegalEntity> {
    const scope = { orgId: command.orgId, legalEntityId: command.id }
    assertCreateVersion(command.expectedVersion, 'Legal entity')
    authorizeFinanceAction(actor, scope, 'foundation.configure', this.now())
    if (!Number.isInteger(command.fiscalYearStartMonth) || command.fiscalYearStartMonth < 1 || command.fiscalYearStartMonth > 12) {
      throw new FinanceValidationError('fiscalYearStartMonth must be between 1 and 12')
    }
    assertEnumValue(command.defaultAccountingBasis, ['cash', 'accrual'], 'defaultAccountingBasis')
    assertEnumValue(command.status, ['draft', 'active'], 'legalEntity.status')
    const now = this.now(); const code = requiredText(command.code, 'code').toUpperCase()
    const entity: LegalEntity = {
      ...scope, id: command.id, code, legalName: requiredText(command.legalName, 'legalName'),
      jurisdictionCode: requiredText(command.jurisdictionCode, 'jurisdictionCode').toUpperCase(),
      functionalCurrency: requiredText(command.functionalCurrency, 'functionalCurrency').toUpperCase(),
      defaultAccountingBasis: command.defaultAccountingBasis, fiscalYearStartMonth: command.fiscalYearStartMonth,
      timezone: requiredText(command.timezone, 'timezone'), status: command.status, schemaVersion: 1, version: 1,
      createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid,
    }
    return this.createWithClaim(actor, 'legal_entities', entity, command, 'legal-entity.create', 'entity_code',
      { orgId: scope.orgId, legalEntityId: '__organization_scope__' }, code, 'legal_entity',
      'finance.legal-entity.created.v1')
  }

  /** API-route aliases for the durable createFinanceApproval / changePeriodStatus implementations. */
  async createApproval(actor: FinanceActorContext, command: CreateFinanceApprovalCommand): Promise<FinanceApprovalRecord> {
    return this.createFinanceApproval(actor, command)
  }

  async closePeriod(actor: FinanceActorContext, command: ChangePeriodStatusCommand): Promise<AccountingPeriod> {
    return this.changePeriodStatus(actor, { ...command, status: 'soft_closed' })
  }

  async reopenPeriod(actor: FinanceActorContext, command: ChangePeriodStatusCommand): Promise<AccountingPeriod> {
    return this.changePeriodStatus(actor, { ...command, status: 'open' })
  }

  async createBranch(actor: FinanceActorContext, command: CreateBranchCommand): Promise<FinanceBranch> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId }
    assertCreateVersion(command.expectedVersion, 'Branch')
    authorizeFinanceAction(actor, scope, 'foundation.configure', this.now())
    assertEnumValue(command.status, ['active'], 'branch.status')
    const now = this.now(); const code = requiredText(command.code, 'code').toUpperCase()
    const branch: FinanceBranch = {
      ...scope, id: command.id, code, name: requiredText(command.name, 'name'), status: command.status,
      reportingOnly: command.reportingOnly, schemaVersion: 1, version: 1,
      createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid,
    }
    const parentRef = storageRef(this.db, 'legal_entities', scope, command.legalEntityId)
    return this.createWithClaim(actor, 'finance_branches', branch, command, 'branch.create', 'branch_code', scope,
      code, 'finance_branch', 'finance.branch.created.v1', async (tx) => {
        const parent = await tx.get(parentRef)
        entityScope(parent.data(), scope, 'Legal entity', command.legalEntityId)
        if (parent.data()?.status !== 'active') throw new FinanceValidationError('Legal entity is not active')
      })
  }

  async createBook(actor: FinanceActorContext, command: CreateBookCommand): Promise<AccountingBook> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.id }
    assertCreateVersion(command.expectedVersion, 'Accounting book')
    authorizeFinanceAction(actor, scope, 'foundation.configure', this.now())
    assertEnumValue(command.bookType, ['primary', 'branch', 'management', 'consolidation'], 'bookType')
    assertEnumValue(command.accountingBasis, ['cash', 'accrual'], 'accountingBasis')
    assertEnumValue(command.status, ['draft', 'active'], 'book.status')
    if (command.status === 'active' && !command.cutoverAt) throw new FinanceValidationError('Active book requires cutoverAt')
    if (command.cutoverAt) parseCanonicalDate(command.cutoverAt, 'cutoverAt')
    const now = this.now(); const code = requiredText(command.code, 'code').toUpperCase()
    const book: AccountingBook = {
      ...scope, id: command.id, code, name: requiredText(command.name, 'name'), branchId: command.branchId,
      bookType: command.bookType, functionalCurrency: requiredText(command.functionalCurrency, 'functionalCurrency').toUpperCase(),
      accountingBasis: command.accountingBasis, jurisdictionCode: requiredText(command.jurisdictionCode, 'jurisdictionCode').toUpperCase(),
      taxPointPolicyId: requiredText(command.taxPointPolicyId, 'taxPointPolicyId'),
      defaultControlAccountIds: clean(command.defaultControlAccountIds), status: command.status, cutoverAt: command.cutoverAt,
      schemaVersion: 1, version: 1, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid,
    }
    const entityScopeValue = { orgId: scope.orgId, legalEntityId: scope.legalEntityId }
    const entityRef = storageRef(this.db, 'legal_entities', entityScopeValue, command.legalEntityId)
    const branchRef = command.branchId
      ? storageRef(this.db, 'finance_branches', entityScopeValue, command.branchId)
      : null
    return this.createWithClaim(actor, 'accounting_books', book, command, 'book.create', 'book_code', entityScopeValue,
      code, 'accounting_book', 'finance.book.created.v1', async (tx) => {
        const refs = branchRef ? [entityRef, branchRef] : [entityRef]
        const snapshots = await tx.getAll(...refs)
        entityScope(snapshots[0].data(), entityScopeValue, 'Legal entity', command.legalEntityId)
        if (snapshots[0].data()?.status !== 'active') throw new FinanceValidationError('Legal entity is not active')
        if (branchRef) {
          entityScope(snapshots[1].data(), entityScopeValue, 'Branch', command.branchId)
          if (snapshots[1].data()?.status !== 'active') throw new FinanceValidationError('Branch is not active')
        }
      })
  }

  async createFinanceApproval(
    approver: FinanceActorContext,
    command: CreateFinanceApprovalCommand,
  ): Promise<FinanceApprovalRecord> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    const action = approvalPolicyAction(command.action)
    const now = this.now()
    assertCreateVersion(command.expectedVersion, 'Finance approval')
    authorizeFinanceAction(approver, scope, action, now)
    requiredText(command.subjectDigest, 'subjectDigest'); requiredText(command.reason, 'reason')
    if (!/^[a-f0-9]{64}$/.test(command.subjectDigest)) throw new FinanceValidationError('subjectDigest must be SHA-256')
    assertFutureApprovalExpiry(command.expiresAt, now)
    const ref = storageRef(this.db, 'finance_approvals', scope, command.id)
    const idemRef = this.idempotencyRef(approver, scope, command.idempotencyKey)
    const payloadDigest = canonicalDigest(clean(command))
    return this.db.runTransaction(async (tx) => {
      const persistedActor = await revalidateFinanceActorInTransaction(tx, this.db, approver, scope, action, now)
      const [existing, idem] = await tx.getAll(ref, idemRef)
      if (idem.exists) {
        this.assertIdempotency(idem.data(), persistedActor, scope, 'finance.approval.create', command, payloadDigest, now)
        const stored = this.idempotentSnapshot<FinanceApprovalRecord>(idem.data(), 'approval')
        exactScope(stored, scope, 'Idempotency approval result', command.id)
        if (!stored.immutable || stored.schemaVersion !== 1) throw new FinanceValidationError('Idempotency approval result is corrupt')
        return stored
      }
      if (existing.exists) throw new FinanceValidationError('Finance approval already exists')
      const book = await tx.get(storageRef(this.db, 'accounting_books', scope, command.bookId))
      exactScope(book.data(), scope, 'Accounting book', command.bookId)
      const assignment = effectiveFinanceAssignments(persistedActor, scope, now)
        .find((candidate) => candidate.role === 'finance_approver' || candidate.role === 'finance_admin')
      if (!assignment) throw new FinanceValidationError('Approval requires an effective finance approver assignment')
      const approvalBase = clean({
        ...scope, id: command.id, schemaVersion: 1, action: command.action, status: 'approved',
        approvedBy: persistedActor.uid, approverRole: assignment.role, approverAssignmentId: assignment.id,
        approvedAt: now, reason: command.reason.trim(), subjectDigest: command.subjectDigest,
        expiresAt: command.expiresAt, immutable: true, canonicalPayloadVersion: CANONICAL_PAYLOAD_VERSION,
        hashAlgorithmVersion: HASH_ALGORITHM_VERSION,
      })
      const approval: FinanceApprovalRecord = { ...approvalBase, contentHash: immutableContentHash(approvalBase) } as FinanceApprovalRecord
      const evidence = await this.prepareEvidence(tx, persistedActor, scope, 'finance_approval', approval.id, 1,
        'finance.approval.recorded.v1', now, { reason: approval.reason, aggregateDigest: canonicalDigest(approval) })
      tx.create(ref, approval)
      tx.create(idemRef, this.idempotencyData(persistedActor, scope, 'finance.approval.create', command, payloadDigest,
        approval.id, now, approval))
      this.writeEvidence(tx, evidence)
      return approval
    })
  }

  async createBookPolicyVersion(
    actor: FinanceActorContext,
    command: CreateBookPolicyVersionCommand,
  ): Promise<BookPolicyVersion> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    assertCreateVersion(command.expectedVersion, 'Book policy version')
    authorizeFinanceAction(actor, scope, 'foundation.configure', this.now())
    assertSafeInteger(command.versionNumber, 'versionNumber', 1)
    assertEnumValue(command.accountingBasis, ['cash', 'accrual'], 'policy.accountingBasis')
    if (!Number.isInteger(command.currencyPrecision) || command.currencyPrecision < 0 || command.currencyPrecision > 6) {
      throw new FinanceValidationError('Policy currencyPrecision is invalid')
    }
    const from = parseCanonicalDate(command.effectiveFrom, 'effectiveFrom')
    const to = command.effectiveTo ? parseCanonicalDate(command.effectiveTo, 'effectiveTo') : undefined
    if (to !== undefined && to < from) throw new FinanceValidationError('Policy effective range is invalid')
    const now = this.now()
    const policy: BookPolicyVersion = {
      ...scope, id: command.id, versionNumber: command.versionNumber, accountingBasis: command.accountingBasis,
      taxPointPolicyId: command.taxPointPolicyId, currencyPrecision: command.currencyPrecision,
      roundingMode: command.roundingMode, effectiveFrom: command.effectiveFrom, effectiveTo: command.effectiveTo,
      status: 'approved', approvalId: command.approvalId, approvalActorId: '', approvedAt: '', immutable: true,
      contentHash: '',
      schemaVersion: 1, version: 1, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid,
    }
    const bookRef = storageRef(this.db, 'accounting_books', scope, command.bookId)
    const calendarRef = this.db.collection('finance_policy_calendar_heads').doc(financeScopeKey(scope))
    const policiesQuery = this.db.collection('book_policy_versions').where('orgId', '==', scope.orgId)
      .where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId)
    return this.createWithClaim(actor, 'book_policy_versions', policy, command, 'book-policy.create',
      'book_policy_version', scope, command.versionNumber, 'book_policy_version', 'finance.book-policy.approved.v1',
      async (tx, persistedActor) => {
        const approval = await this.loadApproval(tx, command.approvalId, scope, 'book-policy.approve', persistedActor.uid,
          financeApprovalSubjectDigest('book-policy.approve', command), now)
        const [snap, calendarSnap, policiesSnap] = await Promise.all([
          tx.get(bookRef), tx.get(calendarRef), tx.get(policiesQuery),
        ])
        const book = record<AccountingBook>(snap, 'Accounting book')
        exactScope(book, scope, 'Accounting book', command.bookId)
        if (calendarSnap.exists) exactScope(calendarSnap.data(), scope, 'Policy calendar head')
        if (policiesSnap.docs.some((doc) => policyRangesOverlap(doc.data() as BookPolicyVersion, policy))) {
          throw new FinanceValidationError('Approved book policy effective range overlaps an existing policy')
        }
        policy.approvalId = approval.approvalId; policy.approvalActorId = approval.approvedBy; policy.approvedAt = approval.approvedAt
        policy.createdBy = persistedActor.uid; policy.updatedBy = persistedActor.uid
        return { approval, reason: approval.reason, aggregateDigest: canonicalDigest(clean(policy)),
          deferredWrite: (transaction: Transaction) => transaction.set(calendarRef,
            { ...scope, revision: Number(calendarSnap.data()?.revision ?? 0) + 1, updatedAt: now }, { merge: false }) }
      })
  }

  async createPeriod(actor: FinanceActorContext, command: CreatePeriodCommand): Promise<AccountingPeriod> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    assertCreateVersion(command.expectedVersion, 'Accounting period')
    authorizeFinanceAction(actor, scope, 'foundation.configure', this.now())
    assertSafeInteger(command.fiscalYear, 'fiscalYear', 1); assertSafeInteger(command.periodNumber, 'periodNumber', 1)
    const starts = parseCanonicalDate(command.startsAt, 'startsAt'); const ends = parseCanonicalDate(command.endsAt, 'endsAt')
    if (starts > ends) throw new FinanceValidationError('Period start must not be after period end')
    assertEnumValue(command.status, ['open'], 'period.status')
    const now = this.now()
    const period: AccountingPeriod = {
      ...scope, id: command.id, fiscalYear: command.fiscalYear, periodNumber: command.periodNumber,
      startsAt: command.startsAt, endsAt: command.endsAt, status: command.status, schemaVersion: 1, version: 1,
      createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid,
    }
    const recordRef = storageRef(this.db, 'accounting_periods', scope, period.id)
    const claimRef = this.db.collection('finance_unique_claims').doc(scopedClaimId('book_period_number', scope,
      [command.fiscalYear, command.periodNumber]))
    const idemRef = this.idempotencyRef(actor, scope, command.idempotencyKey)
    const bookRef = storageRef(this.db, 'accounting_books', scope, command.bookId)
    const calendarRef = this.db.collection('finance_calendar_heads').doc(financeScopeKey(scope))
    const overlapQuery = this.db.collection('accounting_periods').where('orgId', '==', scope.orgId)
      .where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId)
    const payloadDigest = canonicalDigest(clean(command))
    return this.db.runTransaction(async (tx) => {
      const persistedActor = await revalidateFinanceActorInTransaction(tx, this.db, actor, scope, 'foundation.configure', now)
      const [existing, claimSnap, idemSnap, bookSnap, calendarSnap, periodsSnap] = await Promise.all([
        tx.get(recordRef), tx.get(claimRef), tx.get(idemRef), tx.get(bookRef), tx.get(calendarRef), tx.get(overlapQuery),
      ])
      if (idemSnap.exists) {
        this.assertIdempotency(idemSnap.data(), persistedActor, scope, 'period.create', command, payloadDigest, now)
        const stored = this.idempotentSnapshot<AccountingPeriod>(idemSnap.data(), 'period create')
        exactScope(stored, scope, 'Idempotency period result', command.id)
        return stored
      }
      if (existing.exists) throw new FinanceValidationError('Accounting period already exists')
      if (claimSnap.exists) throw new FinanceValidationError('Accounting period number already exists')
      const book = record<AccountingBook>(bookSnap, 'Accounting book'); exactScope(book, scope, 'Accounting book', command.bookId)
      if (calendarSnap.exists) exactScope(calendarSnap.data(), scope, 'Finance calendar head')
      if (periodsSnap.docs.some((doc) => {
        const other = doc.data() as AccountingPeriod
        return starts <= parseCanonicalDate(other.endsAt, 'period.endsAt') && ends >= parseCanonicalDate(other.startsAt, 'period.startsAt')
      })) throw new FinanceValidationError('Accounting period overlaps an existing period')
      period.createdBy = persistedActor.uid; period.updatedBy = persistedActor.uid
      const evidence = await this.prepareEvidence(tx, persistedActor, scope, 'accounting_period', period.id, 1,
        'finance.period.created.v1', now, { aggregateDigest: canonicalDigest(period) })
      tx.create(claimRef, clean({ schemaVersion: 1, claimType: 'book_period_number', normalizedKey: [command.fiscalYear, command.periodNumber],
        ...scope, aggregateId: period.id, createdAt: now, createdBy: persistedActor.uid }))
      tx.create(idemRef, this.idempotencyData(persistedActor, scope, 'period.create', command, payloadDigest, period.id, now, period))
      tx.create(recordRef, period)
      tx.set(calendarRef, { ...scope, revision: Number(calendarSnap.data()?.revision ?? 0) + 1, updatedAt: now }, { merge: false })
      this.writeEvidence(tx, evidence)
      return period
    })
  }

  async createAccount(actor: FinanceActorContext, command: CreateAccountCommand): Promise<LedgerAccount> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    assertCreateVersion(command.expectedVersion, 'Ledger account')
    authorizeFinanceAction(actor, scope, 'foundation.configure', this.now())
    assertEnumValue(command.accountType, ['asset', 'liability', 'equity', 'income', 'expense'], 'accountType')
    assertEnumValue(command.normalBalance, ['debit', 'credit'], 'normalBalance')
    if (command.controlAccountRole !== undefined) assertEnumValue(command.controlAccountRole,
      ['receivables', 'payables', 'tax', 'payroll', 'bank', 'retained_earnings'], 'controlAccountRole')
    assertEnumValue(command.currencyPolicy, ['functional_only', 'fixed_currency'], 'currencyPolicy')
    if (typeof command.postingAllowed !== 'boolean') throw new FinanceValidationError('postingAllowed must be boolean')
    const from = parseCanonicalDate(command.activeFrom, 'activeFrom')
    const to = command.activeTo ? parseCanonicalDate(command.activeTo, 'activeTo') : undefined
    if (to !== undefined && to < from) throw new FinanceValidationError('Account active range is invalid')
    const now = this.now(); const code = requiredText(command.code, 'code').toUpperCase()
    const account: LedgerAccount = {
      ...scope, id: command.id, code, name: requiredText(command.name, 'name'), accountType: command.accountType,
      normalBalance: command.normalBalance, parentAccountId: command.parentAccountId,
      controlAccountRole: command.controlAccountRole, currency: requiredText(command.currency, 'currency').toUpperCase(),
      currencyPolicy: command.currencyPolicy, reportMapping: requiredText(command.reportMapping, 'reportMapping'),
      postingAllowed: command.postingAllowed, activeFrom: command.activeFrom, activeTo: command.activeTo,
      schemaVersion: 1, version: 1, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid,
    }
    const bookRef = storageRef(this.db, 'accounting_books', scope, command.bookId)
    const parentRef = command.parentAccountId ? storageRef(this.db, 'ledger_accounts', scope, command.parentAccountId) : null
    return this.createWithClaim(actor, 'ledger_accounts', account, command, 'account.create', 'account_code', scope, code,
      'ledger_account', 'finance.account.created.v1', async (tx) => {
        const refs = parentRef ? [bookRef, parentRef] : [bookRef]; const snaps = await tx.getAll(...refs)
        const book = record<AccountingBook>(snaps[0], 'Accounting book')
        exactScope(book, scope, 'Accounting book', command.bookId)
        assertDefaultControlAccountConfiguration(book, account)
        if (parentRef) exactScope(snaps[1].data(), scope, 'Parent account', command.parentAccountId)
      })
  }

  async changePeriodStatus(actor: FinanceActorContext, command: ChangePeriodStatusCommand): Promise<AccountingPeriod> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    const operation = command.status === 'open' ? 'period.reopen' as const : 'period.close' as const
    authorizeFinanceAction(actor, scope, operation, this.now())
    const reason = requiredText(command.reason, 'reason'); const now = this.now()
    const ref = storageRef(this.db, 'accounting_periods', scope, command.periodId)
    const idemRef = this.idempotencyRef(actor, scope, command.idempotencyKey)
    const payloadDigest = canonicalDigest(clean(command))
    return this.db.runTransaction(async (tx) => {
      const persistedActor = await revalidateFinanceActorInTransaction(tx, this.db, actor, scope, operation, now)
      const [snap, idemSnap] = await tx.getAll(ref, idemRef)
      const period = record<AccountingPeriod>(snap, 'Accounting period')
      exactScope(period, scope, 'Accounting period', command.periodId)
      if (idemSnap.exists) {
        this.assertIdempotency(idemSnap.data(), persistedActor, scope, operation, command, payloadDigest, now)
        return this.idempotentSnapshot<AccountingPeriod>(idemSnap.data(), 'period transition')
      }
      if (period.version !== command.expectedVersion) throw new FinanceValidationError('Accounting period version conflict')
      const reopening = period.status !== 'open' && command.status === 'open'
      const approvalAction = reopening ? 'period.reopen' as const : 'period.close' as const
      const approval = await this.loadApproval(tx, command.approvalId, scope, approvalAction, persistedActor.uid,
        financeApprovalSubjectDigest(approvalAction, command), now)
      const transitions: Record<AccountingPeriod['status'], AccountingPeriod['status'][]> = {
        open: ['soft_closed', 'hard_closed'], soft_closed: ['open', 'hard_closed'], hard_closed: ['open'],
      }
      if (!transitions[period.status].includes(command.status)) throw new FinanceValidationError('Invalid accounting period transition')
      const updated: AccountingPeriod = clean({
        ...period, status: command.status, version: period.version + 1, updatedAt: now, updatedBy: persistedActor.uid,
        reopenedAt: reopening ? now : period.reopenedAt,
        reopenApprovalId: reopening ? approval.approvalId : period.reopenApprovalId,
        closeApprovalId: reopening ? period.closeApprovalId : approval.approvalId,
      })
      const evidence = await this.prepareEvidence(tx, persistedActor, scope, 'accounting_period', period.id, updated.version,
        'finance.period.status-changed.v1', now, { requestId: command.requestId, idempotencyKey: command.idempotencyKey,
          reason, approval, aggregateDigest: canonicalDigest(updated) })
      tx.create(idemRef, this.idempotencyData(persistedActor, scope, operation, command, payloadDigest, updated.id, now, updated))
      tx.set(ref, updated, { merge: false }); this.writeEvidence(tx, evidence); return updated
    })
  }

  async postJournal(actor: FinanceActorContext, command: PostJournalCommand): Promise<PostedJournalEntry> {
    assertClosedPostJournalCommand(command)
    assertCreateVersion(command.expectedVersion, 'Journal')
    if (command.reversesJournalEntryId || command.sourceType === 'journal_reversal') {
      throw new FinanceValidationError('Reversals and journal_reversal sourceType must use reverseJournal')
    }
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    authorizeFinanceAction(actor, scope, 'journal.post', this.now())
    return this.db.runTransaction((tx) => this.postInTransaction(tx, actor, command))
  }

  async reverseJournal(actor: FinanceActorContext, command: ReverseJournalCommand): Promise<PostedJournalEntry> {
    assertCreateVersion(command.expectedVersion, 'Journal reversal')
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    const reason = requiredText(command.reason, 'reason')
    return this.db.runTransaction(async (tx) => {
      const originalRef = storageRef(this.db, 'journal_entries', scope, command.originalJournalId)
      const originalSnap = await tx.get(originalRef); const original = record<PostedJournalEntry>(originalSnap, 'Original posted journal')
      exactScope(original, scope, 'Original posted journal', command.originalJournalId)
      if (original.status !== 'posted' || !original.immutable) throw new FinanceValidationError('Original journal is not posted and immutable')
      const lineSnap = await tx.get(this.db.collection('journal_lines').where('orgId', '==', scope.orgId)
        .where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId)
        .where('journalEntryId', '==', original.id))
      const originalLines = lineSnap.docs.map((doc) => doc.data() as JournalLine).sort((a, b) => a.sequence - b.sequence)
      assertStoredLineIdentity(original.id, original.periodId, originalLines)
      if (canonicalDigest(originalLines) !== original.lineDigest) throw new FinanceValidationError('Original journal line digest does not match')
      assertPostedJournalContentHash({ ...original, lines: originalLines })
      const policyCandidatesSnap = await tx.get(this.db.collection('book_policy_versions')
        .where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId))
      const postingEpoch = parseCanonicalDate(command.postingDate, 'postingDate')
      const effectivePolicies = policyCandidatesSnap.docs.map((doc) => doc.data() as BookPolicyVersion)
        .filter((policy) => policy.status === 'approved' && policy.immutable &&
          postingEpoch >= parseCanonicalDate(policy.effectiveFrom, 'policy.effectiveFrom') &&
          (!policy.effectiveTo || postingEpoch <= parseCanonicalDate(policy.effectiveTo, 'policy.effectiveTo')))
      if (effectivePolicies.length !== 1) {
        throw new FinanceValidationError('Reversal posting date must resolve to one unique approved policy')
      }
      return this.postInTransaction(tx, actor, {
        id: command.reversalJournalId, ...scope, periodId: command.periodId, sourceType: 'journal_reversal',
        sourceId: original.id, sourceVersion: original.version, postingPurpose: 'reversal', entryType: 'reversal',
        postingDate: command.postingDate, documentDate: command.postingDate,
        description: `Reversal of ${original.description}`, currency: original.currency,
        policyVersionId: effectivePolicies[0].id, expectedVersion: command.expectedVersion, requestId: command.requestId,
        idempotencyKey: command.idempotencyKey, approvalId: command.approvalId, lines: buildReversalLines(originalLines),
        reversesJournalEntryId: original.id, reversalReason: reason,
      }, financeApprovalSubjectDigest('journal.reverse', command))
    })
  }

  private async postInTransaction(
    tx: Transaction,
    actor: FinanceActorContext,
    command: PostJournalCommand,
    approvedSubjectDigest?: string,
  ): Promise<PostedJournalEntry> {
    requiredText(command.requestId, 'requestId'); requiredText(command.idempotencyKey, 'idempotencyKey')
    assertSafeInteger(command.sourceVersion, 'sourceVersion', 1)
    parseCanonicalDate(command.postingDate, 'postingDate'); parseCanonicalDate(command.documentDate, 'documentDate')
    if (command.sourceType === 'journal_reversal' && !command.reversesJournalEntryId) {
      throw new FinanceValidationError('journal_reversal sourceType must use reverseJournal')
    }
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    const action = command.reversesJournalEntryId ? 'journal.reverse' as const : 'journal.post' as const
    const now = this.now()
    const persistedActor = await revalidateFinanceActorInTransaction(tx, this.db, actor, scope, action, now)
    const payloadDigest = canonicalDigest(clean(command))
    const journalRef = storageRef(this.db, 'journal_entries', scope, command.id)
    const idempotencyRef = this.idempotencyRef(persistedActor, scope, command.idempotencyKey)
    const sourceRef = this.db.collection('finance_unique_claims').doc(scopedClaimId('posting_source',
      { orgId: scope.orgId, legalEntityId: scope.legalEntityId },
      [command.sourceType, command.sourceId, command.sourceVersion, command.postingPurpose]))
    const reversalRef = command.reversesJournalEntryId
      ? this.db.collection('finance_unique_claims').doc(scopedClaimId('journal_reversal', scope, command.reversesJournalEntryId))
      : null
    const sequenceRef = this.db.collection('finance_sequences').doc(`journal_${financeScopeKey(scope)}`)
    const policiesQuery = this.db.collection('book_policy_versions').where('orgId', '==', scope.orgId)
      .where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId)
    const refs: DocumentReference[] = [journalRef, idempotencyRef, sourceRef, sequenceRef,
      storageRef(this.db, 'accounting_books', scope, command.bookId),
      storageRef(this.db, 'accounting_periods', scope, command.periodId),
      storageRef(this.db, 'book_policy_versions', scope, command.policyVersionId),
      ...command.lines.map((line) => storageRef(this.db, 'ledger_accounts', scope, line.accountId))]
    if (reversalRef) refs.push(reversalRef)
    const [snaps, policyCandidatesSnap] = await Promise.all([tx.getAll(...refs), tx.get(policiesQuery)])
    const [journalSnap, idemSnap, sourceSnap, sequenceSnap, bookSnap, periodSnap] = snaps
    if (idemSnap.exists) {
      this.assertIdempotency(idemSnap.data(), persistedActor, scope, 'journal.post', command, payloadDigest, now)
      const resultId = idemSnap.data()?.aggregateId
      const existing = journalSnap.exists && resultId === command.id
        ? journalSnap
        : await tx.get(storageRef(this.db, 'journal_entries', scope, resultId))
      const stored = record<PostedJournalEntry>(existing, 'Idempotency result')
      exactScope(stored, scope, 'Idempotency result', resultId)
      const lineSnapshot = await tx.get(this.db.collection('journal_lines').where('orgId', '==', scope.orgId)
        .where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId)
        .where('journalEntryId', '==', resultId))
      const lines = lineSnapshot.docs.map((doc) => doc.data() as JournalLine).sort((left, right) => left.sequence - right.sequence)
      assertStoredLineIdentity(stored.id, stored.periodId, lines)
      if (canonicalDigest(lines) !== stored.lineDigest || stored.idempotencyKey !== command.idempotencyKey ||
          stored.requestId !== command.requestId || stored.canonicalPayloadVersion !== CANONICAL_PAYLOAD_VERSION ||
          stored.hashAlgorithmVersion !== HASH_ALGORITHM_VERSION) {
        throw new FinanceValidationError('Idempotency result metadata or line digest does not match')
      }
      const result = { ...stored, lines }
      assertPostedJournalContentHash(result)
      return result
    }
    if (journalSnap.exists) throw new FinanceValidationError('Journal already exists')
    if (sourceSnap.exists) throw new FinanceValidationError('Posting source already exists')
    if (reversalRef && snaps.at(-1)?.exists) throw new FinanceValidationError('Journal already has a direct reversal')
    if (sequenceSnap.exists) exactScope(sequenceSnap.data(), scope, 'Journal sequence head')
    const book = record<AccountingBook>(bookSnap, 'Accounting book')
    const entityScopeValue = { orgId: scope.orgId, legalEntityId: scope.legalEntityId }
    const entitySnap = await tx.get(storageRef(this.db, 'legal_entities', entityScopeValue, scope.legalEntityId))
    entityScope(entitySnap.data(), entityScopeValue, 'Legal entity', scope.legalEntityId)
    if (entitySnap.data()?.status !== 'active') throw new FinanceValidationError('Legal entity is not active')
    if (book.branchId) {
      const branchSnap = await tx.get(storageRef(this.db, 'finance_branches', entityScopeValue, book.branchId))
      entityScope(branchSnap.data(), entityScopeValue, 'Branch', book.branchId)
      if (branchSnap.data()?.status !== 'active') throw new FinanceValidationError('Branch is not active')
    }
    const period = record<AccountingPeriod>(periodSnap, 'Accounting period')
    const policy = resolveUniqueEffectivePolicy(
      policyCandidatesSnap.docs.map((doc) => doc.data() as BookPolicyVersion), command.postingDate, command.policyVersionId)
    const accountOffset = 7
    const accounts = command.lines.map((line, index) =>
      record<LedgerAccount>(snaps[accountOffset + index], `Ledger account ${line.accountId}`))
    const expectedApprovalAction = command.reversesJournalEntryId ? 'journal.reverse' as const : 'journal.post' as const
    const approval = await this.loadApproval(tx, command.approvalId, scope, expectedApprovalAction, persistedActor.uid,
      approvedSubjectDigest ?? financeApprovalSubjectDigest(expectedApprovalAction, command), now)
    const adjustmentApproval = command.adjustmentApprovalId
      ? await this.loadApproval(tx, command.adjustmentApprovalId, scope, 'period.adjust', persistedActor.uid,
        financeApprovalSubjectDigest('period.adjust', command), now)
      : undefined
    validatePostingContext({
      scope, journalId: command.id, periodId: command.periodId, postingDate: command.postingDate,
      currency: command.currency, sourceType: command.sourceType, actorId: persistedActor.uid, approval,
      adjustmentApproved: Boolean(adjustmentApproval), expectedApprovalAction,
      book, period, policy, lines: command.lines, accounts,
    })
    const entryNumber = Number(sequenceSnap.data()?.value ?? 0) + 1
    assertSafeInteger(entryNumber, 'entryNumber', 1)
    const lines: JournalLine[] = command.lines.map((line, index) => clean({
      ...allowlistedJournalLine(line), ...scope,
      periodId: command.periodId, id: `${command.id}_${String(index + 1).padStart(4, '0')}`,
      journalEntryId: command.id, sequence: index + 1,
    }))
    const lineDigest = canonicalDigest(lines)
    const base = clean({
      ...scope, id: command.id, periodId: command.periodId, sourceType: requiredText(command.sourceType, 'sourceType'),
      sourceId: requiredText(command.sourceId, 'sourceId'), sourceVersion: command.sourceVersion,
      postingPurpose: requiredText(command.postingPurpose, 'postingPurpose'), entryNumber,
      entryType: requiredText(command.entryType, 'entryType'), postingDate: command.postingDate,
      documentDate: command.documentDate, status: 'posted' as const,
      description: requiredText(command.description, 'description'), currency: command.currency.toUpperCase(),
      policyVersionId: policy.id, accountingBasis: policy.accountingBasis,
      totalDebitMinor: lines.reduce((sum, line) => sum + line.debitMinor, 0),
      totalCreditMinor: lines.reduce((sum, line) => sum + line.creditMinor, 0), lines, lineDigest,
      reversesJournalEntryId: command.reversesJournalEntryId, reversalReason: command.reversalReason,
      approvalId: approval.approvalId, approvalActorId: approval.approvedBy, approvedAt: approval.approvedAt,
      requestId: command.requestId, idempotencyKey: command.idempotencyKey,
      correlationId: persistedActor.correlationId, delegationId: persistedActor.delegationId,
      immutable: true as const, canonicalPayloadVersion: CANONICAL_PAYLOAD_VERSION,
      hashAlgorithmVersion: HASH_ALGORITHM_VERSION, schemaVersion: 1 as const, version: 1,
      createdAt: now, createdBy: persistedActor.uid, updatedAt: now, updatedBy: persistedActor.uid,
    })
    const journal: PostedJournalEntry = { ...base, contentHash: canonicalDigest(base) }
    const evidence = await this.prepareEvidence(tx, persistedActor, scope, 'journal_entry', journal.id, 1,
      'finance.journal.posted.v1', now, { requestId: command.requestId, idempotencyKey: command.idempotencyKey,
        reason: approval.reason, approval, aggregateDigest: journal.contentHash })
    tx.create(sourceRef, { schemaVersion: 1, claimType: 'posting_source', ...scope, aggregateId: journal.id,
      normalizedKey: [command.sourceType, command.sourceId, command.sourceVersion, command.postingPurpose],
      createdAt: now, createdBy: persistedActor.uid })
    if (reversalRef) tx.create(reversalRef, { schemaVersion: 1, claimType: 'journal_reversal', ...scope,
      aggregateId: journal.id, originalJournalId: command.reversesJournalEntryId, createdAt: now, createdBy: persistedActor.uid })
    tx.create(idempotencyRef, this.idempotencyData(persistedActor, scope, 'journal.post', command,
      payloadDigest, journal.id, now, journal))
    tx.set(sequenceRef, { ...scope, value: entryNumber, updatedAt: now }, { merge: false })
    tx.create(journalRef, clean({ ...journal, lines: undefined }))
    lines.forEach((line) => tx.create(storageRef(this.db, 'journal_lines', scope, line.id), line))
    this.writeEvidence(tx, evidence)
    return journal
  }

  private async loadApproval(
    tx: Transaction,
    approvalId: string | undefined,
    scope: Required<FinanceScope>,
    action: FinanceApprovalAction,
    actorId: string,
    subjectDigest: string,
    now: string,
  ): Promise<FinanceApprovalEvidence> {
    const id = requiredText(approvalId ?? '', 'approvalId')
    const snapshot = await tx.get(storageRef(this.db, 'finance_approvals', scope, id))
    const approval = snapshot.data() as FinanceApprovalRecord | undefined
    if (!snapshot.exists || !approval || approval.id !== id || approval.status !== 'approved' || !approval.immutable ||
        approval.schemaVersion !== 1 || approval.canonicalPayloadVersion !== CANONICAL_PAYLOAD_VERSION ||
        approval.hashAlgorithmVersion !== HASH_ALGORITHM_VERSION || approval.orgId !== scope.orgId ||
        approval.legalEntityId !== scope.legalEntityId || approval.bookId !== scope.bookId || approval.action !== action ||
        approval.subjectDigest !== subjectDigest ||
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
    assertImmutableContentHash(approval, 'Finance approval')
    const [approverMembership, approverAssignment] = await tx.getAll(
      this.db.collection('orgMembers').doc(`${scope.orgId}_${approval.approvedBy}`),
      this.db.collection('finance_role_assignments').doc(approval.approverAssignmentId),
    )
    const membership = approverMembership.data()
    const assignment = approverAssignment.data()
    const moduleEnabled = membership?.accessPolicy?.modules?.billing === true || membership?.accessPolicy?.modules?.finance === true
    const nowEpoch = parseIsoTimestamp(now, 'approval revalidation timestamp')
    const assignmentEffective = assignment?.status === 'active' &&
      (!assignment.effectiveFrom || parseIsoTimestamp(assignment.effectiveFrom, 'assignment.effectiveFrom') <= nowEpoch) &&
      (!assignment.effectiveTo || parseIsoTimestamp(assignment.effectiveTo, 'assignment.effectiveTo') >= nowEpoch)
    const assignmentCoversScope = assignment?.id === approval.approverAssignmentId &&
      assignment?.userId === approval.approvedBy && assignment?.orgId === scope.orgId &&
      assignment?.legalEntityId === scope.legalEntityId &&
      (assignment?.scopeMode === 'entity' || (assignment?.scopeMode === 'book' && assignment?.bookId === scope.bookId)) &&
      assignment?.role === approval.approverRole && ['finance_approver', 'finance_admin'].includes(assignment?.role)
    if (membership?.status !== 'active' || !moduleEnabled || !assignmentEffective || !assignmentCoversScope) {
      throw new FinanceValidationError('Persisted approval approver authority is no longer effective')
    }
    return { approvalId: approval.id, approvedBy: approval.approvedBy, approvedAt: approval.approvedAt,
      action: approval.action, reason: approval.reason }
  }

  private async createWithClaim<
    T extends { id: string; orgId: string; legalEntityId: string; bookId?: string; version: number; createdBy: string; updatedBy: string },
    C extends CommandIdentity & object,
  >(
    actor: FinanceActorContext,
    collection: string,
    value: T,
    command: C,
    operation: string,
    claimType: string,
    claimScope: FinanceScope,
    normalizedKey: unknown,
    aggregateType: string,
    eventType: string,
    validate?: (tx: Transaction, persistedActor: FinanceActorContext) => Promise<EvidenceMetadata | void>,
  ): Promise<T> {
    const scope: FinanceScope = clean({ orgId: value.orgId, legalEntityId: value.legalEntityId, bookId: value.bookId })
    const ref = storageRef(this.db, collection, scope, value.id)
    const claimRef = this.db.collection('finance_unique_claims').doc(scopedClaimId(claimType, claimScope, normalizedKey))
    const idemRef = this.idempotencyRef(actor, scope, command.idempotencyKey)
    const now = this.now(); const payloadDigest = canonicalDigest(clean(command))
    return this.db.runTransaction(async (tx) => {
      const persistedActor = await revalidateFinanceActorInTransaction(tx, this.db, actor, scope,
        'foundation.configure', now)
      const [existing, claimSnap, idemSnap] = await tx.getAll(ref, claimRef, idemRef)
      if (idemSnap.exists) {
        this.assertIdempotency(idemSnap.data(), persistedActor, scope, operation, command, payloadDigest, now)
        const stored = this.idempotentSnapshot<T>(idemSnap.data(), aggregateType)
        exactScope(stored, scope, `Idempotency ${aggregateType} result`, value.id)
        return stored
      }
      if (existing.exists) throw new FinanceValidationError(`${aggregateType} already exists`)
      if (claimSnap.exists) throw new FinanceValidationError(`${aggregateType} unique key already exists`)
      const metadata = await validate?.(tx, persistedActor) ?? {}
      value.createdBy = persistedActor.uid; value.updatedBy = persistedActor.uid
      if (aggregateType === 'book_policy_version') {
        ;(value as unknown as BookPolicyVersion).contentHash = immutableContentHash(value)
      }
      const evidence = await this.prepareEvidence(tx, persistedActor, scope, aggregateType, value.id, value.version,
        eventType, now, { aggregateDigest: canonicalDigest(clean(value)), ...metadata })
      metadata.deferredWrite?.(tx)
      tx.create(claimRef, clean({ schemaVersion: 1, claimType, normalizedKey, ...claimScope,
        aggregateId: value.id, createdAt: now, createdBy: persistedActor.uid }))
      tx.create(idemRef, this.idempotencyData(persistedActor, scope, operation, command, payloadDigest, value.id, now, value))
      tx.create(ref, clean(value)); this.writeEvidence(tx, evidence)
      return value
    })
  }

  private idempotencyRef(actor: FinanceActorContext, scope: FinanceScope, key: string): DocumentReference {
    requiredText(key, 'idempotencyKey')
    return this.db.collection('finance_idempotency_claims').doc(scopedClaimId('command_idempotency',
      { orgId: scope.orgId, legalEntityId: '__org_command_scope__' }, { actorId: actor.uid, key }))
  }

  private idempotencyData(
    actor: FinanceActorContext,
    scope: FinanceScope,
    operation: string,
    command: CommandIdentity,
    payloadDigest: string,
    aggregateId: string,
    now: string,
    resultSnapshot: unknown,
  ): DocumentData {
    const snapshot = clean(structuredClone(resultSnapshot))
    return clean({
      schemaVersion: 1, canonicalPayloadVersion: CANONICAL_PAYLOAD_VERSION,
      hashAlgorithmVersion: HASH_ALGORITHM_VERSION, payloadDigest, aggregateId, operation,
      actorId: actor.uid, orgId: scope.orgId, scopeIdentity: canonicalScopeIdentity(scope),
      requestId: requiredText(command.requestId, 'requestId'), idempotencyKey: requiredText(command.idempotencyKey, 'idempotencyKey'),
      expiresAt: new Date(Date.parse(now) + 24 * 60 * 60 * 1000).toISOString(), createdAt: now,
      resultSnapshot: snapshot, resultDigest: canonicalDigest(snapshot),
    })
  }

  private idempotentSnapshot<T>(data: DocumentData | undefined, resource: string): T {
    if (!data || data.resultSnapshot === undefined || canonicalDigest(data.resultSnapshot) !== data.resultDigest) {
      throw new FinanceValidationError(`Idempotency ${resource} result snapshot is corrupt`)
    }
    return structuredClone(data.resultSnapshot) as T
  }

  private assertIdempotency(
    data: DocumentData | undefined,
    actor: FinanceActorContext,
    scope: FinanceScope,
    operation: string,
    command: CommandIdentity,
    payloadDigest: string,
    now: string,
  ): void {
    if (!data || data.schemaVersion !== 1 || data.canonicalPayloadVersion !== CANONICAL_PAYLOAD_VERSION ||
        data.hashAlgorithmVersion !== HASH_ALGORITHM_VERSION || data.actorId !== actor.uid || data.orgId !== scope.orgId ||
        data.scopeIdentity !== canonicalScopeIdentity(scope) || data.operation !== operation ||
        data.requestId !== command.requestId || data.idempotencyKey !== command.idempotencyKey || data.expiresAt <= now) {
      throw new FinanceValidationError('Idempotency metadata is invalid, mismatched, or expired')
    }
    if (data.payloadDigest !== payloadDigest) throw new FinanceValidationError('Idempotency key payload mismatch')
  }

  private async prepareEvidence(
    tx: Transaction,
    actor: FinanceActorContext,
    scope: FinanceScope,
    aggregateType: string,
    aggregateId: string,
    aggregateVersion: number,
    eventType: string,
    now: string,
    metadata: EvidenceMetadata,
  ): Promise<{ audit: FinanceAuditEvent; outbox: FinanceOutboxEvent; headRef: DocumentReference }> {
    const headRef = this.db.collection('finance_audit_heads').doc(financeScopeKey(scope)); const headSnap = await tx.get(headRef)
    if (headSnap.exists) exactScope(headSnap.data(), scope, 'Finance audit head')
    const head = headSnap.data() ?? {}
    if (headSnap.exists && (head.canonicalPayloadVersion !== CANONICAL_PAYLOAD_VERSION ||
        head.hashAlgorithmVersion !== HASH_ALGORITHM_VERSION || !Number.isSafeInteger(head.sequence))) {
      throw new FinanceValidationError('Finance audit head metadata is corrupt')
    }
    const sequence = headSnap.exists ? Number(head.sequence) + 1 : 0
    const eventWithoutHash = clean({
      ...scope,
      id: `audit_${canonicalDigest({ scopeKey: financeScopeKey(scope), sequence, aggregateType, aggregateId, eventType }).slice(0, 40)}`,
      schemaVersion: 1 as const, aggregateType, aggregateId, aggregateVersion,
      aggregateDigest: metadata.aggregateDigest ?? canonicalDigest({ aggregateType, aggregateId, aggregateVersion }),
      eventType, actorId: actor.uid, requestId: metadata.requestId, idempotencyKey: metadata.idempotencyKey,
      correlationId: actor.correlationId, delegationId: actor.delegationId, reason: metadata.reason,
      approvalReference: metadata.approval?.approvalId, approvalAction: metadata.approval?.action,
      occurredAt: now, sequence, previousEventId: head.eventId, previousEventHash: head.eventHash,
      canonicalPayloadVersion: CANONICAL_PAYLOAD_VERSION, hashAlgorithmVersion: HASH_ALGORITHM_VERSION,
    })
    const audit: FinanceAuditEvent = { ...eventWithoutHash, eventHash: canonicalDigest(eventWithoutHash) }
    const outbox: FinanceOutboxEvent = {
      ...scope, id: `outbox_${audit.id.slice(6)}`, schemaVersion: 1, eventType, aggregateType, aggregateId,
      payload: clean({ aggregateId, aggregateVersion, aggregateDigest: audit.aggregateDigest, requestId: metadata.requestId }),
      deliveryStatus: 'internal_pending', externalEgressAllowed: false, createdAt: now,
    }
    return { audit, outbox, headRef }
  }

  private writeEvidence(
    tx: Transaction,
    evidence: { audit: FinanceAuditEvent; outbox: FinanceOutboxEvent; headRef: DocumentReference },
  ): void {
    const scope = { orgId: evidence.audit.orgId, legalEntityId: evidence.audit.legalEntityId, bookId: evidence.audit.bookId }
    tx.create(storageRef(this.db, 'finance_audit_events', scope, evidence.audit.id), evidence.audit)
    tx.create(storageRef(this.db, 'finance_outbox_events', scope, evidence.outbox.id), evidence.outbox)
    tx.set(evidence.headRef, clean({
      ...scope, eventId: evidence.audit.id, eventHash: evidence.audit.eventHash, sequence: evidence.audit.sequence,
      canonicalPayloadVersion: CANONICAL_PAYLOAD_VERSION, hashAlgorithmVersion: HASH_ALGORITHM_VERSION,
      updatedAt: evidence.audit.occurredAt,
    }), { merge: false })
  }
}
