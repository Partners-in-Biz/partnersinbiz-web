import { adminDb } from '@/lib/firebase/admin'
import type { FinanceActorContext } from '@/lib/finance/types'
import { FirestoreFinanceDocumentsGateway } from '@/lib/accounting/firestore-documents-gateway'
import {
  StatementFinanceService,
  cloneStatementStore,
  createEmptyStatementStore,
  type ApplyStatementCommand,
  type BankTransactionImporter,
  type GenerateReconSuggestionsCommand,
  type ParseStatementCommand,
  type ResolveReconSuggestionCommand,
  type StatementFinanceStore,
} from './service'
import type { ReconSuggestion, StatementImportBatch, StatementImportLineRecord } from './types'

function asMap<T extends { id: string }>(docs: FirebaseFirestore.QuerySnapshot): Map<string, T> {
  const map = new Map<string, T>()
  for (const doc of docs.docs) {
    const data = doc.data() as T
    if (data?.id) map.set(data.id, data)
    else map.set(doc.id, { ...(data as object), id: doc.id } as T)
  }
  return map
}

async function loadStore(): Promise<StatementFinanceStore> {
  const db = adminDb
  const [batches, lines, suggestions, claims] = await Promise.all([
    db.collection('finance_statement_import_batches').limit(2000).get(),
    db.collection('finance_statement_import_lines').limit(10000).get(),
    db.collection('finance_recon_suggestions').limit(5000).get(),
    db.collection('finance_statement_claims').limit(10000).get(),
  ])
  const store = createEmptyStatementStore()
  store.batches = asMap<StatementImportBatch>(batches)
  store.lines = asMap<StatementImportLineRecord>(lines)
  store.suggestions = asMap<ReconSuggestion>(suggestions)
  for (const doc of claims.docs) {
    const key = (doc.data() as { key?: string }).key || doc.id
    store.claims.add(key)
  }
  return store
}

async function saveStore(before: StatementFinanceStore, after: StatementFinanceStore): Promise<void> {
  const db = adminDb
  const batch = db.batch()
  let ops = 0
  const touch = (col: string, id: string, value: object, prior?: object) => {
    if (prior && JSON.stringify(prior) === JSON.stringify(value)) return
    batch.set(db.collection(col).doc(id), value, { merge: true })
    ops++
  }
  for (const [id, value] of after.batches) {
    touch('finance_statement_import_batches', id, value, before.batches.get(id))
  }
  for (const [id, value] of after.lines) {
    touch('finance_statement_import_lines', id, value, before.lines.get(id))
  }
  for (const [id, value] of after.suggestions) {
    touch('finance_recon_suggestions', id, value, before.suggestions.get(id))
  }
  for (const key of after.claims) {
    if (before.claims.has(key)) continue
    const claimId = Buffer.from(key).toString('base64url').slice(0, 700)
    batch.set(
      db.collection('finance_statement_claims').doc(claimId),
      { id: claimId, key, createdAt: new Date().toISOString() },
      { merge: true },
    )
    ops++
  }
  if (ops > 0) await batch.commit()
}

const defaultImporter: BankTransactionImporter = async (input) => {
  const gateway = new FirestoreFinanceDocumentsGateway()
  try {
    const txn = await gateway.importBankTransaction(input.actor, {
      id: input.id,
      orgId: input.orgId,
      legalEntityId: input.legalEntityId,
      bookId: input.bookId,
      bankAccountId: input.bankAccountId,
      statementDate: input.statementDate,
      effectiveDate: input.effectiveDate,
      amountMinor: input.amountMinor,
      description: input.description,
      sourceFingerprint: input.sourceFingerprint,
      ...(input.reference ? { reference: input.reference } : {}),
      ...(input.counterpartyName ? { counterpartyName: input.counterpartyName } : {}),
      expectedVersion: 0,
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
    })
    return { id: txn.id }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/already imported|fingerprint|already exists/i.test(msg)) {
      return { id: input.id, duplicate: true }
    }
    throw err
  }
}

export class FirestoreStatementFinanceGateway {
  constructor(private readonly importer: BankTransactionImporter = defaultImporter) {}

  private service() {
    return new StatementFinanceService(
      () => loadStore(),
      (before, after) => saveStore(before, after),
      this.importer,
    )
  }

  parseStatement(actor: FinanceActorContext, command: ParseStatementCommand) {
    return this.service().parseStatement(actor, command)
  }

  applyStatement(actor: FinanceActorContext, command: ApplyStatementCommand) {
    return this.service().applyStatement(actor, command)
  }

  generateSuggestions(actor: FinanceActorContext, command: GenerateReconSuggestionsCommand) {
    return this.service().generateSuggestions(actor, command)
  }

  acceptSuggestion(actor: FinanceActorContext, command: ResolveReconSuggestionCommand) {
    return this.service().acceptSuggestion(actor, command)
  }

  dismissSuggestion(actor: FinanceActorContext, command: ResolveReconSuggestionCommand) {
    return this.service().dismissSuggestion(actor, command)
  }

  listForOrg(
    actor: FinanceActorContext,
    orgId: string,
    opts?: { bankAccountId?: string; batchId?: string },
  ) {
    return this.service().listForOrg(actor, orgId, opts)
  }
}

export type {
  ApplyStatementCommand,
  GenerateReconSuggestionsCommand,
  ParseStatementCommand,
  ResolveReconSuggestionCommand,
  StatementFinanceStore,
  BankTransactionImporter,
}

export { StatementFinanceService, cloneStatementStore, createEmptyStatementStore }
