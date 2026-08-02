import { FinanceAuthorizationError } from '@/lib/finance/policy'
import type { FinanceActorContext } from '@/lib/finance/types'
import { parseStatementFile, StatementParseError } from './parse'
import type {
  ReconSuggestion,
  ReconSuggestionKind,
  StatementFinanceAction,
  StatementFileFormat,
  StatementImportBatch,
  StatementImportLineRecord,
} from './types'

export class StatementFinanceValidationError extends Error {
  readonly statusCode = 400
  constructor(message: string) {
    super(message)
    this.name = 'StatementFinanceValidationError'
  }
}

export class StatementFinanceNotFoundError extends Error {
  readonly statusCode = 404
  constructor(message: string) {
    super(message)
    this.name = 'StatementFinanceNotFoundError'
  }
}

export interface ParseStatementCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  bankAccountId: string
  fileName: string
  contentText: string
  format?: StatementFileFormat
  requestId: string
  idempotencyKey: string
}

export interface ApplyStatementCommand {
  id: string
  orgId: string
  requestId: string
  idempotencyKey: string
}

export interface GenerateReconSuggestionsCommand {
  idPrefix?: string
  orgId: string
  legalEntityId: string
  bookId: string
  bankAccountId: string
  /** Observed bank transactions available for matching (caller-supplied snapshot). */
  bankTransactions: Array<{
    id: string
    bankAccountId: string
    amountMinor: number
    statementDate: string
    description: string
    reference?: string
    counterpartyName?: string
    reconciliationState: string
  }>
  /** Verified payments available as match candidates. */
  payments: Array<{
    id: string
    amountMinor: number
    observedDate?: string
    description?: string
    externalReference?: string
    status: string
  }>
  requestId: string
  idempotencyKey: string
}

export interface ResolveReconSuggestionCommand {
  id: string
  orgId: string
  resolutionNote?: string
  requestId: string
  idempotencyKey: string
}

export interface StatementFinanceStore {
  batches: Map<string, StatementImportBatch>
  lines: Map<string, StatementImportLineRecord>
  suggestions: Map<string, ReconSuggestion>
  claims: Set<string>
}

export function createEmptyStatementStore(): StatementFinanceStore {
  return {
    batches: new Map(),
    lines: new Map(),
    suggestions: new Map(),
    claims: new Set(),
  }
}

export function cloneStatementStore(store: StatementFinanceStore): StatementFinanceStore {
  return {
    batches: new Map(store.batches),
    lines: new Map(store.lines),
    suggestions: new Map(store.suggestions),
    claims: new Set(store.claims),
  }
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new StatementFinanceValidationError(`${field} is required`)
  }
  return value.trim()
}

function claim(store: StatementFinanceStore, key: string, message: string) {
  if (store.claims.has(key)) throw new StatementFinanceValidationError(message)
  store.claims.add(key)
}

function hasFinanceRole(actor: FinanceActorContext, orgId: string): boolean {
  const isOrgAdmin = actor.membershipRole === 'owner' || actor.membershipRole === 'admin'
  if (isOrgAdmin) return true
  return actor.assignments.some(
    (a) =>
      a.orgId === orgId &&
      a.userId === actor.uid &&
      a.status === 'active' &&
      ['finance_admin', 'accountant', 'bookkeeper', 'finance_approver'].includes(a.role),
  )
}

function authorizeOrgFinanceAction(
  actor: FinanceActorContext,
  orgId: string,
  action: StatementFinanceAction,
): void {
  if (!actor.membershipActive) throw new FinanceAuthorizationError('Active organization membership is required')
  if (actor.orgId !== orgId) throw new FinanceAuthorizationError('Actor organization does not match finance scope')
  if (!actor.financeModuleEnabled) throw new FinanceAuthorizationError('Persisted Finance module capability is required')
  if (!hasFinanceRole(actor, orgId)) {
    throw new FinanceAuthorizationError(`Finance role or org admin required for ${action}`)
  }
  if (actor.delegationId) {
    if (actor.delegationOrgId !== orgId) {
      throw new FinanceAuthorizationError('Delegation organization does not match finance scope')
    }
    const scopes = actor.delegationScopes ?? []
    const ok =
      scopes.includes('finance:*') ||
      scopes.some((s) => s.startsWith('finance:')) ||
      scopes.includes(`finance:${action}`) ||
      scopes.includes('finance:statement:*')
    if (!ok) throw new FinanceAuthorizationError('Delegation does not grant finance statement access')
  }
}

export type BankTransactionImporter = (input: {
  actor: FinanceActorContext
  orgId: string
  legalEntityId: string
  bookId: string
  bankAccountId: string
  id: string
  statementDate: string
  effectiveDate: string
  amountMinor: number
  description: string
  sourceFingerprint: string
  reference?: string
  counterpartyName?: string
  requestId: string
  idempotencyKey: string
}) => Promise<{ id: string; duplicate?: boolean }>

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function scoreMatch(
  txn: GenerateReconSuggestionsCommand['bankTransactions'][number],
  payment: GenerateReconSuggestionsCommand['payments'][number],
): { score: number; reason: string; kind: ReconSuggestionKind } | null {
  if (payment.status !== 'verified') return null
  if (Math.abs(txn.amountMinor) !== Math.abs(payment.amountMinor)) return null

  const txnRef = normalize(txn.reference || '')
  const payRef = normalize(payment.externalReference || '')
  const txnDesc = normalize(txn.description || '')
  const payDesc = normalize(payment.description || '')

  if (txnRef && payRef && txnRef === payRef) {
    return { score: 0.95, reason: 'Exact external reference match on equal amount', kind: 'match_payment' }
  }
  if (txnDesc && payDesc && (txnDesc.includes(payDesc) || payDesc.includes(txnDesc))) {
    return { score: 0.8, reason: 'Description overlap on equal amount', kind: 'match_payment' }
  }
  if (txn.counterpartyName && payDesc && normalize(txn.counterpartyName) === payDesc) {
    return { score: 0.75, reason: 'Counterparty matches payment description on equal amount', kind: 'match_payment' }
  }
  // Equal amount only — lower confidence, still human-gated.
  return { score: 0.55, reason: 'Equal amount only; human review required', kind: 'match_payment' }
}

function recurringKey(txn: GenerateReconSuggestionsCommand['bankTransactions'][number]): string {
  const desc = normalize(txn.description).split(' ').slice(0, 4).join(' ')
  return `${Math.abs(txn.amountMinor)}|${desc}`
}

export class StatementFinanceService {
  constructor(
    private readonly load: () => Promise<StatementFinanceStore>,
    private readonly save: (before: StatementFinanceStore, after: StatementFinanceStore) => Promise<void>,
    private readonly importBankTxn: BankTransactionImporter,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async parseStatement(
    actor: FinanceActorContext,
    command: ParseStatementCommand,
  ): Promise<{ batch: StatementImportBatch; lines: StatementImportLineRecord[] }> {
    authorizeOrgFinanceAction(actor, command.orgId, 'statement.import.parse')
    const id = requiredText(command.id, 'id')
    const orgId = requiredText(command.orgId, 'orgId')
    const legalEntityId = requiredText(command.legalEntityId, 'legalEntityId')
    const bookId = requiredText(command.bookId, 'bookId')
    const bankAccountId = requiredText(command.bankAccountId, 'bankAccountId')
    const fileName = requiredText(command.fileName, 'fileName')
    const contentText = requiredText(command.contentText, 'contentText')
    if (contentText.length > 2_000_000) {
      throw new StatementFinanceValidationError('Statement file exceeds 2MB text limit')
    }

    let parsed
    try {
      parsed = parseStatementFile(contentText, command.format || 'auto')
    } catch (err) {
      if (err instanceof StatementParseError) throw new StatementFinanceValidationError(err.message)
      throw err
    }

    const before = await this.load()
    const after = cloneStatementStore(before)
    claim(after, `idem:parse:${orgId}:${command.idempotencyKey}`, 'Duplicate idempotency key')
    claim(after, `batch:${id}`, 'Statement import batch already exists')
    claim(
      after,
      `batch_digest:${orgId}:${bankAccountId}:${parsed.contentDigest}`,
      'This statement file was already parsed for this bank account',
    )

    const now = this.now()
    const batch: StatementImportBatch = {
      id,
      orgId,
      legalEntityId,
      bookId,
      bankAccountId,
      format: parsed.format,
      fileName,
      contentDigest: parsed.contentDigest,
      status: 'parsed',
      lineCount: parsed.lines.length,
      importedCount: 0,
      skippedDuplicateCount: 0,
      errorCount: 0,
      createdBy: actor.uid,
      createdAt: now,
      schemaVersion: 1,
      version: 1,
      externalPaymentInitiated: false,
    }
    after.batches.set(id, batch)

    const lineRecords: StatementImportLineRecord[] = []
    for (const line of parsed.lines) {
      const lineId = `${id}_L${line.lineIndex}`
      const rec: StatementImportLineRecord = {
        id: lineId,
        batchId: id,
        orgId,
        legalEntityId,
        bookId,
        bankAccountId,
        lineIndex: line.lineIndex,
        statementDate: line.statementDate,
        effectiveDate: line.effectiveDate,
        amountMinor: line.amountMinor,
        description: line.description,
        ...(line.reference ? { reference: line.reference } : {}),
        ...(line.counterpartyName ? { counterpartyName: line.counterpartyName } : {}),
        sourceFingerprint: line.sourceFingerprint,
        raw: line.raw,
        importStatus: 'pending',
        schemaVersion: 1,
        version: 1,
      }
      after.lines.set(lineId, rec)
      lineRecords.push(rec)
    }

    await this.save(before, after)
    return { batch, lines: lineRecords }
  }

  async applyStatement(
    actor: FinanceActorContext,
    command: ApplyStatementCommand,
  ): Promise<{ batch: StatementImportBatch; lines: StatementImportLineRecord[] }> {
    authorizeOrgFinanceAction(actor, command.orgId, 'statement.import.apply')
    const id = requiredText(command.id, 'id')
    const orgId = requiredText(command.orgId, 'orgId')

    const before = await this.load()
    const existing = before.batches.get(id)
    if (!existing || existing.orgId !== orgId) {
      throw new StatementFinanceNotFoundError('Statement import batch not found')
    }
    if (existing.status === 'applied') {
      const lines = [...before.lines.values()]
        .filter((l) => l.batchId === id)
        .sort((a, b) => a.lineIndex - b.lineIndex)
      return { batch: existing, lines }
    }

    const after = cloneStatementStore(before)
    claim(after, `idem:apply:${orgId}:${command.idempotencyKey}`, 'Duplicate idempotency key')

    const pending = [...after.lines.values()]
      .filter((l) => l.batchId === id)
      .sort((a, b) => a.lineIndex - b.lineIndex)

    let imported = 0
    let duplicates = 0
    let errors = 0

    for (const line of pending) {
      if (line.importStatus === 'imported') {
        imported++
        continue
      }
      try {
        const result = await this.importBankTxn({
          actor,
          orgId: line.orgId,
          legalEntityId: line.legalEntityId,
          bookId: line.bookId,
          bankAccountId: line.bankAccountId,
          id: `btx_${line.sourceFingerprint.slice(0, 24)}`,
          statementDate: line.statementDate,
          effectiveDate: line.effectiveDate,
          amountMinor: line.amountMinor,
          description: line.description,
          sourceFingerprint: line.sourceFingerprint,
          reference: line.reference,
          counterpartyName: line.counterpartyName,
          requestId: `${command.requestId}:${line.lineIndex}`,
          idempotencyKey: `${command.idempotencyKey}:${line.sourceFingerprint}`,
        })
        if (result.duplicate) {
          duplicates++
          after.lines.set(line.id, {
            ...line,
            importStatus: 'duplicate',
            bankTransactionId: result.id,
            version: line.version + 1,
          })
        } else {
          imported++
          after.lines.set(line.id, {
            ...line,
            importStatus: 'imported',
            bankTransactionId: result.id,
            version: line.version + 1,
          })
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Import failed'
        if (/already imported|fingerprint|already exists/i.test(msg)) {
          duplicates++
          after.lines.set(line.id, {
            ...line,
            importStatus: 'duplicate',
            errorMessage: msg,
            version: line.version + 1,
          })
        } else {
          errors++
          after.lines.set(line.id, {
            ...line,
            importStatus: 'error',
            errorMessage: msg,
            version: line.version + 1,
          })
        }
      }
    }

    const now = this.now()
    const status: StatementImportBatch['status'] =
      errors === 0 && duplicates + imported === pending.length
        ? 'applied'
        : errors === pending.length
          ? 'failed'
          : 'partial'

    const batch: StatementImportBatch = {
      ...existing,
      status,
      importedCount: imported,
      skippedDuplicateCount: duplicates,
      errorCount: errors,
      appliedAt: now,
      version: existing.version + 1,
      externalPaymentInitiated: false,
    }
    after.batches.set(id, batch)
    await this.save(before, after)

    const lines = [...after.lines.values()]
      .filter((l) => l.batchId === id)
      .sort((a, b) => a.lineIndex - b.lineIndex)
    return { batch, lines }
  }

  async generateSuggestions(
    actor: FinanceActorContext,
    command: GenerateReconSuggestionsCommand,
  ): Promise<{ suggestions: ReconSuggestion[]; autoPosted: false }> {
    authorizeOrgFinanceAction(actor, command.orgId, 'recon.suggestion.generate')
    const orgId = requiredText(command.orgId, 'orgId')
    const legalEntityId = requiredText(command.legalEntityId, 'legalEntityId')
    const bookId = requiredText(command.bookId, 'bookId')
    const bankAccountId = requiredText(command.bankAccountId, 'bankAccountId')

    const before = await this.load()
    const after = cloneStatementStore(before)
    claim(after, `idem:suggest:${orgId}:${command.idempotencyKey}`, 'Duplicate idempotency key')

    const unmatched = command.bankTransactions.filter(
      (t) =>
        t.bankAccountId === bankAccountId &&
        (t.reconciliationState === 'unmatched' || t.reconciliationState === 'open'),
    )
    const payments = command.payments.filter((p) => p.status === 'verified')
    const now = this.now()
    const prefix = (command.idPrefix || 'rsg').trim() || 'rsg'
    const created: ReconSuggestion[] = []
    const usedPaymentIds = new Set<string>()

    // Recurring frequency map from already-known unmatched descriptions.
    const recurringCounts = new Map<string, number>()
    for (const t of command.bankTransactions) {
      if (t.bankAccountId !== bankAccountId) continue
      if (t.amountMinor >= 0) continue
      const key = recurringKey(t)
      recurringCounts.set(key, (recurringCounts.get(key) || 0) + 1)
    }

    let seq = 0
    for (const txn of unmatched) {
      let best:
        | {
            paymentId: string
            score: number
            reason: string
            kind: ReconSuggestionKind
          }
        | null = null
      for (const payment of payments) {
        if (usedPaymentIds.has(payment.id)) continue
        const scored = scoreMatch(txn, payment)
        if (!scored) continue
        if (!best || scored.score > best.score) {
          best = {
            paymentId: payment.id,
            score: scored.score,
            reason: scored.reason,
            kind: scored.kind,
          }
        }
      }

      // Require stronger than equal-amount-only before locking a payment candidate.
      if (best && best.score >= 0.75) {
        usedPaymentIds.add(best.paymentId)
        seq++
        const id = `${prefix}_${seq}`
        const suggestion: ReconSuggestion = {
          id,
          orgId,
          legalEntityId,
          bookId,
          bankAccountId,
          bankTransactionId: txn.id,
          kind: best.kind,
          status: 'pending',
          confidence: best.score,
          reason: best.reason,
          suggestedPaymentId: best.paymentId,
          createdBy: actor.uid,
          createdAt: now,
          schemaVersion: 1,
          version: 1,
          autoPosted: false,
        }
        after.suggestions.set(id, suggestion)
        created.push(suggestion)
        continue
      }

      // Expense / recurring suggestions for unmatched outflows only.
      if (txn.amountMinor < 0) {
        seq++
        const id = `${prefix}_${seq}`
        const key = recurringKey(txn)
        const count = recurringCounts.get(key) || 1
        const isRecurring = count >= 2
        const suggestion: ReconSuggestion = {
          id,
          orgId,
          legalEntityId,
          bookId,
          bankAccountId,
          bankTransactionId: txn.id,
          kind: isRecurring ? 'match_recurring' : 'propose_expense',
          status: 'pending',
          confidence: isRecurring ? 0.7 : 0.4,
          reason: isRecurring
            ? 'Recurring outflow pattern detected; propose expense coding for human approval'
            : 'Unmatched outflow; propose expense observation for human approval',
          proposedExpenseDescription: txn.description,
          proposedExpenseAmountMinor: Math.abs(txn.amountMinor),
          ...(isRecurring ? { recurringKey: key } : {}),
          createdBy: actor.uid,
          createdAt: now,
          schemaVersion: 1,
          version: 1,
          autoPosted: false,
        }
        after.suggestions.set(id, suggestion)
        created.push(suggestion)
      } else {
        seq++
        const id = `${prefix}_${seq}`
        const suggestion: ReconSuggestion = {
          id,
          orgId,
          legalEntityId,
          bookId,
          bankAccountId,
          bankTransactionId: txn.id,
          kind: 'unmatched_review',
          status: 'pending',
          confidence: 0.3,
          reason: 'Unmatched inflow requires human classification',
          createdBy: actor.uid,
          createdAt: now,
          schemaVersion: 1,
          version: 1,
          autoPosted: false,
        }
        after.suggestions.set(id, suggestion)
        created.push(suggestion)
      }
    }

    await this.save(before, after)
    return { suggestions: created, autoPosted: false }
  }

  async acceptSuggestion(
    actor: FinanceActorContext,
    command: ResolveReconSuggestionCommand,
  ): Promise<ReconSuggestion> {
    return this.resolveSuggestion(actor, command, 'accepted', 'recon.suggestion.accept')
  }

  async dismissSuggestion(
    actor: FinanceActorContext,
    command: ResolveReconSuggestionCommand,
  ): Promise<ReconSuggestion> {
    return this.resolveSuggestion(actor, command, 'dismissed', 'recon.suggestion.dismiss')
  }

  private async resolveSuggestion(
    actor: FinanceActorContext,
    command: ResolveReconSuggestionCommand,
    status: 'accepted' | 'dismissed',
    action: StatementFinanceAction,
  ): Promise<ReconSuggestion> {
    authorizeOrgFinanceAction(actor, command.orgId, action)
    const id = requiredText(command.id, 'id')
    const orgId = requiredText(command.orgId, 'orgId')
    const before = await this.load()
    const existing = before.suggestions.get(id)
    if (!existing || existing.orgId !== orgId) {
      throw new StatementFinanceNotFoundError('Recon suggestion not found')
    }
    if (existing.status !== 'pending') {
      throw new StatementFinanceValidationError('Only pending suggestions can be resolved')
    }
    const after = cloneStatementStore(before)
    claim(after, `idem:resolve:${orgId}:${command.idempotencyKey}`, 'Duplicate idempotency key')
    const now = this.now()
    const next: ReconSuggestion = {
      ...existing,
      status,
      resolvedAt: now,
      resolvedBy: actor.uid,
      ...(command.resolutionNote ? { resolutionNote: command.resolutionNote.trim() } : {}),
      version: existing.version + 1,
      autoPosted: false,
    }
    after.suggestions.set(id, next)
    await this.save(before, after)
    return next
  }

  async listForOrg(
    actor: FinanceActorContext,
    orgId: string,
    opts?: { bankAccountId?: string; batchId?: string },
  ): Promise<{
    batches: StatementImportBatch[]
    lines: StatementImportLineRecord[]
    suggestions: ReconSuggestion[]
    externalPaymentInitiated: false
    autoPosted: false
  }> {
    authorizeOrgFinanceAction(actor, orgId, 'statement.read')
    const store = await this.load()
    let batches = [...store.batches.values()].filter((b) => b.orgId === orgId)
    let lines = [...store.lines.values()].filter((l) => l.orgId === orgId)
    let suggestions = [...store.suggestions.values()].filter((s) => s.orgId === orgId)
    if (opts?.bankAccountId) {
      batches = batches.filter((b) => b.bankAccountId === opts.bankAccountId)
      lines = lines.filter((l) => l.bankAccountId === opts.bankAccountId)
      suggestions = suggestions.filter((s) => s.bankAccountId === opts.bankAccountId)
    }
    if (opts?.batchId) {
      batches = batches.filter((b) => b.id === opts.batchId)
      lines = lines.filter((l) => l.batchId === opts.batchId)
    }
    batches.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    lines.sort((a, b) => a.lineIndex - b.lineIndex)
    suggestions.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return {
      batches,
      lines,
      suggestions,
      externalPaymentInitiated: false,
      autoPosted: false,
    }
  }
}
