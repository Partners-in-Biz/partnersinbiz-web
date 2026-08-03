import { adminDb } from '@/lib/firebase/admin'
import type { FinanceActorContext } from '@/lib/finance/types'
import {
  InventoryFinanceService,
  cloneInventoryStore,
  createEmptyInventoryStore,
  type ApplyBillReceiptCommand,
  type ApplyInvoiceIssueCommand,
  type CreateInventoryItemCommand,
  type CreateStockAdjustmentCommand,
  type CogsJournalPoster,
  type InventoryFinanceStore,
  type UpdateInventoryItemCommand,
} from './inventory-service'
import type {
  CogsPosting,
  InventoryAuditEvent,
  InventoryItem,
  StockAdjustment,
  StockMovement,
} from './inventory-types'

function asMap<T extends { id: string }>(docs: FirebaseFirestore.QuerySnapshot): Map<string, T> {
  const map = new Map<string, T>()
  for (const doc of docs.docs) {
    const data = doc.data() as T
    if (data?.id) map.set(data.id, data)
    else map.set(doc.id, { ...(data as object), id: doc.id } as T)
  }
  return map
}

async function loadStore(): Promise<InventoryFinanceStore> {
  const db = adminDb
  const [items, movements, adjustments, cogs, audit, claims, idem] = await Promise.all([
    db.collection('finance_inventory_items').limit(10000).get(),
    db.collection('finance_stock_movements').limit(20000).get(),
    db.collection('finance_stock_adjustments').limit(10000).get(),
    db.collection('finance_cogs_postings').limit(10000).get(),
    db.collection('finance_inventory_audit_events').limit(20000).get(),
    db.collection('finance_inventory_claims').limit(20000).get(),
    db.collection('finance_inventory_idempotency').limit(20000).get(),
  ])
  const store = createEmptyInventoryStore()
  store.items = asMap<InventoryItem>(items)
  store.movements = asMap<StockMovement>(movements)
  store.adjustments = asMap<StockAdjustment>(adjustments)
  store.cogsPostings = asMap<CogsPosting>(cogs)
  store.auditEvents = asMap<InventoryAuditEvent>(audit)
  for (const doc of claims.docs) {
    const key = (doc.data() as { key?: string }).key || doc.id
    store.claims.add(key)
  }
  for (const doc of idem.docs) {
    const data = doc.data() as { key?: string; operation?: string; resultId?: string }
    if (data.key && data.operation && data.resultId) {
      store.idempotency.set(data.key, { operation: data.operation, resultId: data.resultId })
    }
  }
  for (const event of store.auditEvents.values()) {
    const headKey = `${event.orgId}|${event.legalEntityId}|${event.bookId}`
    const prev = store.auditHeads.get(headKey)
    if (!prev || event.at >= (store.auditEvents.get(prev)?.at || '')) {
      store.auditHeads.set(headKey, event.id)
    }
  }
  return store
}

async function saveStore(before: InventoryFinanceStore, after: InventoryFinanceStore): Promise<void> {
  const db = adminDb
  const batch = db.batch()
  let ops = 0
  const touch = (col: string, id: string, value: object, prior?: object) => {
    if (prior && JSON.stringify(prior) === JSON.stringify(value)) return
    batch.set(db.collection(col).doc(id), value, { merge: true })
    ops += 1
  }
  for (const [id, value] of after.items) touch('finance_inventory_items', id, value, before.items.get(id))
  for (const [id, value] of after.movements) touch('finance_stock_movements', id, value, before.movements.get(id))
  for (const [id, value] of after.adjustments) touch('finance_stock_adjustments', id, value, before.adjustments.get(id))
  for (const [id, value] of after.cogsPostings) touch('finance_cogs_postings', id, value, before.cogsPostings.get(id))
  for (const [id, value] of after.auditEvents) {
    if (before.auditEvents.has(id)) continue
    touch('finance_inventory_audit_events', id, value)
  }
  for (const key of after.claims) {
    if (before.claims.has(key)) continue
    const claimId = Buffer.from(key).toString('base64url').slice(0, 700)
    batch.set(db.collection('finance_inventory_claims').doc(claimId), {
      id: claimId,
      key,
      createdAt: new Date().toISOString(),
    }, { merge: true })
    ops += 1
  }
  for (const [key, value] of after.idempotency) {
    if (before.idempotency.get(key)?.resultId === value.resultId) continue
    const id = Buffer.from(key).toString('base64url').slice(0, 700)
    batch.set(db.collection('finance_inventory_idempotency').doc(id), {
      id,
      key,
      operation: value.operation,
      resultId: value.resultId,
      updatedAt: new Date().toISOString(),
    }, { merge: true })
    ops += 1
  }
  if (ops > 0) await batch.commit()
}

const defaultCogsPoster: CogsJournalPoster = async ({ journalEntryId, posting, actor }) => {
  const now = new Date().toISOString()
  await adminDb.collection('finance_cogs_journal_markers').doc(journalEntryId).set({
    id: journalEntryId,
    orgId: posting.orgId,
    legalEntityId: posting.legalEntityId,
    bookId: posting.bookId,
    cogsPostingId: posting.id,
    cogsMinor: posting.cogsMinor,
    lines: posting.lines,
    actorId: actor.uid,
    createdAt: now,
    externalEgressAllowed: false,
    externalPaymentInitiated: false,
    sarsSubmissionInitiated: false,
  }, { merge: true })
  return { id: journalEntryId }
}

export class FirestoreFinanceInventoryGateway {
  private service() {
    return new InventoryFinanceService(loadStore, saveStore, defaultCogsPoster)
  }

  createItem(actor: FinanceActorContext, command: CreateInventoryItemCommand) {
    return this.service().createItem(actor, command)
  }
  updateItem(actor: FinanceActorContext, command: UpdateInventoryItemCommand) {
    return this.service().updateItem(actor, command)
  }
  applyBillReceipt(actor: FinanceActorContext, command: ApplyBillReceiptCommand) {
    return this.service().applyBillReceipt(actor, command)
  }
  applyInvoiceIssue(actor: FinanceActorContext, command: ApplyInvoiceIssueCommand) {
    return this.service().applyInvoiceIssue(actor, command)
  }
  createAdjustment(actor: FinanceActorContext, command: CreateStockAdjustmentCommand) {
    return this.service().createAdjustment(actor, command)
  }
  listBundle(actor: FinanceActorContext, scope: { orgId: string; legalEntityId: string; bookId: string }) {
    return this.service().listBundle(actor, scope)
  }
  stockOnHandReport(actor: FinanceActorContext, scope: { orgId: string; legalEntityId: string; bookId: string }) {
    return this.service().stockOnHandReport(actor, scope)
  }
  getItem(actor: FinanceActorContext, scope: { orgId: string; legalEntityId: string; bookId: string }, itemId: string) {
    return this.service().getItem(actor, scope, itemId)
  }
}
