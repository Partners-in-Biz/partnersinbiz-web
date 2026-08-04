import { FinanceAuthorizationError } from '@/lib/finance/policy'
import type { FinanceActorContext } from '@/lib/finance/types'
import { pendingRuleSuggestionKey } from '@/lib/finance/scale/recon-index'
import type {
  BankRule,
  BankRuleAction,
  BankRuleMatchCondition,
  BankRuleSuggestion,
  BankRulesFinanceAction,
} from './types'

export class BankRulesValidationError extends Error {
  readonly statusCode = 400
  constructor(message: string) {
    super(message)
    this.name = 'BankRulesValidationError'
  }
}

export class BankRulesNotFoundError extends Error {
  readonly statusCode = 404
  constructor(message: string) {
    super(message)
    this.name = 'BankRulesNotFoundError'
  }
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new BankRulesValidationError(`${field} is required`)
  return value.trim()
}

function requiredInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new BankRulesValidationError(`${field} must be an integer`)
  }
  return value
}

function assertFinanceMembership(actor: FinanceActorContext, orgId: string, action: BankRulesFinanceAction) {
  if (!actor.membershipActive) throw new FinanceAuthorizationError('Active organization membership is required')
  if (actor.orgId !== orgId) throw new FinanceAuthorizationError('Actor organization does not match finance scope')
  if (!actor.financeModuleEnabled) throw new FinanceAuthorizationError('Persisted Finance module capability is required')
  const isOrgAdmin = actor.membershipRole === 'owner' || actor.membershipRole === 'admin'
  const writeRoles = new Set(['finance_admin', 'accountant', 'bookkeeper'])
  const readRoles = new Set(['finance_admin', 'accountant', 'bookkeeper', 'finance_approver', 'finance_viewer'])
  const rolesNeeded = action === 'bank_rule.read' ? readRoles : writeRoles
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
    if (!ok) throw new FinanceAuthorizationError('Delegation does not grant bank rules access')
  }
}

export interface BankRulesStore {
  rules: Map<string, BankRule>
  suggestions: Map<string, BankRuleSuggestion>
  claims: Set<string>
}

export function createEmptyBankRulesStore(): BankRulesStore {
  return { rules: new Map(), suggestions: new Map(), claims: new Set() }
}

export function cloneBankRulesStore(store: BankRulesStore): BankRulesStore {
  return {
    rules: new Map(store.rules),
    suggestions: new Map(store.suggestions),
    claims: new Set(store.claims),
  }
}

function claim(store: BankRulesStore, key: string, message: string) {
  if (store.claims.has(key)) throw new BankRulesValidationError(message)
  store.claims.add(key)
}

function validateMatch(match: BankRuleMatchCondition) {
  const field = requiredText(match?.field, 'match.field') as BankRuleMatchCondition['field']
  const operator = requiredText(match?.operator, 'match.operator') as BankRuleMatchCondition['operator']
  const allowedFields = new Set(['description', 'counterparty', 'reference', 'amount'])
  const allowedOps = new Set(['contains', 'starts_with', 'equals', 'amount_equals', 'amount_between'])
  if (!allowedFields.has(field)) throw new BankRulesValidationError('Invalid match.field')
  if (!allowedOps.has(operator)) throw new BankRulesValidationError('Invalid match.operator')
  if (operator === 'amount_equals' || operator === 'amount_between') {
    requiredInt(match.amountMinor, 'match.amountMinor')
    if (operator === 'amount_between') {
      const max = requiredInt(match.amountMaxMinor, 'match.amountMaxMinor')
      if (max < (match.amountMinor as number)) {
        throw new BankRulesValidationError('match.amountMaxMinor must be >= amountMinor')
      }
    }
  } else if (!match.value || !String(match.value).trim()) {
    throw new BankRulesValidationError('match.value is required for text operators')
  }
}

function validateAction(action: BankRuleAction) {
  const kind = requiredText(action?.kind, 'action.kind') as BankRuleAction['kind']
  const allowed = new Set(['suggest_expense_account', 'suggest_counterparty', 'suggest_match_payment', 'flag_review'])
  if (!allowed.has(kind)) throw new BankRulesValidationError('Invalid action.kind')
  if (kind === 'suggest_expense_account' && !action.accountId?.trim()) {
    throw new BankRulesValidationError('action.accountId is required for suggest_expense_account')
  }
  if (kind === 'suggest_counterparty' && !action.counterpartyName?.trim()) {
    throw new BankRulesValidationError('action.counterpartyName is required for suggest_counterparty')
  }
}

export function matchesBankRule(
  match: BankRuleMatchCondition,
  txn: {
    amountMinor: number
    description: string
    reference?: string
    counterpartyName?: string
  },
): boolean {
  const hay =
    match.field === 'description'
      ? txn.description || ''
      : match.field === 'counterparty'
        ? txn.counterpartyName || ''
        : match.field === 'reference'
          ? txn.reference || ''
          : ''
  if (match.operator === 'contains') return hay.toLowerCase().includes(String(match.value || '').toLowerCase())
  if (match.operator === 'starts_with') return hay.toLowerCase().startsWith(String(match.value || '').toLowerCase())
  if (match.operator === 'equals') {
    if (match.field === 'amount') return txn.amountMinor === match.amountMinor
    return hay.toLowerCase() === String(match.value || '').toLowerCase()
  }
  if (match.operator === 'amount_equals') return txn.amountMinor === match.amountMinor
  if (match.operator === 'amount_between') {
    return txn.amountMinor >= (match.amountMinor as number) && txn.amountMinor <= (match.amountMaxMinor as number)
  }
  return false
}

export interface UpsertBankRuleCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  name: string
  priority?: number
  status?: 'active' | 'inactive'
  match: BankRuleMatchCondition
  action: BankRuleAction
  requestId: string
  idempotencyKey: string
  expectedVersion?: number
}

export interface EvaluateBankRulesCommand {
  idPrefix?: string
  orgId: string
  legalEntityId: string
  bookId: string
  bankAccountId: string
  bankTransactions: Array<{
    id: string
    amountMinor: number
    description: string
    reference?: string
    counterpartyName?: string
    reconciliationState?: string
  }>
  requestId: string
  idempotencyKey: string
}

export interface ResolveBankRuleSuggestionCommand {
  id: string
  orgId: string
  resolutionNote?: string
  requestId: string
  idempotencyKey: string
}

export class BankRulesFinanceService {
  constructor(
    private readonly load: () => Promise<BankRulesStore>,
    private readonly save: (before: BankRulesStore, after: BankRulesStore) => Promise<void>,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async upsertRule(actor: FinanceActorContext, command: UpsertBankRuleCommand): Promise<BankRule> {
    assertFinanceMembership(actor, command.orgId, 'bank_rule.configure')
    const id = requiredText(command.id, 'id')
    const orgId = requiredText(command.orgId, 'orgId')
    const legalEntityId = requiredText(command.legalEntityId, 'legalEntityId')
    const bookId = requiredText(command.bookId, 'bookId')
    const name = requiredText(command.name, 'name')
    validateMatch(command.match)
    validateAction(command.action)
    const before = await this.load()
    const store = cloneBankRulesStore(before)
    claim(store, `idem:${orgId}:${command.idempotencyKey}`, 'Duplicate bank rule request')
    const existing = store.rules.get(id)
    const ts = this.now()
    if (existing) {
      if (existing.orgId !== orgId || existing.legalEntityId !== legalEntityId || existing.bookId !== bookId) {
        throw new BankRulesNotFoundError('Bank rule not found in scope')
      }
      if (typeof command.expectedVersion === 'number' && command.expectedVersion !== existing.version) {
        throw new BankRulesValidationError('Bank rule version conflict')
      }
      const next: BankRule = {
        ...existing,
        name,
        priority: typeof command.priority === 'number' ? command.priority : existing.priority,
        status: command.status === 'inactive' ? 'inactive' : command.status === 'active' ? 'active' : existing.status,
        match: { ...command.match },
        action: { ...command.action },
        version: existing.version + 1,
        updatedBy: actor.uid,
        updatedAt: ts,
        autoPosted: false,
        externalPaymentInitiated: false,
        sarsSubmissionInitiated: false,
      }
      store.rules.set(id, next)
      await this.save(before, store)
      return next
    }
    const created: BankRule = {
      id,
      orgId,
      legalEntityId,
      bookId,
      name,
      priority: typeof command.priority === 'number' ? command.priority : 100,
      status: command.status === 'inactive' ? 'inactive' : 'active',
      match: { ...command.match },
      action: { ...command.action },
      schemaVersion: 1,
      version: 1,
      createdBy: actor.uid,
      createdAt: ts,
      updatedBy: actor.uid,
      updatedAt: ts,
      autoPosted: false,
      externalPaymentInitiated: false,
      sarsSubmissionInitiated: false,
    }
    store.rules.set(id, created)
    await this.save(before, store)
    return created
  }

  async evaluate(actor: FinanceActorContext, command: EvaluateBankRulesCommand): Promise<BankRuleSuggestion[]> {
    assertFinanceMembership(actor, command.orgId, 'bank_rule.evaluate')
    const orgId = requiredText(command.orgId, 'orgId')
    const legalEntityId = requiredText(command.legalEntityId, 'legalEntityId')
    const bookId = requiredText(command.bookId, 'bookId')
    const bankAccountId = requiredText(command.bankAccountId, 'bankAccountId')
    if (!Array.isArray(command.bankTransactions)) {
      throw new BankRulesValidationError('bankTransactions must be an array')
    }
    const before = await this.load()
    const store = cloneBankRulesStore(before)
    claim(store, `idem:${orgId}:${command.idempotencyKey}`, 'Duplicate bank rule evaluate request')
    const rules = [...store.rules.values()]
      .filter((r) => r.orgId === orgId && r.legalEntityId === legalEntityId && r.bookId === bookId && r.status === 'active')
      .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
    // O(1) pending de-dupe instead of scanning all suggestions per txn (N+1 style).
    const pendingKeys = new Set<string>()
    for (const s of store.suggestions.values()) {
      if (s.orgId !== orgId || s.status !== 'pending') continue
      pendingKeys.add(pendingRuleSuggestionKey(s.bankTransactionId, s.ruleId))
    }
    const ts = this.now()
    const prefix = (command.idPrefix || 'brs').trim() || 'brs'
    const created: BankRuleSuggestion[] = []
    for (const txn of command.bankTransactions) {
      if (!txn?.id) continue
      if (txn.reconciliationState === 'matched' || txn.reconciliationState === 'reconciled') continue
      const rule = rules.find((r) => matchesBankRule(r.match, txn))
      if (!rule) continue
      const dedupeKey = pendingRuleSuggestionKey(txn.id, rule.id)
      if (pendingKeys.has(dedupeKey)) continue
      const suggestion: BankRuleSuggestion = {
        id: `${prefix}_${txn.id}_${rule.id}`.slice(0, 120),
        orgId,
        legalEntityId,
        bookId,
        bankAccountId,
        bankTransactionId: txn.id,
        ruleId: rule.id,
        ruleName: rule.name,
        status: 'pending',
        confidence: rule.match.operator === 'equals' || rule.match.operator === 'amount_equals' ? 0.92 : 0.75,
        reason: `Matched rule "${rule.name}" on ${rule.match.field}/${rule.match.operator}`,
        action: { ...rule.action },
        createdBy: actor.uid,
        createdAt: ts,
        schemaVersion: 1,
        version: 1,
        autoPosted: false,
        externalPaymentInitiated: false,
        sarsSubmissionInitiated: false,
      }
      store.suggestions.set(suggestion.id, suggestion)
      pendingKeys.add(dedupeKey)
      created.push(suggestion)
    }
    await this.save(before, store)
    return created
  }

  async acceptSuggestion(actor: FinanceActorContext, command: ResolveBankRuleSuggestionCommand): Promise<BankRuleSuggestion> {
    return this.resolve(actor, command, 'accepted', 'bank_rule.suggestion.accept')
  }

  async dismissSuggestion(actor: FinanceActorContext, command: ResolveBankRuleSuggestionCommand): Promise<BankRuleSuggestion> {
    return this.resolve(actor, command, 'dismissed', 'bank_rule.suggestion.dismiss')
  }

  private async resolve(
    actor: FinanceActorContext,
    command: ResolveBankRuleSuggestionCommand,
    status: 'accepted' | 'dismissed',
    action: BankRulesFinanceAction,
  ): Promise<BankRuleSuggestion> {
    assertFinanceMembership(actor, command.orgId, action)
    const id = requiredText(command.id, 'id')
    const orgId = requiredText(command.orgId, 'orgId')
    const before = await this.load()
    const store = cloneBankRulesStore(before)
    claim(store, `idem:${orgId}:${command.idempotencyKey}`, 'Duplicate bank rule suggestion resolve')
    const existing = store.suggestions.get(id)
    if (!existing || existing.orgId !== orgId) throw new BankRulesNotFoundError('Bank rule suggestion not found')
    if (existing.status !== 'pending') throw new BankRulesValidationError('Suggestion is not pending')
    // Human gate only — never post journals, never initiate payment.
    const next: BankRuleSuggestion = {
      ...existing,
      status,
      resolvedAt: this.now(),
      resolvedBy: actor.uid,
      resolutionNote: command.resolutionNote?.trim() || undefined,
      version: existing.version + 1,
      autoPosted: false,
      externalPaymentInitiated: false,
      sarsSubmissionInitiated: false,
    }
    store.suggestions.set(id, next)
    await this.save(before, store)
    return next
  }

  async getBundle(
    actor: FinanceActorContext,
    orgId: string,
    legalEntityId: string,
    bookId: string,
  ): Promise<{ rules: BankRule[]; suggestions: BankRuleSuggestion[] }> {
    assertFinanceMembership(actor, orgId, 'bank_rule.read')
    const store = await this.load()
    const rules = [...store.rules.values()]
      .filter((r) => r.orgId === orgId && r.legalEntityId === legalEntityId && r.bookId === bookId)
      .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
    const suggestions = [...store.suggestions.values()]
      .filter((s) => s.orgId === orgId && s.legalEntityId === legalEntityId && s.bookId === bookId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return { rules, suggestions }
  }
}
