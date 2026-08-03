import { adminDb } from '@/lib/firebase/admin'
import type { FinanceActorContext } from '@/lib/finance/types'
import { FirestoreFinanceDocumentsGateway } from '@/lib/accounting/firestore-documents-gateway'
import { createChunkedBatchWriter } from '@/lib/finance/scale/firestore-write'
import { STATEMENT_LINES_RESPONSE_PREVIEW } from '@/lib/finance/scale/pagination'
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

/**
 * Org-scoped load. Avoids global collection scans that break multi-tenant scale.
 *
 * Query notes (single-field equality on orgId; composite indexes not required for these):
 * - finance_statement_import_batches where orgId ==
 * - finance_statement_import_lines where orgId ==
 * - finance_recon_suggestions where orgId ==
 * - finance_statement_claims where orgId ==
 *
 * Soft caps guard runaway orgs; pagination lives in StatementFinanceService.listForOrg.
 */
async function loadStore(orgId: string): Promise<StatementFinanceStore> {
  const db = adminDb
  const [batches, lines, suggestions, claims] = await Promise.all([
    db.collection('finance_statement_import_batches').where('orgId', '==', orgId).limit(2000).get(),
    db.collection('finance_statement_import_lines').where('orgId', '==', orgId).limit(25_000).get(),
    db.collection('finance_recon_suggestions').where('orgId', '==', orgId).limit(10_000).get(),
    db.collection('finance_statement_claims').where('orgId', '==', orgId).limit(25_000).get(),
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

async function saveStore(
  orgId: string,
  before: StatementFinanceStore,
  after: StatementFinanceStore,
): Promise<void> {
  const db = adminDb
  const writer = createChunkedBatchWriter(db)

  for (const [id, value] of after.batches) {
    const prior = before.batches.get(id)
    if (prior && JSON.stringify(prior) === JSON.stringify(value)) continue
    await writer.set('finance_statement_import_batches', id, value)
  }
  for (const [id, value] of after.lines) {
    const prior = before.lines.get(id)
    if (prior && JSON.stringify(prior) === JSON.stringify(value)) continue
    await writer.set('finance_statement_import_lines', id, value)
  }
  for (const [id, value] of after.suggestions) {
    const prior = before.suggestions.get(id)
    if (prior && JSON.stringify(prior) === JSON.stringify(value)) continue
    await writer.set('finance_recon_suggestions', id, value)
  }
  for (const key of after.claims) {
    if (before.claims.has(key)) continue
    const claimId = Buffer.from(key).toString('base64url').slice(0, 700)
    await writer.set('finance_statement_claims', claimId, {
      id: claimId,
      orgId,
      key,
      createdAt: new Date().toISOString(),
    })
  }
  await writer.flush()
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

function previewLines<T extends { lineIndex?: number }>(lines: T[]) {
  if (lines.length <= STATEMENT_LINES_RESPONSE_PREVIEW) {
    return {
      lines,
      linesReturned: lines.length,
      linesTotal: lines.length,
      linesTruncated: false as const,
    }
  }
  return {
    lines: lines.slice(0, STATEMENT_LINES_RESPONSE_PREVIEW),
    linesReturned: STATEMENT_LINES_RESPONSE_PREVIEW,
    linesTotal: lines.length,
    linesTruncated: true as const,
  }
}

export class FirestoreStatementFinanceGateway {
  constructor(private readonly importer: BankTransactionImporter = defaultImporter) {}

  private service(orgId: string) {
    return new StatementFinanceService(
      () => loadStore(orgId),
      (before, after) => saveStore(orgId, before, after),
      this.importer,
    )
  }

  async parseStatement(actor: FinanceActorContext, command: ParseStatementCommand) {
    const result = await this.service(command.orgId).parseStatement(actor, command)
    return { batch: result.batch, ...previewLines(result.lines) }
  }

  async applyStatement(actor: FinanceActorContext, command: ApplyStatementCommand) {
    const result = await this.service(command.orgId).applyStatement(actor, command)
    return { batch: result.batch, ...previewLines(result.lines) }
  }

  generateSuggestions(actor: FinanceActorContext, command: GenerateReconSuggestionsCommand) {
    return this.service(command.orgId).generateSuggestions(actor, command)
  }

  acceptSuggestion(actor: FinanceActorContext, command: ResolveReconSuggestionCommand) {
    return this.service(command.orgId).acceptSuggestion(actor, command)
  }

  dismissSuggestion(actor: FinanceActorContext, command: ResolveReconSuggestionCommand) {
    return this.service(command.orgId).dismissSuggestion(actor, command)
  }

  listForOrg(
    actor: FinanceActorContext,
    orgId: string,
    opts?: {
      bankAccountId?: string
      batchId?: string
      lineLimit?: number
      lineOffset?: number
      suggestionLimit?: number
      suggestionOffset?: number
      batchLimit?: number
      batchOffset?: number
    },
  ) {
    return this.service(orgId).listForOrg(actor, orgId, opts)
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
