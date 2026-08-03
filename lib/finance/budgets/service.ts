import { FinanceAuthorizationError } from '@/lib/finance/policy'
import type { FinanceActorContext } from '@/lib/finance/types'
import type {
  Budget,
  BudgetLine,
  BudgetsFinanceAction,
  CashForecastScenario,
  CashScenarioAdjustment,
  CashScenarioCompareCell,
  CashScenarioCompareRow,
  CashScenarioComparison,
  CashScenarioKind,
  CashScenarioSnapshot,
  CashflowMonthBucket,
  CashflowPlan,
  ForecastScenario,
  ReconciledCashActualsRef,
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
const SCENARIO_KINDS = new Set<CashScenarioKind>(['base', 'downside', 'upside', 'custom'])

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
  cashScenarios: Map<string, CashForecastScenario>
  cashComparisons: Map<string, CashScenarioComparison>
  cashSnapshots: Map<string, CashScenarioSnapshot>
  claims: Set<string>
}

export function createEmptyBudgetsStore(): BudgetsStore {
  return {
    budgets: new Map(),
    forecasts: new Map(),
    cashflowPlans: new Map(),
    cashScenarios: new Map(),
    cashComparisons: new Map(),
    cashSnapshots: new Map(),
    claims: new Set(),
  }
}

export function cloneBudgetsStore(store: BudgetsStore): BudgetsStore {
  return {
    budgets: new Map(store.budgets),
    forecasts: new Map(store.forecasts),
    cashflowPlans: new Map(store.cashflowPlans),
    cashScenarios: new Map(store.cashScenarios),
    cashComparisons: new Map(store.cashComparisons),
    cashSnapshots: new Map(store.cashSnapshots),
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
        (line.amountMinor < 0
          ? 'out'
          : line.accountCode?.startsWith('4')
            ? 'in'
            : line.amountMinor >= 0 && (line.accountName || '').toLowerCase().includes('income')
              ? 'in'
              : 'out')
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
      adjustmentInflowsMinor: 0,
      adjustmentOutflowsMinor: 0,
    })
    cash = closing
  }
  return months
}

function normalizeAdjustments(raw: CashScenarioAdjustment[] | undefined): CashScenarioAdjustment[] {
  if (raw == null) return []
  if (!Array.isArray(raw)) throw new BudgetsValidationError('adjustments must be an array')
  return raw.map((adj, idx) => {
    if (adj.periodKey != null && !PERIOD_KEY.test(adj.periodKey)) {
      throw new BudgetsValidationError(`adjustments[${idx}].periodKey must be YYYY-MM`)
    }
    const inflowDeltaMinor =
      adj.inflowDeltaMinor == null ? 0 : requiredInt(adj.inflowDeltaMinor, `adjustments[${idx}].inflowDeltaMinor`)
    const outflowDeltaMinor =
      adj.outflowDeltaMinor == null ? 0 : requiredInt(adj.outflowDeltaMinor, `adjustments[${idx}].outflowDeltaMinor`)
    const inflowBps = adj.inflowBps == null ? 10000 : requiredInt(adj.inflowBps, `adjustments[${idx}].inflowBps`)
    const outflowBps = adj.outflowBps == null ? 10000 : requiredInt(adj.outflowBps, `adjustments[${idx}].outflowBps`)
    if (inflowBps < 0 || outflowBps < 0 || inflowBps > 50000 || outflowBps > 50000) {
      throw new BudgetsValidationError('adjustment bps must be 0-50000')
    }
    return {
      periodKey: adj.periodKey,
      inflowDeltaMinor,
      outflowDeltaMinor,
      inflowBps,
      outflowBps,
      note: adj.note?.trim() || undefined,
    }
  })
}

/**
 * Apply named-scenario global bps + period adjustments on top of base cashflow months.
 * Re-chains opening/closing; never initiates bank movement.
 */
export function applyCashScenarioToMonths(input: {
  baseMonths: CashflowMonthBucket[]
  openingCashMinor: number
  inflowBps?: number
  outflowBps?: number
  adjustments?: CashScenarioAdjustment[]
}): CashflowMonthBucket[] {
  const opening = requiredInt(input.openingCashMinor, 'openingCashMinor')
  const inflowBps = input.inflowBps ?? 10000
  const outflowBps = input.outflowBps ?? 10000
  if (inflowBps < 0 || outflowBps < 0 || inflowBps > 50000 || outflowBps > 50000) {
    throw new BudgetsValidationError('scenario bps must be 0-50000')
  }
  const adjustments = normalizeAdjustments(input.adjustments)
  let cash = opening
  const out: CashflowMonthBucket[] = []
  for (const base of input.baseMonths) {
    const matching = adjustments.filter((a) => !a.periodKey || a.periodKey === base.periodKey)
    let periodInBps = inflowBps
    let periodOutBps = outflowBps
    let inDelta = 0
    let outDelta = 0
    for (const adj of matching) {
      // stack extra period multipliers relative to 10000 onto the global bps
      periodInBps = Math.trunc((periodInBps * (adj.inflowBps ?? 10000)) / 10000)
      periodOutBps = Math.trunc((periodOutBps * (adj.outflowBps ?? 10000)) / 10000)
      inDelta += adj.inflowDeltaMinor ?? 0
      outDelta += adj.outflowDeltaMinor ?? 0
    }
    const budgetIn = Math.trunc((base.budgetInflowsMinor * periodInBps) / 10000)
    const budgetOut = Math.trunc((base.budgetOutflowsMinor * periodOutBps) / 10000)
    // AR/AP stay as planned collections/payments unless deltas adjust total
    const ar = base.arCollectionsMinor
    const ap = base.apPaymentsMinor
    const adjIn = Math.max(0, inDelta)
    const adjOut = Math.max(0, outDelta)
    // allow negative deltas to reduce (already applied as signed)
    const signedInAdj = inDelta
    const signedOutAdj = outDelta
    const inflows = Math.max(0, budgetIn + ar + signedInAdj)
    const outflows = Math.max(0, budgetOut + ap + signedOutAdj)
    const net = inflows - outflows
    const closing = cash + net
    out.push({
      periodKey: base.periodKey,
      openingCashMinor: cash,
      inflowsMinor: inflows,
      outflowsMinor: outflows,
      netMinor: net,
      closingCashMinor: closing,
      arCollectionsMinor: ar,
      apPaymentsMinor: ap,
      budgetInflowsMinor: budgetIn,
      budgetOutflowsMinor: budgetOut,
      adjustmentInflowsMinor: signedInAdj,
      adjustmentOutflowsMinor: signedOutAdj,
    })
    cash = closing
  }
  return out
}

export function compareCashScenarioMonths(
  scenarios: Array<Pick<CashForecastScenario, 'id' | 'name' | 'kind' | 'months'>>,
): { rows: CashScenarioCompareRow[]; endingClosingByScenarioId: Record<string, number> } {
  if (!scenarios.length) throw new BudgetsValidationError('At least one scenario is required to compare')
  const periodKeys = scenarios[0].months.map((m) => m.periodKey)
  for (const s of scenarios) {
    if (s.months.length !== periodKeys.length) {
      throw new BudgetsValidationError('Scenarios must share the same horizon length to compare')
    }
    for (let i = 0; i < periodKeys.length; i++) {
      if (s.months[i].periodKey !== periodKeys[i]) {
        throw new BudgetsValidationError('Scenarios must share the same period keys to compare')
      }
    }
  }
  const rows: CashScenarioCompareRow[] = periodKeys.map((periodKey, idx) => {
    const cells: CashScenarioCompareCell[] = scenarios.map((s) => {
      const m = s.months[idx]
      return {
        scenarioId: s.id,
        kind: s.kind,
        name: s.name,
        openingCashMinor: m.openingCashMinor,
        inflowsMinor: m.inflowsMinor,
        outflowsMinor: m.outflowsMinor,
        netMinor: m.netMinor,
        closingCashMinor: m.closingCashMinor,
      }
    })
    const closings = cells.map((c) => c.closingCashMinor)
    const minClosingMinor = Math.min(...closings)
    const maxClosingMinor = Math.max(...closings)
    return {
      periodKey,
      cells,
      minClosingMinor,
      maxClosingMinor,
      spreadClosingMinor: maxClosingMinor - minClosingMinor,
    }
  })
  const endingClosingByScenarioId: Record<string, number> = {}
  for (const s of scenarios) {
    endingClosingByScenarioId[s.id] = s.months[s.months.length - 1]?.closingCashMinor ?? 0
  }
  return { rows, endingClosingByScenarioId }
}

function normalizeActuals(raw: ReconciledCashActualsRef | undefined): ReconciledCashActualsRef | undefined {
  if (raw == null) return undefined
  const asOf = requiredText(raw.asOf, 'actuals.asOf')
  if (!Array.isArray(raw.accountIds) || raw.accountIds.length === 0) {
    throw new BudgetsValidationError('actuals.accountIds required')
  }
  const accountIds = raw.accountIds.map((id, i) => requiredText(id, `actuals.accountIds[${i}]`))
  const totalCashMinor = requiredInt(raw.totalCashMinor, 'actuals.totalCashMinor')
  if (totalCashMinor < 0) throw new BudgetsValidationError('actuals.totalCashMinor must be >= 0')
  return {
    source: 'reconciled_cash_accounts',
    asOf,
    accountIds,
    totalCashMinor,
    note: raw.note?.trim() || undefined,
    readOnly: true,
    bankMovementInitiated: false,
  }
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

export interface UpsertCashScenarioCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  budgetId: string
  planId?: string
  name: string
  kind: CashScenarioKind
  status?: CashForecastScenario['status']
  openingCashMinor: number
  startPeriodKey: string
  horizonMonths: number
  inflowBps?: number
  outflowBps?: number
  adjustments?: CashScenarioAdjustment[]
  arByPeriod?: Record<string, number>
  apByPeriod?: Record<string, number>
  lineDirection?: Record<string, 'in' | 'out'>
  /** When true and no explicit openingCashMinor intent — use attached actuals total if present on update path */
  useActualsOpening?: boolean
  actuals?: ReconciledCashActualsRef
  requestId: string
  idempotencyKey: string
  expectedVersion?: number
}

export interface AttachCashActualsCommand {
  scenarioId: string
  orgId: string
  legalEntityId: string
  bookId: string
  actuals: ReconciledCashActualsRef
  /** When true, rebuild months with opening = actuals.totalCashMinor */
  applyAsOpening?: boolean
  requestId: string
  idempotencyKey: string
  expectedVersion?: number
}

export interface CompareCashScenariosCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  name: string
  scenarioIds: string[]
  requestId: string
  idempotencyKey: string
}

export interface SnapshotCashScenariosCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  name: string
  scenarioIds: string[]
  includeComparison?: boolean
  comparisonName?: string
  requestId: string
  idempotencyKey: string
}

const HARD_GATES = {
  externalPaymentInitiated: false as const,
  sarsSubmissionInitiated: false as const,
  externalEgressAllowed: false as const,
  bankMovementInitiated: false as const,
  temporaryAnalysis: true as const,
  permanentDashboard: false as const,
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

  private buildScenarioMonths(
    budget: Budget,
    command: {
      openingCashMinor: number
      startPeriodKey: string
      horizonMonths: number
      inflowBps: number
      outflowBps: number
      adjustments: CashScenarioAdjustment[]
      arByPeriod?: Record<string, number>
      apByPeriod?: Record<string, number>
      lineDirection?: Record<string, 'in' | 'out'>
    },
  ): CashflowMonthBucket[] {
    const baseMonths = buildCashflowMonths({
      startPeriodKey: command.startPeriodKey,
      horizonMonths: command.horizonMonths,
      openingCashMinor: command.openingCashMinor,
      budgetLines: budget.lines,
      lineDirection: command.lineDirection,
      revenueBps: 10000,
      expenseBps: 10000,
      arByPeriod: command.arByPeriod,
      apByPeriod: command.apByPeriod,
    })
    return applyCashScenarioToMonths({
      baseMonths,
      openingCashMinor: command.openingCashMinor,
      inflowBps: command.inflowBps,
      outflowBps: command.outflowBps,
      adjustments: command.adjustments,
    })
  }

  async upsertCashScenario(actor: FinanceActorContext, command: UpsertCashScenarioCommand): Promise<CashForecastScenario> {
    assertFinanceMembership(actor, command.orgId, 'cashflow.scenario')
    const id = requiredText(command.id, 'id')
    const orgId = requiredText(command.orgId, 'orgId')
    const legalEntityId = requiredText(command.legalEntityId, 'legalEntityId')
    const bookId = requiredText(command.bookId, 'bookId')
    const budgetId = requiredText(command.budgetId, 'budgetId')
    const name = requiredText(command.name, 'name')
    const kind = requiredText(command.kind, 'kind') as CashScenarioKind
    if (!SCENARIO_KINDS.has(kind)) throw new BudgetsValidationError('kind must be base|downside|upside|custom')
    const inflowBps = command.inflowBps == null ? 10000 : requiredInt(command.inflowBps, 'inflowBps')
    const outflowBps = command.outflowBps == null ? 10000 : requiredInt(command.outflowBps, 'outflowBps')
    const adjustments = normalizeAdjustments(command.adjustments)
    const actuals = normalizeActuals(command.actuals)
    let openingCashMinor = requiredInt(command.openingCashMinor, 'openingCashMinor')
    if (command.useActualsOpening && actuals) openingCashMinor = actuals.totalCashMinor

    const before = await this.load()
    const store = cloneBudgetsStore(before)
    claim(store, `idem:${orgId}:${command.idempotencyKey}`, 'Duplicate cash scenario request')
    const budget = store.budgets.get(budgetId)
    if (!budget || budget.orgId !== orgId || budget.legalEntityId !== legalEntityId || budget.bookId !== bookId) {
      throw new BudgetsNotFoundError('Budget not found for cash scenario')
    }
    if (command.planId) {
      const plan = store.cashflowPlans.get(command.planId)
      if (!plan || plan.orgId !== orgId || plan.budgetId !== budgetId) throw new BudgetsNotFoundError('Cashflow plan not found')
    }
    const months = this.buildScenarioMonths(budget, {
      openingCashMinor,
      startPeriodKey: command.startPeriodKey,
      horizonMonths: command.horizonMonths,
      inflowBps,
      outflowBps,
      adjustments,
      arByPeriod: command.arByPeriod,
      apByPeriod: command.apByPeriod,
      lineDirection: command.lineDirection,
    })
    const ts = this.now()
    const existing = store.cashScenarios.get(id)
    if (existing) {
      if (existing.orgId !== orgId || existing.legalEntityId !== legalEntityId || existing.bookId !== bookId) {
        throw new BudgetsNotFoundError('Cash scenario not found in scope')
      }
      if (typeof command.expectedVersion === 'number' && command.expectedVersion !== existing.version) {
        throw new BudgetsValidationError('Cash scenario version conflict')
      }
      const next: CashForecastScenario = {
        ...existing,
        budgetId,
        planId: command.planId || existing.planId,
        name,
        kind,
        status: command.status || existing.status,
        currency: budget.currency,
        openingCashMinor,
        startPeriodKey: command.startPeriodKey,
        horizonMonths: command.horizonMonths,
        inflowBps,
        outflowBps,
        adjustments,
        arByPeriod: command.arByPeriod,
        apByPeriod: command.apByPeriod,
        lineDirection: command.lineDirection,
        actuals: actuals ?? existing.actuals,
        months,
        ...HARD_GATES,
        version: existing.version + 1,
        updatedBy: actor.uid,
        updatedAt: ts,
      }
      store.cashScenarios.set(id, next)
      await this.save(before, store)
      return next
    }
    const created: CashForecastScenario = {
      id,
      orgId,
      legalEntityId,
      bookId,
      budgetId,
      planId: command.planId,
      name,
      kind,
      status: command.status || 'ready',
      currency: budget.currency,
      openingCashMinor,
      startPeriodKey: command.startPeriodKey,
      horizonMonths: command.horizonMonths,
      inflowBps,
      outflowBps,
      adjustments,
      arByPeriod: command.arByPeriod,
      apByPeriod: command.apByPeriod,
      lineDirection: command.lineDirection,
      actuals,
      months,
      ...HARD_GATES,
      schemaVersion: 1,
      version: 1,
      createdBy: actor.uid,
      createdAt: ts,
      updatedBy: actor.uid,
      updatedAt: ts,
    }
    store.cashScenarios.set(id, created)
    await this.save(before, store)
    return created
  }

  async attachCashActuals(actor: FinanceActorContext, command: AttachCashActualsCommand): Promise<CashForecastScenario> {
    assertFinanceMembership(actor, command.orgId, 'cashflow.actuals.attach')
    const scenarioId = requiredText(command.scenarioId, 'scenarioId')
    const orgId = requiredText(command.orgId, 'orgId')
    const legalEntityId = requiredText(command.legalEntityId, 'legalEntityId')
    const bookId = requiredText(command.bookId, 'bookId')
    const actuals = normalizeActuals(command.actuals)
    if (!actuals) throw new BudgetsValidationError('actuals required')

    const before = await this.load()
    const store = cloneBudgetsStore(before)
    claim(store, `idem:${orgId}:${command.idempotencyKey}`, 'Duplicate cash actuals attach')
    const existing = store.cashScenarios.get(scenarioId)
    if (!existing || existing.orgId !== orgId || existing.legalEntityId !== legalEntityId || existing.bookId !== bookId) {
      throw new BudgetsNotFoundError('Cash scenario not found')
    }
    if (typeof command.expectedVersion === 'number' && command.expectedVersion !== existing.version) {
      throw new BudgetsValidationError('Cash scenario version conflict')
    }
    const budget = store.budgets.get(existing.budgetId)
    if (!budget) throw new BudgetsNotFoundError('Budget not found for cash scenario')

    const openingCashMinor = command.applyAsOpening ? actuals.totalCashMinor : existing.openingCashMinor
    const months = this.buildScenarioMonths(budget, {
      openingCashMinor,
      startPeriodKey: existing.startPeriodKey,
      horizonMonths: existing.horizonMonths,
      inflowBps: existing.inflowBps,
      outflowBps: existing.outflowBps,
      adjustments: existing.adjustments,
      arByPeriod: existing.arByPeriod,
      apByPeriod: existing.apByPeriod,
      lineDirection: existing.lineDirection,
    })
    const ts = this.now()
    const next: CashForecastScenario = {
      ...existing,
      actuals,
      openingCashMinor,
      months,
      ...HARD_GATES,
      version: existing.version + 1,
      updatedBy: actor.uid,
      updatedAt: ts,
    }
    store.cashScenarios.set(scenarioId, next)
    await this.save(before, store)
    return next
  }

  async compareCashScenarios(actor: FinanceActorContext, command: CompareCashScenariosCommand): Promise<CashScenarioComparison> {
    assertFinanceMembership(actor, command.orgId, 'cashflow.scenario.compare')
    const id = requiredText(command.id, 'id')
    const orgId = requiredText(command.orgId, 'orgId')
    const legalEntityId = requiredText(command.legalEntityId, 'legalEntityId')
    const bookId = requiredText(command.bookId, 'bookId')
    const name = requiredText(command.name, 'name')
    if (!Array.isArray(command.scenarioIds) || command.scenarioIds.length < 2) {
      throw new BudgetsValidationError('scenarioIds must include at least two scenarios')
    }
    const before = await this.load()
    const store = cloneBudgetsStore(before)
    claim(store, `idem:${orgId}:${command.idempotencyKey}`, 'Duplicate cash scenario compare')
    const scenarios: CashForecastScenario[] = []
    for (const sid of command.scenarioIds) {
      const s = store.cashScenarios.get(sid)
      if (!s || s.orgId !== orgId || s.legalEntityId !== legalEntityId || s.bookId !== bookId) {
        throw new BudgetsNotFoundError(`Cash scenario not found: ${sid}`)
      }
      scenarios.push(s)
    }
    const { rows, endingClosingByScenarioId } = compareCashScenarioMonths(scenarios)
    const endings = Object.entries(endingClosingByScenarioId)
    endings.sort((a, b) => a[1] - b[1])
    const ts = this.now()
    const comparison: CashScenarioComparison = {
      id,
      orgId,
      legalEntityId,
      bookId,
      name,
      scenarioIds: command.scenarioIds.slice(),
      rows,
      endingClosingByScenarioId,
      lowestEndingScenarioId: endings[0][0],
      highestEndingScenarioId: endings[endings.length - 1][0],
      temporaryAnalysis: true,
      permanentDashboard: false,
      schemaVersion: 1,
      version: 1,
      createdBy: actor.uid,
      createdAt: ts,
      externalPaymentInitiated: false,
      sarsSubmissionInitiated: false,
      externalEgressAllowed: false,
      bankMovementInitiated: false,
    }
    store.cashComparisons.set(id, comparison)
    await this.save(before, store)
    return comparison
  }

  async snapshotCashScenarios(actor: FinanceActorContext, command: SnapshotCashScenariosCommand): Promise<CashScenarioSnapshot> {
    assertFinanceMembership(actor, command.orgId, 'cashflow.scenario.snapshot')
    const id = requiredText(command.id, 'id')
    const orgId = requiredText(command.orgId, 'orgId')
    const legalEntityId = requiredText(command.legalEntityId, 'legalEntityId')
    const bookId = requiredText(command.bookId, 'bookId')
    const name = requiredText(command.name, 'name')
    if (!Array.isArray(command.scenarioIds) || command.scenarioIds.length === 0) {
      throw new BudgetsValidationError('scenarioIds required')
    }
    const before = await this.load()
    const store = cloneBudgetsStore(before)
    claim(store, `idem:${orgId}:${command.idempotencyKey}`, 'Duplicate cash scenario snapshot')
    const scenarios: CashForecastScenario[] = []
    for (const sid of command.scenarioIds) {
      const s = store.cashScenarios.get(sid)
      if (!s || s.orgId !== orgId || s.legalEntityId !== legalEntityId || s.bookId !== bookId) {
        throw new BudgetsNotFoundError(`Cash scenario not found: ${sid}`)
      }
      // deep freeze copy
      scenarios.push(JSON.parse(JSON.stringify(s)) as CashForecastScenario)
    }
    let comparison: CashScenarioComparison | undefined
    if (command.includeComparison && scenarios.length >= 2) {
      const { rows, endingClosingByScenarioId } = compareCashScenarioMonths(scenarios)
      const endings = Object.entries(endingClosingByScenarioId).sort((a, b) => a[1] - b[1])
      comparison = {
        id: `${id}_cmp`,
        orgId,
        legalEntityId,
        bookId,
        name: command.comparisonName?.trim() || `${name} comparison`,
        scenarioIds: command.scenarioIds.slice(),
        rows,
        endingClosingByScenarioId,
        lowestEndingScenarioId: endings[0][0],
        highestEndingScenarioId: endings[endings.length - 1][0],
        temporaryAnalysis: true,
        permanentDashboard: false,
        schemaVersion: 1,
        version: 1,
        createdBy: actor.uid,
        createdAt: this.now(),
        externalPaymentInitiated: false,
        sarsSubmissionInitiated: false,
        externalEgressAllowed: false,
        bankMovementInitiated: false,
      }
    }
    const ts = this.now()
    const snap: CashScenarioSnapshot = {
      id,
      orgId,
      legalEntityId,
      bookId,
      name,
      capturedAt: ts,
      scenarioIds: command.scenarioIds.slice(),
      scenarios,
      comparison,
      temporaryAnalysis: true,
      permanentDashboard: false,
      schemaVersion: 1,
      version: 1,
      createdBy: actor.uid,
      createdAt: ts,
      externalPaymentInitiated: false,
      sarsSubmissionInitiated: false,
      externalEgressAllowed: false,
      bankMovementInitiated: false,
    }
    store.cashSnapshots.set(id, snap)
    await this.save(before, store)
    return snap
  }

  async getBundle(
    actor: FinanceActorContext,
    orgId: string,
    legalEntityId: string,
    bookId: string,
  ): Promise<{
    budgets: Budget[]
    forecasts: ForecastScenario[]
    cashflowPlans: CashflowPlan[]
    cashScenarios: CashForecastScenario[]
    cashComparisons: CashScenarioComparison[]
    cashSnapshots: CashScenarioSnapshot[]
    analysisMode: { temporaryAnalysis: true; permanentDashboard: false }
  }> {
    assertFinanceMembership(actor, orgId, 'budget.read')
    const store = await this.load()
    const inScope = <T extends { orgId: string; legalEntityId: string; bookId: string }>(row: T) =>
      row.orgId === orgId && row.legalEntityId === legalEntityId && row.bookId === bookId
    const budgets = [...store.budgets.values()].filter(inScope).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    const forecasts = [...store.forecasts.values()].filter(inScope).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    const cashflowPlans = [...store.cashflowPlans.values()]
      .filter(inScope)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    const cashScenarios = [...store.cashScenarios.values()]
      .filter(inScope)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    const cashComparisons = [...store.cashComparisons.values()]
      .filter(inScope)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const cashSnapshots = [...store.cashSnapshots.values()]
      .filter(inScope)
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
    return {
      budgets,
      forecasts,
      cashflowPlans,
      cashScenarios,
      cashComparisons,
      cashSnapshots,
      analysisMode: { temporaryAnalysis: true, permanentDashboard: false },
    }
  }
}
