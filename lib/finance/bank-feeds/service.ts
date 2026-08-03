import { FinanceAuthorizationError } from '@/lib/finance/policy'
import type { FinanceActorContext } from '@/lib/finance/types'
import {
  resolveBankFeedAdapter,
  createBankFeedAdapterRegistry,
  type BankFeedAdapterFactory,
  type BankFeedConnectorAdapter,
} from './adapter'
import type {
  BankFeedAuditEvent,
  BankFeedBankLine,
  BankFeedConnection,
  BankFeedConnectionStatus,
  BankFeedFinanceAction,
  BankFeedProviderId,
  BankFeedSuggestion,
  BankFeedSyncRun,
} from './types'

export class BankFeedValidationError extends Error {
  readonly statusCode = 400
  constructor(message: string) {
    super(message)
    this.name = 'BankFeedValidationError'
  }
}

export class BankFeedNotFoundError extends Error {
  readonly statusCode = 404
  constructor(message: string) {
    super(message)
    this.name = 'BankFeedNotFoundError'
  }
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new BankFeedValidationError(`${field} is required`)
  return value.trim()
}

function assertFinanceMembership(actor: FinanceActorContext, orgId: string, action: BankFeedFinanceAction) {
  if (!actor.membershipActive) throw new FinanceAuthorizationError('Active organization membership is required')
  if (actor.orgId !== orgId) throw new FinanceAuthorizationError('Actor organization does not match finance scope')
  if (!actor.financeModuleEnabled) throw new FinanceAuthorizationError('Persisted Finance module capability is required')
  const isOrgAdmin = actor.membershipRole === 'owner' || actor.membershipRole === 'admin'
  const writeRoles = new Set(['finance_admin', 'accountant', 'bookkeeper'])
  const readRoles = new Set(['finance_admin', 'accountant', 'bookkeeper', 'finance_approver', 'finance_viewer'])
  const rolesNeeded =
    action === 'bank_feed.connection.read' || action === 'bank_feed.audit.read' ? readRoles : writeRoles
  const has = actor.assignments.some(
    (a) => a.orgId === orgId && a.userId === actor.uid && a.status === 'active' && rolesNeeded.has(a.role),
  )
  if (!isOrgAdmin && !has) {
    throw new FinanceAuthorizationError(`Finance role required for ${action}`)
  }
  if (actor.delegationId) {
    if (actor.delegationOrgId !== orgId) {
      throw new FinanceAuthorizationError('Delegation organization does not match finance scope')
    }
    const scopes = actor.delegationScopes ?? []
    const ok =
      scopes.includes('finance:*') ||
      scopes.some((s) => s.startsWith('finance:')) ||
      scopes.includes(`finance:${action}`)
    if (!ok) throw new FinanceAuthorizationError('Delegation does not grant bank feed access')
  }
}

export interface BankFeedStore {
  connections: Map<string, BankFeedConnection>
  syncRuns: Map<string, BankFeedSyncRun>
  lines: Map<string, BankFeedBankLine>
  suggestions: Map<string, BankFeedSuggestion>
  auditEvents: Map<string, BankFeedAuditEvent>
  claims: Set<string>
  /** Fingerprints already imported (org+bankAccount scoped key). */
  importedFingerprints: Set<string>
}

export function createEmptyBankFeedStore(): BankFeedStore {
  return {
    connections: new Map(),
    syncRuns: new Map(),
    lines: new Map(),
    suggestions: new Map(),
    auditEvents: new Map(),
    claims: new Set(),
    importedFingerprints: new Set(),
  }
}

export function cloneBankFeedStore(store: BankFeedStore): BankFeedStore {
  return {
    connections: new Map(store.connections),
    syncRuns: new Map(store.syncRuns),
    lines: new Map(store.lines),
    suggestions: new Map(store.suggestions),
    auditEvents: new Map(store.auditEvents),
    claims: new Set(store.claims),
    importedFingerprints: new Set(store.importedFingerprints),
  }
}

function claim(store: BankFeedStore, key: string, message: string) {
  if (store.claims.has(key)) throw new BankFeedValidationError(message)
  store.claims.add(key)
}

function appendAudit(
  store: BankFeedStore,
  event: Omit<BankFeedAuditEvent, 'schemaVersion' | 'externalEgressAllowed' | 'externalPaymentInitiated' | 'autoPosted'>,
) {
  const full: BankFeedAuditEvent = {
    ...event,
    schemaVersion: 1,
    externalEgressAllowed: false,
    externalPaymentInitiated: false,
    autoPosted: false,
  }
  store.auditEvents.set(full.id, full)
}

/** Optional hook to push staged lines into documents bank_transactions. */
export type BankFeedTransactionImporter = (input: {
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
}) => Promise<{ id: string; duplicate: boolean }>

function suggestForLine(line: BankFeedBankLine): {
  kind: BankFeedSuggestion['kind']
  confidence: number
  reason: string
  suggestedAccountId?: string
  suggestedCounterpartyName?: string
} {
  const d = line.description.toLowerCase()
  if (d.includes('rent')) {
    return {
      kind: 'suggest_expense_account',
      confidence: 0.88,
      reason: 'Description contains rent — suggest premises expense (human accept only)',
      suggestedAccountId: 'acc_rent_expense',
    }
  }
  if (d.includes('vodacom') || d.includes('telkom') || d.includes('mtn')) {
    return {
      kind: 'suggest_expense_account',
      confidence: 0.8,
      reason: 'Telecoms debit order pattern',
      suggestedAccountId: 'acc_telecoms',
    }
  }
  if (d.includes('sars') || d.includes('paye')) {
    return {
      kind: 'flag_review',
      confidence: 0.9,
      reason: 'SARS-related movement — review only; no payment initiation',
    }
  }
  if (line.amountMinor > 0 && (d.includes('eft from') || d.includes('salary') || d.includes('client'))) {
    return {
      kind: 'suggest_counterparty',
      confidence: 0.7,
      reason: 'Inbound EFT — suggest counterparty match',
      suggestedCounterpartyName: line.counterpartyName || 'Unknown payer',
    }
  }
  if (d.includes('fee') || d.includes('fnb') || d.includes('absa') || d.includes('nedbank') || d.includes('standard bank')) {
    return {
      kind: 'suggest_expense_account',
      confidence: 0.75,
      reason: 'Bank fee pattern',
      suggestedAccountId: 'acc_bank_charges',
    }
  }
  return {
    kind: 'flag_review',
    confidence: 0.4,
    reason: 'No strong rule match — queue for human coding',
  }
}

export interface CreateBankFeedConnectionCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  providerId?: BankFeedProviderId
  label: string
  bankAccountId: string
  externalAccountId?: string
  secretRefId?: string
  status?: BankFeedConnectionStatus
  requestId: string
  idempotencyKey: string
}

export interface SyncBankFeedCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  connectionId: string
  /** Force noEgress (default true). Live providers blocked when true. */
  noEgress?: boolean
  requestId: string
  idempotencyKey: string
}

export interface ResolveBankFeedSuggestionCommand {
  id: string
  orgId: string
  resolutionNote?: string
  requestId: string
  idempotencyKey: string
}

export interface DisconnectBankFeedCommand {
  id: string
  orgId: string
  requestId: string
  idempotencyKey: string
}

export class BankFeedFinanceService {
  constructor(
    private readonly load: () => Promise<BankFeedStore>,
    private readonly save: (before: BankFeedStore, after: BankFeedStore) => Promise<void>,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly adapters: Record<BankFeedProviderId, BankFeedAdapterFactory> = createBankFeedAdapterRegistry(),
    private readonly importBankTxn?: BankFeedTransactionImporter,
  ) {}

  private adapter(providerId: BankFeedProviderId): BankFeedConnectorAdapter {
    return resolveBankFeedAdapter(providerId, this.adapters)
  }

  async createConnection(actor: FinanceActorContext, command: CreateBankFeedConnectionCommand): Promise<BankFeedConnection> {
    assertFinanceMembership(actor, command.orgId, 'bank_feed.connection.configure')
    const id = requiredText(command.id, 'id')
    const orgId = requiredText(command.orgId, 'orgId')
    const legalEntityId = requiredText(command.legalEntityId, 'legalEntityId')
    const bookId = requiredText(command.bookId, 'bookId')
    const label = requiredText(command.label, 'label')
    const bankAccountId = requiredText(command.bankAccountId, 'bankAccountId')
    const providerId: BankFeedProviderId = command.providerId || 'mock'
    if (providerId !== 'mock' && providerId !== 'live_stub') {
      throw new BankFeedValidationError('Unsupported providerId')
    }
    if (providerId !== 'mock' && !command.secretRefId?.trim()) {
      throw new BankFeedValidationError('secretRefId is required for non-mock providers (approved secret pattern only)')
    }
    if (providerId === 'mock' && command.secretRefId) {
      throw new BankFeedValidationError('mock provider must not carry secretRefId')
    }

    const before = await this.load()
    const store = cloneBankFeedStore(before)
    claim(store, `idem:${orgId}:${command.idempotencyKey}`, 'Duplicate bank feed connection request')
    if (store.connections.has(id)) throw new BankFeedValidationError('Bank feed connection already exists')

    const ts = this.now()
    // Optionally discover mock external account when not provided.
    let externalAccountId = command.externalAccountId?.trim()
    if (!externalAccountId && providerId === 'mock') {
      const adapter = this.adapter(providerId)
      const accounts = await adapter.listAccounts({
        orgId,
        legalEntityId,
        bookId,
        connectionId: id,
        nowIso: ts,
        noEgress: true,
      })
      externalAccountId = accounts[0]?.externalAccountId
    }

    const connection: BankFeedConnection = {
      id,
      orgId,
      legalEntityId,
      bookId,
      providerId,
      label,
      status: command.status === 'draft' ? 'draft' : 'connected',
      bankAccountId,
      ...(externalAccountId ? { externalAccountId } : {}),
      ...(command.secretRefId?.trim() ? { secretRefId: command.secretRefId.trim() } : {}),
      schemaVersion: 1,
      version: 1,
      createdBy: actor.uid,
      createdAt: ts,
      updatedBy: actor.uid,
      updatedAt: ts,
      externalEgressAllowed: false,
      externalPaymentInitiated: false,
      sarsSubmissionInitiated: false,
      noEgress: true,
    }
    store.connections.set(id, connection)
    appendAudit(store, {
      id: `aud_${id}_create`,
      orgId,
      legalEntityId,
      bookId,
      connectionId: id,
      eventType: 'connection.created',
      actorId: actor.uid,
      at: ts,
      detail: `Created ${providerId} connection "${label}" (noEgress, no payment initiate)`,
    })
    await this.save(before, store)
    return connection
  }

  async disconnectConnection(actor: FinanceActorContext, command: DisconnectBankFeedCommand): Promise<BankFeedConnection> {
    assertFinanceMembership(actor, command.orgId, 'bank_feed.connection.configure')
    const id = requiredText(command.id, 'id')
    const orgId = requiredText(command.orgId, 'orgId')
    const before = await this.load()
    const store = cloneBankFeedStore(before)
    claim(store, `idem:${orgId}:${command.idempotencyKey}`, 'Duplicate bank feed disconnect')
    const existing = store.connections.get(id)
    if (!existing || existing.orgId !== orgId) throw new BankFeedNotFoundError('Bank feed connection not found')
    const ts = this.now()
    const next: BankFeedConnection = {
      ...existing,
      status: 'disconnected',
      version: existing.version + 1,
      updatedAt: ts,
      updatedBy: actor.uid,
      externalEgressAllowed: false,
      externalPaymentInitiated: false,
      sarsSubmissionInitiated: false,
      noEgress: true,
    }
    store.connections.set(id, next)
    appendAudit(store, {
      id: `aud_${id}_disc_${existing.version + 1}`,
      orgId,
      legalEntityId: existing.legalEntityId,
      bookId: existing.bookId,
      connectionId: id,
      eventType: 'connection.disconnected',
      actorId: actor.uid,
      at: ts,
      detail: 'Connection disconnected',
    })
    await this.save(before, store)
    return next
  }

  async syncNow(
    actor: FinanceActorContext,
    command: SyncBankFeedCommand,
  ): Promise<{ run: BankFeedSyncRun; lines: BankFeedBankLine[]; suggestions: BankFeedSuggestion[] }> {
    assertFinanceMembership(actor, command.orgId, 'bank_feed.sync')
    const runId = requiredText(command.id, 'id')
    const orgId = requiredText(command.orgId, 'orgId')
    const legalEntityId = requiredText(command.legalEntityId, 'legalEntityId')
    const bookId = requiredText(command.bookId, 'bookId')
    const connectionId = requiredText(command.connectionId, 'connectionId')
    const noEgress = command.noEgress !== false // default true

    const before = await this.load()
    const store = cloneBankFeedStore(before)
    claim(store, `idem:${orgId}:${command.idempotencyKey}`, 'Duplicate bank feed sync request')

    const connection = store.connections.get(connectionId)
    if (
      !connection ||
      connection.orgId !== orgId ||
      connection.legalEntityId !== legalEntityId ||
      connection.bookId !== bookId
    ) {
      throw new BankFeedNotFoundError('Bank feed connection not found')
    }
    if (connection.status === 'disconnected') {
      throw new BankFeedValidationError('Cannot sync a disconnected connection')
    }
    if (!connection.externalAccountId) {
      throw new BankFeedValidationError('Connection has no externalAccountId — list/select provider account first')
    }

    const ts = this.now()
    const run: BankFeedSyncRun = {
      id: runId,
      orgId,
      legalEntityId,
      bookId,
      connectionId,
      providerId: connection.providerId,
      status: 'running',
      startedAt: ts,
      cursorBefore: connection.cursor,
      fetchedCount: 0,
      stagedCount: 0,
      importedCount: 0,
      duplicateCount: 0,
      errorCount: 0,
      suggestionCount: 0,
      triggeredBy: actor.uid,
      schemaVersion: 1,
      version: 1,
      autoPosted: false,
      externalPaymentInitiated: false,
      externalEgressAllowed: false,
      noEgress: true,
    }
    store.syncRuns.set(runId, run)
    store.connections.set(connectionId, {
      ...connection,
      status: 'syncing',
      version: connection.version + 1,
      updatedAt: ts,
      updatedBy: actor.uid,
      lastError: undefined,
      noEgress: true,
      externalEgressAllowed: false,
      externalPaymentInitiated: false,
      sarsSubmissionInitiated: false,
    })
    appendAudit(store, {
      id: `aud_${runId}_start`,
      orgId,
      legalEntityId,
      bookId,
      connectionId,
      syncRunId: runId,
      eventType: 'sync.started',
      actorId: actor.uid,
      at: ts,
      detail: `Sync started provider=${connection.providerId} noEgress=${noEgress}`,
    })
    // Persist running state before adapter work (in-memory this is one save at end).

    const adapter = this.adapter(connection.providerId)
    let fetched
    try {
      fetched = await adapter.fetchTransactions(
        {
          orgId,
          legalEntityId,
          bookId,
          connectionId,
          secretRefId: connection.secretRefId,
          nowIso: ts,
          noEgress,
        },
        connection.externalAccountId,
        { value: connection.cursor },
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sync fetch failed'
      const failed: BankFeedSyncRun = {
        ...run,
        status: 'failed',
        finishedAt: this.now(),
        errorMessage: msg,
        version: 2,
        autoPosted: false,
        externalPaymentInitiated: false,
        externalEgressAllowed: false,
        noEgress: true,
      }
      store.syncRuns.set(runId, failed)
      store.connections.set(connectionId, {
        ...store.connections.get(connectionId)!,
        status: 'error',
        lastError: msg,
        lastSyncAt: failed.finishedAt,
        lastSyncRunId: runId,
        version: connection.version + 2,
        updatedAt: failed.finishedAt!,
        updatedBy: actor.uid,
        noEgress: true,
        externalEgressAllowed: false,
        externalPaymentInitiated: false,
        sarsSubmissionInitiated: false,
      })
      appendAudit(store, {
        id: `aud_${runId}_fail`,
        orgId,
        legalEntityId,
        bookId,
        connectionId,
        syncRunId: runId,
        eventType: 'sync.failed',
        actorId: actor.uid,
        at: failed.finishedAt!,
        detail: msg,
      })
      await this.save(before, store)
      throw err instanceof BankFeedValidationError ? err : new BankFeedValidationError(msg)
    }

    const mapped = adapter.mapToBankLines({
      orgId,
      legalEntityId,
      bookId,
      connectionId,
      syncRunId: runId,
      bankAccountId: connection.bankAccountId,
      transactions: fetched.transactions,
      actorId: actor.uid,
      nowIso: ts,
    })

    let staged = 0
    let imported = 0
    let duplicates = 0
    let errors = 0
    const createdSuggestions: BankFeedSuggestion[] = []
    const createdLines: BankFeedBankLine[] = []

    for (const line of mapped) {
      // Skip if line already exists
      if (store.lines.has(line.id)) {
        duplicates++
        continue
      }
      const fpKey = `${orgId}|${line.bankAccountId}|${line.sourceFingerprint}`
      let nextLine: BankFeedBankLine = { ...line }

      if (store.importedFingerprints.has(fpKey)) {
        nextLine = { ...nextLine, importStatus: 'duplicate' }
        duplicates++
      } else if (this.importBankTxn) {
        try {
          const result = await this.importBankTxn({
            actor,
            orgId: line.orgId,
            legalEntityId: line.legalEntityId,
            bookId: line.bookId,
            bankAccountId: line.bankAccountId,
            id: `btx_${line.sourceFingerprint}`.slice(0, 80),
            statementDate: line.statementDate,
            effectiveDate: line.effectiveDate,
            amountMinor: line.amountMinor,
            description: line.description,
            sourceFingerprint: line.sourceFingerprint,
            reference: line.reference,
            counterpartyName: line.counterpartyName,
            requestId: `${command.requestId}:${line.externalTransactionId}`,
            idempotencyKey: `${command.idempotencyKey}:${line.sourceFingerprint}`,
          })
          store.importedFingerprints.add(fpKey)
          nextLine = {
            ...nextLine,
            importStatus: result.duplicate ? 'duplicate' : 'imported',
            bankTransactionId: result.id,
          }
          if (result.duplicate) duplicates++
          else imported++
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Import failed'
          if (/already imported|fingerprint|already exists|duplicate/i.test(msg)) {
            store.importedFingerprints.add(fpKey)
            nextLine = { ...nextLine, importStatus: 'duplicate', errorMessage: msg }
            duplicates++
          } else {
            nextLine = { ...nextLine, importStatus: 'error', errorMessage: msg }
            errors++
          }
        }
      } else {
        // In-memory proving path: mark imported into feed store only (observation).
        store.importedFingerprints.add(fpKey)
        nextLine = {
          ...nextLine,
          importStatus: 'imported',
          bankTransactionId: `btx_${line.sourceFingerprint}`.slice(0, 80),
        }
        imported++
      }

      staged++
      store.lines.set(nextLine.id, nextLine)
      createdLines.push(nextLine)

      // Bank-rules style suggestions — NEVER auto-post.
      if (nextLine.importStatus === 'imported' || nextLine.importStatus === 'staged') {
        const hint = suggestForLine(nextLine)
        const suggestion: BankFeedSuggestion = {
          id: `bfs_${runId}_${nextLine.id}`.slice(0, 120),
          orgId,
          legalEntityId,
          bookId,
          connectionId,
          syncRunId: runId,
          bankLineId: nextLine.id,
          ...(nextLine.bankTransactionId ? { bankTransactionId: nextLine.bankTransactionId } : {}),
          status: 'pending',
          kind: hint.kind,
          confidence: hint.confidence,
          reason: hint.reason,
          ...(hint.suggestedAccountId ? { suggestedAccountId: hint.suggestedAccountId } : {}),
          ...(hint.suggestedCounterpartyName
            ? { suggestedCounterpartyName: hint.suggestedCounterpartyName }
            : {}),
          createdBy: actor.uid,
          createdAt: ts,
          schemaVersion: 1,
          version: 1,
          autoPosted: false,
          externalPaymentInitiated: false,
        }
        store.suggestions.set(suggestion.id, suggestion)
        createdSuggestions.push(suggestion)
      }
    }

    const finishedAt = this.now()
    const status: BankFeedSyncRun['status'] =
      errors > 0 && imported + duplicates > 0 ? 'partial' : errors > 0 && imported === 0 ? 'failed' : 'succeeded'
    const finished: BankFeedSyncRun = {
      ...run,
      status,
      finishedAt,
      cursorAfter: fetched.nextCursor || connection.cursor,
      fetchedCount: fetched.transactions.length,
      stagedCount: staged,
      importedCount: imported,
      duplicateCount: duplicates,
      errorCount: errors,
      suggestionCount: createdSuggestions.length,
      version: 2,
      autoPosted: false,
      externalPaymentInitiated: false,
      externalEgressAllowed: false,
      noEgress: true,
    }
    store.syncRuns.set(runId, finished)

    const connNow = store.connections.get(connectionId)!
    store.connections.set(connectionId, {
      ...connNow,
      status: status === 'failed' ? 'error' : 'connected',
      cursor: finished.cursorAfter,
      lastSyncAt: finishedAt,
      lastSyncRunId: runId,
      lastError: status === 'failed' ? 'Sync completed with errors' : undefined,
      version: connNow.version + 1,
      updatedAt: finishedAt,
      updatedBy: actor.uid,
      noEgress: true,
      externalEgressAllowed: false,
      externalPaymentInitiated: false,
      sarsSubmissionInitiated: false,
    })
    appendAudit(store, {
      id: `aud_${runId}_done`,
      orgId,
      legalEntityId,
      bookId,
      connectionId,
      syncRunId: runId,
      eventType: 'sync.finished',
      actorId: actor.uid,
      at: finishedAt,
      detail: `Sync ${status}: fetched=${finished.fetchedCount} imported=${imported} suggestions=${createdSuggestions.length} autoPosted=false`,
    })

    await this.save(before, store)
    return { run: finished, lines: createdLines, suggestions: createdSuggestions }
  }

  async acceptSuggestion(actor: FinanceActorContext, command: ResolveBankFeedSuggestionCommand): Promise<BankFeedSuggestion> {
    return this.resolveSuggestion(actor, command, 'accepted', 'bank_feed.suggestion.accept')
  }

  async dismissSuggestion(actor: FinanceActorContext, command: ResolveBankFeedSuggestionCommand): Promise<BankFeedSuggestion> {
    return this.resolveSuggestion(actor, command, 'dismissed', 'bank_feed.suggestion.dismiss')
  }

  private async resolveSuggestion(
    actor: FinanceActorContext,
    command: ResolveBankFeedSuggestionCommand,
    status: 'accepted' | 'dismissed',
    action: BankFeedFinanceAction,
  ): Promise<BankFeedSuggestion> {
    assertFinanceMembership(actor, command.orgId, action)
    const id = requiredText(command.id, 'id')
    const orgId = requiredText(command.orgId, 'orgId')
    const before = await this.load()
    const store = cloneBankFeedStore(before)
    claim(store, `idem:${orgId}:${command.idempotencyKey}`, 'Duplicate bank feed suggestion resolve')
    const existing = store.suggestions.get(id)
    if (!existing || existing.orgId !== orgId) throw new BankFeedNotFoundError('Bank feed suggestion not found')
    if (existing.status !== 'pending') throw new BankFeedValidationError('Suggestion is not pending')

    // HUMAN GATE ONLY — never post journals, never initiate payments.
    const ts = this.now()
    const next: BankFeedSuggestion = {
      ...existing,
      status,
      resolvedAt: ts,
      resolvedBy: actor.uid,
      resolutionNote: command.resolutionNote?.trim() || undefined,
      version: existing.version + 1,
      autoPosted: false,
      externalPaymentInitiated: false,
    }
    store.suggestions.set(id, next)
    appendAudit(store, {
      id: `aud_${id}_${status}`,
      orgId,
      legalEntityId: existing.legalEntityId,
      bookId: existing.bookId,
      connectionId: existing.connectionId,
      syncRunId: existing.syncRunId,
      eventType: status === 'accepted' ? 'suggestion.accepted' : 'suggestion.dismissed',
      actorId: actor.uid,
      at: ts,
      detail: `${status} suggestion ${id} (still autoPosted=false, externalPaymentInitiated=false)`,
    })
    await this.save(before, store)
    return next
  }

  async getBundle(
    actor: FinanceActorContext,
    orgId: string,
    legalEntityId: string,
    bookId: string,
  ): Promise<{
    connections: BankFeedConnection[]
    syncRuns: BankFeedSyncRun[]
    lines: BankFeedBankLine[]
    suggestions: BankFeedSuggestion[]
    auditEvents: BankFeedAuditEvent[]
    hardGates: {
      noEgress: true
      autoPosted: false
      externalPaymentInitiated: false
      externalEgressAllowed: false
      sarsSubmissionInitiated: false
    }
  }> {
    assertFinanceMembership(actor, orgId, 'bank_feed.connection.read')
    const store = await this.load()
    const inScope = <T extends { orgId: string; legalEntityId: string; bookId: string }>(rows: T[]) =>
      rows.filter((r) => r.orgId === orgId && r.legalEntityId === legalEntityId && r.bookId === bookId)

    return {
      connections: inScope([...store.connections.values()]).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      syncRuns: inScope([...store.syncRuns.values()]).sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
      lines: inScope([...store.lines.values()]).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate)),
      suggestions: inScope([...store.suggestions.values()]).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      auditEvents: inScope([...store.auditEvents.values()]).sort((a, b) => b.at.localeCompare(a.at)),
      hardGates: {
        noEgress: true,
        autoPosted: false,
        externalPaymentInitiated: false,
        externalEgressAllowed: false,
        sarsSubmissionInitiated: false,
      },
    }
  }

  async listProviderAccounts(
    actor: FinanceActorContext,
    input: { orgId: string; legalEntityId: string; bookId: string; connectionId: string },
  ) {
    assertFinanceMembership(actor, input.orgId, 'bank_feed.connection.read')
    const store = await this.load()
    const connection = store.connections.get(input.connectionId)
    if (
      !connection ||
      connection.orgId !== input.orgId ||
      connection.legalEntityId !== input.legalEntityId ||
      connection.bookId !== input.bookId
    ) {
      throw new BankFeedNotFoundError('Bank feed connection not found')
    }
    const adapter = this.adapter(connection.providerId)
    return adapter.listAccounts({
      orgId: input.orgId,
      legalEntityId: input.legalEntityId,
      bookId: input.bookId,
      connectionId: connection.id,
      secretRefId: connection.secretRefId,
      nowIso: this.now(),
      noEgress: true,
    })
  }
}
