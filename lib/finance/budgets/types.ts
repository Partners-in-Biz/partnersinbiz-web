/** Phase-4/6 budgets, forecasts, cashflow planner + named cash scenarios — planning only; no payment initiation. */

export type BudgetStatus = 'draft' | 'active' | 'closed'
export type ForecastStatus = 'draft' | 'active'
export type CashflowPlanStatus = 'draft' | 'ready'
export type CashScenarioKind = 'base' | 'downside' | 'upside' | 'custom'
export type CashScenarioStatus = 'draft' | 'ready' | 'archived'

export interface BudgetLine {
  id: string
  accountId: string
  accountCode?: string
  accountName?: string
  /** Calendar month key YYYY-MM */
  periodKey: string
  amountMinor: number
  note?: string
}

export interface Budget {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  name: string
  currency: string
  fiscalYear: number
  status: BudgetStatus
  lines: BudgetLine[]
  schemaVersion: 1
  version: number
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
  externalPaymentInitiated: false
  sarsSubmissionInitiated: false
  externalEgressAllowed: false
}

export interface ForecastScenario {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  budgetId: string
  name: string
  status: ForecastStatus
  /** Multiplier in basis points; 10000 = 100%. */
  revenueBps: number
  expenseBps: number
  note?: string
  schemaVersion: 1
  version: number
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
  externalPaymentInitiated: false
  sarsSubmissionInitiated: false
}

export interface CashflowMonthBucket {
  periodKey: string
  openingCashMinor: number
  inflowsMinor: number
  outflowsMinor: number
  netMinor: number
  closingCashMinor: number
  arCollectionsMinor: number
  apPaymentsMinor: number
  budgetInflowsMinor: number
  budgetOutflowsMinor: number
  adjustmentInflowsMinor?: number
  adjustmentOutflowsMinor?: number
}

export interface CashflowPlan {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  budgetId: string
  forecastId?: string
  name: string
  status: CashflowPlanStatus
  currency: string
  openingCashMinor: number
  horizonMonths: number
  startPeriodKey: string
  months: CashflowMonthBucket[]
  schemaVersion: 1
  version: number
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
  /** Hard gates — planner never initiates bank payouts. */
  externalPaymentInitiated: false
  sarsSubmissionInitiated: false
  externalEgressAllowed: false
}

/** Period-level additive / multiplicative tweaks on top of budget+AR/AP base months. */
export interface CashScenarioAdjustment {
  /** When omitted, applies to every month in the horizon. */
  periodKey?: string
  inflowDeltaMinor?: number
  outflowDeltaMinor?: number
  /** Extra multiplier on base inflows after budget bps; 10000 = no change. */
  inflowBps?: number
  /** Extra multiplier on base outflows after budget bps; 10000 = no change. */
  outflowBps?: number
  note?: string
}

/**
 * Optional read-only tie to reconciled cash account totals.
 * Operator supplies snapshot values — service never moves money or opens bank sessions.
 */
export interface ReconciledCashActualsRef {
  source: 'reconciled_cash_accounts'
  asOf: string
  accountIds: string[]
  totalCashMinor: number
  note?: string
  readOnly: true
  bankMovementInitiated: false
}

/** Named what-if cash scenario (base / downside / upside / custom). Temporary analysis only. */
export interface CashForecastScenario {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  budgetId: string
  planId?: string
  name: string
  kind: CashScenarioKind
  status: CashScenarioStatus
  currency: string
  openingCashMinor: number
  startPeriodKey: string
  horizonMonths: number
  /** Global inflow/outflow multipliers on budget base (10000 = 100%). */
  inflowBps: number
  outflowBps: number
  adjustments: CashScenarioAdjustment[]
  arByPeriod?: Record<string, number>
  apByPeriod?: Record<string, number>
  lineDirection?: Record<string, 'in' | 'out'>
  actuals?: ReconciledCashActualsRef
  months: CashflowMonthBucket[]
  /** Product rule: scenarios are throw-away analysis, not a permanent CEO dashboard. */
  temporaryAnalysis: true
  permanentDashboard: false
  schemaVersion: 1
  version: number
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
  externalPaymentInitiated: false
  sarsSubmissionInitiated: false
  externalEgressAllowed: false
  bankMovementInitiated: false
}

export interface CashScenarioCompareCell {
  scenarioId: string
  kind: CashScenarioKind
  name: string
  openingCashMinor: number
  inflowsMinor: number
  outflowsMinor: number
  netMinor: number
  closingCashMinor: number
}

export interface CashScenarioCompareRow {
  periodKey: string
  cells: CashScenarioCompareCell[]
  minClosingMinor: number
  maxClosingMinor: number
  spreadClosingMinor: number
}

export interface CashScenarioComparison {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  name: string
  scenarioIds: string[]
  rows: CashScenarioCompareRow[]
  endingClosingByScenarioId: Record<string, number>
  lowestEndingScenarioId: string
  highestEndingScenarioId: string
  temporaryAnalysis: true
  permanentDashboard: false
  schemaVersion: 1
  version: number
  createdBy: string
  createdAt: string
  externalPaymentInitiated: false
  sarsSubmissionInitiated: false
  externalEgressAllowed: false
  bankMovementInitiated: false
}

/** Frozen point-in-time capture of scenarios (+ optional comparison). No bank movement. */
export interface CashScenarioSnapshot {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  name: string
  capturedAt: string
  scenarioIds: string[]
  scenarios: CashForecastScenario[]
  comparison?: CashScenarioComparison
  temporaryAnalysis: true
  permanentDashboard: false
  schemaVersion: 1
  version: 1
  createdBy: string
  createdAt: string
  externalPaymentInitiated: false
  sarsSubmissionInitiated: false
  externalEgressAllowed: false
  bankMovementInitiated: false
}

export type BudgetsFinanceAction =
  | 'budget.configure'
  | 'budget.read'
  | 'forecast.configure'
  | 'cashflow.plan'
  | 'cashflow.scenario'
  | 'cashflow.scenario.compare'
  | 'cashflow.scenario.snapshot'
  | 'cashflow.actuals.attach'
