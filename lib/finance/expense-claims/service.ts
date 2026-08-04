import { FinanceAuthorizationError } from '@/lib/finance/policy'
import type { FinanceActorContext } from '@/lib/finance/types'
import type {
  ExpenseClaim,
  ExpenseClaimAuditEvent,
  ExpenseClaimFinanceAction,
  ExpenseClaimLine,
  ExpenseClaimOcrAssist,
  ExpenseClaimPostTarget,
  ExpenseClaimReceipt,
  ExpenseClaimTaxRateCode,
} from './types'

export class ExpenseClaimValidationError extends Error {
  readonly statusCode = 400
  constructor(message: string) {
    super(message)
    this.name = 'ExpenseClaimValidationError'
  }
}

export class ExpenseClaimNotFoundError extends Error {
  readonly statusCode = 404
  constructor(message: string) {
    super(message)
    this.name = 'ExpenseClaimNotFoundError'
  }
}

const APPROVER_ROLES = new Set(['finance_admin', 'accountant', 'finance_approver'])
const WRITE_ROLES = new Set(['finance_admin', 'accountant', 'bookkeeper'])
const READ_ROLES = new Set(['finance_admin', 'accountant', 'bookkeeper', 'finance_approver', 'finance_viewer'])

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new ExpenseClaimValidationError(`${field} is required`)
  return value.trim()
}

function assertIntMinor(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new ExpenseClaimValidationError(`${field} must be an integer minor amount`)
  }
  if (value < 0) throw new ExpenseClaimValidationError(`${field} must be >= 0`)
  return value
}

/** SA VAT helper — pure; standard rate 15%. */
export function vatMinorForNet(netMinor: number, taxRateCode: ExpenseClaimTaxRateCode): number {
  if (taxRateCode === 'za_std_15') return Math.round((netMinor * 15) / 100)
  return 0
}

export function normalizeClaimLine(input: {
  id: string
  description: string
  expenseAccountId: string
  netMinor: number
  taxRateCode: ExpenseClaimTaxRateCode
  projectId?: string
  category?: string
  /** When provided, must match computed VAT for the rate (human override rejected if mismatch). */
  vatMinor?: number
}): ExpenseClaimLine {
  const netMinor = assertIntMinor(input.netMinor, 'netMinor')
  const taxRateCode = input.taxRateCode
  if (!['za_std_15', 'za_zero', 'za_exempt', 'out_of_scope'].includes(taxRateCode)) {
    throw new ExpenseClaimValidationError('taxRateCode is invalid')
  }
  const expectedVat = vatMinorForNet(netMinor, taxRateCode)
  if (input.vatMinor !== undefined && input.vatMinor !== expectedVat) {
    throw new ExpenseClaimValidationError(
      `vatMinor ${input.vatMinor} does not match rate ${taxRateCode} for net ${netMinor} (expected ${expectedVat})`,
    )
  }
  const vatMinor = expectedVat
  const grossMinor = netMinor + vatMinor
  return {
    id: requiredText(input.id, 'line.id'),
    description: requiredText(input.description, 'line.description'),
    expenseAccountId: requiredText(input.expenseAccountId, 'line.expenseAccountId'),
    netMinor,
    taxRateCode,
    vatMinor,
    grossMinor,
    ...(input.projectId ? { projectId: input.projectId.trim() } : {}),
    ...(input.category ? { category: input.category.trim() } : {}),
  }
}

export function sumClaimLines(lines: ExpenseClaimLine[]): {
  netTotalMinor: number
  vatTotalMinor: number
  grossTotalMinor: number
} {
  let netTotalMinor = 0
  let vatTotalMinor = 0
  let grossTotalMinor = 0
  for (const line of lines) {
    netTotalMinor += line.netMinor
    vatTotalMinor += line.vatMinor
    grossTotalMinor += line.grossMinor
  }
  return { netTotalMinor, vatTotalMinor, grossTotalMinor }
}

/**
 * Lite OCR assist — deterministic heuristic from filename + optional text snippet.
 * Never auto-posts or auto-applies lines.
 */
export function buildOcrAssistSuggestion(input: {
  id: string
  claimId: string
  orgId: string
  receiptId: string
  fileName: string
  textSnippet?: string
  actorId: string
  nowIso: string
}): ExpenseClaimOcrAssist {
  const blob = `${input.fileName} ${input.textSnippet || ''}`.toLowerCase()
  let vendorGuess: string | undefined
  let taxRateCode: ExpenseClaimTaxRateCode = 'za_std_15'
  let netMinor = 100_00
  let confidence = 0.42
  if (blob.includes('woolworths') || blob.includes('checkers') || blob.includes('pick n pay')) {
    vendorGuess = 'SA grocery retail'
    netMinor = 450_00
    confidence = 0.62
  } else if (blob.includes('engen') || blob.includes('shell') || blob.includes('bp ') || blob.includes('fuel')) {
    vendorGuess = 'Fuel station'
    netMinor = 850_00
    confidence = 0.7
  } else if (blob.includes('uber') || blob.includes('bolt') || blob.includes('taxi')) {
    vendorGuess = 'Ride hailing'
    netMinor = 180_00
    confidence = 0.68
  } else if (blob.includes('zero') || blob.includes('export')) {
    taxRateCode = 'za_zero'
    netMinor = 200_00
    confidence = 0.5
  }
  // crude total parse R1,234.56 or 1234.56
  const m = blob.match(/r?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+\.[0-9]{2})/)
  if (m) {
    const major = Number(m[1].replace(/,/g, ''))
    if (Number.isFinite(major) && major > 0) {
      const gross = Math.round(major * 100)
      if (taxRateCode === 'za_std_15') {
        // reverse-out VAT from gross
        netMinor = Math.round(gross / 1.15)
      } else {
        netMinor = gross
      }
      confidence = Math.min(0.85, confidence + 0.15)
    }
  }
  const vatMinor = vatMinorForNet(netMinor, taxRateCode)
  const grossMinor = netMinor + vatMinor
  return {
    id: input.id,
    claimId: input.claimId,
    orgId: input.orgId,
    receiptId: input.receiptId,
    status: 'suggested',
    vendorGuess,
    dateGuess: input.nowIso.slice(0, 10),
    totalGrossMinorGuess: grossMinor,
    currencyGuess: 'ZAR',
    lineGuesses: [
      {
        description: vendorGuess ? `${vendorGuess} (OCR assist — confirm)` : 'Receipt line (OCR assist — confirm)',
        netMinor,
        taxRateCode,
        vatMinor,
        grossMinor,
      },
    ],
    confidence,
    rawTextSnippet: input.textSnippet?.slice(0, 240),
    createdAt: input.nowIso,
    createdBy: input.actorId,
    autoPosted: false,
    autoApplied: false,
    externalPaymentInitiated: false,
    schemaVersion: 1,
  }
}

function assertFinanceMembership(actor: FinanceActorContext, orgId: string, action: ExpenseClaimFinanceAction) {
  if (!actor.membershipActive) throw new FinanceAuthorizationError('Active organization membership is required')
  if (actor.orgId !== orgId) throw new FinanceAuthorizationError('Actor organization does not match finance scope')
  if (!actor.financeModuleEnabled) throw new FinanceAuthorizationError('Persisted Finance module capability is required')
  const isOrgAdmin = actor.membershipRole === 'owner' || actor.membershipRole === 'admin'
  const approveActions = new Set<ExpenseClaimFinanceAction>([
    'expense_claim.approve',
    'expense_claim.reject',
    'expense_claim.bulk_approve',
    'expense_claim.post',
    'expense_claim.payment_instruction.export',
  ])
  const rolesNeeded = action === 'expense_claim.read' ? READ_ROLES : approveActions.has(action) ? APPROVER_ROLES : WRITE_ROLES
  const has = actor.assignments.some(
    (a) => a.orgId === orgId && a.userId === actor.uid && a.status === 'active' && rolesNeeded.has(a.role),
  )
  if (!isOrgAdmin && !has) {
    throw new FinanceAuthorizationError(`Finance role required for ${action}`)
  }
  if (actor.delegationId) {
    if (actor.delegationOrgId !== orgId) {
      throw new FinanceAuthorizationError('Delegation organization does not match finance scope')
    }
    const scopes = actor.delegationScopes ?? []
    const ok =
      scopes.includes('finance:*') ||
      scopes.some((s) => s.startsWith('finance:')) ||
      scopes.includes(`finance:${action}`)
    if (!ok) throw new FinanceAuthorizationError('Delegation does not grant expense claim access')
  }
}

export interface ExpenseClaimStore {
  claims: Map<string, ExpenseClaim>
  receipts: Map<string, ExpenseClaimReceipt>
  ocrAssists: Map<string, ExpenseClaimOcrAssist>
  auditEvents: Map<string, ExpenseClaimAuditEvent>
  claimsKeys: Set<string>
  idempotency: Map<string, string>
}

export function createEmptyExpenseClaimStore(): ExpenseClaimStore {
  return {
    claims: new Map(),
    receipts: new Map(),
    ocrAssists: new Map(),
    auditEvents: new Map(),
    claimsKeys: new Set(),
    idempotency: new Map(),
  }
}

export function cloneExpenseClaimStore(store: ExpenseClaimStore): ExpenseClaimStore {
  return {
    claims: new Map(store.claims),
    receipts: new Map(store.receipts),
    ocrAssists: new Map(store.ocrAssists),
    auditEvents: new Map(store.auditEvents),
    claimsKeys: new Set(store.claimsKeys),
    idempotency: new Map(store.idempotency),
  }
}

function claimKey(store: ExpenseClaimStore, key: string, message: string) {
  if (store.claimsKeys.has(key)) throw new ExpenseClaimValidationError(message)
  store.claimsKeys.add(key)
}

function appendAudit(
  store: ExpenseClaimStore,
  event: Omit<ExpenseClaimAuditEvent, 'schemaVersion' | 'externalEgressAllowed' | 'externalPaymentInitiated' | 'autoPosted'>,
) {
  const full: ExpenseClaimAuditEvent = {
    ...event,
    schemaVersion: 1,
    externalEgressAllowed: false,
    externalPaymentInitiated: false,
    autoPosted: false,
  }
  store.auditEvents.set(full.id, full)
}

function scopeMatch(c: ExpenseClaim, orgId: string, legalEntityId?: string, bookId?: string) {
  if (c.orgId !== orgId) return false
  if (legalEntityId && c.legalEntityId !== legalEntityId) return false
  if (bookId && c.bookId !== bookId) return false
  return true
}

function loadClaim(store: ExpenseClaimStore, orgId: string, id: string): ExpenseClaim {
  const c = store.claims.get(id)
  if (!c || c.orgId !== orgId) throw new ExpenseClaimNotFoundError('Expense claim not found')
  return c
}

function withIdempotency<T extends { id: string }>(
  store: ExpenseClaimStore,
  orgId: string,
  idempotencyKey: string,
  op: string,
  create: () => T,
): T {
  const key = `${orgId}|${op}|${idempotencyKey}`
  const existingId = store.idempotency.get(key)
  if (existingId) {
    // Prefer claim map, then ocr, then receipt
    const hit =
      store.claims.get(existingId) ||
      store.ocrAssists.get(existingId) ||
      store.receipts.get(existingId) ||
      ([...store.claims.values()].find((c) => c.paymentInstructionExport?.packId === existingId) as unknown as T | undefined)
    if (hit) return hit as T
  }
  const created = create()
  store.idempotency.set(key, created.id)
  return created
}

export interface CreateExpenseClaimCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  payeeName: string
  claimDate: string
  currency?: string
  vendor?: string
  policyNotes?: string
  employeeId?: string
  employeeLinkedUserId?: string
  payeeUserId?: string
  lines: Array<{
    id: string
    description: string
    expenseAccountId: string
    netMinor: number
    taxRateCode: ExpenseClaimTaxRateCode
    vatMinor?: number
    projectId?: string
    category?: string
  }>
  requestId: string
  idempotencyKey: string
}

export interface UpdateExpenseClaimCommand {
  id: string
  orgId: string
  expectedVersion: number
  payeeName?: string
  claimDate?: string
  vendor?: string
  policyNotes?: string
  employeeId?: string
  employeeLinkedUserId?: string
  payeeUserId?: string
  lines?: CreateExpenseClaimCommand['lines']
  requestId: string
  idempotencyKey: string
}

export interface ClaimLifecycleCommand {
  id: string
  orgId: string
  note?: string
  requestId: string
  idempotencyKey: string
}

export interface BulkApproveCommand {
  orgId: string
  legalEntityId: string
  bookId: string
  claimIds: string[]
  note?: string
  requestId: string
  idempotencyKey: string
}

export interface PostClaimCommand {
  id: string
  orgId: string
  postTarget: ExpenseClaimPostTarget
  /** Control / payable / cash clearing account for credit side. */
  creditAccountId: string
  /** Optional VAT control account when vatTotal > 0 (defaults to credit split on expense only if omitted — requires when vat>0). */
  vatControlAccountId?: string
  requestId: string
  idempotencyKey: string
}

export interface AttachReceiptCommand {
  id: string
  orgId: string
  claimId: string
  fileName: string
  contentType: ExpenseClaimReceipt['contentType']
  storageRefId: string
  byteSize?: number
  requestId: string
  idempotencyKey: string
}

export interface OcrAssistCommand {
  id: string
  orgId: string
  claimId: string
  receiptId: string
  textSnippet?: string
  requestId: string
  idempotencyKey: string
}

export interface OcrResolveCommand {
  id: string
  orgId: string
  /** When confirming, lines are applied into the draft claim (human confirm). */
  applyLines?: boolean
  defaultExpenseAccountId?: string
  requestId: string
  idempotencyKey: string
}

export interface ExportPaymentInstructionCommand {
  id: string
  orgId: string
  claimId: string
  format?: 'eft_csv' | 'payroll_net_observe'
  requestId: string
  idempotencyKey: string
}

export interface ExpenseClaimListFilters {
  status?: ExpenseClaim['status'] | ExpenseClaim['status'][]
  employeeId?: string
  payeeUserId?: string
  employeeLinkedUserId?: string
  vendorContains?: string
  fromDate?: string
  toDate?: string
  minGrossMinor?: number
  maxGrossMinor?: number
  hasReceipt?: boolean
}

export function filterExpenseClaims(claims: ExpenseClaim[], filters: ExpenseClaimListFilters = {}): ExpenseClaim[] {
  const statuses = filters.status
    ? Array.isArray(filters.status)
      ? new Set(filters.status)
      : new Set([filters.status])
    : null
  return claims.filter((c) => {
    if (statuses && !statuses.has(c.status)) return false
    if (filters.employeeId && c.employeeId !== filters.employeeId) return false
    if (filters.payeeUserId && c.payeeUserId !== filters.payeeUserId) return false
    if (filters.employeeLinkedUserId && c.employeeLinkedUserId !== filters.employeeLinkedUserId) return false
    if (filters.vendorContains) {
      const v = (c.vendor || '').toLowerCase()
      if (!v.includes(filters.vendorContains.toLowerCase())) return false
    }
    if (filters.fromDate && c.claimDate < filters.fromDate) return false
    if (filters.toDate && c.claimDate > filters.toDate) return false
    if (filters.minGrossMinor !== undefined && c.grossTotalMinor < filters.minGrossMinor) return false
    if (filters.maxGrossMinor !== undefined && c.grossTotalMinor > filters.maxGrossMinor) return false
    if (filters.hasReceipt === true && c.receiptIds.length === 0) return false
    if (filters.hasReceipt === false && c.receiptIds.length > 0) return false
    return true
  })
}

export function buildPostJournalProposal(
  claim: ExpenseClaim,
  creditAccountId: string,
  vatControlAccountId?: string,
): NonNullable<ExpenseClaim['journalProposal']> {
  if (claim.lines.length === 0) throw new ExpenseClaimValidationError('Cannot post claim with no lines')
  const lines: NonNullable<ExpenseClaim['journalProposal']>['lines'] = []
  for (const line of claim.lines) {
    lines.push({
      accountId: line.expenseAccountId,
      debitMinor: line.netMinor,
      creditMinor: 0,
      description: line.description,
    })
  }
  if (claim.vatTotalMinor > 0) {
    const vatAcc = requiredText(vatControlAccountId, 'vatControlAccountId')
    lines.push({
      accountId: vatAcc,
      debitMinor: claim.vatTotalMinor,
      creditMinor: 0,
      description: `VAT on expense claim ${claim.id}`,
    })
  }
  lines.push({
    accountId: requiredText(creditAccountId, 'creditAccountId'),
    debitMinor: 0,
    creditMinor: claim.grossTotalMinor,
    description:
      claim.postTarget === 'payable' || true
        ? `Expense claim ${claim.id} payable / clearing`
        : `Expense claim ${claim.id}`,
  })
  const debit = lines.reduce((s, l) => s + l.debitMinor, 0)
  const credit = lines.reduce((s, l) => s + l.creditMinor, 0)
  if (debit !== credit) {
    throw new ExpenseClaimValidationError(`Unbalanced journal proposal debit=${debit} credit=${credit}`)
  }
  return { purpose: 'expense_claim.post', balanced: true, lines }
}

export class ExpenseClaimFinanceService {
  constructor(
    private readonly load: () => Promise<ExpenseClaimStore>,
    private readonly save: (before: ExpenseClaimStore, after: ExpenseClaimStore) => Promise<void>,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  private async tx<T>(fn: (store: ExpenseClaimStore) => T | Promise<T>): Promise<T> {
    const before = await this.load()
    const after = cloneExpenseClaimStore(before)
    const result = await fn(after)
    await this.save(before, after)
    return result
  }

  async createClaim(actor: FinanceActorContext, command: CreateExpenseClaimCommand): Promise<ExpenseClaim> {
    assertFinanceMembership(actor, command.orgId, 'expense_claim.create')
    return this.tx((store) =>
      withIdempotency(store, command.orgId, command.idempotencyKey, 'create', () => {
        if (store.claims.has(command.id)) throw new ExpenseClaimValidationError('Claim id already exists')
        const lines = (command.lines || []).map((l) => normalizeClaimLine(l))
        if (lines.length === 0) throw new ExpenseClaimValidationError('At least one line is required')
        const totals = sumClaimLines(lines)
        const now = this.now()
        const claim: ExpenseClaim = {
          id: requiredText(command.id, 'id'),
          orgId: requiredText(command.orgId, 'orgId'),
          legalEntityId: requiredText(command.legalEntityId, 'legalEntityId'),
          bookId: requiredText(command.bookId, 'bookId'),
          status: 'draft',
          employeeId: command.employeeId?.trim() || undefined,
          employeeLinkedUserId: command.employeeLinkedUserId?.trim() || undefined,
          payeeName: requiredText(command.payeeName, 'payeeName'),
          payeeUserId: command.payeeUserId?.trim() || undefined,
          claimDate: requiredText(command.claimDate, 'claimDate'),
          currency: (command.currency || 'ZAR').toUpperCase(),
          vendor: command.vendor?.trim() || undefined,
          policyNotes: command.policyNotes?.trim() || undefined,
          lines,
          ...totals,
          receiptIds: [],
          schemaVersion: 1,
          version: 1,
          createdBy: actor.uid,
          createdAt: now,
          updatedBy: actor.uid,
          updatedAt: now,
          externalPaymentInitiated: false,
          externalEgressAllowed: false,
          sarsSubmissionInitiated: false,
          autoPosted: false,
        }
        store.claims.set(claim.id, claim)
        appendAudit(store, {
          id: `aud_${command.requestId}_create`,
          orgId: claim.orgId,
          legalEntityId: claim.legalEntityId,
          bookId: claim.bookId,
          claimId: claim.id,
          eventType: 'claim.created',
          actorId: actor.uid,
          at: now,
          detail: `Draft claim ${claim.id} gross=${claim.grossTotalMinor}`,
        })
        return claim
      }),
    )
  }

  async updateClaim(actor: FinanceActorContext, command: UpdateExpenseClaimCommand): Promise<ExpenseClaim> {
    assertFinanceMembership(actor, command.orgId, 'expense_claim.update')
    return this.tx((store) => {
      const existing = loadClaim(store, command.orgId, command.id)
      if (existing.status !== 'draft' && existing.status !== 'rejected') {
        throw new ExpenseClaimValidationError('Only draft or rejected claims can be updated')
      }
      if (existing.version !== command.expectedVersion) {
        throw new ExpenseClaimValidationError('expectedVersion mismatch')
      }
      const lines = command.lines ? command.lines.map((l) => normalizeClaimLine(l)) : existing.lines
      if (lines.length === 0) throw new ExpenseClaimValidationError('At least one line is required')
      const totals = sumClaimLines(lines)
      const now = this.now()
      const next: ExpenseClaim = {
        ...existing,
        payeeName: command.payeeName !== undefined ? requiredText(command.payeeName, 'payeeName') : existing.payeeName,
        claimDate: command.claimDate !== undefined ? requiredText(command.claimDate, 'claimDate') : existing.claimDate,
        vendor: command.vendor !== undefined ? command.vendor.trim() || undefined : existing.vendor,
        policyNotes: command.policyNotes !== undefined ? command.policyNotes.trim() || undefined : existing.policyNotes,
        employeeId: command.employeeId !== undefined ? command.employeeId.trim() || undefined : existing.employeeId,
        employeeLinkedUserId:
          command.employeeLinkedUserId !== undefined
            ? command.employeeLinkedUserId.trim() || undefined
            : existing.employeeLinkedUserId,
        payeeUserId: command.payeeUserId !== undefined ? command.payeeUserId.trim() || undefined : existing.payeeUserId,
        lines,
        ...totals,
        status: existing.status === 'rejected' ? 'draft' : existing.status,
        version: existing.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
        externalPaymentInitiated: false,
        externalEgressAllowed: false,
        sarsSubmissionInitiated: false,
        autoPosted: false,
      }
      store.claims.set(next.id, next)
      appendAudit(store, {
        id: `aud_${command.requestId}_upd`,
        orgId: next.orgId,
        legalEntityId: next.legalEntityId,
        bookId: next.bookId,
        claimId: next.id,
        eventType: 'claim.updated',
        actorId: actor.uid,
        at: now,
        detail: `Updated claim v${next.version}`,
      })
      return next
    })
  }

  async submitClaim(actor: FinanceActorContext, command: ClaimLifecycleCommand): Promise<ExpenseClaim> {
    assertFinanceMembership(actor, command.orgId, 'expense_claim.submit')
    return this.tx((store) => {
      const existing = loadClaim(store, command.orgId, command.id)
      if (existing.status !== 'draft') throw new ExpenseClaimValidationError('Only draft claims can be submitted')
      if (existing.lines.length === 0) throw new ExpenseClaimValidationError('Cannot submit empty claim')
      const now = this.now()
      const next: ExpenseClaim = {
        ...existing,
        status: 'submitted',
        submittedAt: now,
        submittedBy: actor.uid,
        version: existing.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
        externalPaymentInitiated: false,
        autoPosted: false,
      }
      store.claims.set(next.id, next)
      appendAudit(store, {
        id: `aud_${command.requestId}_sub`,
        orgId: next.orgId,
        legalEntityId: next.legalEntityId,
        bookId: next.bookId,
        claimId: next.id,
        eventType: 'claim.submitted',
        actorId: actor.uid,
        at: now,
        detail: command.note || 'Submitted for approval',
      })
      return next
    })
  }

  async approveClaim(actor: FinanceActorContext, command: ClaimLifecycleCommand): Promise<ExpenseClaim> {
    assertFinanceMembership(actor, command.orgId, 'expense_claim.approve')
    return this.tx((store) => this.approveOne(store, actor, command.id, command.orgId, command.note, command.requestId))
  }

  private approveOne(
    store: ExpenseClaimStore,
    actor: FinanceActorContext,
    id: string,
    orgId: string,
    note: string | undefined,
    requestId: string,
  ): ExpenseClaim {
    const existing = loadClaim(store, orgId, id)
    if (existing.status !== 'submitted') throw new ExpenseClaimValidationError(`Claim ${id} is not submitted`)
    // Soft SOD: submitter should not approve unless org owner/admin
    const isOrgAdmin = actor.membershipRole === 'owner' || actor.membershipRole === 'admin'
    if (existing.submittedBy === actor.uid && !isOrgAdmin) {
      throw new ExpenseClaimValidationError('Submitter cannot approve own claim (separation of duties)')
    }
    const now = this.now()
    const next: ExpenseClaim = {
      ...existing,
      status: 'approved',
      reviewedAt: now,
      reviewedBy: actor.uid,
      reviewNote: note?.trim() || undefined,
      version: existing.version + 1,
      updatedAt: now,
      updatedBy: actor.uid,
      externalPaymentInitiated: false,
      autoPosted: false,
    }
    store.claims.set(next.id, next)
    appendAudit(store, {
      id: `aud_${requestId}_apr_${id}`,
      orgId: next.orgId,
      legalEntityId: next.legalEntityId,
      bookId: next.bookId,
      claimId: next.id,
      eventType: 'claim.approved',
      actorId: actor.uid,
      at: now,
      detail: note || 'Approved',
    })
    return next
  }

  async rejectClaim(actor: FinanceActorContext, command: ClaimLifecycleCommand): Promise<ExpenseClaim> {
    assertFinanceMembership(actor, command.orgId, 'expense_claim.reject')
    return this.tx((store) => {
      const existing = loadClaim(store, command.orgId, command.id)
      if (existing.status !== 'submitted') throw new ExpenseClaimValidationError('Only submitted claims can be rejected')
      const now = this.now()
      const next: ExpenseClaim = {
        ...existing,
        status: 'rejected',
        reviewedAt: now,
        reviewedBy: actor.uid,
        reviewNote: requiredText(command.note, 'note'),
        version: existing.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
        externalPaymentInitiated: false,
        autoPosted: false,
      }
      store.claims.set(next.id, next)
      appendAudit(store, {
        id: `aud_${command.requestId}_rej`,
        orgId: next.orgId,
        legalEntityId: next.legalEntityId,
        bookId: next.bookId,
        claimId: next.id,
        eventType: 'claim.rejected',
        actorId: actor.uid,
        at: now,
        detail: next.reviewNote || 'Rejected',
      })
      return next
    })
  }

  async bulkApprove(actor: FinanceActorContext, command: BulkApproveCommand): Promise<{ approved: ExpenseClaim[]; count: number }> {
    assertFinanceMembership(actor, command.orgId, 'expense_claim.bulk_approve')
    if (!command.claimIds?.length) throw new ExpenseClaimValidationError('claimIds required')
    return this.tx((store) => {
      const approved: ExpenseClaim[] = []
      for (const id of command.claimIds) {
        const c = loadClaim(store, command.orgId, id)
        if (c.legalEntityId !== command.legalEntityId || c.bookId !== command.bookId) {
          throw new ExpenseClaimNotFoundError('Expense claim not found')
        }
        approved.push(this.approveOne(store, actor, id, command.orgId, command.note, `${command.requestId}_${id}`))
      }
      appendAudit(store, {
        id: `aud_${command.requestId}_bulk`,
        orgId: command.orgId,
        legalEntityId: command.legalEntityId,
        bookId: command.bookId,
        claimId: command.claimIds[0],
        eventType: 'claim.bulk_approved',
        actorId: actor.uid,
        at: this.now(),
        detail: `Bulk approved ${approved.length} claims`,
      })
      return { approved, count: approved.length }
    })
  }

  async postClaim(actor: FinanceActorContext, command: PostClaimCommand): Promise<ExpenseClaim> {
    assertFinanceMembership(actor, command.orgId, 'expense_claim.post')
    return this.tx((store) => {
      const existing = loadClaim(store, command.orgId, command.id)
      if (existing.status !== 'approved') throw new ExpenseClaimValidationError('Only approved claims can be posted')
      claimKey(store, `post:${existing.id}`, 'Claim already posted')
      const proposal = buildPostJournalProposal(
        { ...existing, postTarget: command.postTarget },
        command.creditAccountId,
        command.vatControlAccountId,
      )
      const now = this.now()
      const next: ExpenseClaim = {
        ...existing,
        status: 'posted',
        postedAt: now,
        postedBy: actor.uid,
        postTarget: command.postTarget,
        postRefId: `post_${existing.id}`,
        journalProposal: proposal,
        version: existing.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
        externalPaymentInitiated: false,
        externalEgressAllowed: false,
        sarsSubmissionInitiated: false,
        autoPosted: false,
      }
      store.claims.set(next.id, next)
      appendAudit(store, {
        id: `aud_${command.requestId}_post`,
        orgId: next.orgId,
        legalEntityId: next.legalEntityId,
        bookId: next.bookId,
        claimId: next.id,
        eventType: 'claim.posted',
        actorId: actor.uid,
        at: now,
        detail: `Posted as ${command.postTarget}; balanced=${proposal.balanced}; no payment initiate`,
      })
      return next
    })
  }

  async attachReceipt(actor: FinanceActorContext, command: AttachReceiptCommand): Promise<ExpenseClaimReceipt> {
    assertFinanceMembership(actor, command.orgId, 'expense_claim.receipt.attach')
    return this.tx((store) =>
      withIdempotency(store, command.orgId, command.idempotencyKey, 'receipt', () => {
        const claim = loadClaim(store, command.orgId, command.claimId)
        if (claim.status !== 'draft' && claim.status !== 'rejected' && claim.status !== 'submitted') {
          throw new ExpenseClaimValidationError('Cannot attach receipt in current status')
        }
        const allowed: ExpenseClaimReceipt['contentType'][] = [
          'image/jpeg',
          'image/png',
          'image/webp',
          'application/pdf',
          'image/heic',
        ]
        if (!allowed.includes(command.contentType)) {
          throw new ExpenseClaimValidationError('contentType must be image/pdf receipt type')
        }
        const now = this.now()
        const receipt: ExpenseClaimReceipt = {
          id: requiredText(command.id, 'id'),
          claimId: claim.id,
          orgId: claim.orgId,
          fileName: requiredText(command.fileName, 'fileName'),
          contentType: command.contentType,
          storageRefId: requiredText(command.storageRefId, 'storageRefId'),
          byteSize: command.byteSize,
          uploadedBy: actor.uid,
          uploadedAt: now,
          schemaVersion: 1,
        }
        store.receipts.set(receipt.id, receipt)
        const next: ExpenseClaim = {
          ...claim,
          receiptIds: claim.receiptIds.includes(receipt.id) ? claim.receiptIds : [...claim.receiptIds, receipt.id],
          version: claim.version + 1,
          updatedAt: now,
          updatedBy: actor.uid,
        }
        store.claims.set(next.id, next)
        appendAudit(store, {
          id: `aud_${command.requestId}_rcpt`,
          orgId: claim.orgId,
          legalEntityId: claim.legalEntityId,
          bookId: claim.bookId,
          claimId: claim.id,
          eventType: 'receipt.attached',
          actorId: actor.uid,
          at: now,
          detail: `Receipt ${receipt.fileName} (${receipt.contentType})`,
        })
        return receipt
      }),
    )
  }

  async runOcrAssist(actor: FinanceActorContext, command: OcrAssistCommand): Promise<ExpenseClaimOcrAssist> {
    assertFinanceMembership(actor, command.orgId, 'expense_claim.ocr.assist')
    return this.tx((store) =>
      withIdempotency(store, command.orgId, command.idempotencyKey, 'ocr', () => {
        const claim = loadClaim(store, command.orgId, command.claimId)
        const receipt = store.receipts.get(command.receiptId)
        if (!receipt || receipt.orgId !== command.orgId || receipt.claimId !== claim.id) {
          throw new ExpenseClaimNotFoundError('Receipt not found')
        }
        const assist = buildOcrAssistSuggestion({
          id: requiredText(command.id, 'id'),
          claimId: claim.id,
          orgId: claim.orgId,
          receiptId: receipt.id,
          fileName: receipt.fileName,
          textSnippet: command.textSnippet,
          actorId: actor.uid,
          nowIso: this.now(),
        })
        store.ocrAssists.set(assist.id, assist)
        appendAudit(store, {
          id: `aud_${command.requestId}_ocr`,
          orgId: claim.orgId,
          legalEntityId: claim.legalEntityId,
          bookId: claim.bookId,
          claimId: claim.id,
          eventType: 'ocr.suggested',
          actorId: actor.uid,
          at: assist.createdAt,
          detail: `OCR assist suggested (autoApplied=false conf=${assist.confidence})`,
        })
        return assist
      }),
    )
  }

  async confirmOcr(actor: FinanceActorContext, command: OcrResolveCommand): Promise<ExpenseClaimOcrAssist> {
    assertFinanceMembership(actor, command.orgId, 'expense_claim.ocr.confirm')
    return this.tx((store) => {
      const assist = store.ocrAssists.get(command.id)
      if (!assist || assist.orgId !== command.orgId) throw new ExpenseClaimNotFoundError('OCR assist not found')
      if (assist.status !== 'suggested') throw new ExpenseClaimValidationError('OCR assist already resolved')
      const claim = loadClaim(store, command.orgId, assist.claimId)
      if (claim.status !== 'draft' && claim.status !== 'rejected') {
        throw new ExpenseClaimValidationError('OCR confirm only on draft/rejected claims')
      }
      const now = this.now()
      const nextAssist: ExpenseClaimOcrAssist = {
        ...assist,
        status: 'confirmed',
        resolvedAt: now,
        resolvedBy: actor.uid,
        autoPosted: false,
        autoApplied: false,
        externalPaymentInitiated: false,
      }
      store.ocrAssists.set(nextAssist.id, nextAssist)
      if (command.applyLines) {
        const accountId = requiredText(command.defaultExpenseAccountId, 'defaultExpenseAccountId')
        const lines = assist.lineGuesses.map((g, i) =>
          normalizeClaimLine({
            id: `ocr_line_${assist.id}_${i}`,
            description: g.description,
            expenseAccountId: accountId,
            netMinor: g.netMinor,
            taxRateCode: g.taxRateCode,
          }),
        )
        const totals = sumClaimLines(lines)
        const nextClaim: ExpenseClaim = {
          ...claim,
          lines,
          ...totals,
          vendor: claim.vendor || assist.vendorGuess,
          version: claim.version + 1,
          updatedAt: now,
          updatedBy: actor.uid,
          status: claim.status === 'rejected' ? 'draft' : claim.status,
        }
        store.claims.set(nextClaim.id, nextClaim)
      }
      appendAudit(store, {
        id: `aud_${command.requestId}_ocr_ok`,
        orgId: claim.orgId,
        legalEntityId: claim.legalEntityId,
        bookId: claim.bookId,
        claimId: claim.id,
        eventType: 'ocr.confirmed',
        actorId: actor.uid,
        at: now,
        detail: command.applyLines ? 'OCR confirmed and lines applied by human' : 'OCR confirmed without line apply',
      })
      return nextAssist
    })
  }

  async dismissOcr(actor: FinanceActorContext, command: OcrResolveCommand): Promise<ExpenseClaimOcrAssist> {
    assertFinanceMembership(actor, command.orgId, 'expense_claim.ocr.dismiss')
    return this.tx((store) => {
      const assist = store.ocrAssists.get(command.id)
      if (!assist || assist.orgId !== command.orgId) throw new ExpenseClaimNotFoundError('OCR assist not found')
      if (assist.status !== 'suggested') throw new ExpenseClaimValidationError('OCR assist already resolved')
      const claim = loadClaim(store, command.orgId, assist.claimId)
      const now = this.now()
      const next: ExpenseClaimOcrAssist = {
        ...assist,
        status: 'dismissed',
        resolvedAt: now,
        resolvedBy: actor.uid,
        autoPosted: false,
        autoApplied: false,
        externalPaymentInitiated: false,
      }
      store.ocrAssists.set(next.id, next)
      appendAudit(store, {
        id: `aud_${command.requestId}_ocr_no`,
        orgId: claim.orgId,
        legalEntityId: claim.legalEntityId,
        bookId: claim.bookId,
        claimId: claim.id,
        eventType: 'ocr.dismissed',
        actorId: actor.uid,
        at: now,
        detail: 'OCR assist dismissed',
      })
      return next
    })
  }

  /**
   * Observe-only payment instruction export for approved/posted claims.
   * Never sets externalPaymentInitiated. Reuses packaging-style hard gates.
   */
  async exportPaymentInstruction(
    actor: FinanceActorContext,
    command: ExportPaymentInstructionCommand,
  ): Promise<ExpenseClaim> {
    assertFinanceMembership(actor, command.orgId, 'expense_claim.payment_instruction.export')
    return this.tx((store) => {
      const existing = loadClaim(store, command.orgId, command.claimId)
      if (existing.status !== 'posted' && existing.status !== 'approved' && existing.status !== 'payment_instruction_exported') {
        throw new ExpenseClaimValidationError('Export only after approve/post')
      }
      const format = command.format || 'eft_csv'
      const now = this.now()
      const packId = requiredText(command.id, 'id')
      const csv =
        format === 'eft_csv'
          ? [
              'payee,amount_minor,currency,reference,claim_id',
              `"${existing.payeeName.replace(/"/g, '""')}",${existing.grossTotalMinor},${existing.currency},EXP-${existing.id},${existing.id}`,
            ].join('\n')
          : `OBSERVE_ONLY payroll_net pack for claim ${existing.id} amount ${existing.grossTotalMinor}`
      // store pack body only in audit detail footprint — pack metadata on claim
      void csv
      const next: ExpenseClaim = {
        ...existing,
        status: 'payment_instruction_exported',
        paymentInstructionExport: {
          packId,
          format,
          exportedAt: now,
          exportedBy: actor.uid,
          externalPaymentInitiated: false,
          externalEgressAllowed: false,
        },
        version: existing.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
        externalPaymentInitiated: false,
        externalEgressAllowed: false,
        sarsSubmissionInitiated: false,
        autoPosted: false,
      }
      store.claims.set(next.id, next)
      appendAudit(store, {
        id: `aud_${command.requestId}_payexp`,
        orgId: next.orgId,
        legalEntityId: next.legalEntityId,
        bookId: next.bookId,
        claimId: next.id,
        eventType: 'payment_instruction.exported',
        actorId: actor.uid,
        at: now,
        detail: `Observe-only ${format} pack ${packId}; externalPaymentInitiated=false`,
      })
      return next
    })
  }

  async getBundle(
    actor: FinanceActorContext,
    orgId: string,
    legalEntityId: string,
    bookId: string,
    filters: ExpenseClaimListFilters = {},
  ) {
    assertFinanceMembership(actor, orgId, 'expense_claim.read')
    const store = await this.load()
    const claims = filterExpenseClaims(
      [...store.claims.values()].filter((c) => scopeMatch(c, orgId, legalEntityId, bookId)),
      filters,
    ).sort((a, b) => b.claimDate.localeCompare(a.claimDate) || b.createdAt.localeCompare(a.createdAt))
    const claimIds = new Set(claims.map((c) => c.id))
    const receipts = [...store.receipts.values()].filter((r) => r.orgId === orgId && claimIds.has(r.claimId))
    const ocrAssists = [...store.ocrAssists.values()].filter((o) => o.orgId === orgId && claimIds.has(o.claimId))
    const auditEvents = [...store.auditEvents.values()]
      .filter((a) => a.orgId === orgId && a.legalEntityId === legalEntityId && a.bookId === bookId)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 200)
    return {
      claims,
      receipts,
      ocrAssists,
      auditEvents,
      filters,
      counts: {
        draft: claims.filter((c) => c.status === 'draft').length,
        submitted: claims.filter((c) => c.status === 'submitted').length,
        approved: claims.filter((c) => c.status === 'approved').length,
        rejected: claims.filter((c) => c.status === 'rejected').length,
        posted: claims.filter((c) => c.status === 'posted' || c.status === 'payment_instruction_exported').length,
      },
      hardGates: {
        externalPaymentInitiated: false,
        externalEgressAllowed: false,
        sarsSubmissionInitiated: false,
        autoPosted: false,
        ocrAutoApplied: false,
      },
    }
  }
}
