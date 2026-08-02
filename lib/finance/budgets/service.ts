import { FinanceAuthorizationError } from '@/lib/finance/policy'
import type { FinanceActorContext } from '@/lib/finance/types'
import type {
  Budget,
  BudgetLine,
  BudgetsFinanceAction,
  CashflowMonthBucket,
  CashflowPlan,
  ForecastScenario,
} from './types'

export class BudgetsValidationError extends Error {
  readonly statusCode = 400
  constructor(message: string) {
    super(message)
    this.name = 'BudgetsValidationError'
  }
}

export class BudgetsNotFoundError extends Error {
  readonly statusCode = 404
  constructor(message: string) {
    super(message)
    this.name = 'BudgetsNotFoundError'
  }
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new BudgetsValidationError(`${field} is required`)
  return value.trim()
}

function requiredInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new BudgetsValidationError(`${field} must be an integer`)
  }
  return value
}

const PERIOD_KEY = /^\d{4}-\d{2}$/

function assertFinanceMembership(actor: FinanceActorContext, orgId: string, action: BudgetsFinanceAction) {
  if (!actor.membershipActive) throw new FinanceAuthorizationError('Active organization membership is required')
  if (actor.orgId !== orgId) throw new FinanceAuthorizationError('Actor organization does not match finance scope')
  if (!actor.financeModuleEnabled) throw new FinanceAuthorizationError('Persisted Finance module capability is required')
  const isOrgAdmin = actor.membershipRole === 'owner' || actor.membershipRole === 'admin'
  const writeRoles = new Set(['finance_admin', 'accountant', 'bookkeeper'])
  const readRoles = new Set(['finance_admin', 'accountant', 'bookkeeper', 'finance_approver', 'finance_viewer'])
  const rolesNeeded = action === 'budget.read' ? readRoles : writeRoles
  const has = actor.assignments.some(
    (a) => a.orgId === orgId && a.userId === actor.uid && a.status === 'active' && rolesNeeded.has(a.role),
  )
  if (!isOrgAdmin && !has) throw new FinanceAuthorizationError(`Finance role required for ${action}`)
  if (actor.delegationId) {
    if (actor.delegationOrgId !== orgId) {
      throw new FinanceAuthorizationError('Delegation organization does not match finance scope')
    }
    const scopes = actor.delegationScopes ?? []
    const ok = scopes.includes('finance:*') || scopes.some((s) => s.startsWith('finance:')) || scopes.includes(`finance:${action}`)
    if (!ok) throw new FinanceAuthorizationError('Delegation does not grant budgets access')
  }
}

export interface BudgetsStore {
  budgets: Map<string, Budget>
  forecasts: Map<string, ForecastScenario>
  cashflowPlans: Map<string, CashflowPlan>
  claims: Set<string>
}

export function createEmptyBudgetsStore(): BudgetsStore {
  return {
    budgets: new Map(),
    forecasts: new Map(),
    cashflowPlans: new Map(),
    claims: new Set(),
  }
}

export function cloneBudgetsStore(store: BudgetsStore): BudgetsStore {
  return {
    budgets: new Map(store.budgets),
    forecasts: new Map(store.forecasts),
    cashflowPlans: new Map(store.cashflowPlans),
    claims: new Set(store.claims),
  }
}

function claim(store: BudgetsStore, key: string, message: string) {
  if (store.claims.has(key)) throw new BudgetsValidationError(message)
  store.claims.add(key)
}

function normalizeLines(lines: BudgetLine[]): BudgetLine[] {
  if (!Array.isArray(lines) || lines.length === 0) throw new BudgetsValidationError('Budget requires at least one line')
  const out: BudgetLine[] = []
  for (const line of lines) {
    const id = requiredText(line.id, 'line.id')
    const accountId = requiredText(line.accountId, 'line.accountId')
    const periodKey = requiredText(line.periodKey, 'line.periodKey')
    if (!PERIOD_KEY.test(periodKey)) throw new BudgetsValidationError('line.periodKey must be YYYY-MM')
    const amountMinor = requiredInt(line.amountMinor, 'line.amountMinor')
    out.push({
      id,
      accountId,
      accountCode: line.accountCode?.trim() || undefined,
      accountName: line.accountName?.trim() || undefined,
      periodKey,
      amountMinor,
      note: line.note?.trim() || undefined,
    })
  }
  return out
}

export function addMonths(periodKey: string, months: number): string {
  const [y, m] = periodKey.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + months, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Positive amountMinor on income-like accounts = inflow; expense-like = outflow. Caller tags direction. */
export function buildCashflowMonths(input: {
  startPeriodKey: string
  horizonMonths: number
  openingCashMinor: number
  budgetLines: BudgetLine[]
  /** optional direction map accountId -> 'in' | 'out'; default expense out, income in via amount sign convention: +in -out */
  lineDirection?: Record<string, 'in' | 'out'>
  revenueBps?: number
  expenseBps?: number
  /** Opening AR expected collections by period */
  arByPeriod?: Record<string, number>
  /** Opening AP expected payments by period (positive numbers = cash out) */
  apByPeriod?: Record<string, number>
}): CashflowMonthBucket[] {
  if (!PERIOD_KEY.test(input.startPeriodKey)) throw new BudgetsValidationError('startPeriodKey must be YYYY-MM')
  const horizon = requiredInt(input.horizonMonths, 'horizonMonths')
  if (horizon < 1 || horizon > 36) throw new BudgetsValidationError('horizonMonths must be 1-36')
  const opening = requiredInt(input.openingCashMinor, 'openingCashMinor')
  const revBps = input.revenueBps ?? 10000
  const expBps = input.expenseBps ?? 10000
  let cash = opening
  const months: CashflowMonthBucket[] = []
  for (let i = 0; i < horizon; i++) {
    const periodKey = addMonths(input.startPeriodKey, i)
    let budgetIn = 0
    let budgetOut = 0
    for (const line of input.budgetLines) {
      if (line.periodKey !== periodKey) continue
      const dir =
        input.lineDirection?.[line.accountId] ||
        (line.amountMinor < 0 ? 'out' : line.accountCode?.startsWith('4') ? 'in' : line.amountMinor >= 0 && (line.accountName || '').toLowerCase().includes('income') ? 'in' : 'out')
      const abs = Math.abs(line.amountMinor)
      if (dir === 'in') budgetIn += Math.trunc((abs * revBps) / 10000)
      else budgetOut += Math.trunc((abs * expBps) / 10000)
    }
    const ar = input.arByPeriod?.[periodKey] || 0
    const ap = input.apByPeriod?.[periodKey] || 0
    if (!Number.isInteger(ar) || ar < 0) throw new BudgetsValidationError('arByPeriod values must be non-negative integers')
    if (!Number.isInteger(ap) || ap < 0) throw new BudgetsValidationError('apByPeriod values must be non-negative integers')
    const inflows = budgetIn + ar
    const outflows = budgetOut + ap
    const net = inflows - outflows
    const closing = cash + net
    months.push({
      periodKey,
      openingCashMinor: cash,
      inflowsMinor: inflows,
      outflowsMinor: outflows,
      netMinor: net,
      closingCashMinor: closing,
      arCollectionsMinor: ar,
      apPaymentsMinor: ap,
      budgetInflowsMinor: budgetIn,
      budgetOutflowsMinor: budgetOut,
    })
    cash = closing
  }
  return months
}

export interface UpsertBudgetCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  name: string
  currency?: string
  fiscalYear: number
  status?: Budget['status']
  lines: BudgetLine[]
  requestId: string
  idempotencyKey: string
  expectedVersion?: number
}

export interface UpsertForecastCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  budgetId: string
  name: string
  revenueBps?: number
  expenseBps?: number
  note?: string
  status?: ForecastScenario['status']
  requestId: string
  idempotencyKey: string
  expectedVersion?: number
}

export interface BuildCashflowPlanCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  budgetId: string
  forecastId?: string
  name: string
  openingCashMinor: number
  startPeriodKey: string
  horizonMonths: number
  arByPeriod?: Record<string, number>
  apByPeriod?: Record<string, number>
  lineDirection?: Record<string, 'in' | 'out'>
  requestId: string
  idempotencyKey: string
}

export class BudgetsFinanceService {
  constructor(
    private readonly load: () => Promise<BudgetsStore>,
    private readonly save: (before: BudgetsStore, after: BudgetsStore) => Promise<void>,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async upsertBudget(actor: FinanceActorContext, command: UpsertBudgetCommand): Promise<Budget> {
    assertFinanceMembership(actor, command.orgId, 'budget.configure')
    const id = requiredText(command.id, 'id')
    const orgId = requiredText(command.orgId, 'orgId')
    const legalEntityId = requiredText(command.legalEntityId, 'legalEntityId')
    const bookId = requiredText(command.bookId, 'bookId')
    const name = requiredText(command.name, 'name')
    const fiscalYear = requiredInt(command.fiscalYear, 'fiscalYear')
    const lines = normalizeLines(command.lines)
    const before = await this.load()
    const store = cloneBudgetsStore(before)
    claim(store, `idem:${orgId}:${command.idempotencyKey}`, 'Duplicate budget request')
    const ts = this.now()
    const existing = store.budgets.get(id)
    if (existing) {
      if (existing.orgId !== orgId || existing.legalEntityId !== legalEntityId || existing.bookId !== bookId) {
        throw new BudgetsNotFoundError('Budget not found in scope')
      }
      if (typeof command.expectedVersion === 'number' && command.expectedVersion !== existing.version) {
        throw new BudgetsValidationError('Budget version conflict')
      }
      const next: Budget = {
        ...existing,
        name,
        fiscalYear,
        currency: (command.currency || existing.currency || 'ZAR').toUpperCase(),
        status: command.status || existing.status,
        lines,
        version: existing.version + 1,
        updatedBy: actor.uid,
        updatedAt: ts,
        externalPaymentInitiated: false,
        sarsSubmissionInitiated: false,
        externalEgressAllowed: false,
      }
      store.budgets.set(id, next)
      await this.save(before, store)
      return next
    }
    const created: Budget = {
      id,
      orgId,
      legalEntityId,
      bookId,
      name,
      currency: (command.currency || 'ZAR').toUpperCase(),
      fiscalYear,
      status: command.status || 'draft',
      lines,
      schemaVersion: 1,
      version: 1,
      createdBy: actor.uid,
      createdAt: ts,
      updatedBy: actor.uid,
      updatedAt: ts,
      externalPaymentInitiated: false,
      sarsSubmissionInitiated: false,
      externalEgressAllowed: false,
    }
    store.budgets.set(id, created)
    await this.save(before, store)
    return created
  }

  async upsertForecast(actor: FinanceActorContext, command: UpsertForecastCommand): Promise<ForecastScenario> {
    assertFinanceMembership(actor, command.orgId, 'forecast.configure')
    const id = requiredText(command.id, 'id')
    const orgId = requiredText(command.orgId, 'orgId')
    const legalEntityId = requiredText(command.legalEntityId, 'legalEntityId')
    const bookId = requiredText(command.bookId, 'bookId')
    const budgetId = requiredText(command.budgetId, 'budgetId')
    const name = requiredText(command.name, 'name')
    const revenueBps = command.revenueBps == null ? 10000 : requiredInt(command.revenueBps, 'revenueBps')
    const expenseBps = command.expenseBps == null ? 10000 : requiredInt(command.expenseBps, 'expenseBps')
    if (revenueBps < 0 || expenseBps < 0 || revenueBps > 50000 || expenseBps > 50000) {
      throw new BudgetsValidationError('bps multipliers must be 0-50000')
    }
    const before = await this.load()
    const store = cloneBudgetsStore(before)
    claim(store, `idem:${orgId}:${command.idempotencyKey}`, 'Duplicate forecast request')
    const budget = store.budgets.get(budgetId)
    if (!budget || budget.orgId !== orgId || budget.legalEntityId !== legalEntityId || budget.bookId !== bookId) {
      throw new BudgetsNotFoundError('Budget not found for forecast')
    }
    const ts = this.now()
    const existing = store.forecasts.get(id)
    if (existing) {
      if (existing.orgId !== orgId) throw new BudgetsNotFoundError('Forecast not found')
      const next: ForecastScenario = {
        ...existing,
        name,
        budgetId,
        revenueBps,
        expenseBps,
        note: command.note?.trim() || undefined,
        status: command.status || existing.status,
        version: existing.version + 1,
        updatedBy: actor.uid,
        updatedAt: ts,
        externalPaymentInitiated: false,
        sarsSubmissionInitiated: false,
      }
      store.forecasts.set(id, next)
      await this.save(before, store)
      return next
    }
    const created: ForecastScenario = {
      id,
      orgId,
      legalEntityId,
      bookId,
      budgetId,
      name,
      status: command.status || 'draft',
      revenueBps,
      expenseBps,
      note: command.note?.trim() || undefined,
      schemaVersion: 1,
      version: 1,
      createdBy: actor.uid,
      createdAt: ts,
      updatedBy: actor.uid,
      updatedAt: ts,
      externalPaymentInitiated: false,
      sarsSubmissionInitiated: false,
    }
    store.forecasts.set(id, created)
    await this.save(before, store)
    return created
  }

  async buildCashflowPlan(actor: FinanceActorContext, command: BuildCashflowPlanCommand): Promise<CashflowPlan> {
    assertFinanceMembership(actor, command.orgId, 'cashflow.plan')
    const id = requiredText(command.id, 'id')
    const orgId = requiredText(command.orgId, 'orgId')
    const legalEntityId = requiredText(command.legalEntityId, 'legalEntityId')
    const bookId = requiredText(command.bookId, 'bookId')
    const budgetId = requiredText(command.budgetId, 'budgetId')
    const name = requiredText(command.name, 'name')
    const before = await this.load()
    const store = cloneBudgetsStore(before)
    claim(store, `idem:${orgId}:${command.idempotencyKey}`, 'Duplicate cashflow plan request')
    const budget = store.budgets.get(budgetId)
    if (!budget || budget.orgId !== orgId || budget.legalEntityId !== legalEntityId || budget.bookId !== bookId) {
      throw new BudgetsNotFoundError('Budget not found for cashflow plan')
    }
    let revenueBps = 10000
    let expenseBps = 10000
    if (command.forecastId) {
      const fc = store.forecasts.get(command.forecastId)
      if (!fc || fc.orgId !== orgId || fc.budgetId !== budgetId) throw new BudgetsNotFoundError('Forecast not found')
      revenueBps = fc.revenueBps
      expenseBps = fc.expenseBps
    }
    const months = buildCashflowMonths({
      startPeriodKey: command.startPeriodKey,
      horizonMonths: command.horizonMonths,
      openingCashMinor: command.openingCashMinor,
      budgetLines: budget.lines,
      lineDirection: command.lineDirection,
      revenueBps,
      expenseBps,
      arByPeriod: command.arByPeriod,
      apByPeriod: command.apByPeriod,
    })
    const ts = this.now()
    const plan: CashflowPlan = {
      id,
      orgId,
      legalEntityId,
      bookId,
      budgetId,
      forecastId: command.forecastId,
      name,
      status: 'ready',
      currency: budget.currency,
      openingCashMinor: command.openingCashMinor,
      horizonMonths: command.horizonMonths,
      startPeriodKey: command.startPeriodKey,
      months,
      schemaVersion: 1,
      version: 1,
      createdBy: actor.uid,
      createdAt: ts,
      updatedBy: actor.uid,
      updatedAt: ts,
      externalPaymentInitiated: false,
      sarsSubmissionInitiated: false,
      externalEgressAllowed: false,
    }
    store.cashflowPlans.set(id, plan)
    await this.save(before, store)
    return plan
  }

  async getBundle(
    actor: FinanceActorContext,
    orgId: string,
    legalEntityId: string,
    bookId: string,
  ): Promise<{ budgets: Budget[]; forecasts: ForecastScenario[]; cashflowPlans: CashflowPlan[] }> {
    assertFinanceMembership(actor, orgId, 'budget.read')
    const store = await this.load()
    const budgets = [...store.budgets.values()]
      .filter((b) => b.orgId === orgId && b.legalEntityId === legalEntityId && b.bookId === bookId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    const forecasts = [...store.forecasts.values()]
      .filter((f) => f.orgId === orgId && f.legalEntityId === legalEntityId && f.bookId === bookId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    const cashflowPlans = [...store.cashflowPlans.values()]
      .filter((p) => p.orgId === orgId && p.legalEntityId === legalEntityId && p.bookId === bookId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return { budgets, forecasts, cashflowPlans }
  }
}
