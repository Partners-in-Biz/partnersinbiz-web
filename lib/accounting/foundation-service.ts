import { createHash } from 'crypto'
import { authorizeFinanceAction } from '@/lib/finance/policy'
import type { AccountingBasis, FinanceActorContext, FinanceScope } from '@/lib/finance/types'
import {
  assertBalancedJournal,
  assertPeriodAllowsPosting,
  buildReversalLines,
  FinanceValidationError,
  requiredText,
} from './foundation'
import type {
  AccountingBook,
  AccountingPeriod,
  FinanceAuditEvent,
  FinanceBranch,
  FinanceOutboxEvent,
  JournalLine,
  JournalLineInput,
  LedgerAccount,
  LegalEntity,
  PostedJournalEntry,
} from './types'

export interface CreateLegalEntityCommand {
  id: string
  orgId: string
  code: string
  legalName: string
  jurisdictionCode: string
  functionalCurrency: string
  defaultAccountingBasis: AccountingBasis
  fiscalYearStartMonth: number
  timezone: string
  status: LegalEntity['status']
  expectedVersion: 0
}

export interface CreateBranchCommand extends FinanceScope {
  id: string
  code: string
  name: string
  status: FinanceBranch['status']
  reportingOnly: boolean
  expectedVersion: 0
}

export interface CreateBookCommand extends FinanceScope {
  id: string
  code: string
  name: string
  branchId?: string
  bookType: AccountingBook['bookType']
  functionalCurrency: string
  accountingBasis: AccountingBasis
  jurisdictionCode: string
  status: AccountingBook['status']
  expectedVersion: 0
}

export interface CreatePeriodCommand extends Required<FinanceScope> {
  id: string
  fiscalYear: number
  periodNumber: number
  startsAt: string
  endsAt: string
  status: AccountingPeriod['status']
  expectedVersion: 0
}

export interface CreateAccountCommand extends Required<FinanceScope> {
  id: string
  code: string
  name: string
  accountType: LedgerAccount['accountType']
  normalBalance: LedgerAccount['normalBalance']
  parentAccountId?: string
  controlAccountRole?: LedgerAccount['controlAccountRole']
  postingAllowed: boolean
  activeFrom: string
  activeTo?: string
  expectedVersion: 0
}

export interface PostJournalCommand extends Required<FinanceScope> {
  id: string
  periodId: string
  sourceType: string
  sourceId: string
  sourceVersion: number
  postingPurpose: string
  entryType: string
  postingDate: string
  documentDate: string
  description: string
  currency: string
  expectedVersion: 0
  authorizedAdjustment?: boolean
  lines: readonly JournalLineInput[]
  reversesJournalEntryId?: string
  reversalReason?: string
}

export interface ReverseJournalCommand {
  originalJournalId: string
  reversalJournalId: string
  periodId: string
  postingDate: string
  reason: string
  expectedVersion: 0
}

export interface ChangePeriodStatusCommand extends Required<FinanceScope> {
  periodId: string
  status: AccountingPeriod['status']
  expectedVersion: number
  reason: string
}

interface FoundationState {
  legalEntities: Map<string, LegalEntity>
  branches: Map<string, FinanceBranch>
  books: Map<string, AccountingBook>
  periods: Map<string, AccountingPeriod>
  accounts: Map<string, LedgerAccount>
  journals: Map<string, PostedJournalEntry>
  uniqueClaims: Map<string, string>
  sequenceByBook: Map<string, number>
  auditEvents: FinanceAuditEvent[]
  outboxEvents: FinanceOutboxEvent[]
}

function cloneMap<T>(source: Map<string, T>): Map<string, T> {
  return new Map(Array.from(source, ([key, value]) => [key, structuredClone(value)]))
}

function cloneState(state: FoundationState): FoundationState {
  return {
    legalEntities: cloneMap(state.legalEntities),
    branches: cloneMap(state.branches),
    books: cloneMap(state.books),
    periods: cloneMap(state.periods),
    accounts: cloneMap(state.accounts),
    journals: cloneMap(state.journals),
    uniqueClaims: new Map(state.uniqueClaims),
    sequenceByBook: new Map(state.sequenceByBook),
    auditEvents: structuredClone(state.auditEvents),
    outboxEvents: structuredClone(state.outboxEvents),
  }
}

export class InMemoryFinanceFoundationStore {
  legalEntities = new Map<string, LegalEntity>()
  branches = new Map<string, FinanceBranch>()
  books = new Map<string, AccountingBook>()
  periods = new Map<string, AccountingPeriod>()
  accounts = new Map<string, LedgerAccount>()
  journals = new Map<string, PostedJournalEntry>()
  uniqueClaims = new Map<string, string>()
  sequenceByBook = new Map<string, number>()
  auditEvents: FinanceAuditEvent[] = []
  outboxEvents: FinanceOutboxEvent[] = []

  async transact<T>(operation: (state: FoundationState) => T | Promise<T>): Promise<T> {
    const draft = cloneState(this)
    const result = await operation(draft)
    this.legalEntities = draft.legalEntities
    this.branches = draft.branches
    this.books = draft.books
    this.periods = draft.periods
    this.accounts = draft.accounts
    this.journals = draft.journals
    this.uniqueClaims = draft.uniqueClaims
    this.sequenceByBook = draft.sequenceByBook
    this.auditEvents = draft.auditEvents
    this.outboxEvents = draft.outboxEvents
    return result
  }

  unsafeUpdatePostedJournal(id: string, update: Partial<PostedJournalEntry>): void {
    const existing = this.journals.get(id)
    if (!existing) throw new Error('Journal not found')
    if (existing.immutable) throw new Error('Posted journals are immutable')
    this.journals.set(id, { ...existing, ...update })
  }
}

function normalizeCode(value: string, field: string): string {
  return requiredText(value, field).toUpperCase()
}

function assertExpectedCreate(expectedVersion: number, existing: unknown, resource: string): void {
  if (expectedVersion !== 0) throw new FinanceValidationError(`${resource} create expectedVersion must be 0`)
  if (existing) throw new FinanceValidationError(`${resource} already exists`)
}

function assertExactScope(record: FinanceScope, scope: FinanceScope, resource: string): void {
  if (record.orgId !== scope.orgId || record.legalEntityId !== scope.legalEntityId || record.bookId !== scope.bookId) {
    throw new FinanceValidationError(`${resource} scope does not match`) 
  }
}

function claim(state: FoundationState, key: string, aggregateId: string, message: string): void {
  const existing = state.uniqueClaims.get(key)
  if (existing && existing !== aggregateId) throw new FinanceValidationError(message)
  state.uniqueClaims.set(key, aggregateId)
}

function contentHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function appendEvidence(
  state: FoundationState,
  actor: FinanceActorContext,
  scope: FinanceScope,
  aggregateType: string,
  aggregateId: string,
  aggregateVersion: number,
  eventType: string,
  now: string,
): void {
  const bookScope = `${scope.orgId}:${scope.legalEntityId}:${scope.bookId ?? 'entity'}`
  const previous = [...state.auditEvents].reverse().find((event) =>
    `${event.orgId}:${event.legalEntityId}:${event.bookId ?? 'entity'}` === bookScope)
  const sequence = previous ? previous.sequence + 1 : 0
  const id = `audit_${contentHash(`${bookScope}:${sequence}:${aggregateType}:${aggregateId}:${eventType}`).slice(0, 32)}`
  const hashPayload = {
    id, scope, aggregateType, aggregateId, aggregateVersion, eventType, actorId: actor.uid,
    occurredAt: now, sequence, previousEventHash: previous?.eventHash,
  }
  const eventHash = contentHash(hashPayload)
  state.auditEvents.push({
    ...scope,
    id,
    schemaVersion: 1,
    aggregateType,
    aggregateId,
    aggregateVersion,
    eventType,
    actorId: actor.uid,
    correlationId: actor.correlationId,
    delegationId: actor.delegationId,
    occurredAt: now,
    sequence,
    previousEventId: previous?.id,
    previousEventHash: previous?.eventHash,
    eventHash,
  })
  state.outboxEvents.push({
    ...scope,
    id: `outbox_${id.slice(6)}`,
    schemaVersion: 1,
    eventType,
    aggregateType,
    aggregateId,
    payload: { aggregateId, aggregateVersion, orgId: scope.orgId },
    deliveryStatus: 'internal_pending',
    externalEgressAllowed: false,
    createdAt: now,
  })
}

export class FinanceFoundationService {
  constructor(
    private readonly store: InMemoryFinanceFoundationStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async createLegalEntity(actor: FinanceActorContext, command: CreateLegalEntityCommand): Promise<LegalEntity> {
    const scope = { orgId: command.orgId, legalEntityId: command.id }
    authorizeFinanceAction(actor, scope, 'foundation.configure', this.now())
    if (!Number.isInteger(command.fiscalYearStartMonth) || command.fiscalYearStartMonth < 1 || command.fiscalYearStartMonth > 12) {
      throw new FinanceValidationError('fiscalYearStartMonth must be between 1 and 12')
    }
    return this.store.transact((state) => {
      assertExpectedCreate(command.expectedVersion, state.legalEntities.get(command.id), 'Legal entity')
      const code = normalizeCode(command.code, 'code')
      claim(state, `entity-code:${command.orgId}:${code}`, command.id, 'Legal entity code already exists')
      const now = this.now()
      const entity: LegalEntity = {
        id: command.id,
        orgId: command.orgId,
        legalEntityId: command.id,
        code,
        legalName: requiredText(command.legalName, 'legalName'),
        jurisdictionCode: normalizeCode(command.jurisdictionCode, 'jurisdictionCode'),
        functionalCurrency: normalizeCode(command.functionalCurrency, 'functionalCurrency'),
        defaultAccountingBasis: command.defaultAccountingBasis,
        fiscalYearStartMonth: command.fiscalYearStartMonth,
        timezone: requiredText(command.timezone, 'timezone'),
        status: command.status,
        schemaVersion: 1,
        version: 1,
        createdAt: now,
        createdBy: actor.uid,
        updatedAt: now,
        updatedBy: actor.uid,
      }
      state.legalEntities.set(entity.id, entity)
      appendEvidence(state, actor, scope, 'legal_entity', entity.id, entity.version, 'finance.legal-entity.created.v1', now)
      return entity
    })
  }

  async createBranch(actor: FinanceActorContext, command: CreateBranchCommand): Promise<FinanceBranch> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId }
    authorizeFinanceAction(actor, scope, 'foundation.configure', this.now())
    return this.store.transact((state) => {
      assertExpectedCreate(command.expectedVersion, state.branches.get(command.id), 'Branch')
      const entity = state.legalEntities.get(command.legalEntityId)
      if (!entity || entity.orgId !== command.orgId) throw new FinanceValidationError('Legal entity not found in scope')
      const code = normalizeCode(command.code, 'code')
      claim(state, `branch-code:${command.orgId}:${command.legalEntityId}:${code}`, command.id, 'Branch code already exists')
      const now = this.now()
      const branch: FinanceBranch = {
        ...scope, id: command.id, code, name: requiredText(command.name, 'name'), status: command.status,
        reportingOnly: command.reportingOnly, schemaVersion: 1, version: 1,
        createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid,
      }
      state.branches.set(branch.id, branch)
      appendEvidence(state, actor, scope, 'finance_branch', branch.id, 1, 'finance.branch.created.v1', now)
      return branch
    })
  }

  async createBook(actor: FinanceActorContext, command: CreateBookCommand): Promise<AccountingBook> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.id }
    authorizeFinanceAction(actor, scope, 'foundation.configure', this.now())
    return this.store.transact((state) => {
      assertExpectedCreate(command.expectedVersion, state.books.get(command.id), 'Accounting book')
      const entity = state.legalEntities.get(command.legalEntityId)
      if (!entity || entity.orgId !== command.orgId) throw new FinanceValidationError('Legal entity not found in scope')
      if (command.branchId) {
        const branch = state.branches.get(command.branchId)
        if (!branch) throw new FinanceValidationError('Branch not found in scope')
        assertExactScope(branch, { orgId: command.orgId, legalEntityId: command.legalEntityId }, 'Branch')
      }
      const code = normalizeCode(command.code, 'code')
      claim(state, `book-code:${command.orgId}:${command.legalEntityId}:${code}`, command.id, 'Accounting book code already exists')
      const now = this.now()
      const book: AccountingBook = {
        ...scope, id: command.id, code, name: requiredText(command.name, 'name'), branchId: command.branchId,
        bookType: command.bookType, functionalCurrency: normalizeCode(command.functionalCurrency, 'functionalCurrency'),
        accountingBasis: command.accountingBasis, jurisdictionCode: normalizeCode(command.jurisdictionCode, 'jurisdictionCode'),
        status: command.status, schemaVersion: 1, version: 1,
        createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid,
      }
      state.books.set(book.id, book)
      appendEvidence(state, actor, scope, 'accounting_book', book.id, 1, 'finance.book.created.v1', now)
      return book
    })
  }

  async createPeriod(actor: FinanceActorContext, command: CreatePeriodCommand): Promise<AccountingPeriod> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    authorizeFinanceAction(actor, scope, 'foundation.configure', this.now())
    if (command.startsAt > command.endsAt) throw new FinanceValidationError('Period start must not be after period end')
    return this.store.transact((state) => {
      assertExpectedCreate(command.expectedVersion, state.periods.get(command.id), 'Accounting period')
      const book = state.books.get(command.bookId)
      if (!book) throw new FinanceValidationError('Accounting book not found in scope')
      assertExactScope(book, scope, 'Accounting book')
      const overlaps = [...state.periods.values()].some((period) =>
        period.bookId === command.bookId && period.orgId === command.orgId &&
        command.startsAt <= period.endsAt && command.endsAt >= period.startsAt)
      if (overlaps) throw new FinanceValidationError('Accounting period overlaps an existing period')
      claim(state, `period:${command.bookId}:${command.fiscalYear}:${command.periodNumber}`, command.id, 'Accounting period number already exists')
      const now = this.now()
      const period: AccountingPeriod = {
        ...scope, id: command.id, fiscalYear: command.fiscalYear, periodNumber: command.periodNumber,
        startsAt: command.startsAt, endsAt: command.endsAt, status: command.status,
        schemaVersion: 1, version: 1, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid,
      }
      state.periods.set(period.id, period)
      appendEvidence(state, actor, scope, 'accounting_period', period.id, 1, 'finance.period.created.v1', now)
      return period
    })
  }

  async changePeriodStatus(actor: FinanceActorContext, command: ChangePeriodStatusCommand): Promise<AccountingPeriod> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    authorizeFinanceAction(actor, scope, 'period.close', this.now())
    requiredText(command.reason, 'reason')
    return this.store.transact((state) => {
      const period = state.periods.get(command.periodId)
      if (!period) throw new FinanceValidationError('Accounting period not found in scope')
      assertExactScope(period, scope, 'Accounting period')
      if (period.version !== command.expectedVersion) throw new FinanceValidationError('Accounting period version conflict')
      const transitions: Record<AccountingPeriod['status'], AccountingPeriod['status'][]> = {
        open: ['soft_closed', 'hard_closed'], soft_closed: ['open', 'hard_closed'], hard_closed: ['open'],
      }
      if (!transitions[period.status].includes(command.status)) throw new FinanceValidationError('Invalid accounting period transition')
      const now = this.now()
      const updated = { ...period, status: command.status, version: period.version + 1, updatedAt: now, updatedBy: actor.uid }
      state.periods.set(period.id, updated)
      appendEvidence(state, actor, scope, 'accounting_period', period.id, updated.version, 'finance.period.status-changed.v1', now)
      return updated
    })
  }

  async createAccount(actor: FinanceActorContext, command: CreateAccountCommand): Promise<LedgerAccount> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    authorizeFinanceAction(actor, scope, 'foundation.configure', this.now())
    return this.store.transact((state) => {
      assertExpectedCreate(command.expectedVersion, state.accounts.get(command.id), 'Ledger account')
      const book = state.books.get(command.bookId)
      if (!book) throw new FinanceValidationError('Accounting book not found in scope')
      assertExactScope(book, scope, 'Accounting book')
      const code = normalizeCode(command.code, 'code')
      claim(state, `account-code:${command.bookId}:${code}`, command.id, 'Ledger account code already exists')
      if (command.parentAccountId) {
        const parent = state.accounts.get(command.parentAccountId)
        if (!parent) throw new FinanceValidationError('Parent account not found in scope')
        assertExactScope(parent, scope, 'Parent account')
      }
      const now = this.now()
      const account: LedgerAccount = {
        ...scope, id: command.id, code, name: requiredText(command.name, 'name'), accountType: command.accountType,
        normalBalance: command.normalBalance, parentAccountId: command.parentAccountId,
        controlAccountRole: command.controlAccountRole, postingAllowed: command.postingAllowed,
        activeFrom: command.activeFrom, activeTo: command.activeTo, schemaVersion: 1, version: 1,
        createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid,
      }
      state.accounts.set(account.id, account)
      appendEvidence(state, actor, scope, 'ledger_account', account.id, 1, 'finance.account.created.v1', now)
      return account
    })
  }

  async postJournal(actor: FinanceActorContext, command: PostJournalCommand): Promise<PostedJournalEntry> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    authorizeFinanceAction(actor, scope, 'journal.post', this.now())
    const totals = assertBalancedJournal(command.lines)
    return this.store.transact((state) => {
      assertExpectedCreate(command.expectedVersion, state.journals.get(command.id), 'Journal')
      const book = state.books.get(command.bookId)
      if (!book) throw new FinanceValidationError('Accounting book not found in scope')
      assertExactScope(book, scope, 'Accounting book')
      if (book.status !== 'active') throw new FinanceValidationError('Accounting book is not active')
      if (book.functionalCurrency !== command.currency.toUpperCase()) throw new FinanceValidationError('Journal currency does not match book functional currency')
      const period = state.periods.get(command.periodId)
      if (!period) throw new FinanceValidationError('Accounting period not found in scope')
      assertExactScope(period, scope, 'Accounting period')
      assertPeriodAllowsPosting(period, command.postingDate, command.authorizedAdjustment === true)
      for (const line of command.lines) {
        const account = state.accounts.get(line.accountId)
        if (!account) throw new FinanceValidationError(`Ledger account ${line.accountId} not found in scope`)
        assertExactScope(account, scope, 'Ledger account')
        if (!account.postingAllowed) throw new FinanceValidationError(`Ledger account ${line.accountId} does not allow posting`)
        if (command.postingDate < account.activeFrom || (account.activeTo && command.postingDate > account.activeTo)) {
          throw new FinanceValidationError(`Ledger account ${line.accountId} is inactive on posting date`)
        }
        if (account.controlAccountRole && !command.authorizedAdjustment) {
          throw new FinanceValidationError(`Control account ${line.accountId} requires an authorized source or adjustment`)
        }
      }
      const sourceKey = [command.orgId, command.legalEntityId, command.bookId, command.sourceType,
        command.sourceId, command.sourceVersion, command.postingPurpose].join(':')
      claim(state, `posting-source:${sourceKey}`, command.id, 'Posting source already exists')
      if (command.reversesJournalEntryId) {
        claim(state, `journal-reversal:${command.reversesJournalEntryId}`, command.id, 'Journal already has a direct reversal')
      }
      const entryNumber = (state.sequenceByBook.get(command.bookId) ?? 0) + 1
      state.sequenceByBook.set(command.bookId, entryNumber)
      const now = this.now()
      const lines: JournalLine[] = command.lines.map((line, index) => ({
        ...scope, periodId: command.periodId, id: `${command.id}_${String(index + 1).padStart(4, '0')}`,
        journalEntryId: command.id, sequence: index + 1, accountId: line.accountId,
        debitMinor: line.debitMinor, creditMinor: line.creditMinor, description: line.description,
      }))
      const hashInput = { ...command, entryNumber, lines, totalDebitMinor: totals.debitMinor, totalCreditMinor: totals.creditMinor }
      const journal: PostedJournalEntry = {
        ...scope, id: command.id, periodId: command.periodId, sourceType: requiredText(command.sourceType, 'sourceType'),
        sourceId: requiredText(command.sourceId, 'sourceId'), sourceVersion: command.sourceVersion,
        postingPurpose: requiredText(command.postingPurpose, 'postingPurpose'), entryNumber,
        entryType: requiredText(command.entryType, 'entryType'), postingDate: command.postingDate,
        documentDate: command.documentDate, status: 'posted', description: requiredText(command.description, 'description'),
        currency: command.currency.toUpperCase(), totalDebitMinor: totals.debitMinor, totalCreditMinor: totals.creditMinor,
        lines, reversesJournalEntryId: command.reversesJournalEntryId, reversalReason: command.reversalReason,
        immutable: true, contentHash: contentHash(hashInput), schemaVersion: 1, version: 1,
        createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid,
      }
      state.journals.set(journal.id, journal)
      appendEvidence(state, actor, scope, 'journal_entry', journal.id, 1, 'finance.journal.posted.v1', now)
      return journal
    })
  }

  async reverseJournal(actor: FinanceActorContext, command: ReverseJournalCommand): Promise<PostedJournalEntry> {
    const original = this.store.journals.get(command.originalJournalId)
    if (!original) throw new FinanceValidationError('Original posted journal not found')
    authorizeFinanceAction(actor, original, 'journal.reverse', this.now())
    const reason = requiredText(command.reason, 'reason')
    return this.postJournal(actor, {
      id: command.reversalJournalId,
      orgId: original.orgId,
      legalEntityId: original.legalEntityId,
      bookId: original.bookId,
      periodId: command.periodId,
      sourceType: 'journal_reversal',
      sourceId: original.id,
      sourceVersion: original.version,
      postingPurpose: 'reversal',
      entryType: 'reversal',
      postingDate: command.postingDate,
      documentDate: command.postingDate,
      description: `Reversal of ${original.description}`,
      currency: original.currency,
      expectedVersion: command.expectedVersion,
      authorizedAdjustment: true,
      lines: buildReversalLines(original.lines),
      reversesJournalEntryId: original.id,
      reversalReason: reason,
    })
  }
}
