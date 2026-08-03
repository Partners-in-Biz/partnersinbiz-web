import { adminDb } from '@/lib/firebase/admin'
import type { FinanceActorContext } from '@/lib/finance/types'
import {
  FinanceJobCostingService,
  cloneJobCostingStore,
  createEmptyJobCostingStore,
  type ApplyTimeCostCommand,
  type JobCostingStore,
} from '@/lib/accounting/job-costing-service'
import type { TimeCostApplication } from '@/lib/accounting/job-costing-types'
import type { FinanceCustomerInvoice, SupplierBill } from '@/lib/accounting/documents-types'
import type { LedgerAccount, PostedJournalEntry } from '@/lib/accounting/types'
import type { AccountingBasis } from '@/lib/finance/types'

function asMap<T extends { id: string }>(docs: FirebaseFirestore.QuerySnapshot): Map<string, T> {
  const map = new Map<string, T>()
  for (const doc of docs.docs) {
    const data = doc.data() as T
    if (data?.id) map.set(data.id, data)
    else map.set(doc.id, { ...(data as object), id: doc.id } as T)
  }
  return map
}

async function loadStore(): Promise<JobCostingStore> {
  const db = adminDb
  const [
    applications,
    claims,
    auditEvents,
    accounts,
    journals,
    invoices,
    bills,
    idempotency,
  ] = await Promise.all([
    db.collection('finance_time_cost_applications').limit(2000).get(),
    db.collection('finance_time_cost_claims').limit(10000).get(),
    db.collection('finance_job_costing_audit_events').limit(5000).get(),
    db.collection('ledger_accounts').limit(5000).get(),
    db.collection('journal_entries').limit(5000).get(),
    db.collection('finance_customer_invoices').limit(5000).get(),
    db.collection('supplier_bills').limit(5000).get(),
    db.collection('finance_time_cost_idempotency').limit(5000).get(),
  ])
  const store = createEmptyJobCostingStore()
  store.applications = asMap<TimeCostApplication>(applications)
  for (const doc of claims.docs) {
    const key = (doc.data() as { key?: string }).key || doc.id
    store.claims.add(key)
  }
  store.auditEvents = auditEvents.docs.map((d) => d.data() as JobCostingStore['auditEvents'][number])
  store.accounts = asMap<LedgerAccount>(accounts)
  store.journals = asMap<PostedJournalEntry>(journals)
  store.invoices = asMap<FinanceCustomerInvoice>(invoices)
  store.bills = asMap<SupplierBill>(bills)
  for (const doc of idempotency.docs) {
    const data = doc.data() as { key?: string; payloadDigest: string; applicationId: string; actorId: string }
    const key = data.key || doc.id
    store.idempotency.set(key, {
      payloadDigest: data.payloadDigest,
      applicationId: data.applicationId,
      actorId: data.actorId,
    })
  }
  return store
}

async function saveStore(before: JobCostingStore, after: JobCostingStore): Promise<void> {
  const db = adminDb
  const batch = db.batch()
  let ops = 0
  const touch = (col: string, id: string, value: object, prior?: object) => {
    if (prior && JSON.stringify(prior) === JSON.stringify(value)) return
    batch.set(db.collection(col).doc(id), value, { merge: true })
    ops++
  }
  for (const [id, value] of after.applications) {
    touch('finance_time_cost_applications', id, value, before.applications.get(id))
  }
  for (const key of after.claims) {
    if (before.claims.has(key)) continue
    const claimId = Buffer.from(key).toString('base64url').slice(0, 700)
    batch.set(
      db.collection('finance_time_cost_claims').doc(claimId),
      { id: claimId, key, createdAt: new Date().toISOString() },
      { merge: true },
    )
    ops++
  }
  for (const event of after.auditEvents) {
    if (before.auditEvents.some((e) => e.id === event.id)) continue
    batch.set(db.collection('finance_job_costing_audit_events').doc(event.id), event, { merge: true })
    ops++
  }
  for (const [key, value] of after.idempotency) {
    if (before.idempotency.has(key)) continue
    const id = Buffer.from(key).toString('base64url').slice(0, 700)
    batch.set(
      db.collection('finance_time_cost_idempotency').doc(id),
      { id, key, ...value, createdAt: new Date().toISOString() },
      { merge: true },
    )
    ops++
  }
  if (ops > 0) await batch.commit()
}

export class FirestoreJobCostingGateway {
  private readonly service = new FinanceJobCostingService(loadStore, saveStore)

  applyTimeCost(actor: FinanceActorContext, command: ApplyTimeCostCommand) {
    return this.service.applyTimeCost(actor, command)
  }

  projectProfitAndLoss(
    actor: FinanceActorContext,
    input: {
      orgId: string
      legalEntityId: string
      bookId: string
      projectId: string
      fromDate: string
      toDate: string
      accountingBasis: AccountingBasis
    },
  ) {
    return this.service.projectProfitAndLoss(actor, input)
  }

  projectWip(
    actor: FinanceActorContext,
    input: {
      orgId: string
      legalEntityId: string
      bookId: string
      projectId: string
      asOfDate: string
      accountingBasis: AccountingBasis
      fromDate?: string
    },
  ) {
    return this.service.projectWip(actor, input)
  }

  closedLoop(
    actor: FinanceActorContext,
    input: {
      orgId: string
      legalEntityId: string
      bookId: string
      projectId: string
      asOfDate: string
      accountingBasis: AccountingBasis
      fromDate?: string
      quoteId?: string
    },
  ) {
    return this.service.closedLoop(actor, input)
  }

  listApplications(
    actor: FinanceActorContext,
    orgId: string,
    filters?: { bookId?: string; projectId?: string; applicationId?: string },
  ) {
    return this.service.listApplications(actor, orgId, filters)
  }
}

export type { ApplyTimeCostCommand }
