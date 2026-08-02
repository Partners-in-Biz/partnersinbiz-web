import { FinanceAuthorizationError } from '@/lib/finance/policy'
import type { FinanceActorContext } from '@/lib/finance/types'
import type {
  PersonalAccount,
  PersonalAccountType,
  PersonalBook,
  PersonalEntry,
  PersonalEntryLine,
  PersonalFinanceAction,
  PersonalTransferObservation,
} from './types'

export class PersonalFinanceValidationError extends Error {
  readonly statusCode = 400
  constructor(message: string) {
    super(message)
    this.name = 'PersonalFinanceValidationError'
  }
}

export class PersonalFinanceNotFoundError extends Error {
  readonly statusCode = 404
  constructor(message: string) {
    super(message)
    this.name = 'PersonalFinanceNotFoundError'
  }
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new PersonalFinanceValidationError(`${field} is required`)
  }
  return value.trim()
}

function requiredInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new PersonalFinanceValidationError(`${field} must be an integer minor amount`)
  }
  return value
}

function assertBalanced(lines: PersonalEntryLine[]) {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new PersonalFinanceValidationError('Entry requires at least two lines')
  }
  let debit = 0
  let credit = 0
  for (const line of lines) {
    const d = requiredInt(line.debitMinor, 'debitMinor')
    const c = requiredInt(line.creditMinor, 'creditMinor')
    if (d < 0 || c < 0) throw new PersonalFinanceValidationError('Line amounts must be non-negative')
    if ((d > 0 && c > 0) || (d === 0 && c === 0)) {
      throw new PersonalFinanceValidationError('Each line must be debit XOR credit')
    }
    debit += d
    credit += c
  }
  if (debit !== credit) throw new PersonalFinanceValidationError('Entry lines must balance')
  if (debit === 0) throw new PersonalFinanceValidationError('Entry amount must be non-zero')
}

/** Owner-private auth: membership + own uid. No other member can read/write. */
export function authorizePersonalOwnerAction(
  actor: FinanceActorContext,
  orgId: string,
  ownerUid: string,
  action: PersonalFinanceAction,
): void {
  if (!actor.membershipActive) throw new FinanceAuthorizationError('Active organization membership is required')
  if (actor.orgId !== orgId) throw new FinanceAuthorizationError('Actor organization does not match finance scope')
  if (!actor.financeModuleEnabled) throw new FinanceAuthorizationError('Persisted Finance module capability is required')
  if (actor.uid !== ownerUid) {
    throw new FinanceAuthorizationError(`Personal books are private to the owner (${action})`)
  }
  if (actor.delegationId) {
    if (actor.delegationOrgId !== orgId) {
      throw new FinanceAuthorizationError('Delegation organization does not match finance scope')
    }
    // Personal owner actions are allowed under any finance:* delegation or explicit personal scopes.
    const scopes = actor.delegationScopes ?? []
    const ok =
      scopes.includes('finance:*') ||
      scopes.some((s) => s.startsWith('finance:')) ||
      scopes.includes(`finance:${action}`) ||
      scopes.includes('finance:personal:*')
    if (!ok) throw new FinanceAuthorizationError(`Delegation does not grant finance personal access`)
  }
}

/** Org finance roles may propose transfer observations to a member — never auto-accept. */
export function authorizePersonalTransferPropose(actor: FinanceActorContext, orgId: string): void {
  if (!actor.membershipActive) throw new FinanceAuthorizationError('Active organization membership is required')
  if (actor.orgId !== orgId) throw new FinanceAuthorizationError('Actor organization does not match finance scope')
  if (!actor.financeModuleEnabled) throw new FinanceAuthorizationError('Persisted Finance module capability is required')
  const isOrgAdmin = actor.membershipRole === 'owner' || actor.membershipRole === 'admin'
  const hasFinanceRole = actor.assignments.some(
    (a) =>
      a.orgId === orgId &&
      a.userId === actor.uid &&
      a.status === 'active' &&
      ['finance_admin', 'accountant', 'bookkeeper', 'finance_approver'].includes(a.role),
  )
  if (!isOrgAdmin && !hasFinanceRole) {
    throw new FinanceAuthorizationError('Finance role or org admin required to propose member pay observations')
  }
}

export interface PersonalFinanceStore {
  books: Map<string, PersonalBook>
  accounts: Map<string, PersonalAccount>
  entries: Map<string, PersonalEntry>
  transfers: Map<string, PersonalTransferObservation>
  claims: Set<string>
}

export function createEmptyPersonalStore(): PersonalFinanceStore {
  return {
    books: new Map(),
    accounts: new Map(),
    entries: new Map(),
    transfers: new Map(),
    claims: new Set(),
  }
}

export function clonePersonalStore(store: PersonalFinanceStore): PersonalFinanceStore {
  return {
    books: new Map(store.books),
    accounts: new Map(store.accounts),
    entries: new Map(store.entries),
    transfers: new Map(store.transfers),
    claims: new Set(store.claims),
  }
}

function claim(store: PersonalFinanceStore, key: string, message: string) {
  if (store.claims.has(key)) throw new PersonalFinanceValidationError(message)
  store.claims.add(key)
}

export interface CreatePersonalBookCommand {
  id: string
  orgId: string
  name: string
  currency?: string
  requestId: string
  idempotencyKey: string
}

export interface CreatePersonalAccountCommand {
  id: string
  orgId: string
  bookId: string
  code: string
  name: string
  accountType: PersonalAccountType
  openingBalanceMinor?: number
  requestId: string
  idempotencyKey: string
}

export interface PostPersonalEntryCommand {
  id: string
  orgId: string
  bookId: string
  entryDate: string
  description: string
  lines: PersonalEntryLine[]
  requestId: string
  idempotencyKey: string
}

export interface ProposePersonalTransferCommand {
  id: string
  orgId: string
  memberUid: string
  amountMinor: number
  currency?: string
  description: string
  sourcePaymentId?: string
  sourceLegalEntityId?: string
  sourceBookId?: string
  requestId: string
  idempotencyKey: string
}

export interface ResolvePersonalTransferCommand {
  id: string
  orgId: string
  bookId: string
  incomeAccountId: string
  assetAccountId: string
  requestId: string
  idempotencyKey: string
}

export interface RejectPersonalTransferCommand {
  id: string
  orgId: string
  requestId: string
  idempotencyKey: string
}

export class PersonalFinanceService {
  constructor(
    private readonly load: () => Promise<PersonalFinanceStore>,
    private readonly save: (before: PersonalFinanceStore, after: PersonalFinanceStore) => Promise<void>,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async createBook(actor: FinanceActorContext, command: CreatePersonalBookCommand): Promise<PersonalBook> {
    authorizePersonalOwnerAction(actor, command.orgId, actor.uid, 'personal.book.create')
    const id = requiredText(command.id, 'id')
    const name = requiredText(command.name, 'name')
    const currency = (command.currency || 'ZAR').toUpperCase()
    const before = await this.load()
    const after = clonePersonalStore(before)
    const idemKey = `idem:book:${command.orgId}:${actor.uid}:${command.idempotencyKey}`
    if (after.claims.has(idemKey)) {
      const existing = [...after.books.values()].find(
        (b) => b.orgId === command.orgId && b.ownerUid === actor.uid && b.id === id,
      )
      if (existing) return existing
    }
    claim(after, idemKey, 'Duplicate idempotency key')
    claim(after, `book:${id}`, 'Personal book already exists')
    claim(after, `owner-book-name:${command.orgId}:${actor.uid}:${name.toLowerCase()}`, 'Book name already used')
    const now = this.now()
    const book: PersonalBook = {
      id,
      orgId: command.orgId,
      ownerUid: actor.uid,
      name,
      currency,
      status: 'active',
      schemaVersion: 1,
      version: 1,
      createdAt: now,
      createdBy: actor.uid,
      updatedAt: now,
      updatedBy: actor.uid,
      visibility: 'owner',
    }
    after.books.set(id, book)
    await this.save(before, after)
    return book
  }

  async createAccount(actor: FinanceActorContext, command: CreatePersonalAccountCommand): Promise<PersonalAccount> {
    const before = await this.load()
    const book = before.books.get(command.bookId)
    if (!book || book.orgId !== command.orgId) throw new PersonalFinanceNotFoundError('Personal book not found')
    authorizePersonalOwnerAction(actor, command.orgId, book.ownerUid, 'personal.account.create')
    const id = requiredText(command.id, 'id')
    const code = requiredText(command.code, 'code').toUpperCase()
    const name = requiredText(command.name, 'name')
    const accountType = command.accountType
    if (!['asset', 'liability', 'equity', 'income', 'expense'].includes(accountType)) {
      throw new PersonalFinanceValidationError('Invalid accountType')
    }
    const opening = command.openingBalanceMinor ?? 0
    if (!Number.isInteger(opening)) throw new PersonalFinanceValidationError('openingBalanceMinor must be integer')

    const after = clonePersonalStore(before)
    const idemKey = `idem:account:${command.orgId}:${book.ownerUid}:${command.idempotencyKey}`
    claim(after, idemKey, 'Duplicate idempotency key')
    claim(after, `account:${id}`, 'Personal account already exists')
    claim(after, `account-code:${book.id}:${code}`, 'Account code already used in this book')
    const now = this.now()
    const account: PersonalAccount = {
      id,
      orgId: command.orgId,
      ownerUid: book.ownerUid,
      bookId: book.id,
      code,
      name,
      accountType,
      openingBalanceMinor: opening,
      balanceMinor: opening,
      schemaVersion: 1,
      version: 1,
      createdAt: now,
      createdBy: actor.uid,
      updatedAt: now,
      updatedBy: actor.uid,
    }
    after.accounts.set(id, account)
    await this.save(before, after)
    return account
  }

  async postEntry(actor: FinanceActorContext, command: PostPersonalEntryCommand): Promise<PersonalEntry> {
    const before = await this.load()
    const book = before.books.get(command.bookId)
    if (!book || book.orgId !== command.orgId) throw new PersonalFinanceNotFoundError('Personal book not found')
    authorizePersonalOwnerAction(actor, command.orgId, book.ownerUid, 'personal.entry.post')
    assertBalanced(command.lines)
    const id = requiredText(command.id, 'id')
    const description = requiredText(command.description, 'description')
    const entryDate = requiredText(command.entryDate, 'entryDate')

    for (const line of command.lines) {
      const account = before.accounts.get(line.accountId)
      if (!account || account.bookId !== book.id || account.ownerUid !== book.ownerUid) {
        throw new PersonalFinanceValidationError('Entry line account must belong to the personal book')
      }
    }

    const after = clonePersonalStore(before)
    const idemKey = `idem:entry:${command.orgId}:${book.ownerUid}:${command.idempotencyKey}`
    claim(after, idemKey, 'Duplicate idempotency key')
    claim(after, `entry:${id}`, 'Personal entry already exists')
    const now = this.now()
    const entry: PersonalEntry = {
      id,
      orgId: command.orgId,
      ownerUid: book.ownerUid,
      bookId: book.id,
      entryDate,
      description,
      lines: command.lines.map((l) => ({
        accountId: l.accountId,
        debitMinor: l.debitMinor,
        creditMinor: l.creditMinor,
        description: l.description,
      })),
      source: { kind: 'manual' },
      schemaVersion: 1,
      version: 1,
      createdAt: now,
      createdBy: actor.uid,
      immutable: true,
    }
    after.entries.set(id, entry)
    for (const line of entry.lines) {
      const account = after.accounts.get(line.accountId)!
      const signed =
        account.accountType === 'asset' || account.accountType === 'expense'
          ? line.debitMinor - line.creditMinor
          : line.creditMinor - line.debitMinor
      after.accounts.set(account.id, {
        ...account,
        balanceMinor: account.balanceMinor + signed,
        version: account.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
      })
    }
    await this.save(before, after)
    return entry
  }

  async proposeTransfer(
    actor: FinanceActorContext,
    command: ProposePersonalTransferCommand,
  ): Promise<PersonalTransferObservation> {
    authorizePersonalTransferPropose(actor, command.orgId)
    const id = requiredText(command.id, 'id')
    const memberUid = requiredText(command.memberUid, 'memberUid')
    const description = requiredText(command.description, 'description')
    const amountMinor = requiredInt(command.amountMinor, 'amountMinor')
    if (amountMinor <= 0) throw new PersonalFinanceValidationError('amountMinor must be positive')
    if (memberUid === actor.uid) {
      // still allowed, but keep path consistent
    }
    const before = await this.load()
    const after = clonePersonalStore(before)
    const idemKey = `idem:transfer:${command.orgId}:${command.idempotencyKey}`
    claim(after, idemKey, 'Duplicate idempotency key')
    claim(after, `transfer:${id}`, 'Transfer observation already exists')
    const now = this.now()
    const transfer: PersonalTransferObservation = {
      id,
      orgId: command.orgId,
      memberUid,
      amountMinor,
      currency: (command.currency || 'ZAR').toUpperCase(),
      description,
      sourcePaymentId: command.sourcePaymentId,
      sourceLegalEntityId: command.sourceLegalEntityId,
      sourceBookId: command.sourceBookId,
      status: 'proposed',
      proposedBy: actor.uid,
      proposedAt: now,
      schemaVersion: 1,
      version: 1,
      externalPaymentInitiated: false,
    }
    after.transfers.set(id, transfer)
    await this.save(before, after)
    return transfer
  }

  async acceptTransfer(
    actor: FinanceActorContext,
    command: ResolvePersonalTransferCommand,
  ): Promise<{ transfer: PersonalTransferObservation; entry: PersonalEntry }> {
    const before = await this.load()
    const transfer = before.transfers.get(command.id)
    if (!transfer || transfer.orgId !== command.orgId) {
      throw new PersonalFinanceNotFoundError('Transfer observation not found')
    }
    authorizePersonalOwnerAction(actor, command.orgId, transfer.memberUid, 'personal.transfer.accept')
    if (transfer.status !== 'proposed') {
      throw new PersonalFinanceValidationError('Only proposed transfers can be accepted')
    }
    const book = before.books.get(command.bookId)
    if (!book || book.orgId !== command.orgId || book.ownerUid !== transfer.memberUid) {
      throw new PersonalFinanceValidationError('bookId must be an owned personal book')
    }
    const income = before.accounts.get(command.incomeAccountId)
    const asset = before.accounts.get(command.assetAccountId)
    if (!income || income.bookId !== book.id || income.accountType !== 'income') {
      throw new PersonalFinanceValidationError('incomeAccountId must be an income account on the personal book')
    }
    if (!asset || asset.bookId !== book.id || asset.accountType !== 'asset') {
      throw new PersonalFinanceValidationError('assetAccountId must be an asset account on the personal book')
    }

    const after = clonePersonalStore(before)
    const idemKey = `idem:transfer-accept:${command.orgId}:${command.idempotencyKey}`
    claim(after, idemKey, 'Duplicate idempotency key')
    const now = this.now()
    const entryId = `pe_${command.id}`
    claim(after, `entry:${entryId}`, 'Personal entry already exists')
    const entry: PersonalEntry = {
      id: entryId,
      orgId: command.orgId,
      ownerUid: transfer.memberUid,
      bookId: book.id,
      entryDate: now.slice(0, 10),
      description: `Org transfer accepted: ${transfer.description}`,
      lines: [
        { accountId: asset.id, debitMinor: transfer.amountMinor, creditMinor: 0, description: 'Cash/bank increase' },
        { accountId: income.id, debitMinor: 0, creditMinor: transfer.amountMinor, description: 'Transfer income' },
      ],
      source: { kind: 'org_member_transfer', transferId: transfer.id },
      schemaVersion: 1,
      version: 1,
      createdAt: now,
      createdBy: actor.uid,
      immutable: true,
    }
    after.entries.set(entryId, entry)
    after.accounts.set(asset.id, {
      ...after.accounts.get(asset.id)!,
      balanceMinor: after.accounts.get(asset.id)!.balanceMinor + transfer.amountMinor,
      version: after.accounts.get(asset.id)!.version + 1,
      updatedAt: now,
      updatedBy: actor.uid,
    })
    after.accounts.set(income.id, {
      ...after.accounts.get(income.id)!,
      balanceMinor: after.accounts.get(income.id)!.balanceMinor + transfer.amountMinor,
      version: after.accounts.get(income.id)!.version + 1,
      updatedAt: now,
      updatedBy: actor.uid,
    })
    const nextTransfer: PersonalTransferObservation = {
      ...transfer,
      status: 'accepted',
      resolvedAt: now,
      resolvedBy: actor.uid,
      personalBookId: book.id,
      personalEntryId: entryId,
      version: transfer.version + 1,
      externalPaymentInitiated: false,
    }
    after.transfers.set(transfer.id, nextTransfer)
    await this.save(before, after)
    return { transfer: nextTransfer, entry }
  }

  async rejectTransfer(
    actor: FinanceActorContext,
    command: RejectPersonalTransferCommand,
  ): Promise<PersonalTransferObservation> {
    const before = await this.load()
    const transfer = before.transfers.get(command.id)
    if (!transfer || transfer.orgId !== command.orgId) {
      throw new PersonalFinanceNotFoundError('Transfer observation not found')
    }
    authorizePersonalOwnerAction(actor, command.orgId, transfer.memberUid, 'personal.transfer.reject')
    if (transfer.status !== 'proposed') {
      throw new PersonalFinanceValidationError('Only proposed transfers can be rejected')
    }
    const after = clonePersonalStore(before)
    const idemKey = `idem:transfer-reject:${command.orgId}:${command.idempotencyKey}`
    claim(after, idemKey, 'Duplicate idempotency key')
    const now = this.now()
    const next: PersonalTransferObservation = {
      ...transfer,
      status: 'rejected',
      resolvedAt: now,
      resolvedBy: actor.uid,
      version: transfer.version + 1,
      externalPaymentInitiated: false,
    }
    after.transfers.set(transfer.id, next)
    await this.save(before, after)
    return next
  }

  async getOwnerBundle(actor: FinanceActorContext, orgId: string): Promise<{
    books: PersonalBook[]
    accounts: PersonalAccount[]
    entries: PersonalEntry[]
    transfers: PersonalTransferObservation[]
    externalPaymentInitiated: false
  }> {
    authorizePersonalOwnerAction(actor, orgId, actor.uid, 'personal.book.read')
    const store = await this.load()
    const owner = actor.uid
    return {
      books: [...store.books.values()].filter((b) => b.orgId === orgId && b.ownerUid === owner),
      accounts: [...store.accounts.values()].filter((a) => a.orgId === orgId && a.ownerUid === owner),
      entries: [...store.entries.values()]
        .filter((e) => e.orgId === orgId && e.ownerUid === owner)
        .sort((a, b) => a.entryDate.localeCompare(b.entryDate)),
      transfers: [...store.transfers.values()]
        .filter((t) => t.orgId === orgId && t.memberUid === owner)
        .sort((a, b) => a.proposedAt.localeCompare(b.proposedAt)),
      externalPaymentInitiated: false,
    }
  }
}
