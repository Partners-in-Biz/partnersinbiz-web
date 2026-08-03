import { adminDb } from '@/lib/firebase/admin'
import type { FinanceActorContext } from '@/lib/finance/types'
import {
  BankFeedFinanceService,
  createEmptyBankFeedStore,
  type BankFeedStore,
  type CreateBankFeedConnectionCommand,
  type DisconnectBankFeedCommand,
  type ResolveBankFeedSuggestionCommand,
  type SyncBankFeedCommand,
} from './service'
import type {
  BankFeedAuditEvent,
  BankFeedBankLine,
  BankFeedConnection,
  BankFeedSuggestion,
  BankFeedSyncRun,
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

async function loadStore(orgId: string): Promise<BankFeedStore> {
  const db = adminDb
  const [connections, syncRuns, lines, suggestions, audit, claims, fps] = await Promise.all([
    db.collection('finance_bank_feed_connections').where('orgId', '==', orgId).get(),
    db.collection('finance_bank_feed_sync_runs').where('orgId', '==', orgId).get(),
    db.collection('finance_bank_feed_lines').where('orgId', '==', orgId).get(),
    db.collection('finance_bank_feed_suggestions').where('orgId', '==', orgId).get(),
    db.collection('finance_bank_feed_audit_events').where('orgId', '==', orgId).get(),
    db.collection('finance_bank_feed_claims').where('orgId', '==', orgId).get(),
    db.collection('finance_bank_feed_fingerprints').where('orgId', '==', orgId).get(),
  ])
  const store = createEmptyBankFeedStore()
  store.connections = asMap<BankFeedConnection>(connections)
  store.syncRuns = asMap<BankFeedSyncRun>(syncRuns)
  store.lines = asMap<BankFeedBankLine>(lines)
  store.suggestions = asMap<BankFeedSuggestion>(suggestions)
  store.auditEvents = asMap<BankFeedAuditEvent>(audit)
  for (const doc of claims.docs) {
    const key = (doc.data() as { key?: string }).key || doc.id
    store.claims.add(key)
  }
  for (const doc of fps.docs) {
    const key = (doc.data() as { key?: string }).key || doc.id
    store.importedFingerprints.add(key)
  }
  return store
}

async function saveStore(orgId: string, before: BankFeedStore, after: BankFeedStore): Promise<void> {
  const db = adminDb
  const batch = db.batch()
  const writeMap = <T extends { id: string }>(collection: string, prev: Map<string, T>, next: Map<string, T>) => {
    for (const [id, value] of next) {
      const prior = prev.get(id)
      if (prior && JSON.stringify(prior) === JSON.stringify(value)) continue
      batch.set(db.collection(collection).doc(id), value, { merge: true })
    }
  }
  writeMap('finance_bank_feed_connections', before.connections, after.connections)
  writeMap('finance_bank_feed_sync_runs', before.syncRuns, after.syncRuns)
  writeMap('finance_bank_feed_lines', before.lines, after.lines)
  writeMap('finance_bank_feed_suggestions', before.suggestions, after.suggestions)
  writeMap('finance_bank_feed_audit_events', before.auditEvents, after.auditEvents)
  for (const key of after.claims) {
    if (before.claims.has(key)) continue
    const claimId = Buffer.from(key).toString('base64url').slice(0, 700)
    batch.set(
      db.collection('finance_bank_feed_claims').doc(claimId),
      { id: claimId, orgId, key, createdAt: new Date().toISOString() },
      { merge: true },
    )
  }
  for (const key of after.importedFingerprints) {
    if (before.importedFingerprints.has(key)) continue
    const fpId = Buffer.from(key).toString('base64url').slice(0, 700)
    batch.set(
      db.collection('finance_bank_feed_fingerprints').doc(fpId),
      { id: fpId, orgId, key, createdAt: new Date().toISOString() },
      { merge: true },
    )
  }
  await batch.commit()
}

export class FirestoreBankFeedFinanceGateway {
  private service(orgId: string) {
    return new BankFeedFinanceService(
      () => loadStore(orgId),
      (before, after) => saveStore(orgId, before, after),
    )
  }

  createConnection(actor: FinanceActorContext, command: CreateBankFeedConnectionCommand) {
    return this.service(command.orgId).createConnection(actor, command)
  }

  disconnectConnection(actor: FinanceActorContext, command: DisconnectBankFeedCommand) {
    return this.service(command.orgId).disconnectConnection(actor, command)
  }

  syncNow(actor: FinanceActorContext, command: SyncBankFeedCommand) {
    return this.service(command.orgId).syncNow(actor, command)
  }

  acceptSuggestion(actor: FinanceActorContext, command: ResolveBankFeedSuggestionCommand) {
    return this.service(command.orgId).acceptSuggestion(actor, command)
  }

  dismissSuggestion(actor: FinanceActorContext, command: ResolveBankFeedSuggestionCommand) {
    return this.service(command.orgId).dismissSuggestion(actor, command)
  }

  getBundle(actor: FinanceActorContext, orgId: string, legalEntityId: string, bookId: string) {
    return this.service(orgId).getBundle(actor, orgId, legalEntityId, bookId)
  }

  listProviderAccounts(
    actor: FinanceActorContext,
    input: { orgId: string; legalEntityId: string; bookId: string; connectionId: string },
  ) {
    return this.service(input.orgId).listProviderAccounts(actor, input)
  }
}

export type {
  CreateBankFeedConnectionCommand,
  DisconnectBankFeedCommand,
  ResolveBankFeedSuggestionCommand,
  SyncBankFeedCommand,
}
export { BankFeedFinanceService, createEmptyBankFeedStore }
