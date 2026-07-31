import { authorizeFinanceAction } from '@/lib/finance/policy'
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
  FinanceApprovalRecord,
  FinanceScope,
} from '@/lib/finance/types'
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
import {
  assertAllocationAmount,
  assertDueOnOrAfterIssue,
  assertPositiveMinor,
  assertReconciliationCanApprove,
  assertReconciliationStatementMath,
  buildDocumentLine,
  computeReconciliationDifference,
  formatDocumentNumber,
  paymentDirectionForTarget,
  projectDocumentStatusFromOutstanding,
  projectOpenItemStatus,
  sumDocumentLines,
  type DocumentLineInput,
} from './documents'
import type {
  BankAccount,
  BankTransaction,
  CounterpartySnapshot,
  DocumentAuditEvent,
  DocumentAuditEventType,
  FinanceCustomerInvoice,
  FinancePayment,
  OpenItem,
  PaymentAllocation,
  Reconciliation,
  ReconciliationMatch,
  SupplierBill,
} from './documents-types'
import type { TaxCode, TaxRuleVersion } from './tax-types'

interface CommandIdentity { requestId: string; idempotencyKey: string }

export interface CreateCustomerInvoiceCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  customerCompanyId: string
  customerSnapshot: CounterpartySnapshot
  issueDate: string
  dueDate: string
  currency: string
  accountingBasis: AccountingBasis
  numberPrefix?: string
  lines: DocumentLineInput[]
  expectedVersion: 0
}

export interface IssueCustomerInvoiceCommand extends Required<FinanceScope>, CommandIdentity {
  invoiceId: string
  expectedVersion: number
  controlAccountId: string
  issueJournalEntryId?: string
}

export interface VoidCustomerInvoiceCommand extends Required<FinanceScope>, CommandIdentity {
  invoiceId: string
  expectedVersion: number
  reason: string
}

export interface CreateSupplierBillCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  supplierCompanyId: string
  supplierSnapshot: CounterpartySnapshot
  supplierReference?: string
  issueDate: string
  receivedDate: string
  dueDate: string
  currency: string
  accountingBasis: AccountingBasis
  numberPrefix?: string
  lines: DocumentLineInput[]
  expectedVersion: 0
}

export interface IssueSupplierBillCommand extends Required<FinanceScope>, CommandIdentity {
  billId: string
  expectedVersion: number
  controlAccountId: string
  issueJournalEntryId?: string
}

export interface ObservePaymentCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  direction: FinancePayment['direction']
  amountMinor: number
  currency: string
  observedDate: string
  effectiveDate: string
  method: FinancePayment['method']
  sourceEventKey: string
  provider?: string
  externalReference?: string
  counterpartyCompanyId?: string
  bankAccountId?: string
  proofReference?: string
  autoVerify?: boolean
  expectedVersion: 0
}

export interface VerifyPaymentCommand extends Required<FinanceScope>, CommandIdentity {
  paymentId: string
  expectedVersion: number
  postingJournalEntryId?: string
}

export interface AllocatePaymentCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  paymentId: string
  targetType: PaymentAllocation['targetType']
  targetId: string
  allocatedMinor: number
  discountMinor?: number
  writeOffMinor?: number
  settlementJournalEntryId?: string
  expectedVersion: 0
}

export interface ReverseAllocationCommand extends Required<FinanceScope>, CommandIdentity {
  allocationId: string
  expectedVersion: number
  reason: string
}

export interface CreateBankAccountCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  code: string
  name: string
  currency: string
  ledgerAccountId: string
  maskedAccountNumber?: string
  expectedVersion: 0
}

export interface ImportBankTransactionCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  bankAccountId: string
  statementDate: string
  effectiveDate: string
  amountMinor: number
  description: string
  sourceFingerprint: string
  reference?: string
  counterpartyName?: string
  expectedVersion: 0
}

export interface CreateReconciliationCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  bankAccountId: string
  statementStartsAt: string
  statementEndsAt: string
  openingBalanceMinor: number
  closingBalanceMinor: number
  expectedVersion: 0
}

export interface AddReconciliationMatchCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  reconciliationId: string
  bankTransactionId: string
  matchedMinor: number
  paymentId?: string
  journalEntryId?: string
  expectedVersion: 0
}

export interface SubmitReconciliationCommand extends Required<FinanceScope>, CommandIdentity {
  reconciliationId: string
  expectedVersion: number
}

export interface ApproveReconciliationCommand extends Required<FinanceScope>, CommandIdentity {
  reconciliationId: string
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

export interface DocumentsServiceState {
  invoices: Map<string, FinanceCustomerInvoice>
  bills: Map<string, SupplierBill>
  openItems: Map<string, OpenItem>
  payments: Map<string, FinancePayment>
  allocations: Map<string, PaymentAllocation>
  bankAccounts: Map<string, BankAccount>
  bankTransactions: Map<string, BankTransaction>
  reconciliations: Map<string, Reconciliation>
  reconciliationMatches: Map<string, ReconciliationMatch>
  sequences: Map<string, number>
  taxCodes: Map<string, TaxCode>
  taxRules: Map<string, TaxRuleVersion>
  approvals: Map<string, FinanceApprovalRecord>
  uniqueClaims: Map<string, string>
  idempotency: Map<string, IdempotencyRecord>
  auditEvents: DocumentAuditEvent[]
}

function cloneMap<T>(source: Map<string, T>): Map<string, T> {
  return new Map(Array.from(source, ([key, value]) => [key, structuredClone(value)]))
}

function cloneState(state: DocumentsServiceState): DocumentsServiceState {
  return {
    invoices: cloneMap(state.invoices),
    bills: cloneMap(state.bills),
    openItems: cloneMap(state.openItems),
    payments: cloneMap(state.payments),
    allocations: cloneMap(state.allocations),
    bankAccounts: cloneMap(state.bankAccounts),
    bankTransactions: cloneMap(state.bankTransactions),
    reconciliations: cloneMap(state.reconciliations),
    reconciliationMatches: cloneMap(state.reconciliationMatches),
    sequences: new Map(state.sequences),
    taxCodes: cloneMap(state.taxCodes),
    taxRules: cloneMap(state.taxRules),
    approvals: cloneMap(state.approvals),
    uniqueClaims: new Map(state.uniqueClaims),
    idempotency: cloneMap(state.idempotency),
    auditEvents: structuredClone(state.auditEvents),
  }
}

export class InMemoryDocumentsStore implements DocumentsServiceState {
  invoices = new Map<string, FinanceCustomerInvoice>()
  bills = new Map<string, SupplierBill>()
  openItems = new Map<string, OpenItem>()
  payments = new Map<string, FinancePayment>()
  allocations = new Map<string, PaymentAllocation>()
  bankAccounts = new Map<string, BankAccount>()
  bankTransactions = new Map<string, BankTransaction>()
  reconciliations = new Map<string, Reconciliation>()
  reconciliationMatches = new Map<string, ReconciliationMatch>()
  sequences = new Map<string, number>()
  taxCodes = new Map<string, TaxCode>()
  taxRules = new Map<string, TaxRuleVersion>()
  approvals = new Map<string, FinanceApprovalRecord>()
  uniqueClaims = new Map<string, string>()
  idempotency = new Map<string, IdempotencyRecord>()
  auditEvents: DocumentAuditEvent[] = []
  private transactionTail: Promise<void> = Promise.resolve()

  async transact<T>(operation: (state: DocumentsServiceState) => T | Promise<T>): Promise<T> {
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

function claim(state: DocumentsServiceState, type: string, scope: FinanceScope, key: unknown, id: string, message: string): void {
  const claimId = scopedClaimId(type, scope, key)
  const existing = state.uniqueClaims.get(claimId)
  if (existing && existing !== id) throw new FinanceValidationError(message)
  state.uniqueClaims.set(claimId, id)
}

function compactUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}

function idempotencyInput(
  state: DocumentsServiceState,
  actor: FinanceActorContext,
  scope: FinanceScope,
  operation: string,
  command: unknown,
  now: string,
): { retryId?: string; claimId: string; payloadDigest: string } {
  const payloadDigest = canonicalDigest(command)
  const claimId = scopedClaimId('documents_idempotency', scope, {
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
  state: DocumentsServiceState,
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
  state: DocumentsServiceState,
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

function assertExactScope<T extends Required<FinanceScope>>(record: T | undefined, scope: Required<FinanceScope>, label: string): T {
  if (!record || record.orgId !== scope.orgId || record.legalEntityId !== scope.legalEntityId || record.bookId !== scope.bookId) {
    throw new FinanceValidationError(`${label} not found in exact scope`)
  }
  return record
}

function nextSequence(state: DocumentsServiceState, scope: Required<FinanceScope>, kind: string): number {
  const key = `${canonicalScopeIdentity(scope)}:${kind}`
  const current = state.sequences.get(key) ?? 0
  const next = current + 1
  state.sequences.set(key, next)
  return next
}

function appendAudit(
  state: DocumentsServiceState,
  scope: Required<FinanceScope>,
  actor: FinanceActorContext,
  eventType: DocumentAuditEventType,
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
    ...scope,
    id: `daud_${scope.orgId}_${sequence}`,
    schemaVersion: 1 as const,
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

function resolveLines(
  state: DocumentsServiceState,
  scope: Required<FinanceScope>,
  lines: DocumentLineInput[],
  documentDate: string,
) {
  if (!Array.isArray(lines) || lines.length === 0) throw new FinanceValidationError('Document requires at least one line')
  const built = lines.map((line, index) => {
    const taxCode = assertExactScope(state.taxCodes.get(line.taxCodeId), scope, 'Tax code')
    if (!taxCode.active) throw new FinanceValidationError('Tax code is inactive')
    const rules = [...state.taxRules.values()].filter(
      (rule) => rule.orgId === scope.orgId && rule.legalEntityId === scope.legalEntityId && rule.bookId === scope.bookId,
    )
    return buildDocumentLine({ line, sequence: index + 1, taxCode, taxRules: rules, documentDate })
  })
  return { lines: built, totals: sumDocumentLines(built) }
}

function createOpenItem(
  state: DocumentsServiceState,
  scope: Required<FinanceScope>,
  actor: FinanceActorContext,
  now: string,
  input: {
    id: string
    sourceType: OpenItem['sourceType']
    sourceId: string
    sourceVersion: number
    counterpartyCompanyId: string
    counterpartyRole: OpenItem['counterpartyRole']
    currency: string
    originalMinor: number
    dueDate: string
    taxDate: string
    controlAccountId: string
  },
): OpenItem {
  claim(state, 'open_item_source', scope, [input.sourceType, input.sourceId], input.id, 'Open item already exists for source document')
  const openItem: OpenItem = {
    ...scope,
    id: input.id,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceVersion: input.sourceVersion,
    counterpartyCompanyId: input.counterpartyCompanyId,
    counterpartyRole: input.counterpartyRole,
    currency: input.currency,
    originalMinor: input.originalMinor,
    outstandingMinor: input.originalMinor,
    dueDate: input.dueDate,
    taxDate: input.taxDate,
    controlAccountId: requiredText(input.controlAccountId, 'controlAccountId'),
    status: 'open',
    schemaVersion: 1,
    version: 1,
    createdAt: now,
    createdBy: actor.uid,
    updatedAt: now,
    updatedBy: actor.uid,
  }
  state.openItems.set(openItem.id, openItem)
  return openItem
}

function updateDocumentProjection(
  state: DocumentsServiceState,
  scope: Required<FinanceScope>,
  openItem: OpenItem,
  outstandingMinor: number,
  actorId: string,
  now: string,
  settlementJournalEntryId?: string,
): void {
  if (openItem.sourceType === 'customer_invoice') {
    const invoice = assertExactScope(state.invoices.get(openItem.sourceId), scope, 'Customer invoice')
    const { contentHash: _c, ...rest } = invoice
    const journals = settlementJournalEntryId
      ? [...invoice.settlementJournalEntryIds, settlementJournalEntryId]
      : invoice.settlementJournalEntryIds
    const baseStatus = invoice.status === 'paid' || invoice.status === 'partially_paid' ? 'issued' : invoice.status
    state.invoices.set(invoice.id, {
      ...rest,
      outstandingMinor,
      status: projectDocumentStatusFromOutstanding(baseStatus, invoice.totalMinor, outstandingMinor),
      settlementJournalEntryIds: journals,
      version: invoice.version + 1,
      updatedAt: now,
      updatedBy: actorId,
    })
  }
  if (openItem.sourceType === 'supplier_bill') {
    const bill = assertExactScope(state.bills.get(openItem.sourceId), scope, 'Supplier bill')
    const { contentHash: _c, ...rest } = bill
    const journals = settlementJournalEntryId
      ? [...bill.settlementJournalEntryIds, settlementJournalEntryId]
      : bill.settlementJournalEntryIds
    const baseStatus = bill.status === 'paid' || bill.status === 'partially_paid' ? 'issued' : bill.status
    state.bills.set(bill.id, {
      ...rest,
      outstandingMinor,
      status: projectDocumentStatusFromOutstanding(baseStatus, bill.totalMinor, outstandingMinor),
      settlementJournalEntryIds: journals,
      version: bill.version + 1,
      updatedAt: now,
      updatedBy: actorId,
    })
  }
}

export class FinanceDocumentsService {
  constructor(
    private readonly store: InMemoryDocumentsStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  registerApproval(approval: FinanceApprovalRecord): void { this.store.approvals.set(approval.id, approval) }
  registerTaxCode(taxCode: TaxCode): void { this.store.taxCodes.set(taxCode.id, taxCode) }
  registerTaxRule(rule: TaxRuleVersion): void { this.store.taxRules.set(rule.id, rule) }

  async createCustomerInvoice(actor: FinanceActorContext, command: CreateCustomerInvoiceCommand): Promise<FinanceCustomerInvoice> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    assertCreateVersion(command.expectedVersion, 'Customer invoice')
    authorizeFinanceAction(actor, scope, 'invoice.create', this.now())
    assertEnumValue(command.accountingBasis, ['cash', 'accrual'], 'accountingBasis')
    parseCanonicalDate(command.issueDate, 'issueDate')
    assertDueOnOrAfterIssue(command.issueDate, command.dueDate)
    requiredText(command.customerCompanyId, 'customerCompanyId')
    requiredText(command.customerSnapshot.companyId, 'customerSnapshot.companyId')
    requiredText(command.customerSnapshot.legalName, 'customerSnapshot.legalName')
    if (command.customerSnapshot.companyId !== command.customerCompanyId) {
      throw new FinanceValidationError('customerSnapshot.companyId must match customerCompanyId')
    }
    return this.store.transact((state) => {
      const now = this.now()
      const idem = idempotencyInput(state, actor, scope, 'customer_invoice.create', command, now)
      if (idem.retryId) return assertExactScope(state.invoices.get(idem.retryId), scope, 'Customer invoice')
      if (state.invoices.get(command.id)) throw new FinanceValidationError('Customer invoice already exists')
      const { lines, totals } = resolveLines(state, scope, command.lines, command.issueDate)
      const documentNumber = formatDocumentNumber(command.numberPrefix ?? 'INV', nextSequence(state, scope, 'customer_invoice'))
      claim(state, 'customer_invoice_number', scope, documentNumber, command.id, 'Customer invoice number already exists')
      const invoice: FinanceCustomerInvoice = {
        ...scope, id: command.id, documentNumber,
        customerCompanyId: command.customerCompanyId,
        customerSnapshot: structuredClone(command.customerSnapshot),
        issueDate: command.issueDate, dueDate: command.dueDate,
        currency: requiredText(command.currency, 'currency').toUpperCase(),
        accountingBasis: command.accountingBasis, status: 'draft', postingState: 'unposted',
        lines, subtotalMinor: totals.subtotalMinor, taxMinor: totals.taxMinor, totalMinor: totals.totalMinor,
        outstandingMinor: totals.totalMinor, settlementJournalEntryIds: [], immutable: false,
        schemaVersion: 1, version: 1, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid,
      }
      state.invoices.set(invoice.id, invoice)
      appendAudit(state, scope, actor, 'customer_invoice.created', 'customer_invoice', invoice.id, invoice.version, now, command, {
        documentNumber: invoice.documentNumber, totalMinor: invoice.totalMinor,
      })
      storeIdempotency(state, actor, scope, 'customer_invoice.create', command, invoice.id, idem.claimId, idem.payloadDigest, now, invoice)
      return invoice
    })
  }

  async issueCustomerInvoice(actor: FinanceActorContext, command: IssueCustomerInvoiceCommand): Promise<FinanceCustomerInvoice> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    authorizeFinanceAction(actor, scope, 'invoice.issue', this.now())
    return this.store.transact((state) => {
      const now = this.now()
      const idem = idempotencyInput(state, actor, scope, 'customer_invoice.issue', command, now)
      if (idem.retryId) return assertExactScope(state.invoices.get(idem.retryId), scope, 'Customer invoice')
      const existing = assertExactScope(state.invoices.get(command.invoiceId), scope, 'Customer invoice')
      if (existing.version !== command.expectedVersion) throw new FinanceValidationError('Customer invoice version mismatch')
      if (existing.status !== 'draft') throw new FinanceValidationError('Only draft customer invoices can be issued')
      const openItem = createOpenItem(state, scope, actor, now, {
        id: `oi_${existing.id}`, sourceType: 'customer_invoice', sourceId: existing.id, sourceVersion: existing.version + 1,
        counterpartyCompanyId: existing.customerCompanyId, counterpartyRole: 'customer', currency: existing.currency,
        originalMinor: existing.totalMinor, dueDate: existing.dueDate, taxDate: existing.issueDate, controlAccountId: command.controlAccountId,
      })
      const issued: FinanceCustomerInvoice = {
        ...existing, status: 'issued', postingState: command.issueJournalEntryId ? 'posted' : existing.postingState,
        openItemId: openItem.id, issueJournalEntryId: command.issueJournalEntryId,
        version: existing.version + 1, updatedAt: now, updatedBy: actor.uid, immutable: true,
      }
      const withHash = { ...issued, contentHash: immutableContentHash(issued) }
      state.invoices.set(withHash.id, withHash)
      appendAudit(state, scope, actor, 'customer_invoice.issued', 'customer_invoice', withHash.id, withHash.version, now, command, {
        openItemId: openItem.id, totalMinor: withHash.totalMinor, issueJournalEntryId: command.issueJournalEntryId,
      })
      storeIdempotency(state, actor, scope, 'customer_invoice.issue', command, withHash.id, idem.claimId, idem.payloadDigest, now, withHash)
      return withHash
    })
  }

  async voidCustomerInvoice(actor: FinanceActorContext, command: VoidCustomerInvoiceCommand): Promise<FinanceCustomerInvoice> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    authorizeFinanceAction(actor, scope, 'invoice.void', this.now())
    requiredText(command.reason, 'reason')
    return this.store.transact((state) => {
      const now = this.now()
      const idem = idempotencyInput(state, actor, scope, 'customer_invoice.void', command, now)
      if (idem.retryId) return assertExactScope(state.invoices.get(idem.retryId), scope, 'Customer invoice')
      const existing = assertExactScope(state.invoices.get(command.invoiceId), scope, 'Customer invoice')
      if (existing.version !== command.expectedVersion) throw new FinanceValidationError('Customer invoice version mismatch')
      if (existing.status === 'voided') throw new FinanceValidationError('Customer invoice is already voided')
      if (existing.status === 'paid' || existing.outstandingMinor !== existing.totalMinor) {
        throw new FinanceValidationError('Cannot void a customer invoice with allocations')
      }
      if (existing.openItemId) {
        const openItem = assertExactScope(state.openItems.get(existing.openItemId), scope, 'Open item')
        if (openItem.outstandingMinor !== openItem.originalMinor) {
          throw new FinanceValidationError('Cannot void a customer invoice with open-item allocations')
        }
        state.openItems.set(openItem.id, {
          ...openItem, outstandingMinor: 0, status: 'voided', version: openItem.version + 1, updatedAt: now, updatedBy: actor.uid,
        })
      }
      const voided: FinanceCustomerInvoice = {
        ...existing, status: 'voided', outstandingMinor: 0, voidReason: command.reason,
        version: existing.version + 1, updatedAt: now, updatedBy: actor.uid, immutable: true,
      }
      const withHash = { ...voided, contentHash: immutableContentHash(voided) }
      state.invoices.set(withHash.id, withHash)
      appendAudit(state, scope, actor, 'customer_invoice.voided', 'customer_invoice', withHash.id, withHash.version, now, command, {
        reason: command.reason,
      }, command.reason)
      storeIdempotency(state, actor, scope, 'customer_invoice.void', command, withHash.id, idem.claimId, idem.payloadDigest, now, withHash)
      return withHash
    })
  }

  async createSupplierBill(actor: FinanceActorContext, command: CreateSupplierBillCommand): Promise<SupplierBill> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    assertCreateVersion(command.expectedVersion, 'Supplier bill')
    authorizeFinanceAction(actor, scope, 'supplier_bill.create', this.now())
    assertEnumValue(command.accountingBasis, ['cash', 'accrual'], 'accountingBasis')
    parseCanonicalDate(command.issueDate, 'issueDate')
    parseCanonicalDate(command.receivedDate, 'receivedDate')
    assertDueOnOrAfterIssue(command.issueDate, command.dueDate)
    requiredText(command.supplierCompanyId, 'supplierCompanyId')
    requiredText(command.supplierSnapshot.companyId, 'supplierSnapshot.companyId')
    requiredText(command.supplierSnapshot.legalName, 'supplierSnapshot.legalName')
    if (command.supplierSnapshot.companyId !== command.supplierCompanyId) {
      throw new FinanceValidationError('supplierSnapshot.companyId must match supplierCompanyId')
    }
    return this.store.transact((state) => {
      const now = this.now()
      const idem = idempotencyInput(state, actor, scope, 'supplier_bill.create', command, now)
      if (idem.retryId) return assertExactScope(state.bills.get(idem.retryId), scope, 'Supplier bill')
      if (state.bills.get(command.id)) throw new FinanceValidationError('Supplier bill already exists')
      const { lines, totals } = resolveLines(state, scope, command.lines, command.issueDate)
      const documentNumber = formatDocumentNumber(command.numberPrefix ?? 'BILL', nextSequence(state, scope, 'supplier_bill'))
      claim(state, 'supplier_bill_number', scope, documentNumber, command.id, 'Supplier bill number already exists')
      if (command.supplierReference) {
        claim(state, 'supplier_reference', scope, [command.supplierCompanyId, requiredText(command.supplierReference, 'supplierReference')], command.id, 'Supplier reference already exists for supplier in this book')
      }
      const bill: SupplierBill = {
        ...scope, id: command.id, documentNumber,
        supplierCompanyId: command.supplierCompanyId,
        supplierSnapshot: structuredClone(command.supplierSnapshot),
        issueDate: command.issueDate, receivedDate: command.receivedDate, dueDate: command.dueDate,
        currency: requiredText(command.currency, 'currency').toUpperCase(),
        accountingBasis: command.accountingBasis, status: 'draft', postingState: 'unposted',
        lines, subtotalMinor: totals.subtotalMinor, taxMinor: totals.taxMinor, totalMinor: totals.totalMinor,
        outstandingMinor: totals.totalMinor, settlementJournalEntryIds: [], immutable: false,
        schemaVersion: 1, version: 1, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid,
        ...(command.supplierReference ? { supplierReference: command.supplierReference.trim() } : {}),
      }
      state.bills.set(bill.id, bill)
      appendAudit(state, scope, actor, 'supplier_bill.created', 'supplier_bill', bill.id, bill.version, now, command, {
        documentNumber: bill.documentNumber, totalMinor: bill.totalMinor,
      })
      storeIdempotency(state, actor, scope, 'supplier_bill.create', command, bill.id, idem.claimId, idem.payloadDigest, now, bill)
      return bill
    })
  }

  async issueSupplierBill(actor: FinanceActorContext, command: IssueSupplierBillCommand): Promise<SupplierBill> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    authorizeFinanceAction(actor, scope, 'supplier_bill.issue', this.now())
    return this.store.transact((state) => {
      const now = this.now()
      const idem = idempotencyInput(state, actor, scope, 'supplier_bill.issue', command, now)
      if (idem.retryId) return assertExactScope(state.bills.get(idem.retryId), scope, 'Supplier bill')
      const existing = assertExactScope(state.bills.get(command.billId), scope, 'Supplier bill')
      if (existing.version !== command.expectedVersion) throw new FinanceValidationError('Supplier bill version mismatch')
      if (existing.status !== 'draft') throw new FinanceValidationError('Only draft supplier bills can be issued')
      const openItem = createOpenItem(state, scope, actor, now, {
        id: `oi_${existing.id}`, sourceType: 'supplier_bill', sourceId: existing.id, sourceVersion: existing.version + 1,
        counterpartyCompanyId: existing.supplierCompanyId, counterpartyRole: 'supplier', currency: existing.currency,
        originalMinor: existing.totalMinor, dueDate: existing.dueDate, taxDate: existing.issueDate, controlAccountId: command.controlAccountId,
      })
      const issued: SupplierBill = {
        ...existing, status: 'issued', postingState: command.issueJournalEntryId ? 'posted' : existing.postingState,
        openItemId: openItem.id, issueJournalEntryId: command.issueJournalEntryId,
        version: existing.version + 1, updatedAt: now, updatedBy: actor.uid, immutable: true,
      }
      const withHash = { ...issued, contentHash: immutableContentHash(issued) }
      state.bills.set(withHash.id, withHash)
      appendAudit(state, scope, actor, 'supplier_bill.issued', 'supplier_bill', withHash.id, withHash.version, now, command, {
        openItemId: openItem.id, totalMinor: withHash.totalMinor,
      })
      storeIdempotency(state, actor, scope, 'supplier_bill.issue', command, withHash.id, idem.claimId, idem.payloadDigest, now, withHash)
      return withHash
    })
  }

  async observePayment(actor: FinanceActorContext, command: ObservePaymentCommand): Promise<FinancePayment> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    assertCreateVersion(command.expectedVersion, 'Payment')
    authorizeFinanceAction(actor, scope, 'payment.observe', this.now())
    assertEnumValue(command.direction, ['receipt', 'disbursement'], 'direction')
    assertEnumValue(command.method, ['eft', 'cash', 'card', 'other'], 'method')
    assertPositiveMinor(command.amountMinor, 'amountMinor')
    parseCanonicalDate(command.observedDate, 'observedDate')
    parseCanonicalDate(command.effectiveDate, 'effectiveDate')
    requiredText(command.sourceEventKey, 'sourceEventKey')
    return this.store.transact((state) => {
      const now = this.now()
      const idem = idempotencyInput(state, actor, scope, 'payment.observe', command, now)
      if (idem.retryId) return assertExactScope(state.payments.get(idem.retryId), scope, 'Payment')
      if (state.payments.get(command.id)) throw new FinanceValidationError('Payment already exists')
      claim(state, 'payment_source_event', scope, command.sourceEventKey, command.id, 'Payment source event already recorded')
      if (command.bankAccountId) assertExactScope(state.bankAccounts.get(command.bankAccountId), scope, 'Bank account')
      const status: FinancePayment['status'] = command.autoVerify === false ? 'observed' : 'verified'
      const payment: FinancePayment = {
        ...scope, id: command.id, direction: command.direction, status,
        amountMinor: command.amountMinor, unallocatedMinor: command.amountMinor,
        currency: requiredText(command.currency, 'currency').toUpperCase(),
        observedDate: command.observedDate, effectiveDate: command.effectiveDate, method: command.method,
        sourceEventKey: command.sourceEventKey, externalPaymentInitiated: false, immutable: true,
        schemaVersion: 1, version: 1, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid,
        ...(command.provider ? { provider: command.provider } : {}),
        ...(command.externalReference ? { externalReference: command.externalReference } : {}),
        ...(command.counterpartyCompanyId ? { counterpartyCompanyId: command.counterpartyCompanyId } : {}),
        ...(command.bankAccountId ? { bankAccountId: command.bankAccountId } : {}),
        ...(command.proofReference ? { proofReference: command.proofReference } : {}),
      }
      const withHash = { ...payment, contentHash: immutableContentHash(payment) }
      state.payments.set(withHash.id, withHash)
      appendAudit(state, scope, actor, status === 'verified' ? 'payment.verified' : 'payment.observed', 'payment', withHash.id, withHash.version, now, command, {
        amountMinor: withHash.amountMinor, direction: withHash.direction, sourceEventKey: withHash.sourceEventKey, externalPaymentInitiated: false,
      })
      storeIdempotency(state, actor, scope, 'payment.observe', command, withHash.id, idem.claimId, idem.payloadDigest, now, withHash)
      return withHash
    })
  }

  async verifyPayment(actor: FinanceActorContext, command: VerifyPaymentCommand): Promise<FinancePayment> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    authorizeFinanceAction(actor, scope, 'payment.verify', this.now())
    return this.store.transact((state) => {
      const now = this.now()
      const idem = idempotencyInput(state, actor, scope, 'payment.verify', command, now)
      if (idem.retryId) return assertExactScope(state.payments.get(idem.retryId), scope, 'Payment')
      const existing = assertExactScope(state.payments.get(command.paymentId), scope, 'Payment')
      if (existing.version !== command.expectedVersion) throw new FinanceValidationError('Payment version mismatch')
      if (existing.status === 'verified') throw new FinanceValidationError('Payment is already verified')
      if (existing.status === 'reversed') throw new FinanceValidationError('Cannot verify a reversed payment')
      const verified: FinancePayment = {
        ...existing, status: 'verified', postingJournalEntryId: command.postingJournalEntryId,
        version: existing.version + 1, updatedAt: now, updatedBy: actor.uid, externalPaymentInitiated: false,
      }
      const withHash = { ...verified, contentHash: immutableContentHash(verified) }
      state.payments.set(withHash.id, withHash)
      appendAudit(state, scope, actor, 'payment.verified', 'payment', withHash.id, withHash.version, now, command, {
        postingJournalEntryId: command.postingJournalEntryId, externalPaymentInitiated: false,
      })
      storeIdempotency(state, actor, scope, 'payment.verify', command, withHash.id, idem.claimId, idem.payloadDigest, now, withHash)
      return withHash
    })
  }

  async allocatePayment(actor: FinanceActorContext, command: AllocatePaymentCommand): Promise<PaymentAllocation> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    assertCreateVersion(command.expectedVersion, 'Payment allocation')
    authorizeFinanceAction(actor, scope, 'payment.allocate', this.now())
    assertEnumValue(command.targetType, ['customer_invoice', 'supplier_bill', 'open_item', 'on_account'], 'targetType')
    return this.store.transact((state) => {
      const now = this.now()
      const idem = idempotencyInput(state, actor, scope, 'payment.allocate', command, now)
      if (idem.retryId) return assertExactScope(state.allocations.get(idem.retryId), scope, 'Payment allocation')
      if (state.allocations.get(command.id)) throw new FinanceValidationError('Payment allocation already exists')
      const payment = assertExactScope(state.payments.get(command.paymentId), scope, 'Payment')
      if (payment.status !== 'verified') throw new FinanceValidationError('Only verified payments can be allocated')
      if (payment.externalPaymentInitiated !== false) throw new FinanceValidationError('Payment must not initiate external payment rails')

      let openItem: OpenItem | undefined
      if (command.targetType === 'customer_invoice') {
        const invoice = assertExactScope(state.invoices.get(command.targetId), scope, 'Customer invoice')
        if (invoice.status === 'voided' || invoice.status === 'draft') throw new FinanceValidationError('Cannot allocate to a draft or voided customer invoice')
        if (!invoice.openItemId) throw new FinanceValidationError('Customer invoice has no open item')
        openItem = assertExactScope(state.openItems.get(invoice.openItemId), scope, 'Open item')
        if (payment.direction !== paymentDirectionForTarget('customer_invoice')) throw new FinanceValidationError('Receipt required for customer invoice allocation')
      } else if (command.targetType === 'supplier_bill') {
        const bill = assertExactScope(state.bills.get(command.targetId), scope, 'Supplier bill')
        if (bill.status === 'voided' || bill.status === 'draft') throw new FinanceValidationError('Cannot allocate to a draft or voided supplier bill')
        if (!bill.openItemId) throw new FinanceValidationError('Supplier bill has no open item')
        openItem = assertExactScope(state.openItems.get(bill.openItemId), scope, 'Open item')
        if (payment.direction !== paymentDirectionForTarget('supplier_bill')) throw new FinanceValidationError('Disbursement required for supplier bill allocation')
      } else if (command.targetType === 'open_item') {
        openItem = assertExactScope(state.openItems.get(command.targetId), scope, 'Open item')
        const expectedDirection = paymentDirectionForTarget('open_item', openItem.counterpartyRole)
        if (expectedDirection && payment.direction !== expectedDirection) {
          throw new FinanceValidationError('Payment direction does not match open item counterparty role')
        }
      }

      const discountMinor = command.discountMinor ?? 0
      const writeOffMinor = command.writeOffMinor ?? 0
      if (command.targetType === 'on_account') {
        assertPositiveMinor(command.allocatedMinor, 'allocatedMinor')
        if (command.allocatedMinor > payment.unallocatedMinor) throw new FinanceValidationError('Allocation exceeds payment unallocated amount')
      } else {
        if (!openItem) throw new FinanceValidationError('Open item is required for this allocation target')
        assertAllocationAmount(payment.unallocatedMinor, openItem.outstandingMinor, command.allocatedMinor, discountMinor, writeOffMinor)
      }

      const allocation: PaymentAllocation = {
        ...scope, id: command.id, paymentId: payment.id, targetType: command.targetType, targetId: command.targetId,
        allocatedMinor: command.allocatedMinor, discountMinor, writeOffMinor, status: 'active',
        schemaVersion: 1, version: 1, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid,
        ...(openItem ? { openItemId: openItem.id } : {}),
        ...(command.settlementJournalEntryId ? { settlementJournalEntryId: command.settlementJournalEntryId } : {}),
      }
      state.allocations.set(allocation.id, allocation)

      const updatedPayment: FinancePayment = {
        ...payment, unallocatedMinor: payment.unallocatedMinor - command.allocatedMinor,
        version: payment.version + 1, updatedAt: now, updatedBy: actor.uid, externalPaymentInitiated: false,
      }
      state.payments.set(updatedPayment.id, { ...updatedPayment, contentHash: immutableContentHash(updatedPayment) })

      if (openItem) {
        const outstandingMinor = openItem.outstandingMinor - command.allocatedMinor - discountMinor - writeOffMinor
        const updatedOpenItem: OpenItem = {
          ...openItem, outstandingMinor, status: projectOpenItemStatus(openItem.originalMinor, outstandingMinor),
          version: openItem.version + 1, updatedAt: now, updatedBy: actor.uid,
        }
        state.openItems.set(updatedOpenItem.id, updatedOpenItem)
        updateDocumentProjection(state, scope, openItem, outstandingMinor, actor.uid, now, command.settlementJournalEntryId)
      }

      appendAudit(state, scope, actor, 'payment_allocation.created', 'payment_allocation', allocation.id, allocation.version, now, command, {
        paymentId: payment.id, targetType: command.targetType, targetId: command.targetId, allocatedMinor: command.allocatedMinor,
      })
      storeIdempotency(state, actor, scope, 'payment.allocate', command, allocation.id, idem.claimId, idem.payloadDigest, now, allocation)
      return allocation
    })
  }

  async reverseAllocation(actor: FinanceActorContext, command: ReverseAllocationCommand): Promise<PaymentAllocation> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    authorizeFinanceAction(actor, scope, 'payment.allocate', this.now())
    requiredText(command.reason, 'reason')
    return this.store.transact((state) => {
      const now = this.now()
      const idem = idempotencyInput(state, actor, scope, 'payment.allocate.reverse', command, now)
      if (idem.retryId) return assertExactScope(state.allocations.get(idem.retryId), scope, 'Payment allocation')
      const existing = assertExactScope(state.allocations.get(command.allocationId), scope, 'Payment allocation')
      if (existing.version !== command.expectedVersion) throw new FinanceValidationError('Payment allocation version mismatch')
      if (existing.status !== 'active') throw new FinanceValidationError('Only active allocations can be reversed')
      const payment = assertExactScope(state.payments.get(existing.paymentId), scope, 'Payment')
      const reversed: PaymentAllocation = {
        ...existing, status: 'reversed', version: existing.version + 1, updatedAt: now, updatedBy: actor.uid,
      }
      state.allocations.set(reversed.id, reversed)
      const restoredPayment: FinancePayment = {
        ...payment, unallocatedMinor: payment.unallocatedMinor + existing.allocatedMinor,
        version: payment.version + 1, updatedAt: now, updatedBy: actor.uid, externalPaymentInitiated: false,
      }
      state.payments.set(restoredPayment.id, { ...restoredPayment, contentHash: immutableContentHash(restoredPayment) })
      if (existing.openItemId) {
        const openItem = assertExactScope(state.openItems.get(existing.openItemId), scope, 'Open item')
        const outstandingMinor = openItem.outstandingMinor + existing.allocatedMinor + existing.discountMinor + existing.writeOffMinor
        state.openItems.set(openItem.id, {
          ...openItem, outstandingMinor, status: projectOpenItemStatus(openItem.originalMinor, outstandingMinor),
          version: openItem.version + 1, updatedAt: now, updatedBy: actor.uid,
        })
        updateDocumentProjection(state, scope, openItem, outstandingMinor, actor.uid, now)
      }
      appendAudit(state, scope, actor, 'payment_allocation.reversed', 'payment_allocation', reversed.id, reversed.version, now, command, {
        reason: command.reason, allocatedMinor: existing.allocatedMinor,
      }, command.reason)
      storeIdempotency(state, actor, scope, 'payment.allocate.reverse', command, reversed.id, idem.claimId, idem.payloadDigest, now, reversed)
      return reversed
    })
  }

  async createBankAccount(actor: FinanceActorContext, command: CreateBankAccountCommand): Promise<BankAccount> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    assertCreateVersion(command.expectedVersion, 'Bank account')
    authorizeFinanceAction(actor, scope, 'bank.configure', this.now())
    return this.store.transact((state) => {
      const now = this.now()
      const idem = idempotencyInput(state, actor, scope, 'bank_account.create', command, now)
      if (idem.retryId) return assertExactScope(state.bankAccounts.get(idem.retryId), scope, 'Bank account')
      if (state.bankAccounts.get(command.id)) throw new FinanceValidationError('Bank account already exists')
      const code = requiredText(command.code, 'code').toUpperCase()
      claim(state, 'bank_account_code', scope, code, command.id, 'Bank account code already exists')
      const account: BankAccount = {
        ...scope, id: command.id, code, name: requiredText(command.name, 'name'),
        currency: requiredText(command.currency, 'currency').toUpperCase(),
        ledgerAccountId: requiredText(command.ledgerAccountId, 'ledgerAccountId'), active: true,
        schemaVersion: 1, version: 1, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid,
        ...(command.maskedAccountNumber ? { maskedAccountNumber: command.maskedAccountNumber } : {}),
      }
      state.bankAccounts.set(account.id, account)
      appendAudit(state, scope, actor, 'bank_account.created', 'bank_account', account.id, account.version, now, command, {
        code: account.code, ledgerAccountId: account.ledgerAccountId,
      })
      storeIdempotency(state, actor, scope, 'bank_account.create', command, account.id, idem.claimId, idem.payloadDigest, now, account)
      return account
    })
  }

  async importBankTransaction(actor: FinanceActorContext, command: ImportBankTransactionCommand): Promise<BankTransaction> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    assertCreateVersion(command.expectedVersion, 'Bank transaction')
    authorizeFinanceAction(actor, scope, 'bank.import', this.now())
    parseCanonicalDate(command.statementDate, 'statementDate')
    parseCanonicalDate(command.effectiveDate, 'effectiveDate')
    if (!Number.isSafeInteger(command.amountMinor) || command.amountMinor === 0) {
      throw new FinanceValidationError('amountMinor must be a non-zero safe integer')
    }
    requiredText(command.sourceFingerprint, 'sourceFingerprint')
    return this.store.transact((state) => {
      const now = this.now()
      const idem = idempotencyInput(state, actor, scope, 'bank_transaction.import', command, now)
      if (idem.retryId) return assertExactScope(state.bankTransactions.get(idem.retryId), scope, 'Bank transaction')
      if (state.bankTransactions.get(command.id)) throw new FinanceValidationError('Bank transaction already exists')
      assertExactScope(state.bankAccounts.get(command.bankAccountId), scope, 'Bank account')
      claim(state, 'bank_source_fingerprint', scope, [command.bankAccountId, command.sourceFingerprint], command.id, 'Bank transaction source fingerprint already imported')
      const base = {
        ...scope, id: command.id, bankAccountId: command.bankAccountId,
        statementDate: command.statementDate, effectiveDate: command.effectiveDate, amountMinor: command.amountMinor,
        description: requiredText(command.description, 'description'), sourceFingerprint: command.sourceFingerprint,
        reconciliationState: 'unmatched' as const, immutable: true as const,
        schemaVersion: 1 as const, version: 1, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid,
        ...(command.reference ? { reference: command.reference } : {}),
        ...(command.counterpartyName ? { counterpartyName: command.counterpartyName } : {}),
      }
      const txn: BankTransaction = { ...base, contentHash: immutableContentHash(base) }
      assertImmutableContentHash(txn, 'Bank transaction')
      state.bankTransactions.set(txn.id, txn)
      appendAudit(state, scope, actor, 'bank_transaction.imported', 'bank_transaction', txn.id, txn.version, now, command, {
        bankAccountId: txn.bankAccountId, amountMinor: txn.amountMinor, sourceFingerprint: txn.sourceFingerprint,
      })
      storeIdempotency(state, actor, scope, 'bank_transaction.import', command, txn.id, idem.claimId, idem.payloadDigest, now, txn)
      return txn
    })
  }

  async createReconciliation(actor: FinanceActorContext, command: CreateReconciliationCommand): Promise<Reconciliation> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    assertCreateVersion(command.expectedVersion, 'Reconciliation')
    authorizeFinanceAction(actor, scope, 'reconciliation.create', this.now())
    parseCanonicalDate(command.statementStartsAt, 'statementStartsAt')
    parseCanonicalDate(command.statementEndsAt, 'statementEndsAt')
    if (parseCanonicalDate(command.statementEndsAt, 'statementEndsAt') < parseCanonicalDate(command.statementStartsAt, 'statementStartsAt')) {
      throw new FinanceValidationError('statementEndsAt must be on or after statementStartsAt')
    }
    const statementMovementMinor = command.closingBalanceMinor - command.openingBalanceMinor
    assertReconciliationStatementMath({
      openingBalanceMinor: command.openingBalanceMinor,
      closingBalanceMinor: command.closingBalanceMinor,
      statementMovementMinor,
    })
    return this.store.transact((state) => {
      const now = this.now()
      const idem = idempotencyInput(state, actor, scope, 'reconciliation.create', command, now)
      if (idem.retryId) return assertExactScope(state.reconciliations.get(idem.retryId), scope, 'Reconciliation')
      if (state.reconciliations.get(command.id)) throw new FinanceValidationError('Reconciliation already exists')
      assertExactScope(state.bankAccounts.get(command.bankAccountId), scope, 'Bank account')
      const recon: Reconciliation = {
        ...scope, id: command.id, bankAccountId: command.bankAccountId,
        statementStartsAt: command.statementStartsAt, statementEndsAt: command.statementEndsAt,
        openingBalanceMinor: command.openingBalanceMinor, closingBalanceMinor: command.closingBalanceMinor,
        statementMovementMinor, matchedMovementMinor: 0, differenceMinor: statementMovementMinor, status: 'draft',
        schemaVersion: 1, version: 1, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid,
      }
      state.reconciliations.set(recon.id, recon)
      appendAudit(state, scope, actor, 'reconciliation.created', 'reconciliation', recon.id, recon.version, now, command, {
        bankAccountId: recon.bankAccountId, statementMovementMinor,
      })
      storeIdempotency(state, actor, scope, 'reconciliation.create', command, recon.id, idem.claimId, idem.payloadDigest, now, recon)
      return recon
    })
  }

  async addReconciliationMatch(actor: FinanceActorContext, command: AddReconciliationMatchCommand): Promise<ReconciliationMatch> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    assertCreateVersion(command.expectedVersion, 'Reconciliation match')
    authorizeFinanceAction(actor, scope, 'reconciliation.match', this.now())
    if (!command.paymentId && !command.journalEntryId) throw new FinanceValidationError('Reconciliation match requires a paymentId or journalEntryId')
    if (!Number.isSafeInteger(command.matchedMinor) || command.matchedMinor === 0) {
      throw new FinanceValidationError('matchedMinor must be a non-zero safe integer')
    }
    return this.store.transact((state) => {
      const now = this.now()
      const idem = idempotencyInput(state, actor, scope, 'reconciliation.match', command, now)
      if (idem.retryId) return assertExactScope(state.reconciliationMatches.get(idem.retryId), scope, 'Reconciliation match')
      if (state.reconciliationMatches.get(command.id)) throw new FinanceValidationError('Reconciliation match already exists')
      const recon = assertExactScope(state.reconciliations.get(command.reconciliationId), scope, 'Reconciliation')
      if (recon.status !== 'draft' && recon.status !== 'in_review') throw new FinanceValidationError('Cannot match against a locked reconciliation')
      const txn = assertExactScope(state.bankTransactions.get(command.bankTransactionId), scope, 'Bank transaction')
      if (txn.bankAccountId !== recon.bankAccountId) throw new FinanceValidationError('Bank transaction does not belong to reconciliation bank account')
      if (txn.reconciliationState === 'matched') throw new FinanceValidationError('Bank transaction is already matched')
      if (command.paymentId) {
        const payment = assertExactScope(state.payments.get(command.paymentId), scope, 'Payment')
        if (payment.status !== 'verified') throw new FinanceValidationError('Only verified payments can be reconciliation-matched')
        if (Math.abs(command.matchedMinor) > payment.amountMinor) throw new FinanceValidationError('Matched amount exceeds payment amount')
      }
      claim(state, 'recon_bank_txn', scope, [recon.id, txn.id], command.id, 'Bank transaction already matched in this reconciliation')
      const match: ReconciliationMatch = {
        ...scope, id: command.id, reconciliationId: recon.id, bankTransactionId: txn.id,
        matchedMinor: command.matchedMinor, status: 'active',
        schemaVersion: 1, version: 1, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid,
        ...(command.paymentId ? { paymentId: command.paymentId } : {}),
        ...(command.journalEntryId ? { journalEntryId: command.journalEntryId } : {}),
      }
      state.reconciliationMatches.set(match.id, match)
      state.bankTransactions.set(txn.id, { ...txn, reconciliationState: 'matched', version: txn.version + 1, updatedAt: now, updatedBy: actor.uid })
      const matchedMovementMinor = recon.matchedMovementMinor + command.matchedMinor
      const differenceMinor = computeReconciliationDifference({ statementMovementMinor: recon.statementMovementMinor, matchedMovementMinor })
      state.reconciliations.set(recon.id, {
        ...recon, matchedMovementMinor, differenceMinor, version: recon.version + 1, updatedAt: now, updatedBy: actor.uid,
      })
      appendAudit(state, scope, actor, 'reconciliation.match_added', 'reconciliation_match', match.id, match.version, now, command, {
        reconciliationId: recon.id, bankTransactionId: txn.id, matchedMinor: command.matchedMinor,
      })
      storeIdempotency(state, actor, scope, 'reconciliation.match', command, match.id, idem.claimId, idem.payloadDigest, now, match)
      return match
    })
  }

  async submitReconciliation(actor: FinanceActorContext, command: SubmitReconciliationCommand): Promise<Reconciliation> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    authorizeFinanceAction(actor, scope, 'reconciliation.submit', this.now())
    return this.store.transact((state) => {
      const now = this.now()
      const idem = idempotencyInput(state, actor, scope, 'reconciliation.submit', command, now)
      if (idem.retryId) return assertExactScope(state.reconciliations.get(idem.retryId), scope, 'Reconciliation')
      const existing = assertExactScope(state.reconciliations.get(command.reconciliationId), scope, 'Reconciliation')
      if (existing.version !== command.expectedVersion) throw new FinanceValidationError('Reconciliation version mismatch')
      if (existing.status !== 'draft') throw new FinanceValidationError('Only draft reconciliations can be submitted')
      const submitted: Reconciliation = {
        ...existing, status: 'in_review', version: existing.version + 1, updatedAt: now, updatedBy: actor.uid,
      }
      state.reconciliations.set(submitted.id, submitted)
      appendAudit(state, scope, actor, 'reconciliation.submitted', 'reconciliation', submitted.id, submitted.version, now, command, {
        differenceMinor: submitted.differenceMinor,
      })
      storeIdempotency(state, actor, scope, 'reconciliation.submit', command, submitted.id, idem.claimId, idem.payloadDigest, now, submitted)
      return submitted
    })
  }

  async approveReconciliation(actor: FinanceActorContext, command: ApproveReconciliationCommand): Promise<Reconciliation> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    authorizeFinanceAction(actor, scope, 'reconciliation.approve', this.now())
    requiredText(command.reason, 'reason')
    return this.store.transact((state) => {
      const now = this.now()
      const idem = idempotencyInput(state, actor, scope, 'reconciliation.approve', command, now)
      if (idem.retryId) return assertExactScope(state.reconciliations.get(idem.retryId), scope, 'Reconciliation')
      const existing = assertExactScope(state.reconciliations.get(command.reconciliationId), scope, 'Reconciliation')
      if (existing.version !== command.expectedVersion) throw new FinanceValidationError('Reconciliation version mismatch')
      assertReconciliationCanApprove(existing)
      const approval = loadApproval(state, command.approvalId, scope, 'reconciliation.approve', actor.uid, now)
      const approved: Reconciliation = {
        ...existing, status: 'approved', approvalId: approval.approvalId, approvedAt: approval.approvedAt,
        approvedBy: approval.approvedBy, lockMetadata: `approved:${approval.approvalId}`,
        version: existing.version + 1, updatedAt: now, updatedBy: actor.uid,
      }
      state.reconciliations.set(approved.id, approved)
      appendAudit(state, scope, actor, 'reconciliation.approved', 'reconciliation', approved.id, approved.version, now, command, {
        approvalId: approval.approvalId, differenceMinor: approved.differenceMinor,
      }, command.reason)
      storeIdempotency(state, actor, scope, 'reconciliation.approve', command, approved.id, idem.claimId, idem.payloadDigest, now, approved)
      return approved
    })
  }
}
