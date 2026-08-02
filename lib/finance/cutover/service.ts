import { FinanceAuthorizationError } from '@/lib/finance/policy'
import type { FinanceActorContext } from '@/lib/finance/types'
import type {
  CutoverFinanceAction,
  CutoverOpeningOpenItem,
  CutoverPackage,
  CutoverPayrollYtdOpening,
  CutoverTaxStateSnapshot,
  CutoverTrialBalanceLine,
} from './types'

export class CutoverFinanceValidationError extends Error {
  readonly statusCode = 400
  constructor(message: string) {
    super(message)
    this.name = 'CutoverFinanceValidationError'
  }
}

export class CutoverFinanceNotFoundError extends Error {
  readonly statusCode = 404
  constructor(message: string) {
    super(message)
    this.name = 'CutoverFinanceNotFoundError'
  }
}

export interface CreateCutoverPackageCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  periodId: string
  currency: string
  cutoverAt: string
  description: string
  trialBalanceLines?: CutoverTrialBalanceLine[]
  openingOpenItems?: CutoverOpeningOpenItem[]
  payrollYtdOpenings?: CutoverPayrollYtdOpening[]
  taxStateSnapshots?: CutoverTaxStateSnapshot[]
  requestId: string
  idempotencyKey: string
}

export interface UpdateCutoverPackageCommand {
  id: string
  orgId: string
  trialBalanceLines?: CutoverTrialBalanceLine[]
  openingOpenItems?: CutoverOpeningOpenItem[]
  payrollYtdOpenings?: CutoverPayrollYtdOpening[]
  taxStateSnapshots?: CutoverTaxStateSnapshot[]
  description?: string
  cutoverAt?: string
  periodId?: string
  currency?: string
  requestId: string
  idempotencyKey: string
  expectedVersion: number
}

export interface ValidateCutoverPackageCommand {
  id: string
  orgId: string
  requestId: string
  idempotencyKey: string
}

export interface ApproveCutoverPackageCommand {
  id: string
  orgId: string
  approvalId: string
  reason: string
  requestId: string
  idempotencyKey: string
}

export interface ActivateCutoverPackageCommand {
  id: string
  orgId: string
  requestId: string
  idempotencyKey: string
  /** Optional pre-created opening journal id; otherwise derived from package id. */
  openingJournalEntryId?: string
}

export interface CutoverFinanceStore {
  packages: Map<string, CutoverPackage>
  claims: Set<string>
  /** bookId -> activated package id (one active cutover per book). */
  bookCutoverClaims: Map<string, string>
}

export function createEmptyCutoverStore(): CutoverFinanceStore {
  return {
    packages: new Map(),
    claims: new Set(),
    bookCutoverClaims: new Map(),
  }
}

export function cloneCutoverStore(store: CutoverFinanceStore): CutoverFinanceStore {
  return {
    packages: new Map(store.packages),
    claims: new Set(store.claims),
    bookCutoverClaims: new Map(store.bookCutoverClaims),
  }
}

export type OpeningJournalPoster = (input: {
  actor: FinanceActorContext
  pkg: CutoverPackage
  journalEntryId: string
  requestId: string
  idempotencyKey: string
}) => Promise<{ id: string }>

export type OpeningOpenItemMaterializer = (input: {
  actor: FinanceActorContext
  pkg: CutoverPackage
  requestId: string
  idempotencyKey: string
}) => Promise<{ openItemIds: string[] }>

export type BookCutoverApplier = (input: {
  actor: FinanceActorContext
  pkg: CutoverPackage
  requestId: string
  idempotencyKey: string
}) => Promise<{ bookId: string; cutoverAt: string; status: 'active' | 'draft' | 'locked' | 'archived' }>

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new CutoverFinanceValidationError(`${field} is required`)
  }
  return value.trim()
}

function parseDate(value: string, field: string): string {
  const v = requiredText(value, field)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new CutoverFinanceValidationError(`${field} must be YYYY-MM-DD`)
  }
  const d = new Date(`${v}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) throw new CutoverFinanceValidationError(`${field} is not a valid date`)
  return v
}

function assertSafeInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new CutoverFinanceValidationError(`${field} must be a safe integer`)
  }
  return value
}

function claim(store: CutoverFinanceStore, key: string, message: string) {
  if (store.claims.has(key)) throw new CutoverFinanceValidationError(message)
  store.claims.add(key)
}

function hasFinanceRole(actor: FinanceActorContext, orgId: string, write: boolean): boolean {
  const isOrgAdmin = actor.membershipRole === 'owner' || actor.membershipRole === 'admin'
  if (isOrgAdmin) return true
  const roles = write
    ? ['finance_admin', 'accountant', 'finance_approver']
    : ['finance_admin', 'accountant', 'bookkeeper', 'finance_approver', 'auditor']
  return actor.assignments.some(
    (a) =>
      a.orgId === orgId &&
      a.userId === actor.uid &&
      a.status === 'active' &&
      roles.includes(a.role),
  )
}

function authorizeOrgFinanceAction(
  actor: FinanceActorContext,
  orgId: string,
  action: CutoverFinanceAction,
): void {
  if (!actor.membershipActive) throw new FinanceAuthorizationError('Active organization membership is required')
  if (actor.orgId !== orgId) throw new FinanceAuthorizationError('Actor organization does not match finance scope')
  if (!actor.financeModuleEnabled) throw new FinanceAuthorizationError('Persisted Finance module capability is required')
  const write = action !== 'cutover.read'
  if (!hasFinanceRole(actor, orgId, write)) {
    throw new FinanceAuthorizationError(`Finance role or org admin required for ${action}`)
  }
  if (action === 'cutover.package.approve' || action === 'cutover.package.activate') {
    const isOrgAdmin = actor.membershipRole === 'owner' || actor.membershipRole === 'admin'
    const isApprover = actor.assignments.some(
      (a) =>
        a.orgId === orgId &&
        a.userId === actor.uid &&
        a.status === 'active' &&
        (a.role === 'finance_admin' || a.role === 'finance_approver'),
    )
    if (!isOrgAdmin && !isApprover) {
      throw new FinanceAuthorizationError(`Finance approver or admin required for ${action}`)
    }
  }
  if (actor.delegationId) {
    if (actor.delegationOrgId !== orgId) {
      throw new FinanceAuthorizationError('Delegation organization does not match finance scope')
    }
    const scopes = actor.delegationScopes ?? []
    const ok =
      scopes.includes('finance:*') ||
      scopes.some((s) => s.startsWith('finance:')) ||
      scopes.includes(`finance:${action}`) ||
      scopes.includes('finance:cutover:*')
    if (!ok) throw new FinanceAuthorizationError('Delegation does not grant finance cutover access')
  }
}

function normalizeLine(line: CutoverTrialBalanceLine, index: number): CutoverTrialBalanceLine {
  const accountId = requiredText(line.accountId, `trialBalanceLines[${index}].accountId`)
  const debitMinor = assertSafeInt(line.debitMinor, `trialBalanceLines[${index}].debitMinor`)
  const creditMinor = assertSafeInt(line.creditMinor, `trialBalanceLines[${index}].creditMinor`)
  if (debitMinor < 0 || creditMinor < 0) {
    throw new CutoverFinanceValidationError(`trialBalanceLines[${index}] amounts must be non-negative`)
  }
  if (debitMinor > 0 && creditMinor > 0) {
    throw new CutoverFinanceValidationError(`trialBalanceLines[${index}] cannot have both debit and credit`)
  }
  if (debitMinor === 0 && creditMinor === 0) {
    throw new CutoverFinanceValidationError(`trialBalanceLines[${index}] must have a non-zero debit or credit`)
  }
  return {
    accountId,
    debitMinor,
    creditMinor,
    ...(line.accountCode ? { accountCode: String(line.accountCode) } : {}),
    ...(line.accountName ? { accountName: String(line.accountName) } : {}),
    ...(line.controlAccountRole ? { controlAccountRole: line.controlAccountRole } : {}),
  }
}

function normalizeOpenItem(item: CutoverOpeningOpenItem, index: number): CutoverOpeningOpenItem {
  const id = requiredText(item.id, `openingOpenItems[${index}].id`)
  const originalMinor = assertSafeInt(item.originalMinor, `openingOpenItems[${index}].originalMinor`)
  if (originalMinor <= 0) {
    throw new CutoverFinanceValidationError(`openingOpenItems[${index}].originalMinor must be positive`)
  }
  const role = item.counterpartyRole
  if (role !== 'customer' && role !== 'supplier') {
    throw new CutoverFinanceValidationError(`openingOpenItems[${index}].counterpartyRole must be customer|supplier`)
  }
  return {
    id,
    counterpartyCompanyId: requiredText(item.counterpartyCompanyId, `openingOpenItems[${index}].counterpartyCompanyId`),
    counterpartyRole: role,
    currency: requiredText(item.currency, `openingOpenItems[${index}].currency`).toUpperCase(),
    originalMinor,
    dueDate: parseDate(item.dueDate, `openingOpenItems[${index}].dueDate`),
    taxDate: parseDate(item.taxDate, `openingOpenItems[${index}].taxDate`),
    controlAccountId: requiredText(item.controlAccountId, `openingOpenItems[${index}].controlAccountId`),
    legacySourceRef: requiredText(item.legacySourceRef, `openingOpenItems[${index}].legacySourceRef`),
    ...(item.description ? { description: String(item.description) } : {}),
  }
}

function normalizePayrollYtd(row: CutoverPayrollYtdOpening, index: number): CutoverPayrollYtdOpening {
  return {
    id: requiredText(row.id, `payrollYtdOpenings[${index}].id`),
    employeeId: requiredText(row.employeeId, `payrollYtdOpenings[${index}].employeeId`),
    taxYearId: requiredText(row.taxYearId, `payrollYtdOpenings[${index}].taxYearId`),
    componentCode: requiredText(row.componentCode, `payrollYtdOpenings[${index}].componentCode`),
    amountMinor: assertSafeInt(row.amountMinor, `payrollYtdOpenings[${index}].amountMinor`),
    currency: requiredText(row.currency, `payrollYtdOpenings[${index}].currency`).toUpperCase(),
    ...(row.sourceEvidenceRef ? { sourceEvidenceRef: String(row.sourceEvidenceRef) } : {}),
  }
}

function normalizeTaxSnapshot(row: CutoverTaxStateSnapshot, index: number): CutoverTaxStateSnapshot {
  return {
    id: requiredText(row.id, `taxStateSnapshots[${index}].id`),
    description: requiredText(row.description, `taxStateSnapshots[${index}].description`),
    balanceMinor: assertSafeInt(row.balanceMinor, `taxStateSnapshots[${index}].balanceMinor`),
    currency: requiredText(row.currency, `taxStateSnapshots[${index}].currency`).toUpperCase(),
    ...(row.taxPeriodId ? { taxPeriodId: String(row.taxPeriodId) } : {}),
    ...(row.taxCodeId ? { taxCodeId: String(row.taxCodeId) } : {}),
    ...(row.sourceEvidenceRef ? { sourceEvidenceRef: String(row.sourceEvidenceRef) } : {}),
  }
}

export function computeCutoverTotals(input: {
  trialBalanceLines: CutoverTrialBalanceLine[]
  openingOpenItems: CutoverOpeningOpenItem[]
}): {
  totalDebitMinor: number
  totalCreditMinor: number
  receivablesControlTotalMinor: number
  payablesControlTotalMinor: number
  openItemCustomerTotalMinor: number
  openItemSupplierTotalMinor: number
} {
  let totalDebitMinor = 0
  let totalCreditMinor = 0
  let receivablesControlTotalMinor = 0
  let payablesControlTotalMinor = 0
  for (const line of input.trialBalanceLines) {
    totalDebitMinor += line.debitMinor
    totalCreditMinor += line.creditMinor
    if (line.controlAccountRole === 'receivables') {
      receivablesControlTotalMinor += line.debitMinor - line.creditMinor
    }
    if (line.controlAccountRole === 'payables') {
      payablesControlTotalMinor += line.creditMinor - line.debitMinor
    }
  }
  let openItemCustomerTotalMinor = 0
  let openItemSupplierTotalMinor = 0
  for (const item of input.openingOpenItems) {
    if (item.counterpartyRole === 'customer') openItemCustomerTotalMinor += item.originalMinor
    else openItemSupplierTotalMinor += item.originalMinor
  }
  return {
    totalDebitMinor,
    totalCreditMinor,
    receivablesControlTotalMinor,
    payablesControlTotalMinor,
    openItemCustomerTotalMinor,
    openItemSupplierTotalMinor,
  }
}

export function validateCutoverPackageContents(pkg: Pick<
  CutoverPackage,
  | 'trialBalanceLines'
  | 'openingOpenItems'
  | 'cutoverAt'
  | 'periodId'
  | 'currency'
  | 'receivablesControlTotalMinor'
  | 'payablesControlTotalMinor'
  | 'openItemCustomerTotalMinor'
  | 'openItemSupplierTotalMinor'
  | 'totalDebitMinor'
  | 'totalCreditMinor'
>): string[] {
  const errors: string[] = []
  if (pkg.trialBalanceLines.length < 2) {
    errors.push('Opening trial balance requires at least two lines')
  }
  if (pkg.totalDebitMinor !== pkg.totalCreditMinor) {
    errors.push(
      `Trial balance is not balanced: debits ${pkg.totalDebitMinor} != credits ${pkg.totalCreditMinor}`,
    )
  }
  if (pkg.receivablesControlTotalMinor !== pkg.openItemCustomerTotalMinor) {
    errors.push(
      `Receivables control total ${pkg.receivablesControlTotalMinor} does not equal customer open items ${pkg.openItemCustomerTotalMinor}`,
    )
  }
  if (pkg.payablesControlTotalMinor !== pkg.openItemSupplierTotalMinor) {
    errors.push(
      `Payables control total ${pkg.payablesControlTotalMinor} does not equal supplier open items ${pkg.openItemSupplierTotalMinor}`,
    )
  }
  if (!pkg.cutoverAt || !pkg.periodId || !pkg.currency) {
    errors.push('cutoverAt, periodId, and currency are required')
  }
  const openIds = new Set<string>()
  for (const item of pkg.openingOpenItems) {
    if (openIds.has(item.id)) errors.push(`Duplicate opening open item id ${item.id}`)
    openIds.add(item.id)
  }
  return errors
}

export class CutoverFinanceService {
  constructor(
    private readonly load: () => Promise<CutoverFinanceStore>,
    private readonly save: (before: CutoverFinanceStore, after: CutoverFinanceStore) => Promise<void>,
    private readonly postOpeningJournal: OpeningJournalPoster,
    private readonly materializeOpenItems: OpeningOpenItemMaterializer,
    private readonly applyBookCutover: BookCutoverApplier,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  private async mutate<T>(fn: (store: CutoverFinanceStore) => Promise<T> | T): Promise<T> {
    const before = await this.load()
    const after = cloneCutoverStore(before)
    const result = await fn(after)
    await this.save(before, after)
    return result
  }

  async createPackage(actor: FinanceActorContext, command: CreateCutoverPackageCommand): Promise<CutoverPackage> {
    authorizeOrgFinanceAction(actor, command.orgId, 'cutover.package.create')
    const id = requiredText(command.id, 'id')
    const orgId = requiredText(command.orgId, 'orgId')
    const legalEntityId = requiredText(command.legalEntityId, 'legalEntityId')
    const bookId = requiredText(command.bookId, 'bookId')
    const periodId = requiredText(command.periodId, 'periodId')
    const currency = requiredText(command.currency, 'currency').toUpperCase()
    const cutoverAt = parseDate(command.cutoverAt, 'cutoverAt')
    const description = requiredText(command.description, 'description')
    requiredText(command.requestId, 'requestId')
    requiredText(command.idempotencyKey, 'idempotencyKey')

    const lines = (command.trialBalanceLines ?? []).map(normalizeLine)
    const openItems = (command.openingOpenItems ?? []).map(normalizeOpenItem)
    const payrollYtd = (command.payrollYtdOpenings ?? []).map(normalizePayrollYtd)
    const taxSnaps = (command.taxStateSnapshots ?? []).map(normalizeTaxSnapshot)
    const totals = computeCutoverTotals({ trialBalanceLines: lines, openingOpenItems: openItems })
    const now = this.now()

    return this.mutate((store) => {
      claim(store, `cutover_idem:${orgId}:${command.idempotencyKey}`, 'Idempotency key already used for cutover create')
      if (store.packages.has(id)) throw new CutoverFinanceValidationError('Cutover package already exists')
      if (store.bookCutoverClaims.has(`${orgId}:${bookId}`)) {
        throw new CutoverFinanceValidationError('Book already has an activated cutover package')
      }
      const pkg: CutoverPackage = {
        id,
        orgId,
        legalEntityId,
        bookId,
        periodId,
        currency,
        cutoverAt,
        status: 'draft',
        description,
        trialBalanceLines: lines,
        openingOpenItems: openItems,
        payrollYtdOpenings: payrollYtd,
        taxStateSnapshots: taxSnaps,
        ...totals,
        validationErrors: [],
        materializedOpenItemIds: [],
        createdBy: actor.uid,
        createdAt: now,
        updatedBy: actor.uid,
        updatedAt: now,
        schemaVersion: 1,
        version: 1,
        sarsSubmissionInitiated: false,
        externalPaymentInitiated: false,
      }
      store.packages.set(id, pkg)
      return pkg
    })
  }

  async updatePackage(actor: FinanceActorContext, command: UpdateCutoverPackageCommand): Promise<CutoverPackage> {
    authorizeOrgFinanceAction(actor, command.orgId, 'cutover.package.update')
    const id = requiredText(command.id, 'id')
    const orgId = requiredText(command.orgId, 'orgId')
    requiredText(command.requestId, 'requestId')
    requiredText(command.idempotencyKey, 'idempotencyKey')
    if (!Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 1) {
      throw new CutoverFinanceValidationError('expectedVersion must be a positive integer')
    }

    return this.mutate((store) => {
      claim(store, `cutover_idem:${orgId}:${command.idempotencyKey}`, 'Idempotency key already used for cutover update')
      const existing = store.packages.get(id)
      if (!existing || existing.orgId !== orgId) throw new CutoverFinanceNotFoundError('Cutover package not found')
      if (existing.status !== 'draft' && existing.status !== 'validated' && existing.status !== 'failed') {
        throw new CutoverFinanceValidationError(`Cannot update cutover package in status ${existing.status}`)
      }
      if (existing.version !== command.expectedVersion) {
        throw new CutoverFinanceValidationError('Cutover package version conflict')
      }
      const lines = command.trialBalanceLines
        ? command.trialBalanceLines.map(normalizeLine)
        : existing.trialBalanceLines
      const openItems = command.openingOpenItems
        ? command.openingOpenItems.map(normalizeOpenItem)
        : existing.openingOpenItems
      const payrollYtd = command.payrollYtdOpenings
        ? command.payrollYtdOpenings.map(normalizePayrollYtd)
        : existing.payrollYtdOpenings
      const taxSnaps = command.taxStateSnapshots
        ? command.taxStateSnapshots.map(normalizeTaxSnapshot)
        : existing.taxStateSnapshots
      const totals = computeCutoverTotals({ trialBalanceLines: lines, openingOpenItems: openItems })
      const now = this.now()
      const next: CutoverPackage = {
        ...existing,
        periodId: command.periodId ? requiredText(command.periodId, 'periodId') : existing.periodId,
        currency: command.currency ? requiredText(command.currency, 'currency').toUpperCase() : existing.currency,
        cutoverAt: command.cutoverAt ? parseDate(command.cutoverAt, 'cutoverAt') : existing.cutoverAt,
        description: command.description
          ? requiredText(command.description, 'description')
          : existing.description,
        trialBalanceLines: lines,
        openingOpenItems: openItems,
        payrollYtdOpenings: payrollYtd,
        taxStateSnapshots: taxSnaps,
        ...totals,
        status: 'draft',
        validationErrors: [],
        approvalId: undefined,
        approvalActorId: undefined,
        approvedAt: undefined,
        approvalReason: undefined,
        updatedAt: now,
        updatedBy: actor.uid,
        version: existing.version + 1,
        sarsSubmissionInitiated: false,
        externalPaymentInitiated: false,
      }
      store.packages.set(id, next)
      return next
    })
  }

  async validatePackage(actor: FinanceActorContext, command: ValidateCutoverPackageCommand): Promise<CutoverPackage> {
    authorizeOrgFinanceAction(actor, command.orgId, 'cutover.package.validate')
    const id = requiredText(command.id, 'id')
    const orgId = requiredText(command.orgId, 'orgId')
    requiredText(command.requestId, 'requestId')
    requiredText(command.idempotencyKey, 'idempotencyKey')

    return this.mutate((store) => {
      claim(store, `cutover_idem:${orgId}:${command.idempotencyKey}`, 'Idempotency key already used for cutover validate')
      const existing = store.packages.get(id)
      if (!existing || existing.orgId !== orgId) throw new CutoverFinanceNotFoundError('Cutover package not found')
      if (existing.status === 'activated') {
        throw new CutoverFinanceValidationError('Activated cutover package cannot be re-validated')
      }
      const errors = validateCutoverPackageContents(existing)
      const now = this.now()
      const next: CutoverPackage = {
        ...existing,
        status: errors.length === 0 ? 'validated' : 'failed',
        validationErrors: errors,
        updatedAt: now,
        updatedBy: actor.uid,
        version: existing.version + 1,
        sarsSubmissionInitiated: false,
        externalPaymentInitiated: false,
      }
      store.packages.set(id, next)
      return next
    })
  }

  async approvePackage(actor: FinanceActorContext, command: ApproveCutoverPackageCommand): Promise<CutoverPackage> {
    authorizeOrgFinanceAction(actor, command.orgId, 'cutover.package.approve')
    const id = requiredText(command.id, 'id')
    const orgId = requiredText(command.orgId, 'orgId')
    const approvalId = requiredText(command.approvalId, 'approvalId')
    const reason = requiredText(command.reason, 'reason')
    requiredText(command.requestId, 'requestId')
    requiredText(command.idempotencyKey, 'idempotencyKey')

    return this.mutate((store) => {
      claim(store, `cutover_idem:${orgId}:${command.idempotencyKey}`, 'Idempotency key already used for cutover approve')
      const existing = store.packages.get(id)
      if (!existing || existing.orgId !== orgId) throw new CutoverFinanceNotFoundError('Cutover package not found')
      if (existing.status !== 'validated') {
        throw new CutoverFinanceValidationError('Only validated cutover packages can be approved')
      }
      const errors = validateCutoverPackageContents(existing)
      if (errors.length > 0) {
        throw new CutoverFinanceValidationError(`Package failed re-validation: ${errors.join('; ')}`)
      }
      const now = this.now()
      const next: CutoverPackage = {
        ...existing,
        status: 'approved',
        approvalId,
        approvalActorId: actor.uid,
        approvedAt: now,
        approvalReason: reason,
        validationErrors: [],
        updatedAt: now,
        updatedBy: actor.uid,
        version: existing.version + 1,
        sarsSubmissionInitiated: false,
        externalPaymentInitiated: false,
      }
      store.packages.set(id, next)
      return next
    })
  }

  async activatePackage(actor: FinanceActorContext, command: ActivateCutoverPackageCommand): Promise<CutoverPackage> {
    authorizeOrgFinanceAction(actor, command.orgId, 'cutover.package.activate')
    const id = requiredText(command.id, 'id')
    const orgId = requiredText(command.orgId, 'orgId')
    requiredText(command.requestId, 'requestId')
    requiredText(command.idempotencyKey, 'idempotencyKey')

    const before = await this.load()
    const existing = before.packages.get(id)
    if (!existing || existing.orgId !== orgId) throw new CutoverFinanceNotFoundError('Cutover package not found')
    if (existing.status !== 'approved') {
      throw new CutoverFinanceValidationError('Only approved cutover packages can be activated')
    }
    const errors = validateCutoverPackageContents(existing)
    if (errors.length > 0) {
      throw new CutoverFinanceValidationError(`Package failed re-validation: ${errors.join('; ')}`)
    }
    const bookKey = `${orgId}:${existing.bookId}`
    if (before.bookCutoverClaims.has(bookKey) && before.bookCutoverClaims.get(bookKey) !== id) {
      throw new CutoverFinanceValidationError('Book already has an activated cutover package')
    }

    const journalEntryId = command.openingJournalEntryId || `jnl_open_${id}`
    const journal = await this.postOpeningJournal({
      actor,
      pkg: existing,
      journalEntryId,
      requestId: command.requestId,
      idempotencyKey: `${command.idempotencyKey}:journal`,
    })
    const openItems = await this.materializeOpenItems({
      actor,
      pkg: existing,
      requestId: command.requestId,
      idempotencyKey: `${command.idempotencyKey}:open_items`,
    })
    const book = await this.applyBookCutover({
      actor,
      pkg: existing,
      requestId: command.requestId,
      idempotencyKey: `${command.idempotencyKey}:book`,
    })

    return this.mutate((store) => {
      claim(store, `cutover_idem:${orgId}:${command.idempotencyKey}`, 'Idempotency key already used for cutover activate')
      const current = store.packages.get(id)
      if (!current || current.orgId !== orgId) throw new CutoverFinanceNotFoundError('Cutover package not found')
      if (current.status === 'activated') return current
      if (current.status !== 'approved') {
        throw new CutoverFinanceValidationError('Only approved cutover packages can be activated')
      }
      if (store.bookCutoverClaims.has(bookKey) && store.bookCutoverClaims.get(bookKey) !== id) {
        throw new CutoverFinanceValidationError('Book already has an activated cutover package')
      }
      const now = this.now()
      const next: CutoverPackage = {
        ...current,
        status: 'activated',
        activatedAt: now,
        activatedBy: actor.uid,
        openingJournalEntryId: journal.id,
        materializedOpenItemIds: openItems.openItemIds,
        updatedAt: now,
        updatedBy: actor.uid,
        version: current.version + 1,
        sarsSubmissionInitiated: false,
        externalPaymentInitiated: false,
        // Reflect applied book cutover date
        cutoverAt: book.cutoverAt || current.cutoverAt,
      }
      store.packages.set(id, next)
      store.bookCutoverClaims.set(bookKey, id)
      return next
    })
  }

  async listForOrg(
    actor: FinanceActorContext,
    orgId: string,
    opts?: { bookId?: string; packageId?: string },
  ): Promise<{ packages: CutoverPackage[]; gates: { sarsSubmissionInitiated: false; externalPaymentInitiated: false } }> {
    authorizeOrgFinanceAction(actor, orgId, 'cutover.read')
    const store = await this.load()
    let packages = [...store.packages.values()].filter((p) => p.orgId === orgId)
    if (opts?.bookId) packages = packages.filter((p) => p.bookId === opts.bookId)
    if (opts?.packageId) packages = packages.filter((p) => p.id === opts.packageId)
    packages.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return {
      packages,
      gates: { sarsSubmissionInitiated: false, externalPaymentInitiated: false },
    }
  }
}
