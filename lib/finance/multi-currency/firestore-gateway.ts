import { adminDb } from '@/lib/firebase/admin'
import type { FinanceActorContext } from '@/lib/finance/types'
import {
  MultiCurrencyFinanceService,
  cloneMultiCurrencyStore,
  createEmptyMultiCurrencyStore,
  type AddRateCommand,
  type ApproveRateSetCommand,
  type ApproveRevaluationCommand,
  type BuildFunctionalReportCommand,
  type ConfigureFxPolicyCommand,
  type CreateRateSetCommand,
  type CreateRevaluationCommand,
  type MultiCurrencyFinanceStore,
  type RecordFxDocumentCommand,
  type RecordFxSettlementCommand,
} from './service'
import type {
  AccountingRate,
  AccountingRateSet,
  FxAuditEvent,
  FxBookPolicy,
  FxForeignDocument,
  FxFunctionalReport,
  FxMonetaryPosition,
  FxRevaluationRun,
  FxSettlement,
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

async function loadStore(): Promise<MultiCurrencyFinanceStore> {
  const db = adminDb
  const [
    policies,
    rateSets,
    rates,
    positions,
    documents,
    settlements,
    revaluations,
    reports,
    claims,
    auditEvents,
  ] = await Promise.all([
    db.collection('fx_book_policies').limit(2000).get(),
    db.collection('accounting_rate_sets').limit(2000).get(),
    db.collection('accounting_rates').limit(10000).get(),
    db.collection('fx_monetary_positions').limit(10000).get(),
    db.collection('fx_foreign_documents').limit(10000).get(),
    db.collection('fx_settlements').limit(10000).get(),
    db.collection('fx_revaluation_runs').limit(2000).get(),
    db.collection('fx_functional_reports').limit(2000).get(),
    db.collection('fx_unique_claims').limit(20000).get(),
    db.collection('fx_audit_events').orderBy('at', 'desc').limit(2000).get(),
  ])

  const store = createEmptyMultiCurrencyStore()
  store.policies = asMap<FxBookPolicy>(policies)
  store.rateSets = asMap<AccountingRateSet>(rateSets)
  store.rates = asMap<AccountingRate>(rates)
  store.positions = asMap<FxMonetaryPosition>(positions)
  store.documents = asMap<FxForeignDocument>(documents)
  store.settlements = asMap<FxSettlement>(settlements)
  store.revaluations = asMap<FxRevaluationRun>(revaluations)
  store.reports = asMap<FxFunctionalReport>(reports)
  for (const doc of claims.docs) {
    const key = (doc.data() as { key?: string }).key || doc.id
    store.claims.add(key)
  }
  store.auditEvents = auditEvents.docs.map((doc) => {
    const data = doc.data() as FxAuditEvent
    return data?.id ? data : ({ ...(data as object), id: doc.id } as FxAuditEvent)
  })
  return store
}

async function saveStore(
  before: MultiCurrencyFinanceStore,
  after: MultiCurrencyFinanceStore,
): Promise<void> {
  const db = adminDb
  let batch = db.batch()
  let ops = 0

  const flush = async () => {
    if (ops === 0) return
    await batch.commit()
    batch = db.batch()
    ops = 0
  }

  const touch = (col: string, id: string, value: object, prior?: object) => {
    if (prior && JSON.stringify(prior) === JSON.stringify(value)) return
    batch.set(db.collection(col).doc(id), value, { merge: true })
    ops++
  }

  for (const [id, value] of after.policies) {
    touch('fx_book_policies', id, value, before.policies.get(id))
    if (ops >= 400) await flush()
  }
  for (const [id, value] of after.rateSets) {
    touch('accounting_rate_sets', id, value, before.rateSets.get(id))
    if (ops >= 400) await flush()
  }
  for (const [id, value] of after.rates) {
    touch('accounting_rates', id, value, before.rates.get(id))
    if (ops >= 400) await flush()
  }
  for (const [id, value] of after.positions) {
    touch('fx_monetary_positions', id, value, before.positions.get(id))
    if (ops >= 400) await flush()
  }
  for (const [id, value] of after.documents) {
    touch('fx_foreign_documents', id, value, before.documents.get(id))
    if (ops >= 400) await flush()
  }
  for (const [id, value] of after.settlements) {
    touch('fx_settlements', id, value, before.settlements.get(id))
    if (ops >= 400) await flush()
  }
  for (const [id, value] of after.revaluations) {
    touch('fx_revaluation_runs', id, value, before.revaluations.get(id))
    if (ops >= 400) await flush()
  }
  for (const [id, value] of after.reports) {
    touch('fx_functional_reports', id, value, before.reports.get(id))
    if (ops >= 400) await flush()
  }

  for (const key of after.claims) {
    if (before.claims.has(key)) continue
    const claimId = Buffer.from(key).toString('base64url').slice(0, 700)
    batch.set(
      db.collection('fx_unique_claims').doc(claimId),
      { id: claimId, key, createdAt: new Date().toISOString() },
      { merge: true },
    )
    ops++
    if (ops >= 400) await flush()
  }

  const priorAuditIds = new Set(before.auditEvents.map((e) => e.id))
  for (const event of after.auditEvents) {
    if (priorAuditIds.has(event.id)) continue
    batch.set(db.collection('fx_audit_events').doc(event.id), event, { merge: true })
    ops++
    if (ops >= 400) await flush()
  }

  await flush()
}

export class FirestoreMultiCurrencyFinanceGateway {
  private service() {
    return new MultiCurrencyFinanceService(
      () => loadStore(),
      (before, after) => saveStore(before, after),
    )
  }

  configurePolicy(actor: FinanceActorContext, command: ConfigureFxPolicyCommand) {
    return this.service().configurePolicy(actor, command)
  }

  createRateSet(actor: FinanceActorContext, command: CreateRateSetCommand) {
    return this.service().createRateSet(actor, command)
  }

  addRate(actor: FinanceActorContext, command: AddRateCommand) {
    return this.service().addRate(actor, command)
  }

  approveRateSet(actor: FinanceActorContext, command: ApproveRateSetCommand) {
    return this.service().approveRateSet(actor, command)
  }

  recordDocument(actor: FinanceActorContext, command: RecordFxDocumentCommand) {
    return this.service().recordDocument(actor, command)
  }

  recordSettlement(actor: FinanceActorContext, command: RecordFxSettlementCommand) {
    return this.service().recordSettlement(actor, command)
  }

  createRevaluation(actor: FinanceActorContext, command: CreateRevaluationCommand) {
    return this.service().createRevaluation(actor, command)
  }

  approveRevaluation(actor: FinanceActorContext, command: ApproveRevaluationCommand) {
    return this.service().approveRevaluation(actor, command)
  }

  buildFunctionalReport(actor: FinanceActorContext, command: BuildFunctionalReportCommand) {
    return this.service().buildFunctionalReport(actor, command)
  }

  listForOrg(actor: FinanceActorContext, orgId: string, opts?: { bookId?: string; rateSetId?: string }) {
    return this.service().listForOrg(actor, orgId, opts)
  }
}

export type {
  AddRateCommand,
  ApproveRateSetCommand,
  ApproveRevaluationCommand,
  BuildFunctionalReportCommand,
  ConfigureFxPolicyCommand,
  CreateRateSetCommand,
  CreateRevaluationCommand,
  MultiCurrencyFinanceStore,
  RecordFxDocumentCommand,
  RecordFxSettlementCommand,
}

export {
  MultiCurrencyFinanceService,
  MultiCurrencyFinanceNotFoundError,
  MultiCurrencyFinanceValidationError,
  cloneMultiCurrencyStore,
  createEmptyMultiCurrencyStore,
  convertTxnToFunctional,
  computeRealizedFxMinor,
  buildBalancedJournal,
} from './service'
