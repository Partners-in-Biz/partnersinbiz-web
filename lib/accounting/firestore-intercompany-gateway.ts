import type { Firestore } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { authorizeFinanceAction } from '@/lib/finance/policy'
import { canonicalDigest, scopedStorageId } from '@/lib/finance/integrity'
import type { FinanceActorContext, FinanceApprovalRecord, FinanceScope } from '@/lib/finance/types'
import {
  FinanceIntercompanyService,
  InMemoryIntercompanyStore,
  type ActivateIntercompanyPairCommand,
  type ApproveConsolidationRunCommand,
  type ApproveEliminationRuleCommand,
  type ApproveIntercompanyReceiveCommand,
  type CreateConsolidationRunCommand,
  type CreateEliminationRuleCommand,
  type CreateIntercompanyPairCommand,
  type IntercompanyServiceState,
  type PinConsolidationRunCommand,
  type PostConsolidationEliminationsCommand,
  type PostIntercompanyReceivingCommand,
  type PostIntercompanySourceCommand,
  type ProposeIntercompanyTransactionCommand,
  type RejectIntercompanyTransactionCommand,
} from './intercompany-service'
import type {
  ConsolidationEntry,
  ConsolidationRun,
  EliminationRule,
  IntercompanyPair,
  IntercompanyTransaction,
} from './intercompany-types'

export type {
  ActivateIntercompanyPairCommand,
  ApproveConsolidationRunCommand,
  ApproveEliminationRuleCommand,
  ApproveIntercompanyReceiveCommand,
  CreateConsolidationRunCommand,
  CreateEliminationRuleCommand,
  CreateIntercompanyPairCommand,
  PinConsolidationRunCommand,
  PostConsolidationEliminationsCommand,
  PostIntercompanyReceivingCommand,
  PostIntercompanySourceCommand,
  ProposeIntercompanyTransactionCommand,
  RejectIntercompanyTransactionCommand,
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

async function hydrateIntercompanyStore(db: Firestore, orgId: string): Promise<InMemoryIntercompanyStore> {
  const store = new InMemoryIntercompanyStore()
  const [
    pairs, txs, rules, runs, entries, balances, bookTypes, approvals, claims, idempotency, audit,
  ] = await Promise.all([
    db.collection('intercompany_pairs').where('orgId', '==', orgId).get(),
    db.collection('intercompany_transactions').where('orgId', '==', orgId).get(),
    db.collection('elimination_rules').where('orgId', '==', orgId).get(),
    db.collection('consolidation_runs').where('orgId', '==', orgId).get(),
    db.collection('consolidation_entries').where('orgId', '==', orgId).get(),
    db.collection('intercompany_control_balances').where('orgId', '==', orgId).get(),
    db.collection('accounting_books').where('orgId', '==', orgId).get(),
    db.collection('finance_approvals').where('orgId', '==', orgId).get(),
    db.collection('finance_unique_claims').where('orgId', '==', orgId).get(),
    db.collection('finance_idempotency_claims').where('orgId', '==', orgId).get(),
    db.collection('finance_audit_events').where('orgId', '==', orgId).get(),
  ])

  for (const doc of pairs.docs) {
    const value = doc.data() as IntercompanyPair
    store.pairs.set(value.id, value)
  }
  for (const doc of txs.docs) {
    const value = doc.data() as IntercompanyTransaction
    store.transactions.set(value.id, value)
  }
  for (const doc of rules.docs) {
    const value = doc.data() as EliminationRule
    store.eliminationRules.set(value.id, value)
  }
  for (const doc of runs.docs) {
    const value = doc.data() as ConsolidationRun
    store.consolidationRuns.set(value.id, value)
  }
  for (const doc of entries.docs) {
    const value = doc.data() as ConsolidationEntry
    store.consolidationEntries.set(value.id, value)
  }
  for (const doc of balances.docs) {
    const data = doc.data() as { key: string; dueFromMinor: number; dueToMinor: number }
    if (data.key) store.controlBalances.set(data.key, { dueFromMinor: data.dueFromMinor, dueToMinor: data.dueToMinor })
  }
  for (const doc of bookTypes.docs) {
    const data = doc.data() as { id: string; bookType?: 'primary' | 'branch' | 'management' | 'consolidation' }
    if (data.id && data.bookType) store.bookTypes.set(data.id, data.bookType)
  }
  for (const doc of approvals.docs) {
    const value = doc.data() as FinanceApprovalRecord
    store.approvals.set(value.id, value)
  }
  for (const doc of claims.docs) {
    const data = doc.data()
    if (typeof data.aggregateId === 'string') store.uniqueClaims.set(doc.id, data.aggregateId)
  }
  for (const doc of idempotency.docs) {
    const data = doc.data()
    store.idempotency.set(doc.id, data as IntercompanyServiceState['idempotency'] extends Map<string, infer V> ? V : never)
  }
  for (const doc of audit.docs) {
    const data = doc.data()
    const et = String(data.eventType || '')
    if (et.startsWith('intercompany.') || et.startsWith('consolidation.') || et.startsWith('elimination.')) {
      store.auditEvents.push(data as IntercompanyServiceState['auditEvents'][number])
    }
  }
  store.auditEvents.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
  return store
}

async function persistIntercompanyStore(
  db: Firestore,
  orgId: string,
  before: IntercompanyServiceState,
  after: IntercompanyServiceState,
  actor: FinanceActorContext,
): Promise<void> {
  const batch = db.batch()
  const now = new Date().toISOString()
  const scopeHint = { orgId, legalEntityId: 'group', bookId: 'group' }

  const writeMap = <T extends { id: string }>(
    collection: string,
    previous: Map<string, T>,
    next: Map<string, T>,
  ) => {
    for (const [id, value] of next) {
      const prev = previous.get(id)
      if (prev && canonicalDigest(clean(prev)) === canonicalDigest(clean(value))) continue
      batch.set(db.collection(collection).doc(scopedStorageId(scopeHint, id)), clean(value), { merge: false })
    }
  }

  writeMap('intercompany_pairs', before.pairs, after.pairs)
  writeMap('intercompany_transactions', before.transactions, after.transactions)
  writeMap('elimination_rules', before.eliminationRules, after.eliminationRules)
  writeMap('consolidation_runs', before.consolidationRuns, after.consolidationRuns)
  writeMap('consolidation_entries', before.consolidationEntries, after.consolidationEntries)

  for (const [key, value] of after.controlBalances) {
    const prev = before.controlBalances.get(key)
    if (prev && prev.dueFromMinor === value.dueFromMinor && prev.dueToMinor === value.dueToMinor) continue
    const id = scopedStorageId(scopeHint, `bal_${canonicalDigest({ key }).slice(0, 24)}`)
    batch.set(db.collection('intercompany_control_balances').doc(id), clean({
      schemaVersion: 1,
      orgId,
      key,
      ...value,
      updatedAt: now,
      updatedBy: actor.uid,
    }), { merge: false })
  }

  for (const [claimId, aggregateId] of after.uniqueClaims) {
    if (before.uniqueClaims.get(claimId) === aggregateId) continue
    batch.set(db.collection('finance_unique_claims').doc(claimId), clean({
      schemaVersion: 1,
      claimType: 'intercompany',
      orgId,
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
      const id = event.id || `icaud_${canonicalDigest(event).slice(0, 24)}`
      batch.set(db.collection('finance_audit_events').doc(scopedStorageId(scopeHint, id)), clean({ ...event, id }), { merge: false })
    }
  }

  await batch.commit()
}

function snapshotState(store: InMemoryIntercompanyStore): IntercompanyServiceState {
  return {
    pairs: new Map(store.pairs),
    transactions: new Map(store.transactions),
    eliminationRules: new Map(store.eliminationRules),
    consolidationRuns: new Map(store.consolidationRuns),
    consolidationEntries: new Map(store.consolidationEntries),
    controlBalances: new Map(store.controlBalances),
    bookTypes: new Map(store.bookTypes),
    approvals: new Map(store.approvals),
    uniqueClaims: new Map(store.uniqueClaims),
    idempotency: new Map(store.idempotency),
    auditEvents: structuredClone(store.auditEvents),
  }
}

export class FirestoreFinanceIntercompanyGateway {
  private readonly db: Firestore

  constructor(options: { db?: Firestore } = {}) {
    this.db = options.db ?? adminDb
  }

  private async withService<T>(
    actor: FinanceActorContext,
    orgId: string,
    run: (service: FinanceIntercompanyService) => Promise<T> | T,
  ): Promise<T> {
    const store = await hydrateIntercompanyStore(this.db, orgId)
    const before = snapshotState(store)
    const service = new FinanceIntercompanyService(store)
    const result = await run(service)
    await persistIntercompanyStore(this.db, orgId, before, store, actor)
    return result
  }

  createPair(actor: FinanceActorContext, command: CreateIntercompanyPairCommand) {
    return this.withService(actor, command.orgId, (s) => s.createPair(actor, command))
  }
  activatePair(actor: FinanceActorContext, command: ActivateIntercompanyPairCommand) {
    return this.withService(actor, command.orgId, (s) => s.activatePair(actor, command))
  }
  proposeTransaction(actor: FinanceActorContext, command: ProposeIntercompanyTransactionCommand) {
    return this.withService(actor, command.orgId, (s) => s.proposeTransaction(actor, command))
  }
  postSource(actor: FinanceActorContext, command: PostIntercompanySourceCommand) {
    return this.withService(actor, command.orgId, (s) => s.postSource(actor, command))
  }
  approveReceive(actor: FinanceActorContext, command: ApproveIntercompanyReceiveCommand) {
    return this.withService(actor, command.orgId, (s) => s.approveReceive(actor, command))
  }
  postReceiving(actor: FinanceActorContext, command: PostIntercompanyReceivingCommand) {
    return this.withService(actor, command.orgId, (s) => s.postReceiving(actor, command))
  }
  rejectTransaction(actor: FinanceActorContext, command: RejectIntercompanyTransactionCommand) {
    return this.withService(actor, command.orgId, (s) => s.rejectTransaction(actor, command))
  }
  createEliminationRule(actor: FinanceActorContext, command: CreateEliminationRuleCommand) {
    return this.withService(actor, command.orgId, (s) => s.createEliminationRule(actor, command))
  }
  approveEliminationRule(actor: FinanceActorContext, command: ApproveEliminationRuleCommand) {
    return this.withService(actor, command.orgId, (s) => s.approveEliminationRule(actor, command))
  }
  createConsolidationRun(actor: FinanceActorContext, command: CreateConsolidationRunCommand) {
    return this.withService(actor, command.orgId, (s) => s.createConsolidationRun(actor, command))
  }
  pinConsolidationRun(actor: FinanceActorContext, command: PinConsolidationRunCommand) {
    return this.withService(actor, command.orgId, (s) => s.pinConsolidationRun(actor, command))
  }
  postEliminations(actor: FinanceActorContext, command: PostConsolidationEliminationsCommand) {
    return this.withService(actor, command.orgId, (s) => s.postEliminations(actor, command))
  }
  approveConsolidationRun(actor: FinanceActorContext, command: ApproveConsolidationRunCommand) {
    return this.withService(actor, command.orgId, (s) => s.approveConsolidationRun(actor, command))
  }

  async listBundle(actor: FinanceActorContext, scope: Required<FinanceScope>) {
    authorizeFinanceAction(actor, scope, 'intercompany.read')
    const store = await hydrateIntercompanyStore(this.db, scope.orgId)
    return {
      pairs: [...store.pairs.values()],
      transactions: [...store.transactions.values()],
      eliminationRules: [...store.eliminationRules.values()],
      consolidationRuns: [...store.consolidationRuns.values()],
      consolidationEntries: [...store.consolidationEntries.values()],
      controlBalances: Object.fromEntries(store.controlBalances.entries()),
      externalEgressAllowed: false,
    }
  }
}
