import { adminDb } from '@/lib/firebase/admin'
import type { FinanceActorContext } from '@/lib/finance/types'
import {
  ExpenseClaimFinanceService,
  createEmptyExpenseClaimStore,
  type AttachReceiptCommand,
  type BulkApproveCommand,
  type ClaimLifecycleCommand,
  type CreateExpenseClaimCommand,
  type ExpenseClaimListFilters,
  type ExpenseClaimStore,
  type ExportPaymentInstructionCommand,
  type OcrAssistCommand,
  type OcrResolveCommand,
  type PostClaimCommand,
  type UpdateExpenseClaimCommand,
} from './service'
import type {
  ExpenseClaim,
  ExpenseClaimAuditEvent,
  ExpenseClaimOcrAssist,
  ExpenseClaimReceipt,
} from './types'

function asMap<T extends { id: string }>(docs: FirebaseFirestore.QuerySnapshot): Map<string, T> {
  const map = new Map<string, T>()
  for (const doc of docs.docs) {
    const data = doc.data() as T
    if (data?.id) map.set(data.id, data)
    else map.set(doc.id, { ...(data as object), id: doc.id } as T)
  }
  return map
}

async function loadStore(orgId: string): Promise<ExpenseClaimStore> {
  const db = adminDb
  const [claims, receipts, ocr, audit, keys, idem] = await Promise.all([
    db.collection('finance_expense_claims').where('orgId', '==', orgId).get(),
    db.collection('finance_expense_claim_receipts').where('orgId', '==', orgId).get(),
    db.collection('finance_expense_claim_ocr_assists').where('orgId', '==', orgId).get(),
    db.collection('finance_expense_claim_audit_events').where('orgId', '==', orgId).get(),
    db.collection('finance_expense_claim_unique_keys').where('orgId', '==', orgId).get(),
    db.collection('finance_expense_claim_idempotency').where('orgId', '==', orgId).get(),
  ])
  const store = createEmptyExpenseClaimStore()
  store.claims = asMap<ExpenseClaim>(claims)
  store.receipts = asMap<ExpenseClaimReceipt>(receipts)
  store.ocrAssists = asMap<ExpenseClaimOcrAssist>(ocr)
  store.auditEvents = asMap<ExpenseClaimAuditEvent>(audit)
  for (const doc of keys.docs) {
    const key = (doc.data() as { key?: string }).key || doc.id
    store.claimsKeys.add(key)
  }
  for (const doc of idem.docs) {
    const data = doc.data() as { key?: string; resultId?: string }
    if (data.key && data.resultId) store.idempotency.set(data.key, data.resultId)
  }
  return store
}

async function saveStore(orgId: string, before: ExpenseClaimStore, after: ExpenseClaimStore): Promise<void> {
  const db = adminDb
  const batch = db.batch()
  const writeMap = <T extends { id: string }>(collection: string, prev: Map<string, T>, next: Map<string, T>) => {
    for (const [id, value] of next) {
      const prior = prev.get(id)
      if (prior && JSON.stringify(prior) === JSON.stringify(value)) continue
      batch.set(db.collection(collection).doc(id), value, { merge: true })
    }
  }
  writeMap('finance_expense_claims', before.claims, after.claims)
  writeMap('finance_expense_claim_receipts', before.receipts, after.receipts)
  writeMap('finance_expense_claim_ocr_assists', before.ocrAssists, after.ocrAssists)
  writeMap('finance_expense_claim_audit_events', before.auditEvents, after.auditEvents)
  for (const key of after.claimsKeys) {
    if (before.claimsKeys.has(key)) continue
    const claimId = Buffer.from(key).toString('base64url').slice(0, 700)
    batch.set(
      db.collection('finance_expense_claim_unique_keys').doc(claimId),
      { id: claimId, orgId, key, createdAt: new Date().toISOString() },
      { merge: true },
    )
  }
  for (const [key, resultId] of after.idempotency) {
    if (before.idempotency.get(key) === resultId) continue
    const id = Buffer.from(key).toString('base64url').slice(0, 700)
    batch.set(
      db.collection('finance_expense_claim_idempotency').doc(id),
      { id, orgId, key, resultId, createdAt: new Date().toISOString() },
      { merge: true },
    )
  }
  await batch.commit()
}

export class FirestoreExpenseClaimFinanceGateway {
  private service(orgId: string) {
    return new ExpenseClaimFinanceService(
      () => loadStore(orgId),
      (before, after) => saveStore(orgId, before, after),
    )
  }

  createClaim(actor: FinanceActorContext, command: CreateExpenseClaimCommand) {
    return this.service(command.orgId).createClaim(actor, command)
  }
  updateClaim(actor: FinanceActorContext, command: UpdateExpenseClaimCommand) {
    return this.service(command.orgId).updateClaim(actor, command)
  }
  submitClaim(actor: FinanceActorContext, command: ClaimLifecycleCommand) {
    return this.service(command.orgId).submitClaim(actor, command)
  }
  approveClaim(actor: FinanceActorContext, command: ClaimLifecycleCommand) {
    return this.service(command.orgId).approveClaim(actor, command)
  }
  rejectClaim(actor: FinanceActorContext, command: ClaimLifecycleCommand) {
    return this.service(command.orgId).rejectClaim(actor, command)
  }
  bulkApprove(actor: FinanceActorContext, command: BulkApproveCommand) {
    return this.service(command.orgId).bulkApprove(actor, command)
  }
  postClaim(actor: FinanceActorContext, command: PostClaimCommand) {
    return this.service(command.orgId).postClaim(actor, command)
  }
  attachReceipt(actor: FinanceActorContext, command: AttachReceiptCommand) {
    return this.service(command.orgId).attachReceipt(actor, command)
  }
  runOcrAssist(actor: FinanceActorContext, command: OcrAssistCommand) {
    return this.service(command.orgId).runOcrAssist(actor, command)
  }
  confirmOcr(actor: FinanceActorContext, command: OcrResolveCommand) {
    return this.service(command.orgId).confirmOcr(actor, command)
  }
  dismissOcr(actor: FinanceActorContext, command: OcrResolveCommand) {
    return this.service(command.orgId).dismissOcr(actor, command)
  }
  exportPaymentInstruction(actor: FinanceActorContext, command: ExportPaymentInstructionCommand) {
    return this.service(command.orgId).exportPaymentInstruction(actor, command)
  }
  getBundle(
    actor: FinanceActorContext,
    orgId: string,
    legalEntityId: string,
    bookId: string,
    filters?: ExpenseClaimListFilters,
  ) {
    return this.service(orgId).getBundle(actor, orgId, legalEntityId, bookId, filters)
  }
}

export type {
  AttachReceiptCommand,
  BulkApproveCommand,
  ClaimLifecycleCommand,
  CreateExpenseClaimCommand,
  ExpenseClaimListFilters,
  ExportPaymentInstructionCommand,
  OcrAssistCommand,
  OcrResolveCommand,
  PostClaimCommand,
  UpdateExpenseClaimCommand,
}
export { ExpenseClaimFinanceService, createEmptyExpenseClaimStore }
