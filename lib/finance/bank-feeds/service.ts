import { FinanceAuthorizationError } from '@/lib/finance/policy'
import type { FinanceActorContext } from '@/lib/finance/types'
import {
  resolveBankFeedAdapter,
  createBankFeedAdapterRegistry,
  type BankFeedAdapterFactory,
  type BankFeedConnectorAdapter,
} from './adapter'
import {
  BankFeedCredentialVaultError,
  BankFeedCredentialVaultStub,
  createEmptyBankFeedCredentialVault,
  looksLikeInlineSecret,
} from './credential-vault-stub'
import {
  buildAccountFeedFromProvider,
  buildReconCentre,
  computeConnectionHealth,
  isSafeBulkAcceptSuggestion,
  markLinesMaterialized,
  normalizeLinkedAccounts,
  toBankRulesEvaluatePayload,
} from './productization'
import {
  bankFeedProviderSettingsHardGates,
  defaultBankFeedOrgProviderSettings,
  normalizeBankFeedOrgProviderSettings,
  resolveConnectionProviderId,
  type BankFeedOrgProviderSettings,
  BankFeedProviderSettingsError,
} from './provider-settings'
import { ZaAggregatorStubBankFeedProvider } from './providers/za-aggregator-stub'
import type {
  BankFeedAccountFeed,
  BankFeedAuditEvent,
  BankFeedBankLine,
  BankFeedConnection,
  BankFeedConnectionStatus,
  BankFeedFinanceAction,
  BankFeedProviderId,
  BankFeedReconCentre,
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
    action === 'bank_feed.connection.read' ||
    action === 'bank_feed.audit.read' ||
    action === 'bank_feed.recon.read'
      ? readRoles
      : writeRoles
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
  /** Org provider selection feature flags (mock default). */
  providerSettingsByOrg: Map<string, BankFeedOrgProviderSettings>
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
    providerSettingsByOrg: new Map(),
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
    providerSettingsByOrg: new Map(store.providerSettingsByOrg ?? []),
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
  if (d.includes('interest')) {
    return {
      kind: 'suggest_expense_account',
      confidence: 0.82,
      reason: 'Interest credit pattern — suggest interest income (human accept only)',
      suggestedAccountId: 'acc_interest_income',
    }
  }
  return {
    kind: 'flag_review',
    confidence: 0.4,
    reason: 'No strong rule match — queue for human coding',
  }
}

const SUPPORTED_PROVIDERS = new Set<BankFeedProviderId>(['mock', 'live_stub', 'za_aggregator_stub'])

export interface CreateBankFeedConnectionCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  providerId?: BankFeedProviderId
  label: string
  bankAccountId: string
  externalAccountId?: string
  /** Optional multi-account links: externalAccountId → bankAccountId (defaults to bankAccountId). */
  accountLinks?: Array<{ externalAccountId: string; bankAccountId?: string }>
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
  /** When set, sync only this external account; otherwise all active linked accounts. */
  externalAccountId?: string
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

export interface BulkResolveBankFeedSuggestionsCommand {
  orgId: string
  legalEntityId: string
  bookId: string
  /** accept | dismiss */
  resolution: 'accept' | 'dismiss'
  /** When empty on accept, resolves only safeBulkAccept candidates. On dismiss, all pending when empty. */
  suggestionIds?: string[]
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

export interface ReconnectBankFeedCommand {
  id: string
  orgId: string
  requestId: string
  idempotencyKey: string
}

export interface RefreshBankFeedAccountsCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  /** Default bank account for newly discovered provider accounts. */
  defaultBankAccountId?: string
  /** Explicit external→bank mappings. */
  accountLinks?: Array<{ externalAccountId: string; bankAccountId?: string }>
  requestId: string
  idempotencyKey: string
}

export class BankFeedFinanceService {
  private readonly adapters: Record<BankFeedProviderId, BankFeedAdapterFactory>
  private readonly vault: BankFeedCredentialVaultStub

  constructor(
    private readonly load: () => Promise<BankFeedStore>,
    private readonly save: (before: BankFeedStore, after: BankFeedStore) => Promise<void>,
    private readonly now: () => string = () => new Date().toISOString(),
    adapters?: Record<BankFeedProviderId, BankFeedAdapterFactory>,
    private readonly importBankTxn?: BankFeedTransactionImporter,
    vault?: BankFeedCredentialVaultStub,
  ) {
    this.vault = vault ?? createEmptyBankFeedCredentialVault()
    this.adapters =
      adapters ??
      createBankFeedAdapterRegistry({
        za_aggregator_stub: () => new ZaAggregatorStubBankFeedProvider(this.vault),
      })
  }

  private adapter(providerId: BankFeedProviderId): BankFeedConnectorAdapter {
    return resolveBankFeedAdapter(providerId, this.adapters)
  }

  private settingsForOrg(store: BankFeedStore, orgId: string): BankFeedOrgProviderSettings {
    return store.providerSettingsByOrg.get(orgId) ?? defaultBankFeedOrgProviderSettings(orgId, this.now())
  }

  async getProviderSettings(actor: FinanceActorContext, orgId: string): Promise<BankFeedOrgProviderSettings> {
    assertFinanceMembership(actor, orgId, 'bank_feed.connection.read')
    const store = await this.load()
    return this.settingsForOrg(store, orgId)
  }

  async updateProviderSettings(
    actor: FinanceActorContext,
    command: {
      orgId: string
      defaultProviderId?: BankFeedProviderId
      enabledProviderIds?: BankFeedProviderId[]
      allowNonMockProviders?: boolean
      allowLiveEgress?: boolean
      requestId: string
      idempotencyKey: string
    },
  ): Promise<BankFeedOrgProviderSettings> {
    assertFinanceMembership(actor, command.orgId, 'bank_feed.connection.configure')
    const orgId = requiredText(command.orgId, 'orgId')
    const before = await this.load()
    const store = cloneBankFeedStore(before)
    claim(store, `idem:${orgId}:provider-settings:${command.idempotencyKey}`, 'Duplicate provider settings update')
    const previous = this.settingsForOrg(store, orgId)
    let next: BankFeedOrgProviderSettings
    try {
      next = normalizeBankFeedOrgProviderSettings({
        orgId,
        defaultProviderId: command.defaultProviderId,
        enabledProviderIds: command.enabledProviderIds,
        allowNonMockProviders: command.allowNonMockProviders,
        allowLiveEgress: command.allowLiveEgress,
        updatedBy: actor.uid,
        nowIso: this.now(),
        previous,
      })
    } catch (err) {
      if (err instanceof BankFeedProviderSettingsError) {
        throw new BankFeedValidationError(err.message)
      }
      throw err
    }
    store.providerSettingsByOrg.set(orgId, next)
    await this.save(before, store)
    return next
  }

  getCredentialVault(): BankFeedCredentialVaultStub {
    return this.vault
  }

  async createConnection(actor: FinanceActorContext, command: CreateBankFeedConnectionCommand): Promise<BankFeedConnection> {
    assertFinanceMembership(actor, command.orgId, 'bank_feed.connection.configure')
    const id = requiredText(command.id, 'id')
    const orgId = requiredText(command.orgId, 'orgId')
    const legalEntityId = requiredText(command.legalEntityId, 'legalEntityId')
    const bookId = requiredText(command.bookId, 'bookId')
    const label = requiredText(command.label, 'label')
    const bankAccountId = requiredText(command.bankAccountId, 'bankAccountId')

    const before = await this.load()
    const store = cloneBankFeedStore(before)
    const settings = this.settingsForOrg(store, orgId)
    let providerId: BankFeedProviderId
    try {
      providerId = resolveConnectionProviderId(settings, command.providerId)
    } catch (err) {
      if (err instanceof BankFeedProviderSettingsError) {
        throw new BankFeedValidationError(err.message)
      }
      throw err
    }
    if (!SUPPORTED_PROVIDERS.has(providerId)) {
      throw new BankFeedValidationError('Unsupported providerId')
    }
    if (providerId !== 'mock' && !command.secretRefId?.trim()) {
      throw new BankFeedValidationError('secretRefId is required for non-mock providers (approved secret pattern only)')
    }
    if (providerId === 'mock' && command.secretRefId) {
      throw new BankFeedValidationError('mock provider must not carry secretRefId')
    }
    if (command.secretRefId && looksLikeInlineSecret(command.secretRefId)) {
      throw new BankFeedValidationError('secretRefId must be an opaque reference id, not inline credential material')
    }
    if (providerId === 'za_aggregator_stub') {
      try {
        this.vault.assertUsableForProvider({
          orgId,
          secretRefId: command.secretRefId,
          providerId,
        })
      } catch (err) {
        if (err instanceof BankFeedCredentialVaultError) {
          throw new BankFeedValidationError(err.message)
        }
        throw err
      }
    }

    claim(store, `idem:${orgId}:${command.idempotencyKey}`, 'Duplicate bank feed connection request')
    if (store.connections.has(id)) throw new BankFeedValidationError('Bank feed connection already exists')

    const ts = this.now()
    let linkedAccounts: BankFeedAccountFeed[] = []
    let externalAccountId = command.externalAccountId?.trim()

    if (providerId === 'mock') {
      const adapter = this.adapter(providerId)
      const accounts = await adapter.listAccounts({
        orgId,
        legalEntityId,
        bookId,
        connectionId: id,
        nowIso: ts,
        noEgress: true,
      })
      const linkMap = new Map(
        (command.accountLinks || []).map((l) => [l.externalAccountId, l.bankAccountId?.trim() || bankAccountId]),
      )
      // When operator picks a single external account, still link only that one; else multi-account catalogue.
      const selected = externalAccountId
        ? accounts.filter((a) => a.externalAccountId === externalAccountId)
        : accounts
      const useAccounts = selected.length > 0 ? selected : accounts.slice(0, 1)
      linkedAccounts = useAccounts.map((a) =>
        buildAccountFeedFromProvider({
          externalAccountId: a.externalAccountId,
          name: a.name,
          currency: a.currency,
          maskedAccountNumber: a.maskedAccountNumber,
          accountType: a.accountType,
          bankAccountId: linkMap.get(a.externalAccountId) || bankAccountId,
          status: 'active',
        }),
      )
      if (!externalAccountId) externalAccountId = linkedAccounts[0]?.externalAccountId
    } else if (externalAccountId) {
      linkedAccounts = [
        buildAccountFeedFromProvider({
          externalAccountId,
          name: label,
          currency: 'ZAR',
          bankAccountId,
          status: 'active',
        }),
      ]
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
      ...(linkedAccounts.length ? { linkedAccounts } : {}),
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
      detail: `Created ${providerId} connection "${label}" accounts=${linkedAccounts.length} (noEgress, no payment initiate)`,
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
    const linked = normalizeLinkedAccounts(existing).map((a) => ({
      ...a,
      status: 'disconnected' as const,
      lastError: undefined,
    }))
    const next: BankFeedConnection = {
      ...existing,
      status: 'disconnected',
      linkedAccounts: linked,
      lastError: undefined,
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

  async reconnectConnection(actor: FinanceActorContext, command: ReconnectBankFeedCommand): Promise<BankFeedConnection> {
    assertFinanceMembership(actor, command.orgId, 'bank_feed.connection.configure')
    const id = requiredText(command.id, 'id')
    const orgId = requiredText(command.orgId, 'orgId')
    const before = await this.load()
    const store = cloneBankFeedStore(before)
    claim(store, `idem:${orgId}:${command.idempotencyKey}`, 'Duplicate bank feed reconnect')
    const existing = store.connections.get(id)
    if (!existing || existing.orgId !== orgId) throw new BankFeedNotFoundError('Bank feed connection not found')
    const ts = this.now()
    const linked = normalizeLinkedAccounts(existing).map((a) => ({
      ...a,
      status: 'active' as const,
      lastError: undefined,
    }))
    const next: BankFeedConnection = {
      ...existing,
      status: 'connected',
      lastError: undefined,
      linkedAccounts: linked,
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
      id: `aud_${id}_reconn_${existing.version + 1}`,
      orgId,
      legalEntityId: existing.legalEntityId,
      bookId: existing.bookId,
      connectionId: id,
      eventType: 'connection.reconnected',
      actorId: actor.uid,
      at: ts,
      detail: 'Connection reconnected — error cleared; ready for Sync now (no auto-post)',
    })
    await this.save(before, store)
    return next
  }

  async refreshLinkedAccounts(
    actor: FinanceActorContext,
    command: RefreshBankFeedAccountsCommand,
  ): Promise<BankFeedConnection> {
    assertFinanceMembership(actor, command.orgId, 'bank_feed.connection.configure')
    const id = requiredText(command.id, 'id')
    const orgId = requiredText(command.orgId, 'orgId')
    const legalEntityId = requiredText(command.legalEntityId, 'legalEntityId')
    const bookId = requiredText(command.bookId, 'bookId')
    const before = await this.load()
    const store = cloneBankFeedStore(before)
    claim(store, `idem:${orgId}:${command.idempotencyKey}`, 'Duplicate bank feed account refresh')
    const existing = store.connections.get(id)
    if (
      !existing ||
      existing.orgId !== orgId ||
      existing.legalEntityId !== legalEntityId ||
      existing.bookId !== bookId
    ) {
      throw new BankFeedNotFoundError('Bank feed connection not found')
    }
    if (existing.status === 'disconnected') {
      throw new BankFeedValidationError('Reconnect before refreshing linked accounts')
    }

    const ts = this.now()
    const adapter = this.adapter(existing.providerId)
    const providerAccounts = await adapter.listAccounts({
      orgId,
      legalEntityId,
      bookId,
      connectionId: id,
      secretRefId: existing.secretRefId,
      nowIso: ts,
      noEgress: true,
    })
    const prior = normalizeLinkedAccounts(existing)
    const priorByExt = new Map(prior.map((a) => [a.externalAccountId, a]))
    const defaultBank = command.defaultBankAccountId?.trim() || existing.bankAccountId
    const linkMap = new Map(
      (command.accountLinks || []).map((l) => [l.externalAccountId, l.bankAccountId?.trim() || defaultBank]),
    )

    const linkedAccounts: BankFeedAccountFeed[] = providerAccounts.map((a) => {
      const prev = priorByExt.get(a.externalAccountId)
      return buildAccountFeedFromProvider({
        externalAccountId: a.externalAccountId,
        name: a.name,
        currency: a.currency,
        maskedAccountNumber: a.maskedAccountNumber,
        accountType: a.accountType,
        bankAccountId: linkMap.get(a.externalAccountId) || prev?.bankAccountId || defaultBank,
        status: prev?.status === 'paused' ? 'paused' : 'active',
        cursor: prev?.cursor,
        lastSyncAt: prev?.lastSyncAt,
        lastSyncRunId: prev?.lastSyncRunId,
        lastError: undefined,
      })
    })

    const next: BankFeedConnection = {
      ...existing,
      linkedAccounts,
      externalAccountId: existing.externalAccountId || linkedAccounts[0]?.externalAccountId,
      bankAccountId: existing.bankAccountId || linkedAccounts[0]?.bankAccountId || defaultBank,
      version: existing.version + 1,
      updatedAt: ts,
      updatedBy: actor.uid,
      noEgress: true,
      externalEgressAllowed: false,
      externalPaymentInitiated: false,
      sarsSubmissionInitiated: false,
    }
    store.connections.set(id, next)
    appendAudit(store, {
      id: `aud_${id}_accts_${existing.version + 1}`,
      orgId,
      legalEntityId,
      bookId,
      connectionId: id,
      eventType: 'accounts.linked',
      actorId: actor.uid,
      at: ts,
      detail: `Linked ${linkedAccounts.length} provider accounts (per-account cursor/status)`,
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
      throw new BankFeedValidationError('Cannot sync a disconnected connection — reconnect first')
    }

    const accounts = normalizeLinkedAccounts(connection)
    let targets = accounts.filter((a) => a.status === 'active' || a.status === 'error')
    const externalAccountIdFilter = command.externalAccountId?.trim()
    if (externalAccountIdFilter) {
      targets = targets.filter((a) => a.externalAccountId === externalAccountIdFilter)
    }
    if (targets.length === 0 && connection.externalAccountId) {
      targets = [
        buildAccountFeedFromProvider({
          externalAccountId: connection.externalAccountId,
          name: connection.label,
          currency: 'ZAR',
          bankAccountId: connection.bankAccountId,
          status: 'active',
          cursor: connection.cursor,
        }),
      ]
    }
    if (targets.length === 0) {
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
      cursorBefore: targets.map((t) => t.cursor || '').join(',') || connection.cursor,
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
      detail: `Sync started provider=${connection.providerId} accounts=${targets.length} noEgress=${noEgress}`,
    })

    const adapter = this.adapter(connection.providerId)
    let staged = 0
    let imported = 0
    let duplicates = 0
    let errors = 0
    let fetchedTotal = 0
    const createdSuggestions: BankFeedSuggestion[] = []
    const createdLines: BankFeedBankLine[] = []
    const updatedAccounts = normalizeLinkedAccounts(connection)
    const accountByExt = new Map(updatedAccounts.map((a) => [a.externalAccountId, { ...a }]))
    const cursorAfterParts: string[] = []
    let hardFailMessage: string | undefined

    for (const target of targets) {
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
          target.externalAccountId,
          { value: target.cursor },
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Sync fetch failed'
        hardFailMessage = msg
        const acc = accountByExt.get(target.externalAccountId)
        if (acc) {
          accountByExt.set(target.externalAccountId, {
            ...acc,
            status: 'error',
            lastError: msg,
            lastSyncAt: this.now(),
            lastSyncRunId: runId,
          })
        }
        errors++
        continue
      }

      fetchedTotal += fetched.transactions.length
      const mapped = adapter.mapToBankLines({
        orgId,
        legalEntityId,
        bookId,
        connectionId,
        syncRunId: runId,
        bankAccountId: target.bankAccountId,
        transactions: fetched.transactions,
        actorId: actor.uid,
        nowIso: ts,
      })

      for (const line of mapped) {
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

        // Statement materialization continuity into recon centre.
        if (nextLine.importStatus === 'imported' || nextLine.importStatus === 'staged') {
          nextLine = {
            ...nextLine,
            reconMaterializedAt: ts,
            reconState: 'unreconciled',
          }
        }

        staged++
        store.lines.set(nextLine.id, nextLine)
        createdLines.push(nextLine)

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
          store.lines.set(nextLine.id, {
            ...nextLine,
            reconState: 'suggestion_pending',
          })
        }
      }

      const nextCursor = fetched.nextCursor || target.cursor
      if (nextCursor) cursorAfterParts.push(nextCursor)
      const acc = accountByExt.get(target.externalAccountId)
      if (acc) {
        accountByExt.set(target.externalAccountId, {
          ...acc,
          status: 'active',
          cursor: nextCursor,
          lastSyncAt: this.now(),
          lastSyncRunId: runId,
          lastError: undefined,
        })
      }
    }

    const finishedAt = this.now()
    const allFailed = fetchedTotal === 0 && errors > 0 && imported === 0 && staged === 0 && !!hardFailMessage
    const status: BankFeedSyncRun['status'] = allFailed
      ? 'failed'
      : errors > 0 && imported + duplicates > 0
        ? 'partial'
        : errors > 0 && imported === 0 && staged === 0
          ? 'failed'
          : 'succeeded'

    if (allFailed) {
      const failed: BankFeedSyncRun = {
        ...run,
        status: 'failed',
        finishedAt,
        errorMessage: hardFailMessage,
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
        lastError: hardFailMessage,
        lastSyncAt: finishedAt,
        lastSyncRunId: runId,
        linkedAccounts: [...accountByExt.values()],
        version: connection.version + 2,
        updatedAt: finishedAt,
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
        at: finishedAt,
        detail: hardFailMessage || 'Sync failed',
      })
      await this.save(before, store)
      throw new BankFeedValidationError(hardFailMessage || 'Sync failed')
    }

    const finished: BankFeedSyncRun = {
      ...run,
      status,
      finishedAt,
      cursorAfter: cursorAfterParts.slice(-1)[0] || connection.cursor,
      fetchedCount: fetchedTotal,
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

    const linkedList = [...accountByExt.values()]
    const primary = linkedList.find((a) => a.externalAccountId === connection.externalAccountId) || linkedList[0]
    const connNow = store.connections.get(connectionId)!
    store.connections.set(connectionId, {
      ...connNow,
      status: status === 'failed' ? 'error' : 'connected',
      cursor: primary?.cursor || finished.cursorAfter,
      lastSyncAt: finishedAt,
      lastSyncRunId: runId,
      lastError: status === 'failed' ? 'Sync completed with errors' : undefined,
      linkedAccounts: linkedList,
      externalAccountId: connNow.externalAccountId || primary?.externalAccountId,
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
      detail: `Sync ${status}: fetched=${finished.fetchedCount} imported=${imported} suggestions=${createdSuggestions.length} materialized=${createdLines.filter((l) => l.reconMaterializedAt).length} autoPosted=false`,
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

  async bulkResolveSuggestions(
    actor: FinanceActorContext,
    command: BulkResolveBankFeedSuggestionsCommand,
  ): Promise<{ resolved: BankFeedSuggestion[]; skipped: string[]; autoPosted: false; externalPaymentInitiated: false }> {
    assertFinanceMembership(actor, command.orgId, 'bank_feed.suggestion.bulk')
    const orgId = requiredText(command.orgId, 'orgId')
    const legalEntityId = requiredText(command.legalEntityId, 'legalEntityId')
    const bookId = requiredText(command.bookId, 'bookId')
    if (command.resolution !== 'accept' && command.resolution !== 'dismiss') {
      throw new BankFeedValidationError('resolution must be accept or dismiss')
    }

    const before = await this.load()
    const store = cloneBankFeedStore(before)
    claim(store, `idem:${orgId}:${command.idempotencyKey}`, 'Duplicate bank feed bulk resolve')

    const pending = [...store.suggestions.values()].filter(
      (s) =>
        s.orgId === orgId &&
        s.legalEntityId === legalEntityId &&
        s.bookId === bookId &&
        s.status === 'pending',
    )

    let candidates = pending
    if (command.suggestionIds && command.suggestionIds.length > 0) {
      const want = new Set(command.suggestionIds)
      candidates = pending.filter((s) => want.has(s.id))
    } else if (command.resolution === 'accept') {
      candidates = pending.filter(isSafeBulkAcceptSuggestion)
    }

    const resolved: BankFeedSuggestion[] = []
    const skipped: string[] = []
    const ts = this.now()
    const status = command.resolution === 'accept' ? 'accepted' : 'dismissed'

    for (const existing of candidates) {
      if (command.resolution === 'accept' && !isSafeBulkAcceptSuggestion(existing)) {
        skipped.push(existing.id)
        continue
      }
      const next: BankFeedSuggestion = {
        ...existing,
        status,
        resolvedAt: ts,
        resolvedBy: actor.uid,
        resolutionNote:
          command.resolutionNote?.trim() ||
          (status === 'accepted'
            ? 'Bulk accept (safe confidence only; no journal/payment auto-post)'
            : 'Bulk dismiss (human-gated; no journal/payment)'),
        version: existing.version + 1,
        autoPosted: false,
        externalPaymentInitiated: false,
      }
      store.suggestions.set(existing.id, next)
      resolved.push(next)
      const line = store.lines.get(existing.bankLineId)
      if (line && line.orgId === orgId) {
        store.lines.set(line.id, {
          ...line,
          reconState: status === 'accepted' ? 'suggestion_accepted' : 'suggestion_dismissed',
          version: line.version + 1,
        })
      }
    }

    if (command.suggestionIds) {
      for (const id of command.suggestionIds) {
        if (!resolved.some((r) => r.id === id) && !skipped.includes(id)) skipped.push(id)
      }
    }

    appendAudit(store, {
      id: `aud_bulk_${command.requestId}`.slice(0, 120),
      orgId,
      legalEntityId,
      bookId,
      eventType: status === 'accepted' ? 'suggestion.bulk_accepted' : 'suggestion.bulk_dismissed',
      actorId: actor.uid,
      at: ts,
      detail: `Bulk ${status}: resolved=${resolved.length} skipped=${skipped.length} autoPosted=false externalPaymentInitiated=false`,
    })
    await this.save(before, store)
    return { resolved, skipped, autoPosted: false, externalPaymentInitiated: false }
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
    const line = store.lines.get(existing.bankLineId)
    if (line && line.orgId === orgId) {
      store.lines.set(line.id, {
        ...line,
        reconState: status === 'accepted' ? 'suggestion_accepted' : 'suggestion_dismissed',
        version: line.version + 1,
      })
    }
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
    connections: Array<
      BankFeedConnection & {
        health: ReturnType<typeof computeConnectionHealth>
        accounts: BankFeedAccountFeed[]
      }
    >
    syncRuns: BankFeedSyncRun[]
    lines: BankFeedBankLine[]
    suggestions: BankFeedSuggestion[]
    auditEvents: BankFeedAuditEvent[]
    reconCentre: BankFeedReconCentre
    providerSettings: BankFeedOrgProviderSettings
    providerSelection: ReturnType<typeof bankFeedProviderSettingsHardGates>
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
    const providerSettings = this.settingsForOrg(store, orgId)

    const ts = this.now()
    const connections = inScope([...store.connections.values()])
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((c) => ({
        ...c,
        linkedAccounts: normalizeLinkedAccounts(c),
        health: computeConnectionHealth(c, ts),
        accounts: normalizeLinkedAccounts(c),
      }))
    const lines = inScope([...store.lines.values()]).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))
    const suggestions = inScope([...store.suggestions.values()]).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const reconCentre = buildReconCentre({
      orgId,
      legalEntityId,
      bookId,
      asOfIso: ts,
      lines,
      suggestions,
      connections: connections.map(({ health: _h, accounts: _a, ...c }) => c),
    })

    return {
      connections,
      syncRuns: inScope([...store.syncRuns.values()]).sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
      lines,
      suggestions,
      auditEvents: inScope([...store.auditEvents.values()]).sort((a, b) => b.at.localeCompare(a.at)),
      reconCentre,
      providerSettings,
      providerSelection: bankFeedProviderSettingsHardGates(providerSettings),
      hardGates: {
        noEgress: true,
        autoPosted: false,
        externalPaymentInitiated: false,
        externalEgressAllowed: false,
        sarsSubmissionInitiated: false,
      },
    }
  }

  async getReconCentre(
    actor: FinanceActorContext,
    orgId: string,
    legalEntityId: string,
    bookId: string,
  ): Promise<BankFeedReconCentre> {
    assertFinanceMembership(actor, orgId, 'bank_feed.recon.read')
    const bundle = await this.getBundle(actor, orgId, legalEntityId, bookId)
    return bundle.reconCentre
  }

  /** Ensure imported lines carry recon materialization markers (idempotent). */
  async materializeReconContinuity(
    actor: FinanceActorContext,
    input: { orgId: string; legalEntityId: string; bookId: string; requestId: string; idempotencyKey: string },
  ): Promise<{ updated: number; bankRulesPayloadCount: number; autoPosted: false }> {
    assertFinanceMembership(actor, input.orgId, 'bank_feed.sync')
    const orgId = requiredText(input.orgId, 'orgId')
    const legalEntityId = requiredText(input.legalEntityId, 'legalEntityId')
    const bookId = requiredText(input.bookId, 'bookId')
    const before = await this.load()
    const store = cloneBankFeedStore(before)
    claim(store, `idem:${orgId}:${input.idempotencyKey}`, 'Duplicate materialize recon')
    const ts = this.now()
    let updated = 0
    const scoped = [...store.lines.values()].filter(
      (l) => l.orgId === orgId && l.legalEntityId === legalEntityId && l.bookId === bookId,
    )
    const nextLines = markLinesMaterialized(scoped, ts)
    for (const line of nextLines) {
      const prev = store.lines.get(line.id)
      if (!prev) continue
      if (prev.reconMaterializedAt !== line.reconMaterializedAt || prev.version !== line.version) {
        store.lines.set(line.id, line)
        updated++
      }
    }
    const payload = toBankRulesEvaluatePayload([...store.lines.values()].filter((l) => l.orgId === orgId))
    appendAudit(store, {
      id: `aud_mat_${input.requestId}`.slice(0, 120),
      orgId,
      legalEntityId,
      bookId,
      eventType: 'connection.updated',
      actorId: actor.uid,
      at: ts,
      detail: `Materialized recon continuity updated=${updated} bankRulesPayload=${payload.length} autoPosted=false`,
    })
    await this.save(before, store)
    return { updated, bankRulesPayloadCount: payload.length, autoPosted: false }
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
