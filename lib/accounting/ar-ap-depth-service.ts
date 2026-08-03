/**
 * Phase-4 AR/AP depth: credit/debit notes, recurring schedules, statement drafts,
 * bulk ops, aging, attachments, portal filters. No mass email / no payment initiate.
 */
import { authorizeFinanceAction } from '@/lib/finance/policy'
import {
  CANONICAL_PAYLOAD_VERSION,
  HASH_ALGORITHM_VERSION,
  canonicalDigest,
  canonicalScopeIdentity,
  scopedClaimId,
} from '@/lib/finance/integrity'
import type { AccountingBasis, FinanceActorContext, FinanceScope } from '@/lib/finance/types'
import {
  FinanceValidationError,
  assertCreateVersion,
  assertEnumValue,
  assertSafeInteger,
  immutableContentHash,
  parseCanonicalDate,
  requiredText,
} from './foundation'
import {
  buildDocumentLine,
  formatDocumentNumber,
  projectDocumentStatusFromOutstanding,
  projectOpenItemStatus,
  sumDocumentLines,
  type DocumentLineInput,
} from './documents'
import {
  addCalendarDays,
  assertNoteApplicationAmount,
  buildAgingReport,
  buildStatementBalances,
  filterDocumentsByPortalFilters,
  nextRecurringRunDate,
  projectCreditNoteStatus,
  renderStatementCsv,
} from './ar-ap-depth'
import type {
  CounterpartySnapshot,
  FinanceCustomerInvoice,
  OpenItem,
  PaymentAllocation,
  SupplierBill,
} from './documents-types'
import type {
  CounterpartyStatementDraft,
  CustomerCreditNote,
  DocumentListFilters,
  FinanceDocumentAttachment,
  NoteApplication,
  RecurringDocumentSchedule,
  SupplierDebitNote,
} from './ar-ap-depth-types'
import type { TaxCode, TaxRuleVersion } from './tax-types'
import {
  FinanceDocumentsService,
  InMemoryDocumentsStore,
  type CreateCustomerInvoiceCommand,
  type CreateSupplierBillCommand,
  type IssueCustomerInvoiceCommand,
  type IssueSupplierBillCommand,
  type AllocatePaymentCommand,
  type VoidCustomerInvoiceCommand,
} from './documents-service'

interface CommandIdentity { requestId: string; idempotencyKey: string }

type DepthAuditType =
  | 'customer_credit_note.created' | 'customer_credit_note.issued' | 'customer_credit_note.applied' | 'customer_credit_note.voided'
  | 'supplier_debit_note.created' | 'supplier_debit_note.issued' | 'supplier_debit_note.applied' | 'supplier_debit_note.voided'
  | 'recurring_schedule.created' | 'recurring_schedule.generated' | 'recurring_schedule.paused'
  | 'statement_draft.created' | 'document_attachment.added'
  | 'documents.bulk_issue' | 'documents.bulk_void' | 'documents.bulk_allocate'

export interface ArApDepthState {
  creditNotes: Map<string, CustomerCreditNote>
  debitNotes: Map<string, SupplierDebitNote>
  noteApplications: Map<string, NoteApplication>
  recurringSchedules: Map<string, RecurringDocumentSchedule>
  statementDrafts: Map<string, CounterpartyStatementDraft>
  attachments: Map<string, FinanceDocumentAttachment>
  sequences: Map<string, number>
  uniqueClaims: Map<string, string>
  idempotency: Map<string, {
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
  }>
  auditEvents: Array<Record<string, unknown>>
}

export class InMemoryArApDepthStore implements ArApDepthState {
  creditNotes = new Map<string, CustomerCreditNote>()
  debitNotes = new Map<string, SupplierDebitNote>()
  noteApplications = new Map<string, NoteApplication>()
  recurringSchedules = new Map<string, RecurringDocumentSchedule>()
  statementDrafts = new Map<string, CounterpartyStatementDraft>()
  attachments = new Map<string, FinanceDocumentAttachment>()
  sequences = new Map<string, number>()
  uniqueClaims = new Map<string, string>()
  idempotency = new Map<string, ArApDepthState['idempotency'] extends Map<string, infer V> ? V : never>()
  auditEvents: Array<Record<string, unknown>> = []
  private tail: Promise<void> = Promise.resolve()

  async transact<T>(op: (state: ArApDepthState) => T | Promise<T>): Promise<T> {
    let release!: () => void
    const prev = this.tail
    this.tail = new Promise<void>((r) => { release = r })
    await prev
    try {
      const draft: ArApDepthState = {
        creditNotes: new Map(Array.from(this.creditNotes, ([k, v]) => [k, structuredClone(v)])),
        debitNotes: new Map(Array.from(this.debitNotes, ([k, v]) => [k, structuredClone(v)])),
        noteApplications: new Map(Array.from(this.noteApplications, ([k, v]) => [k, structuredClone(v)])),
        recurringSchedules: new Map(Array.from(this.recurringSchedules, ([k, v]) => [k, structuredClone(v)])),
        statementDrafts: new Map(Array.from(this.statementDrafts, ([k, v]) => [k, structuredClone(v)])),
        attachments: new Map(Array.from(this.attachments, ([k, v]) => [k, structuredClone(v)])),
        sequences: new Map(this.sequences),
        uniqueClaims: new Map(this.uniqueClaims),
        idempotency: new Map(Array.from(this.idempotency, ([k, v]) => [k, structuredClone(v)])),
        auditEvents: structuredClone(this.auditEvents),
      }
      const result = await op(draft)
      Object.assign(this, draft)
      return result
    } finally {
      release()
    }
  }
}

function claim(state: ArApDepthState, type: string, scope: FinanceScope, key: unknown, id: string, message: string) {
  const claimId = scopedClaimId(type, scope, key)
  const existing = state.uniqueClaims.get(claimId)
  if (existing && existing !== id) throw new FinanceValidationError(message)
  state.uniqueClaims.set(claimId, id)
}

function compactUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}

function idemInput(state: ArApDepthState, actor: FinanceActorContext, scope: FinanceScope, operation: string, command: unknown, now: string) {
  const payloadDigest = canonicalDigest(command)
  const claimId = scopedClaimId('ar_ap_depth_idempotency', scope, {
    actorId: actor.uid, key: (command as CommandIdentity).idempotencyKey, operation,
  })
  const retry = state.idempotency.get(claimId)
  if (!retry) return { claimId, payloadDigest }
  if (
    retry.schemaVersion !== 1 || retry.canonicalPayloadVersion !== CANONICAL_PAYLOAD_VERSION ||
    retry.hashAlgorithmVersion !== HASH_ALGORITHM_VERSION || retry.actorId !== actor.uid ||
    retry.orgId !== scope.orgId || retry.scopeIdentity !== canonicalScopeIdentity(scope) ||
    retry.operation !== operation || retry.requestId !== (command as CommandIdentity).requestId ||
    retry.expiresAt <= now
  ) throw new FinanceValidationError('Idempotency metadata is invalid, mismatched, or expired')
  if (retry.payloadDigest !== payloadDigest) throw new FinanceValidationError('Idempotency key payload mismatch')
  return { retryId: retry.aggregateId, claimId, payloadDigest, resultSnapshot: retry.resultSnapshot }
}

function storeIdem(state: ArApDepthState, actor: FinanceActorContext, scope: FinanceScope, operation: string, command: unknown, aggregateId: string, claimId: string, payloadDigest: string, now: string, result: unknown) {
  const compactResult = compactUndefined(result as Record<string, unknown>)
  state.idempotency.set(claimId, {
    schemaVersion: 1, canonicalPayloadVersion: CANONICAL_PAYLOAD_VERSION, hashAlgorithmVersion: HASH_ALGORITHM_VERSION,
    payloadDigest, aggregateId, operation, actorId: actor.uid, orgId: scope.orgId, scopeIdentity: canonicalScopeIdentity(scope),
    requestId: (command as CommandIdentity).requestId,
    expiresAt: new Date(Date.parse(now) + 24 * 60 * 60 * 1000).toISOString(),
    resultSnapshot: structuredClone(compactResult), resultDigest: canonicalDigest(compactResult),
  })
}

function nextSeq(state: ArApDepthState, scope: Required<FinanceScope>, kind: string) {
  const key = `${canonicalScopeIdentity(scope)}:${kind}`
  const next = (state.sequences.get(key) ?? 0) + 1
  state.sequences.set(key, next)
  return next
}

function appendAudit(state: ArApDepthState, scope: Required<FinanceScope>, actor: FinanceActorContext, eventType: DepthAuditType, aggregateType: string, aggregateId: string, aggregateVersion: number, now: string, command: CommandIdentity, payload: Record<string, unknown>, reason?: string) {
  const sequence = state.auditEvents.length + 1
  const base = {
    ...scope, id: `depth_aud_${scope.orgId}_${sequence}`, schemaVersion: 1 as const,
    aggregateType, aggregateId, aggregateVersion, eventType, actorId: actor.uid,
    requestId: command.requestId, idempotencyKey: command.idempotencyKey, occurredAt: now, sequence,
    payload: compactUndefined(payload), externalEgressAllowed: false as const,
    canonicalPayloadVersion: 1 as const, hashAlgorithmVersion: HASH_ALGORITHM_VERSION,
    ...(reason ? { reason } : {}),
  }
  state.auditEvents.push({ ...base, eventHash: canonicalDigest(base) })
}

function assertScope<T extends Required<FinanceScope>>(record: T | undefined, scope: Required<FinanceScope>, label: string): T {
  if (!record || record.orgId !== scope.orgId || record.legalEntityId !== scope.legalEntityId || record.bookId !== scope.bookId) {
    throw new FinanceValidationError(`${label} not found in exact scope`)
  }
  return record
}

function resolveLines(
  docs: InMemoryDocumentsStore,
  scope: Required<FinanceScope>,
  lines: DocumentLineInput[],
  documentDate: string,
) {
  if (!Array.isArray(lines) || lines.length === 0) throw new FinanceValidationError('Document requires at least one line')
  const built = lines.map((line, index) => {
    const taxCode = assertScope(docs.taxCodes.get(line.taxCodeId) as TaxCode | undefined, scope, 'Tax code')
    if (!taxCode.active) throw new FinanceValidationError('Tax code is inactive')
    const rules = [...docs.taxRules.values()].filter(
      (rule) => rule.orgId === scope.orgId && rule.legalEntityId === scope.legalEntityId && rule.bookId === scope.bookId,
    ) as TaxRuleVersion[]
    return buildDocumentLine({ line, sequence: index + 1, taxCode, taxRules: rules, documentDate })
  })
  return { lines: built, totals: sumDocumentLines(built) }
}

function reduceOpenItem(
  docs: InMemoryDocumentsStore,
  scope: Required<FinanceScope>,
  openItemId: string,
  appliedMinor: number,
  actorId: string,
  now: string,
  settlementJournalEntryId?: string,
) {
  const openItem = assertScope(docs.openItems.get(openItemId), scope, 'Open item')
  const outstandingMinor = openItem.outstandingMinor - appliedMinor
  if (outstandingMinor < 0) throw new FinanceValidationError('Application exceeds target outstanding amount')
  const updated: OpenItem = {
    ...openItem,
    outstandingMinor,
    status: projectOpenItemStatus(openItem.originalMinor, outstandingMinor),
    version: openItem.version + 1,
    updatedAt: now,
    updatedBy: actorId,
  }
  docs.openItems.set(updated.id, updated)

  if (openItem.sourceType === 'customer_invoice') {
    const invoice = assertScope(docs.invoices.get(openItem.sourceId), scope, 'Customer invoice')
    const { contentHash: _c, ...rest } = invoice
    const journals = settlementJournalEntryId
      ? [...invoice.settlementJournalEntryIds, settlementJournalEntryId]
      : invoice.settlementJournalEntryIds
    const baseStatus = invoice.status === 'paid' || invoice.status === 'partially_paid' ? 'issued' : invoice.status
    docs.invoices.set(invoice.id, {
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
    const bill = assertScope(docs.bills.get(openItem.sourceId), scope, 'Supplier bill')
    const { contentHash: _c, ...rest } = bill
    const journals = settlementJournalEntryId
      ? [...bill.settlementJournalEntryIds, settlementJournalEntryId]
      : bill.settlementJournalEntryIds
    const baseStatus = bill.status === 'paid' || bill.status === 'partially_paid' ? 'issued' : bill.status
    docs.bills.set(bill.id, {
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

// Command types
export interface CreateCustomerCreditNoteCommand extends Required<FinanceScope>, CommandIdentity {
  id: string; customerCompanyId: string; customerSnapshot: CounterpartySnapshot; relatedInvoiceId?: string
  issueDate: string; currency: string; accountingBasis: AccountingBasis; numberPrefix?: string; reason?: string
  lines: DocumentLineInput[]; expectedVersion: 0
}
export interface IssueCustomerCreditNoteCommand extends Required<FinanceScope>, CommandIdentity {
  creditNoteId: string; expectedVersion: number; issueJournalEntryId?: string
}
export interface ApplyCustomerCreditNoteCommand extends Required<FinanceScope>, CommandIdentity {
  id: string; creditNoteId: string; invoiceId: string; appliedMinor: number; settlementJournalEntryId?: string; expectedVersion: 0
}
export interface VoidCustomerCreditNoteCommand extends Required<FinanceScope>, CommandIdentity {
  creditNoteId: string; expectedVersion: number; reason: string
}
export interface CreateSupplierDebitNoteCommand extends Required<FinanceScope>, CommandIdentity {
  id: string; supplierCompanyId: string; supplierSnapshot: CounterpartySnapshot; relatedBillId?: string; supplierReference?: string
  issueDate: string; currency: string; accountingBasis: AccountingBasis; numberPrefix?: string; reason?: string
  lines: DocumentLineInput[]; expectedVersion: 0
}
export interface IssueSupplierDebitNoteCommand extends Required<FinanceScope>, CommandIdentity {
  debitNoteId: string; expectedVersion: number; issueJournalEntryId?: string
}
export interface ApplySupplierDebitNoteCommand extends Required<FinanceScope>, CommandIdentity {
  id: string; debitNoteId: string; billId: string; appliedMinor: number; settlementJournalEntryId?: string; expectedVersion: 0
}
export interface VoidSupplierDebitNoteCommand extends Required<FinanceScope>, CommandIdentity {
  debitNoteId: string; expectedVersion: number; reason: string
}
export interface CreateRecurringScheduleCommand extends Required<FinanceScope>, CommandIdentity {
  id: string; documentKind: RecurringDocumentSchedule['documentKind']; name: string
  frequency: RecurringDocumentSchedule['frequency']; startDate: string; endDate?: string
  template: RecurringDocumentSchedule['template']; expectedVersion: 0
}
export interface GenerateRecurringScheduleCommand extends Required<FinanceScope>, CommandIdentity {
  scheduleId: string; expectedVersion: number; runDate?: string; documentId: string; controlAccountId?: string; autoIssue?: boolean
}
export interface PauseRecurringScheduleCommand extends Required<FinanceScope>, CommandIdentity {
  scheduleId: string; expectedVersion: number; reason?: string
}
export interface CreateCounterpartyStatementCommand extends Required<FinanceScope>, CommandIdentity {
  id: string; role: 'customer' | 'supplier'; counterpartyCompanyId: string; counterpartySnapshot: CounterpartySnapshot
  fromDate: string; toDate: string; currency: string; exportFormat?: CounterpartyStatementDraft['exportFormat']; expectedVersion: 0
}
export interface BulkIssueDocumentsCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  targets: Array<{ type: 'customer_invoice' | 'supplier_bill' | 'customer_credit_note' | 'supplier_debit_note'; id: string; expectedVersion: number; controlAccountId?: string; issueJournalEntryId?: string }>
}
export interface BulkVoidDocumentsCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  targets: Array<{ type: 'customer_invoice' | 'customer_credit_note' | 'supplier_debit_note'; id: string; expectedVersion: number; reason: string }>
}
export interface BulkAllocatePaymentsCommand extends Required<FinanceScope>, CommandIdentity {
  id: string
  allocations: Array<{ id: string; paymentId: string; targetType: PaymentAllocation['targetType']; targetId: string; allocatedMinor: number; discountMinor?: number; writeOffMinor?: number; settlementJournalEntryId?: string }>
}
export interface AddDocumentAttachmentCommand extends Required<FinanceScope>, CommandIdentity {
  id: string; parentType: FinanceDocumentAttachment['parentType']; parentId: string
  fileName: string; contentType: string; byteSize: number; storageRef: string; sha256?: string; expectedVersion: 0
}
export interface BuildAgingReportCommand extends Required<FinanceScope> {
  role: 'customer' | 'supplier'; asOfDate: string; currency: string
}

export class ArApDepthService {
  constructor(
    private readonly docsStore: InMemoryDocumentsStore,
    private readonly docsService: FinanceDocumentsService,
    private readonly depthStore: InMemoryArApDepthStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async createCustomerCreditNote(actor: FinanceActorContext, command: CreateCustomerCreditNoteCommand): Promise<CustomerCreditNote> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    assertCreateVersion(command.expectedVersion, 'Customer credit note')
    authorizeFinanceAction(actor, scope, 'credit_note.create', this.now())
    assertEnumValue(command.accountingBasis, ['cash', 'accrual'], 'accountingBasis')
    parseCanonicalDate(command.issueDate, 'issueDate')
    requiredText(command.customerCompanyId, 'customerCompanyId')
    requiredText(command.customerSnapshot.companyId, 'customerSnapshot.companyId')
    requiredText(command.customerSnapshot.legalName, 'customerSnapshot.legalName')
    if (command.customerSnapshot.companyId !== command.customerCompanyId) throw new FinanceValidationError('customerSnapshot.companyId must match customerCompanyId')
    return this.depthStore.transact((state) => {
      const now = this.now()
      const idem = idemInput(state, actor, scope, 'customer_credit_note.create', command, now)
      if (idem.retryId) return assertScope(state.creditNotes.get(idem.retryId), scope, 'Customer credit note')
      if (state.creditNotes.get(command.id)) throw new FinanceValidationError('Customer credit note already exists')
      if (command.relatedInvoiceId) {
        const invoice = assertScope(this.docsStore.invoices.get(command.relatedInvoiceId), scope, 'Related customer invoice')
        if (invoice.customerCompanyId !== command.customerCompanyId) throw new FinanceValidationError('Related invoice customer does not match credit note customer')
      }
      const { lines, totals } = resolveLines(this.docsStore, scope, command.lines, command.issueDate)
      const documentNumber = formatDocumentNumber(command.numberPrefix ?? 'CN', nextSeq(state, scope, 'customer_credit_note'))
      claim(state, 'customer_credit_note_number', scope, documentNumber, command.id, 'Customer credit note number already exists')
      const note: CustomerCreditNote = {
        ...scope, id: command.id, documentNumber, customerCompanyId: command.customerCompanyId,
        customerSnapshot: structuredClone(command.customerSnapshot), issueDate: command.issueDate,
        currency: command.currency, accountingBasis: command.accountingBasis, status: 'draft', postingState: 'unposted',
        lines, ...totals, remainingMinor: totals.totalMinor, immutable: false, massEmailAllowed: false,
        schemaVersion: 1, version: 1, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid,
        ...(command.relatedInvoiceId ? { relatedInvoiceId: command.relatedInvoiceId } : {}),
        ...(command.reason ? { reason: command.reason } : {}),
      }
      state.creditNotes.set(note.id, note)
      appendAudit(state, scope, actor, 'customer_credit_note.created', 'customer_credit_note', note.id, note.version, now, command, { documentNumber, totalMinor: note.totalMinor })
      storeIdem(state, actor, scope, 'customer_credit_note.create', command, note.id, idem.claimId, idem.payloadDigest, now, note)
      return note
    })
  }

  async issueCustomerCreditNote(actor: FinanceActorContext, command: IssueCustomerCreditNoteCommand): Promise<CustomerCreditNote> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    authorizeFinanceAction(actor, scope, 'credit_note.issue', this.now())
    return this.depthStore.transact((state) => {
      const now = this.now()
      const idem = idemInput(state, actor, scope, 'customer_credit_note.issue', command, now)
      if (idem.retryId) return assertScope(state.creditNotes.get(idem.retryId), scope, 'Customer credit note')
      const existing = assertScope(state.creditNotes.get(command.creditNoteId), scope, 'Customer credit note')
      if (existing.version !== command.expectedVersion) throw new FinanceValidationError('Customer credit note version mismatch')
      if (existing.status !== 'draft') throw new FinanceValidationError('Only draft customer credit notes can be issued')
      const issuedBase = {
        ...existing, status: 'issued' as const, postingState: 'posted' as const, remainingMinor: existing.totalMinor,
        immutable: true, version: existing.version + 1, updatedAt: now, updatedBy: actor.uid,
        ...(command.issueJournalEntryId ? { issueJournalEntryId: command.issueJournalEntryId } : {}),
      }
      const withHash = { ...issuedBase, contentHash: immutableContentHash(issuedBase) }
      state.creditNotes.set(withHash.id, withHash)
      appendAudit(state, scope, actor, 'customer_credit_note.issued', 'customer_credit_note', withHash.id, withHash.version, now, command, { totalMinor: withHash.totalMinor })
      storeIdem(state, actor, scope, 'customer_credit_note.issue', command, withHash.id, idem.claimId, idem.payloadDigest, now, withHash)
      return withHash
    })
  }

  async applyCustomerCreditNote(actor: FinanceActorContext, command: ApplyCustomerCreditNoteCommand): Promise<NoteApplication> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    authorizeFinanceAction(actor, scope, 'credit_note.apply', this.now())
    return this.depthStore.transact((state) => {
      const now = this.now()
      const idem = idemInput(state, actor, scope, 'customer_credit_note.apply', command, now)
      if (idem.retryId) return assertScope(state.noteApplications.get(idem.retryId), scope, 'Note application')
      if (state.noteApplications.get(command.id)) throw new FinanceValidationError('Note application already exists')
      const note = assertScope(state.creditNotes.get(command.creditNoteId), scope, 'Customer credit note')
      if (note.status === 'draft' || note.status === 'voided' || note.status === 'applied') {
        throw new FinanceValidationError('Customer credit note is not applicable in its current status')
      }
      const invoice = assertScope(this.docsStore.invoices.get(command.invoiceId), scope, 'Customer invoice')
      if (invoice.customerCompanyId !== note.customerCompanyId) throw new FinanceValidationError('Credit note and invoice customers must match')
      if (invoice.status === 'draft' || invoice.status === 'voided' || invoice.status === 'paid') {
        throw new FinanceValidationError('Cannot apply credit note to draft, voided, or paid invoice')
      }
      if (!invoice.openItemId) throw new FinanceValidationError('Invoice has no open item to apply against')
      const openItem = assertScope(this.docsStore.openItems.get(invoice.openItemId), scope, 'Open item')
      assertNoteApplicationAmount(note.remainingMinor, openItem.outstandingMinor, command.appliedMinor)
      const application: NoteApplication = {
        ...scope, id: command.id, noteType: 'customer_credit_note', noteId: note.id, targetType: 'customer_invoice',
        targetId: invoice.id, openItemId: openItem.id, appliedMinor: command.appliedMinor, status: 'active',
        schemaVersion: 1, version: 1, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid,
        ...(command.settlementJournalEntryId ? { settlementJournalEntryId: command.settlementJournalEntryId } : {}),
      }
      state.noteApplications.set(application.id, application)
      const remainingMinor = note.remainingMinor - command.appliedMinor
      const { contentHash: _c, ...noteRest } = note
      state.creditNotes.set(note.id, {
        ...noteRest, remainingMinor,
        status: projectCreditNoteStatus(note.totalMinor, remainingMinor, note.status) as CustomerCreditNote['status'],
        version: note.version + 1, updatedAt: now, updatedBy: actor.uid,
      })
      reduceOpenItem(this.docsStore, scope, openItem.id, command.appliedMinor, actor.uid, now, command.settlementJournalEntryId)
      appendAudit(state, scope, actor, 'customer_credit_note.applied', 'note_application', application.id, application.version, now, command, {
        creditNoteId: note.id, invoiceId: invoice.id, appliedMinor: command.appliedMinor,
      })
      storeIdem(state, actor, scope, 'customer_credit_note.apply', command, application.id, idem.claimId, idem.payloadDigest, now, application)
      return application
    })
  }

  async voidCustomerCreditNote(actor: FinanceActorContext, command: VoidCustomerCreditNoteCommand): Promise<CustomerCreditNote> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    authorizeFinanceAction(actor, scope, 'credit_note.void', this.now())
    requiredText(command.reason, 'reason')
    return this.depthStore.transact((state) => {
      const now = this.now()
      const idem = idemInput(state, actor, scope, 'customer_credit_note.void', command, now)
      if (idem.retryId) return assertScope(state.creditNotes.get(idem.retryId), scope, 'Customer credit note')
      const existing = assertScope(state.creditNotes.get(command.creditNoteId), scope, 'Customer credit note')
      if (existing.version !== command.expectedVersion) throw new FinanceValidationError('Customer credit note version mismatch')
      if (existing.status === 'voided') throw new FinanceValidationError('Customer credit note already voided')
      if (existing.status === 'partially_applied' || existing.status === 'applied') {
        throw new FinanceValidationError('Cannot void a credit note with applications; reverse applications first')
      }
      const voidedBase = {
        ...existing, status: 'voided' as const, remainingMinor: 0, voidReason: command.reason,
        immutable: true, version: existing.version + 1, updatedAt: now, updatedBy: actor.uid,
      }
      const withHash = { ...voidedBase, contentHash: immutableContentHash(voidedBase) }
      state.creditNotes.set(withHash.id, withHash)
      appendAudit(state, scope, actor, 'customer_credit_note.voided', 'customer_credit_note', withHash.id, withHash.version, now, command, { reason: command.reason }, command.reason)
      storeIdem(state, actor, scope, 'customer_credit_note.void', command, withHash.id, idem.claimId, idem.payloadDigest, now, withHash)
      return withHash
    })
  }

  async createSupplierDebitNote(actor: FinanceActorContext, command: CreateSupplierDebitNoteCommand): Promise<SupplierDebitNote> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    assertCreateVersion(command.expectedVersion, 'Supplier debit note')
    authorizeFinanceAction(actor, scope, 'debit_note.create', this.now())
    assertEnumValue(command.accountingBasis, ['cash', 'accrual'], 'accountingBasis')
    parseCanonicalDate(command.issueDate, 'issueDate')
    requiredText(command.supplierCompanyId, 'supplierCompanyId')
    requiredText(command.supplierSnapshot.companyId, 'supplierSnapshot.companyId')
    requiredText(command.supplierSnapshot.legalName, 'supplierSnapshot.legalName')
    if (command.supplierSnapshot.companyId !== command.supplierCompanyId) throw new FinanceValidationError('supplierSnapshot.companyId must match supplierCompanyId')
    return this.depthStore.transact((state) => {
      const now = this.now()
      const idem = idemInput(state, actor, scope, 'supplier_debit_note.create', command, now)
      if (idem.retryId) return assertScope(state.debitNotes.get(idem.retryId), scope, 'Supplier debit note')
      if (state.debitNotes.get(command.id)) throw new FinanceValidationError('Supplier debit note already exists')
      if (command.relatedBillId) {
        const bill = assertScope(this.docsStore.bills.get(command.relatedBillId), scope, 'Related supplier bill')
        if (bill.supplierCompanyId !== command.supplierCompanyId) throw new FinanceValidationError('Related bill supplier does not match debit note supplier')
      }
      const { lines, totals } = resolveLines(this.docsStore, scope, command.lines, command.issueDate)
      const documentNumber = formatDocumentNumber(command.numberPrefix ?? 'DN', nextSeq(state, scope, 'supplier_debit_note'))
      claim(state, 'supplier_debit_note_number', scope, documentNumber, command.id, 'Supplier debit note number already exists')
      const note: SupplierDebitNote = {
        ...scope, id: command.id, documentNumber, supplierCompanyId: command.supplierCompanyId,
        supplierSnapshot: structuredClone(command.supplierSnapshot), issueDate: command.issueDate,
        currency: command.currency, accountingBasis: command.accountingBasis, status: 'draft', postingState: 'unposted',
        lines, ...totals, remainingMinor: totals.totalMinor, immutable: false, massEmailAllowed: false,
        schemaVersion: 1, version: 1, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid,
        ...(command.relatedBillId ? { relatedBillId: command.relatedBillId } : {}),
        ...(command.supplierReference ? { supplierReference: command.supplierReference } : {}),
        ...(command.reason ? { reason: command.reason } : {}),
      }
      state.debitNotes.set(note.id, note)
      appendAudit(state, scope, actor, 'supplier_debit_note.created', 'supplier_debit_note', note.id, note.version, now, command, { documentNumber, totalMinor: note.totalMinor })
      storeIdem(state, actor, scope, 'supplier_debit_note.create', command, note.id, idem.claimId, idem.payloadDigest, now, note)
      return note
    })
  }

  async issueSupplierDebitNote(actor: FinanceActorContext, command: IssueSupplierDebitNoteCommand): Promise<SupplierDebitNote> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    authorizeFinanceAction(actor, scope, 'debit_note.issue', this.now())
    return this.depthStore.transact((state) => {
      const now = this.now()
      const idem = idemInput(state, actor, scope, 'supplier_debit_note.issue', command, now)
      if (idem.retryId) return assertScope(state.debitNotes.get(idem.retryId), scope, 'Supplier debit note')
      const existing = assertScope(state.debitNotes.get(command.debitNoteId), scope, 'Supplier debit note')
      if (existing.version !== command.expectedVersion) throw new FinanceValidationError('Supplier debit note version mismatch')
      if (existing.status !== 'draft') throw new FinanceValidationError('Only draft supplier debit notes can be issued')
      const issuedBase = {
        ...existing, status: 'issued' as const, postingState: 'posted' as const, remainingMinor: existing.totalMinor,
        immutable: true, version: existing.version + 1, updatedAt: now, updatedBy: actor.uid,
        ...(command.issueJournalEntryId ? { issueJournalEntryId: command.issueJournalEntryId } : {}),
      }
      const withHash = { ...issuedBase, contentHash: immutableContentHash(issuedBase) }
      state.debitNotes.set(withHash.id, withHash)
      appendAudit(state, scope, actor, 'supplier_debit_note.issued', 'supplier_debit_note', withHash.id, withHash.version, now, command, { totalMinor: withHash.totalMinor })
      storeIdem(state, actor, scope, 'supplier_debit_note.issue', command, withHash.id, idem.claimId, idem.payloadDigest, now, withHash)
      return withHash
    })
  }

  async applySupplierDebitNote(actor: FinanceActorContext, command: ApplySupplierDebitNoteCommand): Promise<NoteApplication> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    authorizeFinanceAction(actor, scope, 'debit_note.apply', this.now())
    return this.depthStore.transact((state) => {
      const now = this.now()
      const idem = idemInput(state, actor, scope, 'supplier_debit_note.apply', command, now)
      if (idem.retryId) return assertScope(state.noteApplications.get(idem.retryId), scope, 'Note application')
      if (state.noteApplications.get(command.id)) throw new FinanceValidationError('Note application already exists')
      const note = assertScope(state.debitNotes.get(command.debitNoteId), scope, 'Supplier debit note')
      if (note.status === 'draft' || note.status === 'voided' || note.status === 'applied') {
        throw new FinanceValidationError('Supplier debit note is not applicable in its current status')
      }
      const bill = assertScope(this.docsStore.bills.get(command.billId), scope, 'Supplier bill')
      if (bill.supplierCompanyId !== note.supplierCompanyId) throw new FinanceValidationError('Debit note and bill suppliers must match')
      if (bill.status === 'draft' || bill.status === 'voided' || bill.status === 'paid') {
        throw new FinanceValidationError('Cannot apply debit note to draft, voided, or paid bill')
      }
      if (!bill.openItemId) throw new FinanceValidationError('Bill has no open item to apply against')
      const openItem = assertScope(this.docsStore.openItems.get(bill.openItemId), scope, 'Open item')
      assertNoteApplicationAmount(note.remainingMinor, openItem.outstandingMinor, command.appliedMinor)
      const application: NoteApplication = {
        ...scope, id: command.id, noteType: 'supplier_debit_note', noteId: note.id, targetType: 'supplier_bill',
        targetId: bill.id, openItemId: openItem.id, appliedMinor: command.appliedMinor, status: 'active',
        schemaVersion: 1, version: 1, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid,
        ...(command.settlementJournalEntryId ? { settlementJournalEntryId: command.settlementJournalEntryId } : {}),
      }
      state.noteApplications.set(application.id, application)
      const remainingMinor = note.remainingMinor - command.appliedMinor
      const { contentHash: _c, ...noteRest } = note
      state.debitNotes.set(note.id, {
        ...noteRest, remainingMinor,
        status: projectCreditNoteStatus(note.totalMinor, remainingMinor, note.status) as SupplierDebitNote['status'],
        version: note.version + 1, updatedAt: now, updatedBy: actor.uid,
      })
      reduceOpenItem(this.docsStore, scope, openItem.id, command.appliedMinor, actor.uid, now, command.settlementJournalEntryId)
      appendAudit(state, scope, actor, 'supplier_debit_note.applied', 'note_application', application.id, application.version, now, command, {
        debitNoteId: note.id, billId: bill.id, appliedMinor: command.appliedMinor,
      })
      storeIdem(state, actor, scope, 'supplier_debit_note.apply', command, application.id, idem.claimId, idem.payloadDigest, now, application)
      return application
    })
  }

  async voidSupplierDebitNote(actor: FinanceActorContext, command: VoidSupplierDebitNoteCommand): Promise<SupplierDebitNote> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    authorizeFinanceAction(actor, scope, 'debit_note.void', this.now())
    requiredText(command.reason, 'reason')
    return this.depthStore.transact((state) => {
      const now = this.now()
      const idem = idemInput(state, actor, scope, 'supplier_debit_note.void', command, now)
      if (idem.retryId) return assertScope(state.debitNotes.get(idem.retryId), scope, 'Supplier debit note')
      const existing = assertScope(state.debitNotes.get(command.debitNoteId), scope, 'Supplier debit note')
      if (existing.version !== command.expectedVersion) throw new FinanceValidationError('Supplier debit note version mismatch')
      if (existing.status === 'voided') throw new FinanceValidationError('Supplier debit note already voided')
      if (existing.status === 'partially_applied' || existing.status === 'applied') {
        throw new FinanceValidationError('Cannot void a debit note with applications; reverse applications first')
      }
      const voidedBase = {
        ...existing, status: 'voided' as const, remainingMinor: 0, voidReason: command.reason,
        immutable: true, version: existing.version + 1, updatedAt: now, updatedBy: actor.uid,
      }
      const withHash = { ...voidedBase, contentHash: immutableContentHash(voidedBase) }
      state.debitNotes.set(withHash.id, withHash)
      appendAudit(state, scope, actor, 'supplier_debit_note.voided', 'supplier_debit_note', withHash.id, withHash.version, now, command, { reason: command.reason }, command.reason)
      storeIdem(state, actor, scope, 'supplier_debit_note.void', command, withHash.id, idem.claimId, idem.payloadDigest, now, withHash)
      return withHash
    })
  }

  async createRecurringSchedule(actor: FinanceActorContext, command: CreateRecurringScheduleCommand): Promise<RecurringDocumentSchedule> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    assertCreateVersion(command.expectedVersion, 'Recurring schedule')
    authorizeFinanceAction(actor, scope, 'recurring.create', this.now())
    assertEnumValue(command.documentKind, ['customer_invoice', 'supplier_bill'], 'documentKind')
    assertEnumValue(command.frequency, ['weekly', 'monthly', 'quarterly', 'yearly'], 'frequency')
    parseCanonicalDate(command.startDate, 'startDate')
    if (command.endDate) {
      parseCanonicalDate(command.endDate, 'endDate')
      if (command.endDate < command.startDate) throw new FinanceValidationError('endDate must be on or after startDate')
    }
    requiredText(command.name, 'name')
    requiredText(command.template.counterpartyCompanyId, 'template.counterpartyCompanyId')
    if (!Array.isArray(command.template.lines) || command.template.lines.length === 0) throw new FinanceValidationError('Recurring template requires at least one line')
    assertSafeInteger(command.template.dueDays, 'template.dueDays', 0)
    return this.depthStore.transact((state) => {
      const now = this.now()
      const idem = idemInput(state, actor, scope, 'recurring_schedule.create', command, now)
      if (idem.retryId) return assertScope(state.recurringSchedules.get(idem.retryId), scope, 'Recurring schedule')
      if (state.recurringSchedules.get(command.id)) throw new FinanceValidationError('Recurring schedule already exists')
      resolveLines(this.docsStore, scope, command.template.lines, command.startDate)
      const schedule: RecurringDocumentSchedule = {
        ...scope, id: command.id, documentKind: command.documentKind, name: command.name.trim(),
        frequency: command.frequency, startDate: command.startDate, nextRunDate: command.startDate,
        status: 'active', template: structuredClone(command.template), generatedCount: 0,
        autoSend: false, massEmailAllowed: false,
        schemaVersion: 1, version: 1, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid,
        ...(command.endDate ? { endDate: command.endDate } : {}),
      }
      state.recurringSchedules.set(schedule.id, schedule)
      appendAudit(state, scope, actor, 'recurring_schedule.created', 'recurring_schedule', schedule.id, schedule.version, now, command, {
        documentKind: schedule.documentKind, frequency: schedule.frequency, nextRunDate: schedule.nextRunDate, autoSend: false,
      })
      storeIdem(state, actor, scope, 'recurring_schedule.create', command, schedule.id, idem.claimId, idem.payloadDigest, now, schedule)
      return schedule
    })
  }

  async generateRecurringSchedule(actor: FinanceActorContext, command: GenerateRecurringScheduleCommand): Promise<{ schedule: RecurringDocumentSchedule; document: FinanceCustomerInvoice | SupplierBill }> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    authorizeFinanceAction(actor, scope, 'recurring.generate', this.now())
    const existingBefore = assertScope(this.depthStore.recurringSchedules.get(command.scheduleId), scope, 'Recurring schedule')
    {
      const now = this.now()
      const idemProbe = idemInput(this.depthStore, actor, scope, 'recurring_schedule.generate', command, now)
      if (idemProbe.retryId && idemProbe.resultSnapshot) return idemProbe.resultSnapshot as { schedule: RecurringDocumentSchedule; document: FinanceCustomerInvoice | SupplierBill }
    }
    if (existingBefore.version !== command.expectedVersion) throw new FinanceValidationError('Recurring schedule version mismatch')
    if (existingBefore.status !== 'active') throw new FinanceValidationError('Only active recurring schedules can generate documents')
    const runDate = command.runDate || existingBefore.nextRunDate
    parseCanonicalDate(runDate, 'runDate')
    if (runDate < existingBefore.nextRunDate) throw new FinanceValidationError('runDate cannot be before nextRunDate')
    if (existingBefore.endDate && runDate > existingBefore.endDate) throw new FinanceValidationError('runDate is after schedule endDate')
    const dueDate = addCalendarDays(runDate, existingBefore.template.dueDays)

    let document: FinanceCustomerInvoice | SupplierBill
    if (existingBefore.documentKind === 'customer_invoice') {
      document = await this.docsService.createCustomerInvoice(actor, compactUndefined({
        ...scope, id: command.documentId,
        customerCompanyId: existingBefore.template.counterpartyCompanyId,
        customerSnapshot: existingBefore.template.counterpartySnapshot,
        issueDate: runDate, dueDate, currency: existingBefore.template.currency,
        accountingBasis: existingBefore.template.accountingBasis,
        numberPrefix: existingBefore.template.numberPrefix, lines: existingBefore.template.lines,
        expectedVersion: 0, requestId: `${command.requestId}:doc`, idempotencyKey: `${command.idempotencyKey}:doc`,
      }) as CreateCustomerInvoiceCommand)
      if (command.autoIssue) {
        if (!command.controlAccountId) throw new FinanceValidationError('controlAccountId is required when autoIssue is true')
        document = await this.docsService.issueCustomerInvoice(actor, compactUndefined({
          ...scope, invoiceId: document.id, expectedVersion: document.version, controlAccountId: command.controlAccountId,
          requestId: `${command.requestId}:issue`, idempotencyKey: `${command.idempotencyKey}:issue`,
        }) as IssueCustomerInvoiceCommand)
      }
    } else {
      document = await this.docsService.createSupplierBill(actor, compactUndefined({
        ...scope, id: command.documentId,
        supplierCompanyId: existingBefore.template.counterpartyCompanyId,
        supplierSnapshot: existingBefore.template.counterpartySnapshot,
        supplierReference: existingBefore.template.supplierReferencePrefix
          ? `${existingBefore.template.supplierReferencePrefix}-${existingBefore.generatedCount + 1}`
          : undefined,
        issueDate: runDate, receivedDate: runDate, dueDate, currency: existingBefore.template.currency,
        accountingBasis: existingBefore.template.accountingBasis,
        numberPrefix: existingBefore.template.numberPrefix, lines: existingBefore.template.lines,
        expectedVersion: 0, requestId: `${command.requestId}:doc`, idempotencyKey: `${command.idempotencyKey}:doc`,
      }) as CreateSupplierBillCommand)
      if (command.autoIssue) {
        if (!command.controlAccountId) throw new FinanceValidationError('controlAccountId is required when autoIssue is true')
        document = await this.docsService.issueSupplierBill(actor, compactUndefined({
          ...scope, billId: document.id, expectedVersion: document.version, controlAccountId: command.controlAccountId,
          requestId: `${command.requestId}:issue`, idempotencyKey: `${command.idempotencyKey}:issue`,
        }) as IssueSupplierBillCommand)
      }
    }

    return this.depthStore.transact((state) => {
      const now = this.now()
      const idem = idemInput(state, actor, scope, 'recurring_schedule.generate', command, now)
      if (idem.retryId && idem.resultSnapshot) return idem.resultSnapshot as { schedule: RecurringDocumentSchedule; document: FinanceCustomerInvoice | SupplierBill }
      const live = assertScope(state.recurringSchedules.get(command.scheduleId), scope, 'Recurring schedule')
      if (live.version !== command.expectedVersion) throw new FinanceValidationError('Recurring schedule version mismatch')
      let nextRunDate = nextRecurringRunDate(runDate, live.frequency)
      let status: RecurringDocumentSchedule['status'] = 'active'
      if (live.endDate && nextRunDate > live.endDate) {
        status = 'completed'
        nextRunDate = live.endDate
      }
      const schedule: RecurringDocumentSchedule = {
        ...live, nextRunDate, status, lastGeneratedDocumentId: document.id, lastGeneratedAt: now,
        generatedCount: live.generatedCount + 1, version: live.version + 1, updatedAt: now, updatedBy: actor.uid,
      }
      state.recurringSchedules.set(schedule.id, schedule)
      const result = { schedule, document }
      appendAudit(state, scope, actor, 'recurring_schedule.generated', 'recurring_schedule', schedule.id, schedule.version, now, command, {
        documentId: document.id, runDate, nextRunDate: schedule.nextRunDate, autoSend: false, massEmailAllowed: false,
      })
      storeIdem(state, actor, scope, 'recurring_schedule.generate', command, schedule.id, idem.claimId, idem.payloadDigest, now, result)
      return result
    })
  }

  async pauseRecurringSchedule(actor: FinanceActorContext, command: PauseRecurringScheduleCommand): Promise<RecurringDocumentSchedule> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    authorizeFinanceAction(actor, scope, 'recurring.update', this.now())
    return this.depthStore.transact((state) => {
      const now = this.now()
      const idem = idemInput(state, actor, scope, 'recurring_schedule.pause', command, now)
      if (idem.retryId) return assertScope(state.recurringSchedules.get(idem.retryId), scope, 'Recurring schedule')
      const existing = assertScope(state.recurringSchedules.get(command.scheduleId), scope, 'Recurring schedule')
      if (existing.version !== command.expectedVersion) throw new FinanceValidationError('Recurring schedule version mismatch')
      if (existing.status === 'completed') throw new FinanceValidationError('Completed schedules cannot be paused')
      const paused: RecurringDocumentSchedule = { ...existing, status: 'paused', version: existing.version + 1, updatedAt: now, updatedBy: actor.uid }
      state.recurringSchedules.set(paused.id, paused)
      appendAudit(state, scope, actor, 'recurring_schedule.paused', 'recurring_schedule', paused.id, paused.version, now, command, { reason: command.reason }, command.reason)
      storeIdem(state, actor, scope, 'recurring_schedule.pause', command, paused.id, idem.claimId, idem.payloadDigest, now, paused)
      return paused
    })
  }

  async createCounterpartyStatement(actor: FinanceActorContext, command: CreateCounterpartyStatementCommand): Promise<CounterpartyStatementDraft> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    assertCreateVersion(command.expectedVersion, 'Counterparty statement')
    authorizeFinanceAction(actor, scope, 'statement.draft', this.now())
    assertEnumValue(command.role, ['customer', 'supplier'], 'role')
    parseCanonicalDate(command.fromDate, 'fromDate')
    parseCanonicalDate(command.toDate, 'toDate')
    if (command.toDate < command.fromDate) throw new FinanceValidationError('toDate must be on or after fromDate')
    requiredText(command.counterpartyCompanyId, 'counterpartyCompanyId')
    const exportFormat = command.exportFormat ?? 'csv'
    assertEnumValue(exportFormat, ['json', 'csv', 'pdf_payload'], 'exportFormat')
    return this.depthStore.transact((state) => {
      const now = this.now()
      const idem = idemInput(state, actor, scope, 'statement_draft.create', command, now)
      if (idem.retryId) return assertScope(state.statementDrafts.get(idem.retryId), scope, 'Statement draft')
      if (state.statementDrafts.get(command.id)) throw new FinanceValidationError('Statement draft already exists')

      type RawLine = { date: string; documentType: string; documentId: string; documentNumber?: string; description: string; debitMinor: number; creditMinor: number }
      const raw: RawLine[] = []
      if (command.role === 'customer') {
        for (const inv of this.docsStore.invoices.values()) {
          if (inv.orgId !== scope.orgId || inv.legalEntityId !== scope.legalEntityId || inv.bookId !== scope.bookId) continue
          if (inv.customerCompanyId !== command.counterpartyCompanyId) continue
          if (inv.status === 'draft' || inv.status === 'voided') continue
          if (inv.issueDate < command.fromDate || inv.issueDate > command.toDate) continue
          raw.push({ date: inv.issueDate, documentType: 'customer_invoice', documentId: inv.id, documentNumber: inv.documentNumber, description: `Invoice ${inv.documentNumber}`, debitMinor: inv.totalMinor, creditMinor: 0 })
        }
        for (const note of state.creditNotes.values()) {
          if (note.orgId !== scope.orgId || note.legalEntityId !== scope.legalEntityId || note.bookId !== scope.bookId) continue
          if (note.customerCompanyId !== command.counterpartyCompanyId) continue
          if (note.status === 'draft' || note.status === 'voided') continue
          if (note.issueDate < command.fromDate || note.issueDate > command.toDate) continue
          raw.push({ date: note.issueDate, documentType: 'customer_credit_note', documentId: note.id, documentNumber: note.documentNumber, description: `Credit note ${note.documentNumber}`, debitMinor: 0, creditMinor: note.totalMinor })
        }
        for (const payment of this.docsStore.payments.values()) {
          if (payment.orgId !== scope.orgId || payment.legalEntityId !== scope.legalEntityId || payment.bookId !== scope.bookId) continue
          if (payment.counterpartyCompanyId !== command.counterpartyCompanyId) continue
          if (payment.direction !== 'receipt') continue
          if (payment.effectiveDate < command.fromDate || payment.effectiveDate > command.toDate) continue
          raw.push({ date: payment.effectiveDate, documentType: 'payment_receipt', documentId: payment.id, description: `Receipt ${payment.externalReference || payment.id}`, debitMinor: 0, creditMinor: payment.amountMinor })
        }
      } else {
        for (const bill of this.docsStore.bills.values()) {
          if (bill.orgId !== scope.orgId || bill.legalEntityId !== scope.legalEntityId || bill.bookId !== scope.bookId) continue
          if (bill.supplierCompanyId !== command.counterpartyCompanyId) continue
          if (bill.status === 'draft' || bill.status === 'voided') continue
          if (bill.issueDate < command.fromDate || bill.issueDate > command.toDate) continue
          raw.push({ date: bill.issueDate, documentType: 'supplier_bill', documentId: bill.id, documentNumber: bill.documentNumber, description: `Bill ${bill.documentNumber}`, debitMinor: 0, creditMinor: bill.totalMinor })
        }
        for (const note of state.debitNotes.values()) {
          if (note.orgId !== scope.orgId || note.legalEntityId !== scope.legalEntityId || note.bookId !== scope.bookId) continue
          if (note.supplierCompanyId !== command.counterpartyCompanyId) continue
          if (note.status === 'draft' || note.status === 'voided') continue
          if (note.issueDate < command.fromDate || note.issueDate > command.toDate) continue
          raw.push({ date: note.issueDate, documentType: 'supplier_debit_note', documentId: note.id, documentNumber: note.documentNumber, description: `Debit note ${note.documentNumber}`, debitMinor: note.totalMinor, creditMinor: 0 })
        }
        for (const payment of this.docsStore.payments.values()) {
          if (payment.orgId !== scope.orgId || payment.legalEntityId !== scope.legalEntityId || payment.bookId !== scope.bookId) continue
          if (payment.counterpartyCompanyId !== command.counterpartyCompanyId) continue
          if (payment.direction !== 'disbursement') continue
          if (payment.effectiveDate < command.fromDate || payment.effectiveDate > command.toDate) continue
          raw.push({ date: payment.effectiveDate, documentType: 'payment_disbursement', documentId: payment.id, description: `Payment ${payment.externalReference || payment.id}`, debitMinor: payment.amountMinor, creditMinor: 0 })
        }
      }
      raw.sort((a, b) => a.date.localeCompare(b.date) || a.documentId.localeCompare(b.documentId))
      const openingBalanceMinor = 0
      const { closingBalanceMinor, running } = buildStatementBalances({
        openingBalanceMinor,
        lines: raw.map((line) => ({ debitMinor: line.debitMinor, creditMinor: line.creditMinor })),
      })
      const lines = raw.map((line, index) => ({ ...line, balanceMinor: running[index]! }))
      let exportPayload: string | undefined
      if (exportFormat === 'csv') {
        exportPayload = renderStatementCsv({
          role: command.role, counterpartyName: command.counterpartySnapshot.legalName,
          fromDate: command.fromDate, toDate: command.toDate, currency: command.currency,
          openingBalanceMinor, closingBalanceMinor, lines,
        })
      } else {
        exportPayload = JSON.stringify({
          role: command.role, counterparty: command.counterpartySnapshot, fromDate: command.fromDate, toDate: command.toDate,
          currency: command.currency, openingBalanceMinor, closingBalanceMinor, lines,
          massEmailAllowed: false, autoSend: false, externalEgressAllowed: false,
        })
      }
      const draft: CounterpartyStatementDraft = {
        ...scope, id: command.id, role: command.role, counterpartyCompanyId: command.counterpartyCompanyId,
        counterpartySnapshot: structuredClone(command.counterpartySnapshot),
        fromDate: command.fromDate, toDate: command.toDate, currency: command.currency,
        openingBalanceMinor, closingBalanceMinor, lines, status: 'exported', exportFormat,
        massEmailAllowed: false, externalEgressAllowed: false, autoSend: false,
        schemaVersion: 1, version: 1, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid,
        ...(exportPayload ? { exportPayload } : {}),
      }
      state.statementDrafts.set(draft.id, draft)
      appendAudit(state, scope, actor, 'statement_draft.created', 'statement_draft', draft.id, draft.version, now, command, {
        role: draft.role, counterpartyCompanyId: draft.counterpartyCompanyId, closingBalanceMinor,
        massEmailAllowed: false, autoSend: false, externalEgressAllowed: false,
      })
      storeIdem(state, actor, scope, 'statement_draft.create', command, draft.id, idem.claimId, idem.payloadDigest, now, draft)
      return draft
    })
  }

  async bulkIssueDocuments(actor: FinanceActorContext, command: BulkIssueDocumentsCommand) {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    authorizeFinanceAction(actor, scope, 'documents.bulk_issue', this.now())
    if (!Array.isArray(command.targets) || command.targets.length === 0) throw new FinanceValidationError('bulk issue requires targets')
    if (command.targets.length > 50) throw new FinanceValidationError('bulk issue limited to 50 targets')
    const results: Array<{ type: string; id: string; status: string }> = []
    for (const [index, target] of command.targets.entries()) {
      const req = { requestId: `${command.requestId}:${index}`, idempotencyKey: `${command.idempotencyKey}:${index}` }
      if (target.type === 'customer_invoice') {
        if (!target.controlAccountId) throw new FinanceValidationError('controlAccountId required for customer_invoice bulk issue')
        const issued = await this.docsService.issueCustomerInvoice(actor, {
          ...scope, invoiceId: target.id, expectedVersion: target.expectedVersion, controlAccountId: target.controlAccountId,
          ...(target.issueJournalEntryId ? { issueJournalEntryId: target.issueJournalEntryId } : {}), ...req,
        } as IssueCustomerInvoiceCommand)
        results.push({ type: target.type, id: issued.id, status: issued.status })
      } else if (target.type === 'supplier_bill') {
        if (!target.controlAccountId) throw new FinanceValidationError('controlAccountId required for supplier_bill bulk issue')
        const issued = await this.docsService.issueSupplierBill(actor, {
          ...scope, billId: target.id, expectedVersion: target.expectedVersion, controlAccountId: target.controlAccountId,
          ...(target.issueJournalEntryId ? { issueJournalEntryId: target.issueJournalEntryId } : {}), ...req,
        } as IssueSupplierBillCommand)
        results.push({ type: target.type, id: issued.id, status: issued.status })
      } else if (target.type === 'customer_credit_note') {
        const issued = await this.issueCustomerCreditNote(actor, {
          ...scope, creditNoteId: target.id, expectedVersion: target.expectedVersion,
          ...(target.issueJournalEntryId ? { issueJournalEntryId: target.issueJournalEntryId } : {}), ...req,
        })
        results.push({ type: target.type, id: issued.id, status: issued.status })
      } else if (target.type === 'supplier_debit_note') {
        const issued = await this.issueSupplierDebitNote(actor, {
          ...scope, debitNoteId: target.id, expectedVersion: target.expectedVersion,
          ...(target.issueJournalEntryId ? { issueJournalEntryId: target.issueJournalEntryId } : {}), ...req,
        })
        results.push({ type: target.type, id: issued.id, status: issued.status })
      } else throw new FinanceValidationError('Unsupported bulk issue target type')
    }
    await this.depthStore.transact((state) => {
      appendAudit(state, scope, actor, 'documents.bulk_issue', 'bulk_operation', command.id, 1, this.now(), command, { count: results.length, results })
      return null
    })
    return { results }
  }

  async bulkVoidDocuments(actor: FinanceActorContext, command: BulkVoidDocumentsCommand) {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    authorizeFinanceAction(actor, scope, 'documents.bulk_void', this.now())
    if (!Array.isArray(command.targets) || command.targets.length === 0) throw new FinanceValidationError('bulk void requires targets')
    if (command.targets.length > 50) throw new FinanceValidationError('bulk void limited to 50 targets')
    const results: Array<{ type: string; id: string; status: string }> = []
    for (const [index, target] of command.targets.entries()) {
      const req = { requestId: `${command.requestId}:${index}`, idempotencyKey: `${command.idempotencyKey}:${index}` }
      if (target.type === 'customer_invoice') {
        const voided = await this.docsService.voidCustomerInvoice(actor, {
          ...scope, invoiceId: target.id, expectedVersion: target.expectedVersion, reason: target.reason, ...req,
        } as VoidCustomerInvoiceCommand)
        results.push({ type: target.type, id: voided.id, status: voided.status })
      } else if (target.type === 'customer_credit_note') {
        const voided = await this.voidCustomerCreditNote(actor, {
          ...scope, creditNoteId: target.id, expectedVersion: target.expectedVersion, reason: target.reason, ...req,
        })
        results.push({ type: target.type, id: voided.id, status: voided.status })
      } else if (target.type === 'supplier_debit_note') {
        const voided = await this.voidSupplierDebitNote(actor, {
          ...scope, debitNoteId: target.id, expectedVersion: target.expectedVersion, reason: target.reason, ...req,
        })
        results.push({ type: target.type, id: voided.id, status: voided.status })
      } else throw new FinanceValidationError('Unsupported bulk void target type')
    }
    await this.depthStore.transact((state) => {
      appendAudit(state, scope, actor, 'documents.bulk_void', 'bulk_operation', command.id, 1, this.now(), command, { count: results.length, results })
      return null
    })
    return { results }
  }

  async bulkAllocatePayments(actor: FinanceActorContext, command: BulkAllocatePaymentsCommand) {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    authorizeFinanceAction(actor, scope, 'documents.bulk_allocate', this.now())
    if (!Array.isArray(command.allocations) || command.allocations.length === 0) throw new FinanceValidationError('bulk allocate requires allocations')
    if (command.allocations.length > 50) throw new FinanceValidationError('bulk allocate limited to 50 allocations')
    const results: PaymentAllocation[] = []
    for (const [index, item] of command.allocations.entries()) {
      const allocation = await this.docsService.allocatePayment(actor, compactUndefined({
        ...scope, id: item.id, paymentId: item.paymentId, targetType: item.targetType, targetId: item.targetId,
        allocatedMinor: item.allocatedMinor, discountMinor: item.discountMinor, writeOffMinor: item.writeOffMinor,
        settlementJournalEntryId: item.settlementJournalEntryId, expectedVersion: 0,
        requestId: `${command.requestId}:${index}`, idempotencyKey: `${command.idempotencyKey}:${index}`,
      }) as AllocatePaymentCommand)
      results.push(allocation)
    }
    await this.depthStore.transact((state) => {
      appendAudit(state, scope, actor, 'documents.bulk_allocate', 'bulk_operation', command.id, 1, this.now(), command, {
        count: results.length, allocationIds: results.map((row) => row.id),
      })
      return null
    })
    return { results }
  }

  async addDocumentAttachment(actor: FinanceActorContext, command: AddDocumentAttachmentCommand): Promise<FinanceDocumentAttachment> {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    assertCreateVersion(command.expectedVersion, 'Document attachment')
    authorizeFinanceAction(actor, scope, 'attachment.add', this.now())
    requiredText(command.fileName, 'fileName')
    requiredText(command.contentType, 'contentType')
    requiredText(command.storageRef, 'storageRef')
    requiredText(command.parentId, 'parentId')
    assertSafeInteger(command.byteSize, 'byteSize', 1)
    if (command.byteSize > 25 * 1024 * 1024) throw new FinanceValidationError('Attachment exceeds 25MB limit')
    assertEnumValue(command.parentType, ['customer_invoice', 'supplier_bill', 'customer_credit_note', 'supplier_debit_note', 'payment', 'statement_draft'], 'parentType')
    return this.depthStore.transact((state) => {
      const now = this.now()
      const idem = idemInput(state, actor, scope, 'document_attachment.add', command, now)
      if (idem.retryId) return assertScope(state.attachments.get(idem.retryId), scope, 'Document attachment')
      if (state.attachments.get(command.id)) throw new FinanceValidationError('Document attachment already exists')
      if (command.parentType === 'customer_invoice') assertScope(this.docsStore.invoices.get(command.parentId), scope, 'Customer invoice')
      else if (command.parentType === 'supplier_bill') assertScope(this.docsStore.bills.get(command.parentId), scope, 'Supplier bill')
      else if (command.parentType === 'customer_credit_note') assertScope(state.creditNotes.get(command.parentId), scope, 'Customer credit note')
      else if (command.parentType === 'supplier_debit_note') assertScope(state.debitNotes.get(command.parentId), scope, 'Supplier debit note')
      else if (command.parentType === 'payment') assertScope(this.docsStore.payments.get(command.parentId), scope, 'Payment')
      else if (command.parentType === 'statement_draft') assertScope(state.statementDrafts.get(command.parentId), scope, 'Statement draft')
      const attachment: FinanceDocumentAttachment = {
        ...scope, id: command.id, parentType: command.parentType, parentId: command.parentId,
        fileName: command.fileName.trim(), contentType: command.contentType.trim(), byteSize: command.byteSize,
        storageRef: command.storageRef.trim(),
        schemaVersion: 1, version: 1, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid,
        ...(command.sha256 ? { sha256: command.sha256 } : {}),
      }
      state.attachments.set(attachment.id, attachment)
      appendAudit(state, scope, actor, 'document_attachment.added', 'document_attachment', attachment.id, attachment.version, now, command, {
        parentType: attachment.parentType, parentId: attachment.parentId, fileName: attachment.fileName, byteSize: attachment.byteSize,
      })
      storeIdem(state, actor, scope, 'document_attachment.add', command, attachment.id, idem.claimId, idem.payloadDigest, now, attachment)
      return attachment
    })
  }

  buildAgingReport(actor: FinanceActorContext, command: BuildAgingReportCommand) {
    const scope = { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
    authorizeFinanceAction(actor, scope, 'aging.read', this.now())
    assertEnumValue(command.role, ['customer', 'supplier'], 'role')
    const openItems = [...this.docsStore.openItems.values()].filter(
      (item) => item.orgId === scope.orgId && item.legalEntityId === scope.legalEntityId && item.bookId === scope.bookId,
    )
    return buildAgingReport({ asOfDate: command.asOfDate, currency: command.currency, role: command.role, openItems })
  }

  filterPortalDocuments(actor: FinanceActorContext, scope: Required<FinanceScope>, filters: DocumentListFilters = {}) {
    authorizeFinanceAction(actor, scope, 'invoice.read', this.now())
    const scoped = <T extends { orgId: string; legalEntityId: string; bookId: string }>(rows: Iterable<T>) =>
      [...rows].filter((row) => row.orgId === scope.orgId && row.legalEntityId === scope.legalEntityId && row.bookId === scope.bookId)
    return {
      invoices: filterDocumentsByPortalFilters(scoped(this.docsStore.invoices.values()), filters),
      bills: filterDocumentsByPortalFilters(scoped(this.docsStore.bills.values()), filters),
      creditNotes: filterDocumentsByPortalFilters(scoped(this.depthStore.creditNotes.values()), filters),
      debitNotes: filterDocumentsByPortalFilters(scoped(this.depthStore.debitNotes.values()), filters),
      payments: filterDocumentsByPortalFilters(scoped(this.docsStore.payments.values()) as any, filters),
      recurringSchedules: filterDocumentsByPortalFilters(scoped(this.depthStore.recurringSchedules.values()) as any, filters),
      statementDrafts: filterDocumentsByPortalFilters(scoped(this.depthStore.statementDrafts.values()) as any, filters),
      attachments: scoped(this.depthStore.attachments.values()),
      noteApplications: scoped(this.depthStore.noteApplications.values()),
    }
  }
}
