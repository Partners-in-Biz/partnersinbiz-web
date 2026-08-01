import type { DocumentData, Firestore } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { authorizeFinanceAction } from '@/lib/finance/policy'
import { canonicalDigest, scopedStorageId } from '@/lib/finance/integrity'
import type { FinanceActorContext, FinanceApprovalRecord, FinanceScope } from '@/lib/finance/types'
import {
  FinanceDocumentsService,
  InMemoryDocumentsStore,
  type AddReconciliationMatchCommand,
  type AllocatePaymentCommand,
  type ApproveReconciliationCommand,
  type CreateBankAccountCommand,
  type CreateCustomerInvoiceCommand,
  type CreateReconciliationCommand,
  type CreateSupplierBillCommand,
  type DocumentsServiceState,
  type ImportBankTransactionCommand,
  type IssueCustomerInvoiceCommand,
  type IssueSupplierBillCommand,
  type ObservePaymentCommand,
  type ReverseAllocationCommand,
  type SubmitReconciliationCommand,
  type VerifyPaymentCommand,
  type VoidCustomerInvoiceCommand,
} from './documents-service'
import type {
  BankAccount,
  BankTransaction,
  FinanceCustomerInvoice,
  FinancePayment,
  OpenItem,
  PaymentAllocation,
  Reconciliation,
  ReconciliationMatch,
  SupplierBill,
} from './documents-types'
import type { TaxCode, TaxRuleVersion } from './tax-types'

export type {
  AddReconciliationMatchCommand,
  AllocatePaymentCommand,
  ApproveReconciliationCommand,
  CreateBankAccountCommand,
  CreateCustomerInvoiceCommand,
  CreateReconciliationCommand,
  CreateSupplierBillCommand,
  ImportBankTransactionCommand,
  IssueCustomerInvoiceCommand,
  IssueSupplierBillCommand,
  ObservePaymentCommand,
  ReverseAllocationCommand,
  SubmitReconciliationCommand,
  VerifyPaymentCommand,
  VoidCustomerInvoiceCommand,
}

function clean<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clean) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, clean(item)]),
    ) as T
  }
  return value
}

function matchesScope(data: DocumentData | undefined, scope: Required<FinanceScope>): boolean {
  return Boolean(
    data
    && data.orgId === scope.orgId
    && data.legalEntityId === scope.legalEntityId
    && data.bookId === scope.bookId,
  )
}

async function hydrateDocumentsStore(db: Firestore, scope: Required<FinanceScope>): Promise<InMemoryDocumentsStore> {
  const store = new InMemoryDocumentsStore()
  const [
    invoices, bills, openItems, payments, allocations,
    bankAccounts, bankTx, recons, reconMatches, sequences,
    taxCodes, taxRules, approvals, claims, idempotency, audit,
  ] = await Promise.all([
    db.collection('finance_customer_invoices').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('supplier_bills').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('open_items').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('finance_payments').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('payment_allocations').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('bank_accounts').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('bank_transactions').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('reconciliations').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('reconciliation_matches').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('finance_sequences').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('tax_codes').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('tax_rule_versions').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('finance_approvals').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
    db.collection('finance_unique_claims').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).get(),
    db.collection('finance_idempotency_claims').where('orgId', '==', scope.orgId).get(),
    db.collection('finance_audit_events').where('orgId', '==', scope.orgId).where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get(),
  ])

  for (const doc of invoices.docs) {
    const value = doc.data() as FinanceCustomerInvoice
    if (matchesScope(value, scope)) store.invoices.set(value.id, value)
  }
  for (const doc of bills.docs) {
    const value = doc.data() as SupplierBill
    if (matchesScope(value, scope)) store.bills.set(value.id, value)
  }
  for (const doc of openItems.docs) {
    const value = doc.data() as OpenItem
    if (matchesScope(value, scope)) store.openItems.set(value.id, value)
  }
  for (const doc of payments.docs) {
    const value = doc.data() as FinancePayment
    if (matchesScope(value, scope)) store.payments.set(value.id, value)
  }
  for (const doc of allocations.docs) {
    const value = doc.data() as PaymentAllocation
    if (matchesScope(value, scope)) store.allocations.set(value.id, value)
  }
  for (const doc of bankAccounts.docs) {
    const value = doc.data() as BankAccount
    if (matchesScope(value, scope)) store.bankAccounts.set(value.id, value)
  }
  for (const doc of bankTx.docs) {
    const value = doc.data() as BankTransaction
    if (matchesScope(value, scope)) store.bankTransactions.set(value.id, value)
  }
  for (const doc of recons.docs) {
    const value = doc.data() as Reconciliation
    if (matchesScope(value, scope)) store.reconciliations.set(value.id, value)
  }
  for (const doc of reconMatches.docs) {
    const value = doc.data() as ReconciliationMatch
    if (matchesScope(value, scope)) store.reconciliationMatches.set(value.id, value)
  }
  for (const doc of sequences.docs) {
    const data = doc.data()
    if (!matchesScope(data, scope)) continue
    if (typeof data.sequenceKey === 'string' && typeof data.value === 'number') {
      store.sequences.set(data.sequenceKey, data.value)
    }
  }
  for (const doc of taxCodes.docs) {
    const value = doc.data() as TaxCode
    if (matchesScope(value, scope)) store.taxCodes.set(value.id, value)
  }
  for (const doc of taxRules.docs) {
    const value = doc.data() as TaxRuleVersion
    if (matchesScope(value, scope)) store.taxRules.set(value.id, value)
  }
  for (const doc of approvals.docs) {
    const value = doc.data() as FinanceApprovalRecord
    if (matchesScope(value, scope)) store.approvals.set(value.id, value)
  }
  for (const doc of claims.docs) {
    const data = doc.data()
    if (!data || data.orgId !== scope.orgId) continue
    if (data.bookId && data.bookId !== scope.bookId) continue
    if (typeof data.aggregateId === 'string') store.uniqueClaims.set(doc.id, data.aggregateId)
  }
  for (const doc of idempotency.docs) {
    const data = doc.data()
    if (!data || data.orgId !== scope.orgId) continue
    store.idempotency.set(doc.id, data as DocumentsServiceState['idempotency'] extends Map<string, infer V> ? V : never)
  }
  for (const doc of audit.docs) {
    const data = doc.data()
    if (!matchesScope(data, scope)) continue
    if (typeof data.eventType === 'string' && String(data.eventType).includes('.')) {
      // only reload document-domain events; foundation events share the collection
      const et = String(data.eventType)
      if (
        et.startsWith('customer_invoice.')
        || et.startsWith('supplier_bill.')
        || et.startsWith('payment.')
        || et.startsWith('allocation.')
        || et.startsWith('bank_')
        || et.startsWith('reconciliation.')
      ) {
        store.auditEvents.push(data as DocumentsServiceState['auditEvents'][number])
      }
    }
  }
  store.auditEvents.sort((a, b) => a.sequence - b.sequence)
  return store
}

async function persistDocumentsStore(
  db: Firestore,
  scope: Required<FinanceScope>,
  before: DocumentsServiceState,
  after: DocumentsServiceState,
  actor: FinanceActorContext,
): Promise<void> {
  const batch = db.batch()
  const now = new Date().toISOString()

  const writeMap = <T extends { id: string }>(
    collection: string,
    previous: Map<string, T>,
    next: Map<string, T>,
  ) => {
    for (const [id, value] of next) {
      const prev = previous.get(id)
      if (prev && canonicalDigest(clean(prev)) === canonicalDigest(clean(value))) continue
      batch.set(db.collection(collection).doc(scopedStorageId(scope, id)), clean(value), { merge: false })
    }
  }

  writeMap('finance_customer_invoices', before.invoices, after.invoices)
  writeMap('supplier_bills', before.bills, after.bills)
  writeMap('open_items', before.openItems, after.openItems)
  writeMap('finance_payments', before.payments, after.payments)
  writeMap('payment_allocations', before.allocations, after.allocations)
  writeMap('bank_accounts', before.bankAccounts, after.bankAccounts)
  writeMap('bank_transactions', before.bankTransactions, after.bankTransactions)
  writeMap('reconciliations', before.reconciliations, after.reconciliations)
  writeMap('reconciliation_matches', before.reconciliationMatches, after.reconciliationMatches)

  for (const [sequenceKey, value] of after.sequences) {
    if (before.sequences.get(sequenceKey) === value) continue
    const id = scopedStorageId(scope, `seq_${canonicalDigest({ sequenceKey }).slice(0, 24)}`)
    batch.set(db.collection('finance_sequences').doc(id), clean({
      schemaVersion: 1,
      orgId: scope.orgId,
      legalEntityId: scope.legalEntityId,
      bookId: scope.bookId,
      sequenceKey,
      value,
      updatedAt: now,
      updatedBy: actor.uid,
    }), { merge: false })
  }

  for (const [claimId, aggregateId] of after.uniqueClaims) {
    if (before.uniqueClaims.get(claimId) === aggregateId) continue
    batch.set(db.collection('finance_unique_claims').doc(claimId), clean({
      schemaVersion: 1,
      claimType: 'documents',
      orgId: scope.orgId,
      legalEntityId: scope.legalEntityId,
      bookId: scope.bookId,
      aggregateId,
      createdAt: now,
      createdBy: actor.uid,
    }), { merge: true })
  }

  for (const [idemId, record] of after.idempotency) {
    if (before.idempotency.has(idemId)) continue
    batch.set(db.collection('finance_idempotency_claims').doc(idemId), clean(record), { merge: false })
  }

  if (after.auditEvents.length > before.auditEvents.length) {
    const added = after.auditEvents.slice(before.auditEvents.length)
    for (const event of added) {
      batch.set(
        db.collection('finance_audit_events').doc(scopedStorageId(scope, event.id)),
        clean(event),
        { merge: false },
      )
    }
  }

  await batch.commit()
}

function snapshotState(store: InMemoryDocumentsStore): DocumentsServiceState {
  return {
    invoices: new Map(store.invoices),
    bills: new Map(store.bills),
    openItems: new Map(store.openItems),
    payments: new Map(store.payments),
    allocations: new Map(store.allocations),
    bankAccounts: new Map(store.bankAccounts),
    bankTransactions: new Map(store.bankTransactions),
    reconciliations: new Map(store.reconciliations),
    reconciliationMatches: new Map(store.reconciliationMatches),
    sequences: new Map(store.sequences),
    taxCodes: new Map(store.taxCodes),
    taxRules: new Map(store.taxRules),
    approvals: new Map(store.approvals),
    uniqueClaims: new Map(store.uniqueClaims),
    idempotency: new Map(store.idempotency),
    auditEvents: structuredClone(store.auditEvents),
  }
}

export class FirestoreFinanceDocumentsGateway {
  private readonly db: Firestore

  constructor(options: { db?: Firestore } = {}) {
    this.db = options.db ?? adminDb
  }

  private scopeOf(command: { orgId: string; legalEntityId: string; bookId: string }): Required<FinanceScope> {
    return { orgId: command.orgId, legalEntityId: command.legalEntityId, bookId: command.bookId }
  }

  private async withService<T>(
    actor: FinanceActorContext,
    scope: Required<FinanceScope>,
    run: (service: FinanceDocumentsService) => Promise<T> | T,
  ): Promise<T> {
    const store = await hydrateDocumentsStore(this.db, scope)
    const before = snapshotState(store)
    const service = new FinanceDocumentsService(store)
    const result = await run(service)
    await persistDocumentsStore(this.db, scope, before, store, actor)
    return result
  }

  createCustomerInvoice(actor: FinanceActorContext, command: CreateCustomerInvoiceCommand) {
    return this.withService(actor, this.scopeOf(command), (s) => s.createCustomerInvoice(actor, command))
  }
  issueCustomerInvoice(actor: FinanceActorContext, command: IssueCustomerInvoiceCommand) {
    return this.withService(actor, this.scopeOf(command), (s) => s.issueCustomerInvoice(actor, command))
  }
  voidCustomerInvoice(actor: FinanceActorContext, command: VoidCustomerInvoiceCommand) {
    return this.withService(actor, this.scopeOf(command), (s) => s.voidCustomerInvoice(actor, command))
  }
  createSupplierBill(actor: FinanceActorContext, command: CreateSupplierBillCommand) {
    return this.withService(actor, this.scopeOf(command), (s) => s.createSupplierBill(actor, command))
  }
  issueSupplierBill(actor: FinanceActorContext, command: IssueSupplierBillCommand) {
    return this.withService(actor, this.scopeOf(command), (s) => s.issueSupplierBill(actor, command))
  }
  observePayment(actor: FinanceActorContext, command: ObservePaymentCommand) {
    return this.withService(actor, this.scopeOf(command), (s) => s.observePayment(actor, command))
  }
  verifyPayment(actor: FinanceActorContext, command: VerifyPaymentCommand) {
    return this.withService(actor, this.scopeOf(command), (s) => s.verifyPayment(actor, command))
  }
  allocatePayment(actor: FinanceActorContext, command: AllocatePaymentCommand) {
    return this.withService(actor, this.scopeOf(command), (s) => s.allocatePayment(actor, command))
  }
  reverseAllocation(actor: FinanceActorContext, command: ReverseAllocationCommand) {
    return this.withService(actor, this.scopeOf(command), (s) => s.reverseAllocation(actor, command))
  }
  createBankAccount(actor: FinanceActorContext, command: CreateBankAccountCommand) {
    return this.withService(actor, this.scopeOf(command), (s) => s.createBankAccount(actor, command))
  }
  importBankTransaction(actor: FinanceActorContext, command: ImportBankTransactionCommand) {
    return this.withService(actor, this.scopeOf(command), (s) => s.importBankTransaction(actor, command))
  }
  createReconciliation(actor: FinanceActorContext, command: CreateReconciliationCommand) {
    return this.withService(actor, this.scopeOf(command), (s) => s.createReconciliation(actor, command))
  }
  addReconciliationMatch(actor: FinanceActorContext, command: AddReconciliationMatchCommand) {
    return this.withService(actor, this.scopeOf(command), (s) => s.addReconciliationMatch(actor, command))
  }
  submitReconciliation(actor: FinanceActorContext, command: SubmitReconciliationCommand) {
    return this.withService(actor, this.scopeOf(command), (s) => s.submitReconciliation(actor, command))
  }
  approveReconciliation(actor: FinanceActorContext, command: ApproveReconciliationCommand) {
    return this.withService(actor, this.scopeOf(command), (s) => s.approveReconciliation(actor, command))
  }

  async listBundle(actor: FinanceActorContext, scope: Required<FinanceScope>) {
    authorizeFinanceAction(actor, scope, 'invoice.read')
    const store = await hydrateDocumentsStore(this.db, scope)
    return {
      invoices: [...store.invoices.values()].sort((a, b) => a.issueDate.localeCompare(b.issueDate)),
      bills: [...store.bills.values()].sort((a, b) => a.issueDate.localeCompare(b.issueDate)),
      openItems: [...store.openItems.values()].sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
      payments: [...store.payments.values()].sort((a, b) => a.observedDate.localeCompare(b.observedDate)),
      allocations: [...store.allocations.values()],
      bankAccounts: [...store.bankAccounts.values()].sort((a, b) => a.code.localeCompare(b.code)),
      bankTransactions: [...store.bankTransactions.values()].sort((a, b) => a.statementDate.localeCompare(b.statementDate)),
      reconciliations: [...store.reconciliations.values()].sort((a, b) => a.statementStartsAt.localeCompare(b.statementStartsAt)),
      reconciliationMatches: [...store.reconciliationMatches.values()],
      externalPaymentInitiated: false,
      sarsSubmissionInitiated: false,
      externalEgressAllowed: false,
    }
  }
}
