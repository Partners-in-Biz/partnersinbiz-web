/** Phase-4 budgets, forecasts, and cashflow planner — planning only; no payment initiation. */

export type BudgetStatus = 'draft' | 'active' | 'closed'
export type ForecastStatus = 'draft' | 'active'
export type CashflowPlanStatus = 'draft' | 'ready'

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

export type BudgetsFinanceAction =
  | 'budget.configure'
  | 'budget.read'
  | 'forecast.configure'
  | 'cashflow.plan'
