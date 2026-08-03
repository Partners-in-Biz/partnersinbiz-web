import { adminDb } from '@/lib/firebase/admin'
import type { FinanceActorContext } from '@/lib/finance/types'
import type { FinanceSavedView, OperatorDepthAuditEvent } from '@/lib/accounting/operator-depth-types'
import {
  OperatorDepthFinanceService,
  cloneOperatorDepthStore,
  createEmptyOperatorDepthStore,
  type AllocationPlanCommand,
  type BulkSelectionCommand,
  type DeleteSavedViewCommand,
  type OperatorDepthStore,
  type PeriodCloseQuery,
  type UpsertSavedViewCommand,
} from './service'

function asMap<T extends { id: string }>(docs: FirebaseFirestore.QuerySnapshot): Map<string, T> {
  const map = new Map<string, T>()
  for (const doc of docs.docs) {
    const data = doc.data() as T
    if (data?.id) map.set(data.id, data)
    else map.set(doc.id, { ...(data as object), id: doc.id } as T)
  }
  return map
}

async function loadStore(orgId: string): Promise<OperatorDepthStore> {
  const db = adminDb
  const [views, audits, claims] = await Promise.all([
    db.collection('finance_operator_saved_views').where('orgId', '==', orgId).get(),
    db.collection('finance_operator_depth_audit').where('orgId', '==', orgId).get(),
    db.collection('finance_operator_depth_claims').where('orgId', '==', orgId).get(),
  ])
  const store = createEmptyOperatorDepthStore()
  store.savedViews = asMap<FinanceSavedView>(views)
  store.auditEvents = asMap<OperatorDepthAuditEvent>(audits)
  for (const doc of claims.docs) {
    const key = (doc.data() as { key?: string }).key || doc.id
    store.claims.add(key)
  }
  return store
}

async function saveStore(orgId: string, before: OperatorDepthStore, after: OperatorDepthStore): Promise<void> {
  const db = adminDb
  const batch = db.batch()
  const writeMap = <T extends { id: string }>(collection: string, prev: Map<string, T>, next: Map<string, T>) => {
    for (const [id, value] of next) {
      const prior = prev.get(id)
      if (prior && JSON.stringify(prior) === JSON.stringify(value)) continue
      batch.set(db.collection(collection).doc(id), value, { merge: true })
    }
    for (const id of prev.keys()) {
      if (!next.has(id)) batch.delete(db.collection(collection).doc(id))
    }
  }
  writeMap('finance_operator_saved_views', before.savedViews, after.savedViews)
  writeMap('finance_operator_depth_audit', before.auditEvents, after.auditEvents)
  for (const key of after.claims) {
    if (before.claims.has(key)) continue
    const claimId = Buffer.from(key).toString('base64url').slice(0, 700)
    batch.set(
      db.collection('finance_operator_depth_claims').doc(claimId),
      { id: claimId, orgId, key, createdAt: new Date().toISOString() },
      { merge: true },
    )
  }
  for (const key of before.claims) {
    if (after.claims.has(key)) continue
    const claimId = Buffer.from(key).toString('base64url').slice(0, 700)
    batch.delete(db.collection('finance_operator_depth_claims').doc(claimId))
  }
  await batch.commit()
}

export class FirestoreOperatorDepthGateway {
  private service(orgId: string) {
    return new OperatorDepthFinanceService(
      () => loadStore(orgId),
      (before, after) => saveStore(orgId, before, after),
    )
  }

  upsertSavedView(actor: FinanceActorContext, command: UpsertSavedViewCommand) {
    return this.service(command.orgId).upsertSavedView(actor, command)
  }

  deleteSavedView(actor: FinanceActorContext, command: DeleteSavedViewCommand) {
    return this.service(command.orgId).deleteSavedView(actor, command)
  }

  planBulkSelection(actor: FinanceActorContext, command: BulkSelectionCommand) {
    return this.service(command.orgId).planBulkSelection(actor, command)
  }

  planAllocation(actor: FinanceActorContext, command: AllocationPlanCommand) {
    return this.service(command.orgId).planAllocation(actor, command)
  }

  getPeriodCloseCentre(actor: FinanceActorContext, query: PeriodCloseQuery) {
    return this.service(query.orgId).getPeriodCloseCentre(actor, query)
  }

  getBundle(actor: FinanceActorContext, orgId: string, legalEntityId: string, bookId: string, resourceKind?: string) {
    return this.service(orgId).getBundle(actor, orgId, legalEntityId, bookId, resourceKind)
  }
}

export {
  OperatorDepthFinanceService,
  createEmptyOperatorDepthStore,
  cloneOperatorDepthStore,
}
export type {
  UpsertSavedViewCommand,
  DeleteSavedViewCommand,
  BulkSelectionCommand,
  AllocationPlanCommand,
  PeriodCloseQuery,
}
