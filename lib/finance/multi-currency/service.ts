import { FinanceAuthorizationError } from '@/lib/finance/policy'
import type { FinanceActorContext } from '@/lib/finance/types'
import type {
  AccountingRate,
  AccountingRateSet,
  FxAuditEvent,
  FxBookPolicy,
  FxForeignDocument,
  FxFunctionalReport,
  FxJournalLine,
  FxJournalProposal,
  FxMonetaryPosition,
  FxPositionRole,
  FxRevaluationRun,
  FxSettlement,
  MultiCurrencyFinanceAction,
} from './types'

export class MultiCurrencyFinanceValidationError extends Error {
  readonly statusCode = 400
  constructor(message: string) {
    super(message)
    this.name = 'MultiCurrencyFinanceValidationError'
  }
}

export class MultiCurrencyFinanceNotFoundError extends Error {
  readonly statusCode = 404
  constructor(message: string) {
    super(message)
    this.name = 'MultiCurrencyFinanceNotFoundError'
  }
}

const DEFAULT_RATE_SCALE = 8

export interface ConfigureFxPolicyCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  functionalCurrency: string
  realizedFxGainAccountId: string
  realizedFxLossAccountId: string
  unrealizedFxGainAccountId: string
  unrealizedFxLossAccountId: string
  fxRevaluationClearingAccountId: string
  requestId: string
  idempotencyKey: string
}

export interface CreateRateSetCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  functionalCurrency: string
  name: string
  requestId: string
  idempotencyKey: string
}

export interface AddRateCommand {
  rateSetId: string
  orgId: string
  rateId: string
  fromCurrency: string
  toCurrency?: string
  rateDate: string
  rateScaled: number
  rateScale?: number
  source: 'manual' | 'import'
  sourceRef?: string
  requestId: string
  idempotencyKey: string
}

export interface ApproveRateSetCommand {
  rateSetId: string
  orgId: string
  approvalId: string
  reason: string
  requestId: string
  idempotencyKey: string
}

export interface RecordFxDocumentCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  documentType: 'customer_invoice' | 'supplier_bill'
  currency: string
  txnTotalMinor: number
  rateSetId: string
  rateDate: string
  documentDate: string
  positionId?: string
  requestId: string
  idempotencyKey: string
}

export interface RecordFxSettlementCommand {
  id: string
  orgId: string
  positionId: string
  documentId?: string
  settlementDate: string
  settledTxnMinor: number
  rateSetId: string
  periodId: string
  cashAccountId?: string
  controlAccountId?: string
  requestId: string
  idempotencyKey: string
}

export interface CreateRevaluationCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  periodId: string
  asOfDate: string
  rateSetId: string
  reverseNextPeriod?: boolean
  reversePeriodId?: string
  reversePostingDate?: string
  requestId: string
  idempotencyKey: string
}

export interface ApproveRevaluationCommand {
  id: string
  orgId: string
  approvalId: string
  reason: string
  requestId: string
  idempotencyKey: string
}

export interface BuildFunctionalReportCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  asOfDate: string
  rateSetId: string
  requestId: string
  idempotencyKey: string
}

export interface MultiCurrencyFinanceStore {
  policies: Map<string, FxBookPolicy>
  rateSets: Map<string, AccountingRateSet>
  rates: Map<string, AccountingRate>
  documents: Map<string, FxForeignDocument>
  positions: Map<string, FxMonetaryPosition>
  settlements: Map<string, FxSettlement>
  revaluations: Map<string, FxRevaluationRun>
  reports: Map<string, FxFunctionalReport>
  claims: Set<string>
  auditEvents: FxAuditEvent[]
}

export function createEmptyMultiCurrencyStore(): MultiCurrencyFinanceStore {
  return {
    policies: new Map(),
    rateSets: new Map(),
    rates: new Map(),
    documents: new Map(),
    positions: new Map(),
    settlements: new Map(),
    revaluations: new Map(),
    reports: new Map(),
    claims: new Set(),
    auditEvents: [],
  }
}

export function cloneMultiCurrencyStore(store: MultiCurrencyFinanceStore): MultiCurrencyFinanceStore {
  return {
    policies: new Map(store.policies),
    rateSets: new Map(store.rateSets),
    rates: new Map(store.rates),
    documents: new Map(store.documents),
    positions: new Map(store.positions),
    settlements: new Map(store.settlements),
    revaluations: new Map(store.revaluations),
    reports: new Map(store.reports),
    claims: new Set(store.claims),
    auditEvents: store.auditEvents.map((e) => ({ ...e })),
  }
}

/** Half-up integer: convert txn minor → functional minor via scaled rate. */
export function convertTxnToFunctional(
  txnMinor: number,
  rateScaled: number,
  rateScale: number = DEFAULT_RATE_SCALE,
): number {
  if (!Number.isSafeInteger(txnMinor)) {
    throw new MultiCurrencyFinanceValidationError('txnMinor must be a safe integer')
  }
  if (!Number.isSafeInteger(rateScaled) || rateScaled <= 0) {
    throw new MultiCurrencyFinanceValidationError('rateScaled must be a positive safe integer')
  }
  if (!Number.isSafeInteger(rateScale) || rateScale < 0 || rateScale > 18) {
    throw new MultiCurrencyFinanceValidationError('rateScale must be an integer 0..18')
  }
  const den = BigInt(10) ** BigInt(rateScale)
  const num = BigInt(txnMinor) * BigInt(rateScaled)
  const half = den / BigInt(2)
  if (num >= BigInt(0)) return Number((num + half) / den)
  return -Number((-num + half) / den)
}

export function computeRealizedFxMinor(input: {
  role: FxPositionRole
  settledTxnMinor: number
  originalRateScaled: number
  originalRateScale: number
  settlementRateScaled: number
  settlementRateScale: number
}): {
  originalFunctionalPortionMinor: number
  settlementFunctionalMinor: number
  realizedFxMinor: number
} {
  const originalFunctionalPortionMinor = convertTxnToFunctional(
    input.settledTxnMinor,
    input.originalRateScaled,
    input.originalRateScale,
  )
  const settlementFunctionalMinor = convertTxnToFunctional(
    input.settledTxnMinor,
    input.settlementRateScaled,
    input.settlementRateScale,
  )
  const diff = settlementFunctionalMinor - originalFunctionalPortionMinor
  // AR: gain when settlement rate rises; AP inverted.
  const realizedFxMinor = input.role === 'receivable' ? diff : -diff
  return { originalFunctionalPortionMinor, settlementFunctionalMinor, realizedFxMinor }
}

export function buildBalancedJournal(input: {
  purpose: string
  currency: string
  lines: FxJournalLine[]
}): FxJournalProposal {
  const lines = input.lines.map((line) => ({
    accountId: line.accountId,
    debitMinor: line.debitMinor,
    creditMinor: line.creditMinor,
    ...(line.description ? { description: line.description } : {}),
    ...(line.currency ? { currency: line.currency } : {}),
    ...(typeof line.txnAmountMinor === 'number' ? { txnAmountMinor: line.txnAmountMinor } : {}),
    ...(typeof line.functionalAmountMinor === 'number'
      ? { functionalAmountMinor: line.functionalAmountMinor }
      : {}),
  }))
  const totalDebitMinor = lines.reduce((s, l) => s + l.debitMinor, 0)
  const totalCreditMinor = lines.reduce((s, l) => s + l.creditMinor, 0)
  return {
    purpose: input.purpose,
    currency: input.currency,
    lines,
    totalDebitMinor,
    totalCreditMinor,
    balanced: totalDebitMinor === totalCreditMinor,
    externalPaymentInitiated: false,
    sarsSubmissionInitiated: false,
  }
}

function reverseJournal(proposal: FxJournalProposal, purpose: string): FxJournalProposal {
  return buildBalancedJournal({
    purpose,
    currency: proposal.currency,
    lines: proposal.lines.map((line) => ({
      accountId: line.accountId,
      debitMinor: line.creditMinor,
      creditMinor: line.debitMinor,
      ...(line.description ? { description: `Reversal: ${line.description}` } : {}),
      ...(line.currency ? { currency: line.currency } : {}),
      ...(typeof line.txnAmountMinor === 'number' ? { txnAmountMinor: line.txnAmountMinor } : {}),
      ...(typeof line.functionalAmountMinor === 'number'
        ? { functionalAmountMinor: line.functionalAmountMinor }
        : {}),
    })),
  })
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new MultiCurrencyFinanceValidationError(`${field} is required`)
  }
  return value.trim()
}

function parseDate(value: string, field: string): string {
  const v = requiredText(value, field)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new MultiCurrencyFinanceValidationError(`${field} must be YYYY-MM-DD`)
  }
  const d = new Date(`${v}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) throw new MultiCurrencyFinanceValidationError(`${field} is not a valid date`)
  return v
}

function assertSafeInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new MultiCurrencyFinanceValidationError(`${field} must be a safe integer`)
  }
  return value
}

function claim(store: MultiCurrencyFinanceStore, key: string, message: string) {
  if (store.claims.has(key)) throw new MultiCurrencyFinanceValidationError(message)
  store.claims.add(key)
}

function hasFinanceRole(actor: FinanceActorContext, orgId: string, write: boolean): boolean {
  const isOrgAdmin = actor.membershipRole === 'owner' || actor.membershipRole === 'admin'
  if (isOrgAdmin) return true
  const roles = write
    ? ['finance_admin', 'accountant', 'finance_approver']
    : ['finance_admin', 'accountant', 'bookkeeper', 'finance_approver', 'auditor']
  return actor.assignments.some(
    (a) =>
      a.orgId === orgId &&
      a.userId === actor.uid &&
      a.status === 'active' &&
      roles.includes(a.role),
  )
}

function authorizeOrgFinanceAction(
  actor: FinanceActorContext,
  orgId: string,
  action: MultiCurrencyFinanceAction,
): void {
  if (!actor.membershipActive) throw new FinanceAuthorizationError('Active organization membership is required')
  if (actor.orgId !== orgId) throw new FinanceAuthorizationError('Actor organization does not match finance scope')
  if (!actor.financeModuleEnabled) {
    throw new FinanceAuthorizationError('Persisted Finance module capability is required')
  }
  const write = action !== 'fx.read'
  if (!hasFinanceRole(actor, orgId, write)) {
    throw new FinanceAuthorizationError(`Finance role or org admin required for ${action}`)
  }
  if (action === 'fx.rate_set.approve' || action === 'fx.revaluation.approve') {
    const isOrgAdmin = actor.membershipRole === 'owner' || actor.membershipRole === 'admin'
    const isApprover = actor.assignments.some(
      (a) =>
        a.orgId === orgId &&
        a.userId === actor.uid &&
        a.status === 'active' &&
        (a.role === 'finance_admin' || a.role === 'finance_approver'),
    )
    if (!isOrgAdmin && !isApprover) {
      throw new FinanceAuthorizationError(`Finance approver or admin required for ${action}`)
    }
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
      scopes.includes('finance:fx:*') ||
      scopes.includes('finance:multi-currency:*')
    if (!ok) throw new FinanceAuthorizationError('Delegation does not grant finance multi-currency access')
  }
}

function policyKey(orgId: string, bookId: string): string {
  return `${orgId}:${bookId}`
}

function findPolicy(
  store: MultiCurrencyFinanceStore,
  orgId: string,
  bookId: string,
): FxBookPolicy | undefined {
  for (const p of store.policies.values()) {
    if (p.orgId === orgId && p.bookId === bookId) return p
  }
  return store.policies.get(policyKey(orgId, bookId))
}

function requireRateSet(
  store: MultiCurrencyFinanceStore,
  rateSetId: string,
  orgId: string,
): AccountingRateSet {
  const rs = store.rateSets.get(rateSetId)
  if (!rs || rs.orgId !== orgId) {
    throw new MultiCurrencyFinanceNotFoundError('Rate set not found')
  }
  return rs
}

/** Latest rate on or before rateDate for from→to within a rate set. */
function findRateOnOrBefore(
  store: MultiCurrencyFinanceStore,
  rateSet: AccountingRateSet,
  fromCurrency: string,
  toCurrency: string,
  rateDate: string,
): AccountingRate {
  const from = fromCurrency.toUpperCase()
  const to = toCurrency.toUpperCase()
  let best: AccountingRate | undefined
  for (const rateId of rateSet.rateIds) {
    const rate = store.rates.get(rateId)
    if (!rate) continue
    if (rate.fromCurrency !== from || rate.toCurrency !== to) continue
    if (rate.rateDate > rateDate) continue
    if (!best || rate.rateDate > best.rateDate) best = rate
  }
  if (!best) {
    throw new MultiCurrencyFinanceValidationError(
      `No accounting rate for ${from}/${to} on or before ${rateDate} in rate set ${rateSet.id}`,
    )
  }
  return best
}

function roleForDocument(documentType: 'customer_invoice' | 'supplier_bill'): FxPositionRole {
  return documentType === 'customer_invoice' ? 'receivable' : 'payable'
}

function pushAudit(
  store: MultiCurrencyFinanceStore,
  input: {
    orgId: string
    action: string
    actorId: string
    at: string
    entityType: string
    entityId: string
    requestId?: string
    detail?: Record<string, unknown>
  },
) {
  store.auditEvents.push({
    id: `aud_${store.auditEvents.length + 1}_${input.entityId}`,
    orgId: input.orgId,
    action: input.action,
    actorId: input.actorId,
    at: input.at,
    entityType: input.entityType,
    entityId: input.entityId,
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.detail ? { detail: input.detail } : {}),
    externalEgressAllowed: false,
    sarsSubmissionInitiated: false,
    externalPaymentInitiated: false,
  })
}

function buildSettlementJournal(input: {
  role: FxPositionRole
  functionalCurrency: string
  policy: FxBookPolicy
  originalFunctionalPortionMinor: number
  settlementFunctionalMinor: number
  realizedFxMinor: number
  settledTxnMinor: number
  cashAccountId: string
  controlAccountId: string
}): FxJournalProposal {
  const {
    role,
    functionalCurrency,
    policy,
    originalFunctionalPortionMinor,
    settlementFunctionalMinor,
    realizedFxMinor,
    settledTxnMinor,
    cashAccountId,
    controlAccountId,
  } = input
  const lines: FxJournalLine[] = []
  if (role === 'receivable') {
    // Dr cash at settlement functional; Cr AR at original; FX plug.
    lines.push({
      accountId: cashAccountId,
      debitMinor: settlementFunctionalMinor,
      creditMinor: 0,
      description: 'FX settlement cash/bank',
      currency: functionalCurrency,
      txnAmountMinor: settledTxnMinor,
      functionalAmountMinor: settlementFunctionalMinor,
    })
    lines.push({
      accountId: controlAccountId,
      debitMinor: 0,
      creditMinor: originalFunctionalPortionMinor,
      description: 'FX settlement AR relief at original rate',
      currency: functionalCurrency,
      txnAmountMinor: settledTxnMinor,
      functionalAmountMinor: originalFunctionalPortionMinor,
    })
    if (realizedFxMinor > 0) {
      lines.push({
        accountId: policy.realizedFxGainAccountId,
        debitMinor: 0,
        creditMinor: realizedFxMinor,
        description: 'Realized FX gain',
        currency: functionalCurrency,
        functionalAmountMinor: realizedFxMinor,
      })
    } else if (realizedFxMinor < 0) {
      lines.push({
        accountId: policy.realizedFxLossAccountId,
        debitMinor: -realizedFxMinor,
        creditMinor: 0,
        description: 'Realized FX loss',
        currency: functionalCurrency,
        functionalAmountMinor: -realizedFxMinor,
      })
    }
  } else {
    // AP: Dr AP at original; Cr cash at settlement; FX plug inverted.
    lines.push({
      accountId: controlAccountId,
      debitMinor: originalFunctionalPortionMinor,
      creditMinor: 0,
      description: 'FX settlement AP relief at original rate',
      currency: functionalCurrency,
      txnAmountMinor: settledTxnMinor,
      functionalAmountMinor: originalFunctionalPortionMinor,
    })
    lines.push({
      accountId: cashAccountId,
      debitMinor: 0,
      creditMinor: settlementFunctionalMinor,
      description: 'FX settlement cash/bank',
      currency: functionalCurrency,
      txnAmountMinor: settledTxnMinor,
      functionalAmountMinor: settlementFunctionalMinor,
    })
    if (realizedFxMinor > 0) {
      lines.push({
        accountId: policy.realizedFxGainAccountId,
        debitMinor: 0,
        creditMinor: realizedFxMinor,
        description: 'Realized FX gain (AP)',
        currency: functionalCurrency,
        functionalAmountMinor: realizedFxMinor,
      })
    } else if (realizedFxMinor < 0) {
      lines.push({
        accountId: policy.realizedFxLossAccountId,
        debitMinor: -realizedFxMinor,
        creditMinor: 0,
        description: 'Realized FX loss (AP)',
        currency: functionalCurrency,
        functionalAmountMinor: -realizedFxMinor,
      })
    }
  }
  return buildBalancedJournal({
    purpose: 'fx.settlement',
    currency: functionalCurrency,
    lines,
  })
}

function buildRevaluationJournal(input: {
  functionalCurrency: string
  policy: FxBookPolicy
  lines: Array<{ unrealizedFxMinor: number; role: FxPositionRole; positionId: string }>
}): FxJournalProposal {
  const journalLines: FxJournalLine[] = []
  let netGain = 0
  let netLoss = 0
  for (const line of input.lines) {
    // Position signed unrealized already role-adjusted (positive = gain).
    if (line.unrealizedFxMinor > 0) netGain += line.unrealizedFxMinor
    else if (line.unrealizedFxMinor < 0) netLoss += -line.unrealizedFxMinor
  }
  const net = netGain - netLoss
  if (net === 0 && netGain === 0 && netLoss === 0) {
    return buildBalancedJournal({
      purpose: 'fx.revaluation',
      currency: input.functionalCurrency,
      lines: [],
    })
  }
  // Aggregate: Dr/Cr clearing vs unrealized gain/loss so the journal balances.
  if (netGain > 0) {
    journalLines.push({
      accountId: input.policy.fxRevaluationClearingAccountId,
      debitMinor: netGain,
      creditMinor: 0,
      description: 'FX revaluation clearing (unrealized gain)',
    })
    journalLines.push({
      accountId: input.policy.unrealizedFxGainAccountId,
      debitMinor: 0,
      creditMinor: netGain,
      description: 'Unrealized FX gain',
    })
  }
  if (netLoss > 0) {
    journalLines.push({
      accountId: input.policy.unrealizedFxLossAccountId,
      debitMinor: netLoss,
      creditMinor: 0,
      description: 'Unrealized FX loss',
    })
    journalLines.push({
      accountId: input.policy.fxRevaluationClearingAccountId,
      debitMinor: 0,
      creditMinor: netLoss,
      description: 'FX revaluation clearing (unrealized loss)',
    })
  }
  return buildBalancedJournal({
    purpose: 'fx.revaluation',
    currency: input.functionalCurrency,
    lines: journalLines,
  })
}

export class MultiCurrencyFinanceService {
  constructor(
    private readonly load: () => Promise<MultiCurrencyFinanceStore>,
    private readonly save: (
      before: MultiCurrencyFinanceStore,
      after: MultiCurrencyFinanceStore,
    ) => Promise<void>,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  private async mutate<T>(fn: (store: MultiCurrencyFinanceStore) => Promise<T> | T): Promise<T> {
    const before = await this.load()
    const after = cloneMultiCurrencyStore(before)
    const result = await fn(after)
    await this.save(before, after)
    return result
  }

  async configurePolicy(actor: FinanceActorContext, command: ConfigureFxPolicyCommand): Promise<FxBookPolicy> {
    authorizeOrgFinanceAction(actor, command.orgId, 'fx.policy.configure')
    const id = requiredText(command.id, 'id')
    const orgId = requiredText(command.orgId, 'orgId')
    const legalEntityId = requiredText(command.legalEntityId, 'legalEntityId')
    const bookId = requiredText(command.bookId, 'bookId')
    const functionalCurrency = requiredText(command.functionalCurrency, 'functionalCurrency').toUpperCase()
    const realizedFxGainAccountId = requiredText(command.realizedFxGainAccountId, 'realizedFxGainAccountId')
    const realizedFxLossAccountId = requiredText(command.realizedFxLossAccountId, 'realizedFxLossAccountId')
    const unrealizedFxGainAccountId = requiredText(
      command.unrealizedFxGainAccountId,
      'unrealizedFxGainAccountId',
    )
    const unrealizedFxLossAccountId = requiredText(
      command.unrealizedFxLossAccountId,
      'unrealizedFxLossAccountId',
    )
    const fxRevaluationClearingAccountId = requiredText(
      command.fxRevaluationClearingAccountId,
      'fxRevaluationClearingAccountId',
    )
    requiredText(command.requestId, 'requestId')
    requiredText(command.idempotencyKey, 'idempotencyKey')
    const now = this.now()

    return this.mutate((store) => {
      claim(store, `fx_idem:${orgId}:${command.idempotencyKey}`, 'Idempotency key already used for fx policy')
      const existing = findPolicy(store, orgId, bookId)
      const policy: FxBookPolicy = {
        id: existing?.id || id,
        orgId,
        legalEntityId,
        bookId,
        functionalCurrency,
        realizedFxGainAccountId,
        realizedFxLossAccountId,
        unrealizedFxGainAccountId,
        unrealizedFxLossAccountId,
        fxRevaluationClearingAccountId,
        schemaVersion: 1,
        version: (existing?.version || 0) + 1,
        createdBy: existing?.createdBy || actor.uid,
        createdAt: existing?.createdAt || now,
        updatedBy: actor.uid,
        updatedAt: now,
        externalEgressAllowed: false,
        sarsSubmissionInitiated: false,
        externalPaymentInitiated: false,
      }
      store.policies.set(policy.id, policy)
      pushAudit(store, {
        orgId,
        action: 'fx.policy.configure',
        actorId: actor.uid,
        at: now,
        entityType: 'fx_book_policy',
        entityId: policy.id,
        requestId: command.requestId,
      })
      return policy
    })
  }

  async createRateSet(actor: FinanceActorContext, command: CreateRateSetCommand): Promise<AccountingRateSet> {
    authorizeOrgFinanceAction(actor, command.orgId, 'fx.rate_set.create')
    const id = requiredText(command.id, 'id')
    const orgId = requiredText(command.orgId, 'orgId')
    const legalEntityId = requiredText(command.legalEntityId, 'legalEntityId')
    const bookId = requiredText(command.bookId, 'bookId')
    const functionalCurrency = requiredText(command.functionalCurrency, 'functionalCurrency').toUpperCase()
    const name = requiredText(command.name, 'name')
    requiredText(command.requestId, 'requestId')
    requiredText(command.idempotencyKey, 'idempotencyKey')
    const now = this.now()

    return this.mutate((store) => {
      claim(store, `fx_idem:${orgId}:${command.idempotencyKey}`, 'Idempotency key already used for rate set create')
      if (store.rateSets.has(id)) throw new MultiCurrencyFinanceValidationError('Rate set already exists')
      const policy = findPolicy(store, orgId, bookId)
      if (!policy) throw new MultiCurrencyFinanceValidationError('FX book policy must be configured first')
      if (policy.functionalCurrency !== functionalCurrency) {
        throw new MultiCurrencyFinanceValidationError('Rate set functional currency must match book policy')
      }
      const rateSet: AccountingRateSet = {
        id,
        orgId,
        legalEntityId,
        bookId,
        functionalCurrency,
        name,
        status: 'draft',
        rateIds: [],
        schemaVersion: 1,
        version: 1,
        createdBy: actor.uid,
        createdAt: now,
        updatedBy: actor.uid,
        updatedAt: now,
        externalEgressAllowed: false,
        sarsSubmissionInitiated: false,
        externalPaymentInitiated: false,
      }
      store.rateSets.set(id, rateSet)
      pushAudit(store, {
        orgId,
        action: 'fx.rate_set.create',
        actorId: actor.uid,
        at: now,
        entityType: 'accounting_rate_set',
        entityId: id,
        requestId: command.requestId,
      })
      return rateSet
    })
  }

  async addRate(actor: FinanceActorContext, command: AddRateCommand): Promise<AccountingRate> {
    authorizeOrgFinanceAction(actor, command.orgId, 'fx.rate_set.add_rate')
    const rateSetId = requiredText(command.rateSetId, 'rateSetId')
    const orgId = requiredText(command.orgId, 'orgId')
    const rateId = requiredText(command.rateId, 'rateId')
    const fromCurrency = requiredText(command.fromCurrency, 'fromCurrency').toUpperCase()
    const rateDate = parseDate(command.rateDate, 'rateDate')
    const rateScaled = assertSafeInt(command.rateScaled, 'rateScaled')
    if (rateScaled <= 0) throw new MultiCurrencyFinanceValidationError('rateScaled must be positive')
    const rateScale =
      command.rateScale === undefined ? DEFAULT_RATE_SCALE : assertSafeInt(command.rateScale, 'rateScale')
    if (rateScale < 0 || rateScale > 18) {
      throw new MultiCurrencyFinanceValidationError('rateScale must be 0..18')
    }
    if (command.source !== 'manual' && command.source !== 'import') {
      throw new MultiCurrencyFinanceValidationError('source must be manual|import')
    }
    requiredText(command.requestId, 'requestId')
    requiredText(command.idempotencyKey, 'idempotencyKey')
    const now = this.now()

    return this.mutate((store) => {
      claim(store, `fx_idem:${orgId}:${command.idempotencyKey}`, 'Idempotency key already used for add rate')
      const rateSet = requireRateSet(store, rateSetId, orgId)
      if (rateSet.status === 'approved_locked') {
        throw new MultiCurrencyFinanceValidationError('Cannot add rates to an approved rate set')
      }
      if (store.rates.has(rateId)) throw new MultiCurrencyFinanceValidationError('Rate id already exists')
      const toCurrency = (command.toCurrency || rateSet.functionalCurrency).toUpperCase()
      const rate: AccountingRate = {
        id: rateId,
        orgId,
        rateSetId,
        fromCurrency,
        toCurrency,
        rateDate,
        rateScaled,
        rateScale,
        source: command.source,
        ...(command.sourceRef ? { sourceRef: String(command.sourceRef) } : {}),
        schemaVersion: 1,
        version: 1,
        createdBy: actor.uid,
        createdAt: now,
        updatedBy: actor.uid,
        updatedAt: now,
      }
      store.rates.set(rateId, rate)
      const nextSet: AccountingRateSet = {
        ...rateSet,
        rateIds: [...rateSet.rateIds, rateId],
        updatedAt: now,
        updatedBy: actor.uid,
        version: rateSet.version + 1,
        externalEgressAllowed: false,
        sarsSubmissionInitiated: false,
        externalPaymentInitiated: false,
      }
      store.rateSets.set(rateSetId, nextSet)
      pushAudit(store, {
        orgId,
        action: 'fx.rate_set.add_rate',
        actorId: actor.uid,
        at: now,
        entityType: 'accounting_rate',
        entityId: rateId,
        requestId: command.requestId,
        detail: { rateSetId, rateDate, rateScaled, rateScale },
      })
      return rate
    })
  }

  async approveRateSet(
    actor: FinanceActorContext,
    command: ApproveRateSetCommand,
  ): Promise<AccountingRateSet> {
    authorizeOrgFinanceAction(actor, command.orgId, 'fx.rate_set.approve')
    const rateSetId = requiredText(command.rateSetId, 'rateSetId')
    const orgId = requiredText(command.orgId, 'orgId')
    const approvalId = requiredText(command.approvalId, 'approvalId')
    const reason = requiredText(command.reason, 'reason')
    requiredText(command.requestId, 'requestId')
    requiredText(command.idempotencyKey, 'idempotencyKey')
    const now = this.now()

    return this.mutate((store) => {
      claim(store, `fx_idem:${orgId}:${command.idempotencyKey}`, 'Idempotency key already used for rate set approve')
      const rateSet = requireRateSet(store, rateSetId, orgId)
      if (rateSet.status === 'approved_locked') return rateSet
      if (rateSet.status !== 'draft') {
        throw new MultiCurrencyFinanceValidationError('Only draft rate sets can be approved')
      }
      if (rateSet.rateIds.length === 0) {
        throw new MultiCurrencyFinanceValidationError('Rate set must contain at least one rate before approval')
      }
      const next: AccountingRateSet = {
        ...rateSet,
        status: 'approved_locked',
        approvalId,
        approvalActorId: actor.uid,
        approvedAt: now,
        approvalReason: reason,
        updatedAt: now,
        updatedBy: actor.uid,
        version: rateSet.version + 1,
        externalEgressAllowed: false,
        sarsSubmissionInitiated: false,
        externalPaymentInitiated: false,
      }
      store.rateSets.set(rateSetId, next)
      pushAudit(store, {
        orgId,
        action: 'fx.rate_set.approve',
        actorId: actor.uid,
        at: now,
        entityType: 'accounting_rate_set',
        entityId: rateSetId,
        requestId: command.requestId,
      })
      return next
    })
  }

  async recordDocument(
    actor: FinanceActorContext,
    command: RecordFxDocumentCommand,
  ): Promise<{ document: FxForeignDocument; position: FxMonetaryPosition }> {
    authorizeOrgFinanceAction(actor, command.orgId, 'fx.document.record')
    const id = requiredText(command.id, 'id')
    const orgId = requiredText(command.orgId, 'orgId')
    const legalEntityId = requiredText(command.legalEntityId, 'legalEntityId')
    const bookId = requiredText(command.bookId, 'bookId')
    if (command.documentType !== 'customer_invoice' && command.documentType !== 'supplier_bill') {
      throw new MultiCurrencyFinanceValidationError('documentType must be customer_invoice|supplier_bill')
    }
    const currency = requiredText(command.currency, 'currency').toUpperCase()
    const txnTotalMinor = assertSafeInt(command.txnTotalMinor, 'txnTotalMinor')
    if (txnTotalMinor <= 0) throw new MultiCurrencyFinanceValidationError('txnTotalMinor must be positive')
    const rateSetId = requiredText(command.rateSetId, 'rateSetId')
    const rateDate = parseDate(command.rateDate, 'rateDate')
    const documentDate = parseDate(command.documentDate, 'documentDate')
    requiredText(command.requestId, 'requestId')
    requiredText(command.idempotencyKey, 'idempotencyKey')
    const now = this.now()

    return this.mutate((store) => {
      claim(store, `fx_idem:${orgId}:${command.idempotencyKey}`, 'Idempotency key already used for fx document')
      if (store.documents.has(id)) throw new MultiCurrencyFinanceValidationError('Document already exists')
      const policy = findPolicy(store, orgId, bookId)
      if (!policy) throw new MultiCurrencyFinanceValidationError('FX book policy must be configured first')
      const rateSet = requireRateSet(store, rateSetId, orgId)
      if (rateSet.status !== 'approved_locked') {
        throw new MultiCurrencyFinanceValidationError('Document rate pin requires an approved_locked rate set')
      }
      if (rateSet.bookId !== bookId || rateSet.legalEntityId !== legalEntityId) {
        throw new MultiCurrencyFinanceValidationError('Rate set scope does not match document book/entity')
      }
      if (currency === policy.functionalCurrency) {
        throw new MultiCurrencyFinanceValidationError('Foreign document currency must differ from functional currency')
      }
      const rate = findRateOnOrBefore(store, rateSet, currency, policy.functionalCurrency, rateDate)
      const functionalTotalMinor = convertTxnToFunctional(txnTotalMinor, rate.rateScaled, rate.rateScale)
      const positionId = command.positionId?.trim() || `pos_${id}`
      if (store.positions.has(positionId)) {
        throw new MultiCurrencyFinanceValidationError('Position id already exists')
      }
      const role = roleForDocument(command.documentType)
      const document: FxForeignDocument = {
        id,
        orgId,
        legalEntityId,
        bookId,
        documentType: command.documentType,
        currency,
        txnTotalMinor,
        functionalTotalMinor,
        rateSetId,
        rateId: rate.id,
        rateDate: rate.rateDate,
        rateScaled: rate.rateScaled,
        rateScale: rate.rateScale,
        documentDate,
        positionId,
        schemaVersion: 1,
        version: 1,
        createdBy: actor.uid,
        createdAt: now,
        updatedBy: actor.uid,
        updatedAt: now,
        externalEgressAllowed: false,
        sarsSubmissionInitiated: false,
        externalPaymentInitiated: false,
      }
      const position: FxMonetaryPosition = {
        id: positionId,
        orgId,
        legalEntityId,
        bookId,
        documentId: id,
        role,
        currency,
        openTxnMinor: txnTotalMinor,
        originalTxnMinor: txnTotalMinor,
        settledTxnMinor: 0,
        openFunctionalAtOriginalMinor: functionalTotalMinor,
        originalRateSetId: rateSetId,
        originalRateId: rate.id,
        originalRateDate: rate.rateDate,
        originalRateScaled: rate.rateScaled,
        originalRateScale: rate.rateScale,
        realizedFxMinor: 0,
        unrealizedFxMinor: 0,
        status: 'open',
        schemaVersion: 1,
        version: 1,
        createdBy: actor.uid,
        createdAt: now,
        updatedBy: actor.uid,
        updatedAt: now,
        externalEgressAllowed: false,
        sarsSubmissionInitiated: false,
        externalPaymentInitiated: false,
      }
      store.documents.set(id, document)
      store.positions.set(positionId, position)
      pushAudit(store, {
        orgId,
        action: 'fx.document.record',
        actorId: actor.uid,
        at: now,
        entityType: 'fx_foreign_document',
        entityId: id,
        requestId: command.requestId,
        detail: { positionId, functionalTotalMinor, currency },
      })
      return { document, position }
    })
  }

  async recordSettlement(
    actor: FinanceActorContext,
    command: RecordFxSettlementCommand,
  ): Promise<{ settlement: FxSettlement; position: FxMonetaryPosition }> {
    authorizeOrgFinanceAction(actor, command.orgId, 'fx.settlement.record')
    const id = requiredText(command.id, 'id')
    const orgId = requiredText(command.orgId, 'orgId')
    const positionId = requiredText(command.positionId, 'positionId')
    const settlementDate = parseDate(command.settlementDate, 'settlementDate')
    const settledTxnMinor = assertSafeInt(command.settledTxnMinor, 'settledTxnMinor')
    if (settledTxnMinor <= 0) throw new MultiCurrencyFinanceValidationError('settledTxnMinor must be positive')
    const rateSetId = requiredText(command.rateSetId, 'rateSetId')
    const periodId = requiredText(command.periodId, 'periodId')
    requiredText(command.requestId, 'requestId')
    requiredText(command.idempotencyKey, 'idempotencyKey')
    const now = this.now()

    return this.mutate((store) => {
      claim(store, `fx_idem:${orgId}:${command.idempotencyKey}`, 'Idempotency key already used for fx settlement')
      if (store.settlements.has(id)) throw new MultiCurrencyFinanceValidationError('Settlement already exists')
      const position = store.positions.get(positionId)
      if (!position || position.orgId !== orgId) {
        throw new MultiCurrencyFinanceNotFoundError('FX monetary position not found')
      }
      if (command.documentId && command.documentId !== position.documentId) {
        throw new MultiCurrencyFinanceValidationError('documentId does not match position')
      }
      if (settledTxnMinor > position.openTxnMinor) {
        throw new MultiCurrencyFinanceValidationError('settledTxnMinor exceeds open position amount')
      }
      const policy = findPolicy(store, orgId, position.bookId)
      if (!policy) throw new MultiCurrencyFinanceValidationError('FX book policy must be configured first')
      const rateSet = requireRateSet(store, rateSetId, orgId)
      if (rateSet.status !== 'approved_locked') {
        throw new MultiCurrencyFinanceValidationError('Settlement requires an approved_locked rate set')
      }
      const rate = findRateOnOrBefore(
        store,
        rateSet,
        position.currency,
        policy.functionalCurrency,
        settlementDate,
      )
      const fx = computeRealizedFxMinor({
        role: position.role,
        settledTxnMinor,
        originalRateScaled: position.originalRateScaled,
        originalRateScale: position.originalRateScale,
        settlementRateScaled: rate.rateScaled,
        settlementRateScale: rate.rateScale,
      })
      const cashAccountId = command.cashAccountId?.trim() || 'acc_bank_fx'
      const controlAccountId =
        command.controlAccountId?.trim() ||
        (position.role === 'receivable' ? 'acc_ar_fx' : 'acc_ap_fx')
      const journalProposal = buildSettlementJournal({
        role: position.role,
        functionalCurrency: policy.functionalCurrency,
        policy,
        originalFunctionalPortionMinor: fx.originalFunctionalPortionMinor,
        settlementFunctionalMinor: fx.settlementFunctionalMinor,
        realizedFxMinor: fx.realizedFxMinor,
        settledTxnMinor,
        cashAccountId,
        controlAccountId,
      })
      if (!journalProposal.balanced) {
        throw new MultiCurrencyFinanceValidationError('Settlement journal proposal is not balanced')
      }
      const openTxnMinor = position.openTxnMinor - settledTxnMinor
      const openFunctionalAtOriginalMinor =
        position.openFunctionalAtOriginalMinor - fx.originalFunctionalPortionMinor
      const status =
        openTxnMinor === 0 ? 'settled' : settledTxnMinor > 0 ? 'partially_settled' : position.status
      const nextPosition: FxMonetaryPosition = {
        ...position,
        openTxnMinor,
        settledTxnMinor: position.settledTxnMinor + settledTxnMinor,
        openFunctionalAtOriginalMinor,
        realizedFxMinor: position.realizedFxMinor + fx.realizedFxMinor,
        // Settlement clears prior unrealized on settled portion; full reval recomputes later.
        unrealizedFxMinor: openTxnMinor === 0 ? 0 : position.unrealizedFxMinor,
        status,
        updatedAt: now,
        updatedBy: actor.uid,
        version: position.version + 1,
        externalEgressAllowed: false,
        sarsSubmissionInitiated: false,
        externalPaymentInitiated: false,
      }
      const settlement: FxSettlement = {
        id,
        orgId,
        legalEntityId: position.legalEntityId,
        bookId: position.bookId,
        positionId,
        documentId: position.documentId,
        settlementDate,
        periodId,
        settledTxnMinor,
        originalFunctionalPortionMinor: fx.originalFunctionalPortionMinor,
        settlementFunctionalMinor: fx.settlementFunctionalMinor,
        realizedFxMinor: fx.realizedFxMinor,
        rateSetId,
        rateId: rate.id,
        rateScaled: rate.rateScaled,
        rateScale: rate.rateScale,
        journalProposal,
        schemaVersion: 1,
        version: 1,
        createdBy: actor.uid,
        createdAt: now,
        updatedBy: actor.uid,
        updatedAt: now,
        externalEgressAllowed: false,
        sarsSubmissionInitiated: false,
        externalPaymentInitiated: false,
      }
      store.settlements.set(id, settlement)
      store.positions.set(positionId, nextPosition)
      pushAudit(store, {
        orgId,
        action: 'fx.settlement.record',
        actorId: actor.uid,
        at: now,
        entityType: 'fx_settlement',
        entityId: id,
        requestId: command.requestId,
        detail: { realizedFxMinor: fx.realizedFxMinor, settledTxnMinor },
      })
      return { settlement, position: nextPosition }
    })
  }

  async createRevaluation(
    actor: FinanceActorContext,
    command: CreateRevaluationCommand,
  ): Promise<FxRevaluationRun> {
    authorizeOrgFinanceAction(actor, command.orgId, 'fx.revaluation.create')
    const id = requiredText(command.id, 'id')
    const orgId = requiredText(command.orgId, 'orgId')
    const legalEntityId = requiredText(command.legalEntityId, 'legalEntityId')
    const bookId = requiredText(command.bookId, 'bookId')
    const periodId = requiredText(command.periodId, 'periodId')
    const asOfDate = parseDate(command.asOfDate, 'asOfDate')
    const rateSetId = requiredText(command.rateSetId, 'rateSetId')
    const reverseNextPeriod = Boolean(command.reverseNextPeriod)
    requiredText(command.requestId, 'requestId')
    requiredText(command.idempotencyKey, 'idempotencyKey')
    if (reverseNextPeriod) {
      requiredText(command.reversePeriodId, 'reversePeriodId')
      parseDate(command.reversePostingDate || '', 'reversePostingDate')
    }
    const now = this.now()

    return this.mutate((store) => {
      claim(store, `fx_idem:${orgId}:${command.idempotencyKey}`, 'Idempotency key already used for revaluation')
      if (store.revaluations.has(id)) throw new MultiCurrencyFinanceValidationError('Revaluation already exists')
      const policy = findPolicy(store, orgId, bookId)
      if (!policy) throw new MultiCurrencyFinanceValidationError('FX book policy must be configured first')
      const rateSet = requireRateSet(store, rateSetId, orgId)
      if (rateSet.status !== 'approved_locked') {
        throw new MultiCurrencyFinanceValidationError('Revaluation requires an approved_locked rate set')
      }
      const openPositions = [...store.positions.values()].filter(
        (p) =>
          p.orgId === orgId &&
          p.bookId === bookId &&
          p.legalEntityId === legalEntityId &&
          p.openTxnMinor > 0,
      )
      const lines = openPositions.map((position) => {
        const rate = findRateOnOrBefore(
          store,
          rateSet,
          position.currency,
          policy.functionalCurrency,
          asOfDate,
        )
        const originalFunctionalMinor = convertTxnToFunctional(
          position.openTxnMinor,
          position.originalRateScaled,
          position.originalRateScale,
        )
        const revaluedFunctionalMinor = convertTxnToFunctional(
          position.openTxnMinor,
          rate.rateScaled,
          rate.rateScale,
        )
        const rawDiff = revaluedFunctionalMinor - originalFunctionalMinor
        const unrealizedFxMinor = position.role === 'receivable' ? rawDiff : -rawDiff
        return {
          positionId: position.id,
          documentId: position.documentId,
          currency: position.currency,
          role: position.role,
          openTxnMinor: position.openTxnMinor,
          originalFunctionalMinor,
          revaluedFunctionalMinor,
          unrealizedFxMinor,
          rateId: rate.id,
          rateScaled: rate.rateScaled,
          rateScale: rate.rateScale,
        }
      })
      const netUnrealizedMinor = lines.reduce((s, l) => s + l.unrealizedFxMinor, 0)
      const journalProposal = buildRevaluationJournal({
        functionalCurrency: policy.functionalCurrency,
        policy,
        lines,
      })
      if (!journalProposal.balanced) {
        throw new MultiCurrencyFinanceValidationError('Revaluation journal proposal is not balanced')
      }
      let reverseJournalProposal: FxJournalProposal | undefined
      if (reverseNextPeriod) {
        reverseJournalProposal = reverseJournal(journalProposal, 'fx.revaluation_reversal')
      }
      const run: FxRevaluationRun = {
        id,
        orgId,
        legalEntityId,
        bookId,
        periodId,
        asOfDate,
        rateSetId,
        status: 'draft',
        lines,
        netUnrealizedMinor,
        journalProposal,
        reverseNextPeriod,
        ...(reverseNextPeriod
          ? {
              reversePeriodId: command.reversePeriodId,
              reversePostingDate: command.reversePostingDate,
              reverseJournalProposal,
            }
          : {}),
        schemaVersion: 1,
        version: 1,
        createdBy: actor.uid,
        createdAt: now,
        updatedBy: actor.uid,
        updatedAt: now,
        externalEgressAllowed: false,
        sarsSubmissionInitiated: false,
        externalPaymentInitiated: false,
      }
      store.revaluations.set(id, run)
      pushAudit(store, {
        orgId,
        action: 'fx.revaluation.create',
        actorId: actor.uid,
        at: now,
        entityType: 'fx_revaluation_run',
        entityId: id,
        requestId: command.requestId,
        detail: { netUnrealizedMinor, lineCount: lines.length },
      })
      return run
    })
  }

  async approveRevaluation(
    actor: FinanceActorContext,
    command: ApproveRevaluationCommand,
  ): Promise<FxRevaluationRun> {
    authorizeOrgFinanceAction(actor, command.orgId, 'fx.revaluation.approve')
    const id = requiredText(command.id, 'id')
    const orgId = requiredText(command.orgId, 'orgId')
    const approvalId = requiredText(command.approvalId, 'approvalId')
    const reason = requiredText(command.reason, 'reason')
    requiredText(command.requestId, 'requestId')
    requiredText(command.idempotencyKey, 'idempotencyKey')
    const now = this.now()

    return this.mutate((store) => {
      claim(store, `fx_idem:${orgId}:${command.idempotencyKey}`, 'Idempotency key already used for revaluation approve')
      const run = store.revaluations.get(id)
      if (!run || run.orgId !== orgId) {
        throw new MultiCurrencyFinanceNotFoundError('Revaluation run not found')
      }
      if (run.status === 'approved') return run
      if (run.status !== 'draft') {
        throw new MultiCurrencyFinanceValidationError('Only draft revaluations can be approved')
      }
      for (const line of run.lines) {
        const position = store.positions.get(line.positionId)
        if (!position || position.orgId !== orgId) continue
        // Update unrealized only — never touch realized.
        store.positions.set(line.positionId, {
          ...position,
          unrealizedFxMinor: line.unrealizedFxMinor,
          updatedAt: now,
          updatedBy: actor.uid,
          version: position.version + 1,
          externalEgressAllowed: false,
          sarsSubmissionInitiated: false,
          externalPaymentInitiated: false,
        })
      }
      const next: FxRevaluationRun = {
        ...run,
        status: 'approved',
        approvalId,
        approvalActorId: actor.uid,
        approvedAt: now,
        approvalReason: reason,
        updatedAt: now,
        updatedBy: actor.uid,
        version: run.version + 1,
        externalEgressAllowed: false,
        sarsSubmissionInitiated: false,
        externalPaymentInitiated: false,
      }
      store.revaluations.set(id, next)
      pushAudit(store, {
        orgId,
        action: 'fx.revaluation.approve',
        actorId: actor.uid,
        at: now,
        entityType: 'fx_revaluation_run',
        entityId: id,
        requestId: command.requestId,
      })
      return next
    })
  }

  async buildFunctionalReport(
    actor: FinanceActorContext,
    command: BuildFunctionalReportCommand,
  ): Promise<FxFunctionalReport> {
    authorizeOrgFinanceAction(actor, command.orgId, 'fx.report.generate')
    const id = requiredText(command.id, 'id')
    const orgId = requiredText(command.orgId, 'orgId')
    const legalEntityId = requiredText(command.legalEntityId, 'legalEntityId')
    const bookId = requiredText(command.bookId, 'bookId')
    const asOfDate = parseDate(command.asOfDate, 'asOfDate')
    const rateSetId = requiredText(command.rateSetId, 'rateSetId')
    requiredText(command.requestId, 'requestId')
    requiredText(command.idempotencyKey, 'idempotencyKey')
    const now = this.now()

    return this.mutate((store) => {
      claim(store, `fx_idem:${orgId}:${command.idempotencyKey}`, 'Idempotency key already used for fx report')
      const policy = findPolicy(store, orgId, bookId)
      if (!policy) throw new MultiCurrencyFinanceValidationError('FX book policy must be configured first')
      const rateSet = requireRateSet(store, rateSetId, orgId)
      const positions = [...store.positions.values()].filter(
        (p) => p.orgId === orgId && p.bookId === bookId && p.legalEntityId === legalEntityId,
      )
      const rows = positions.map((position) => {
        let openFunctionalAtReportRateMinor = position.openFunctionalAtOriginalMinor
        if (position.openTxnMinor > 0) {
          try {
            const rate = findRateOnOrBefore(
              store,
              rateSet,
              position.currency,
              policy.functionalCurrency,
              asOfDate,
            )
            openFunctionalAtReportRateMinor = convertTxnToFunctional(
              position.openTxnMinor,
              rate.rateScaled,
              rate.rateScale,
            )
          } catch {
            openFunctionalAtReportRateMinor = position.openFunctionalAtOriginalMinor
          }
        }
        return {
          positionId: position.id,
          documentId: position.documentId,
          currency: position.currency,
          role: position.role,
          openTxnMinor: position.openTxnMinor,
          openFunctionalAtOriginalMinor: position.openFunctionalAtOriginalMinor,
          openFunctionalAtReportRateMinor,
          realizedFxMinor: position.realizedFxMinor,
          unrealizedFxMinor: position.unrealizedFxMinor,
          status: position.status,
        }
      })
      const report: FxFunctionalReport = {
        id,
        orgId,
        legalEntityId,
        bookId,
        asOfDate,
        rateSetId,
        functionalCurrency: policy.functionalCurrency,
        rows,
        totalOpenTxnMinor: rows.reduce((s, r) => s + r.openTxnMinor, 0),
        totalOpenFunctionalAtOriginalMinor: rows.reduce((s, r) => s + r.openFunctionalAtOriginalMinor, 0),
        totalOpenFunctionalAtReportRateMinor: rows.reduce(
          (s, r) => s + r.openFunctionalAtReportRateMinor,
          0,
        ),
        totalRealizedFxMinor: rows.reduce((s, r) => s + r.realizedFxMinor, 0),
        totalUnrealizedFxMinor: rows.reduce((s, r) => s + r.unrealizedFxMinor, 0),
        schemaVersion: 1,
        version: 1,
        createdBy: actor.uid,
        createdAt: now,
        updatedBy: actor.uid,
        updatedAt: now,
        externalEgressAllowed: false,
        sarsSubmissionInitiated: false,
        externalPaymentInitiated: false,
      }
      store.reports.set(id, report)
      pushAudit(store, {
        orgId,
        action: 'fx.report.generate',
        actorId: actor.uid,
        at: now,
        entityType: 'fx_functional_report',
        entityId: id,
        requestId: command.requestId,
      })
      return report
    })
  }

  async listForOrg(
    actor: FinanceActorContext,
    orgId: string,
    opts?: { bookId?: string; rateSetId?: string },
  ): Promise<{
    policies: FxBookPolicy[]
    rateSets: AccountingRateSet[]
    rates: AccountingRate[]
    documents: FxForeignDocument[]
    positions: FxMonetaryPosition[]
    settlements: FxSettlement[]
    revaluations: FxRevaluationRun[]
    reports: FxFunctionalReport[]
    noEgress: true
    externalPaymentInitiated: false
    sarsSubmissionInitiated: false
    externalEgressAllowed: false
  }> {
    authorizeOrgFinanceAction(actor, orgId, 'fx.read')
    const store = await this.load()
    const bookId = opts?.bookId
    const rateSetId = opts?.rateSetId
    const matchBook = <T extends { orgId: string; bookId?: string }>(rows: T[]) =>
      rows.filter((r) => r.orgId === orgId && (!bookId || r.bookId === bookId))

    let rateSets = matchBook([...store.rateSets.values()])
    if (rateSetId) rateSets = rateSets.filter((r) => r.id === rateSetId)
    const rateSetIds = new Set(rateSets.map((r) => r.id))
    const rates = [...store.rates.values()].filter(
      (r) => r.orgId === orgId && (!rateSetId || r.rateSetId === rateSetId) && rateSetIds.has(r.rateSetId),
    )

    return {
      policies: matchBook([...store.policies.values()]),
      rateSets,
      rates,
      documents: matchBook([...store.documents.values()]),
      positions: matchBook([...store.positions.values()]),
      settlements: matchBook([...store.settlements.values()]),
      revaluations: matchBook([...store.revaluations.values()]),
      reports: matchBook([...store.reports.values()]),
      noEgress: true,
      externalPaymentInitiated: false,
      sarsSubmissionInitiated: false,
      externalEgressAllowed: false,
    }
  }
}
