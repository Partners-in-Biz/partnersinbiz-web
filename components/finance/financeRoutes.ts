export type FinanceRouteKey =
  | 'hub'
  | 'documents'
  | 'expense-claims'
  | 'ledger'
  | 'reports'
  | 'tax'
  | 'payroll'
  | 'ess'
  | 'assets'
  | 'job-costing'
  | 'inventory'
  | 'packaging'
  | 'intercompany'
  | 'personal'
  | 'cross-org'
  | 'statements'
  | 'bank-rules'
  | 'bank-feeds'
  | 'budgets'
  | 'cutover'
  | 'multi-currency'
  | 'practice'
  | 'setup'
  | 'runbooks'
  | 'period-close'
  | 'proving'
  | 'revenue-recognition'

export type FinanceNavItem = {
  key: FinanceRouteKey
  label: string
  href: string
  icon: string
  description: string
  group: 'command' | 'books' | 'ops' | 'exports'
}

/** Canonical portal finance navigation - keep hub + subpages in lockstep. */
export const FINANCE_NAV: FinanceNavItem[] = [
  {
    key: 'hub',
    label: 'Command',
    href: '/portal/finance',
    icon: 'dashboard',
    description: 'Cash, AR/AP aging, periods, payroll, tax, and packaging snapshot.',
    group: 'command',
  },
  {
    key: 'documents',
    label: 'AR / AP',
    href: '/portal/finance/documents',
    icon: 'receipt_long',
    description: 'Invoices, bills, credit/debit notes, recurring docs, statements, bulk ops, aging, attachments.',
    group: 'ops',
  },
  {
    key: 'expense-claims',
    label: 'Expense claims',
    href: '/portal/finance/expense-claims',
    icon: 'receipt',
    description: 'Staff claims: draft → submit → approve → post; VAT lines; receipts + OCR assist (confirm-only); no payment initiate.',
    group: 'ops',
  },
  {
    key: 'ledger',
    label: 'Ledger',
    href: '/portal/finance/ledger',
    icon: 'menu_book',
    description: 'Periods, chart of accounts, and journal posting.',
    group: 'books',
  },
  {
    key: 'reports',
    label: 'Reports',
    href: '/portal/finance/reports',
    icon: 'query_stats',
    description: 'Trial balance, income statement, and balance sheet.',
    group: 'books',
  },
  {
    key: 'tax',
    label: 'Tax',
    href: '/portal/finance/tax',
    icon: 'percent',
    description: 'VAT codes, periods, and return prep - no SARS submit.',
    group: 'ops',
  },
  {
    key: 'payroll',
    label: 'Payroll',
    href: '/portal/finance/payroll',
    icon: 'groups',
    description: 'ZA payroll calcs, pay runs, and payslips - no bank payout.',
    group: 'ops',
  },
  {
    key: 'ess',
    label: 'ESS',
    href: '/portal/finance/ess',
    icon: 'badge',
    description: 'Mobile/PWA employee self-service: own payslips + leave request/approval routing - no admin payroll controls.',
    group: 'ops',
  },
  {
    key: 'assets',
    label: 'Assets',
    href: '/portal/finance/assets',
    icon: 'precision_manufacturing',
    description: 'Fixed asset register, straight-line depreciation, disposal, NBV reports.',
    group: 'books',
  },
  {
    key: 'revenue-recognition',
    label: 'Revenue recognition',
    href: '/portal/finance/revenue-recognition',
    icon: 'trending_up',
    description: 'Lite deferred revenue schedules (straight-line / milestone) linked to AR contracts; period runs, reverse, deferred vs billed.',
    group: 'books',
  },
  {
    key: 'job-costing',
    label: 'Job costing',
    href: '/portal/finance/job-costing',
    icon: 'work',
    description: 'Project dimensions, project P&L / WIP, and optional time costing without double-billing.',
    group: 'books',
  },
  {
    key: 'inventory',
    label: 'Inventory',
    href: '/portal/finance/inventory',
    icon: 'shelves',
    description: 'SKU master, stock on hand, bill/invoice qty movements, COGS on issue, audited adjustments - no WMS/POS.',
    group: 'books',
  },
  {
    key: 'packaging',
    label: 'Packaging',
    href: '/portal/finance/packaging',
    icon: 'inventory_2',
    description: 'SARS-ready, payment instruction, and accountant download packs.',
    group: 'exports',
  },
  {
    key: 'statements',
    label: 'Statements',
    href: '/portal/finance/statements',
    icon: 'account_balance',
    description: 'Bank statement import and human-gated recon suggestions.',
    group: 'ops',
  },
  {
    key: 'bank-rules',
    label: 'Bank rules',
    href: '/portal/finance/bank-rules',
    icon: 'rule',
    description: 'Match rules for smarter recon suggestions - human accept only, never auto-pay.',
    group: 'ops',
  },
  {
    key: 'bank-feeds',
    label: 'Bank feeds',
    href: '/portal/finance/bank-feeds',
    icon: 'account_balance_wallet',
    description: 'Mock-first bank feed connector: sync SA lines + suggestions - human accept/dismiss only, no paid vendor.',
    group: 'ops',
  },
  {
    key: 'budgets',
    label: 'Budgets',
    href: '/portal/finance/budgets',
    icon: 'savings',
    description: 'Budgets, forecast scenarios, and cashflow planner (no payment initiation).',
    group: 'books',
  },
  {
    key: 'intercompany',
    label: 'Intercompany',
    href: '/portal/finance/intercompany',
    icon: 'hub',
    description: 'Pairs, receive confirm, eliminations, consolidation views.',
    group: 'books',
  },
  {
    key: 'personal',
    label: 'Personal',
    href: '/portal/finance/personal',
    icon: 'person',
    description: 'Owner-private personal books workspace.',
    group: 'books',
  },
  {
    key: 'cross-org',
    label: 'Cross-org',
    href: '/portal/finance/cross-org',
    icon: 'swap_horiz',
    description: 'Cross-org payment notify/confirm (no external initiate).',
    group: 'ops',
  },
  {
    key: 'cutover',
    label: 'Cutover',
    href: '/portal/finance/cutover',
    icon: 'flag',
    description: 'Opening balances and cutover activation controls.',
    group: 'books',
  },
  {
    key: 'multi-currency',
    label: 'Multi-currency',
    href: '/portal/finance/multi-currency',
    icon: 'currency_exchange',
    description: 'FX rate sets, revaluation journals, and functional currency reports.',
    group: 'books',
  },
  {
    key: 'practice',
    label: 'Practice',
    href: '/portal/finance/practice',
    icon: 'admin_panel_settings',
    description: 'Role matrix, multi-client switcher, notifications, and audit explorer.',
    group: 'command',
  },
  {
    key: 'period-close',
    label: 'Period close',
    href: '/portal/finance/period-close',
    icon: 'event_available',
    description: 'Close-week blockers with deep links - unreconciled banks, unapproved journals, open pay runs, FX reval, cutover.',
    group: 'command',
  },
  {
    key: 'setup',
    label: 'Setup',
    href: '/portal/finance/setup',
    icon: 'tune',
    description: 'Bootstrap path for legal entity, book, and periods.',
    group: 'command',
  },
  {
    key: 'runbooks',
    label: 'Runbooks',
    href: '/portal/finance/runbooks',
    icon: 'menu_book',
    description: 'Operator day-0 through Phase 6 market-proof runbooks, hard gates, and acceptance pack pointers.',
    group: 'command',
  },
  {
    key: 'proving',
    label: 'Proving kit',
    href: '/portal/finance/proving',
    icon: 'verified',
    description: 'Deterministic demo company, multi-period close fixture, packaging dry-run, accountant acceptance checklist.',
    group: 'command',
  },
]

export const FINANCE_PRIMARY_TABS: FinanceRouteKey[] = [
  'hub',
  'documents',
  'expense-claims',
  'ledger',
  'reports',
  'tax',
  'payroll',
  'ess',
  'assets',
  'revenue-recognition',
  'job-costing',
  'inventory',
  'packaging',
  'statements',
  'bank-rules',
  'bank-feeds',
  'budgets',
  'multi-currency',
  'practice',
  'period-close',
  'setup',
  'runbooks',
  'proving',
]

export function financeNavItem(key: FinanceRouteKey): FinanceNavItem {
  const item = FINANCE_NAV.find((entry) => entry.key === key)
  if (!item) throw new Error(`Unknown finance route key: ${key}`)
  return item
}
