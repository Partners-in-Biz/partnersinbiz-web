export type FinanceRouteKey =
  | 'hub'
  | 'documents'
  | 'ledger'
  | 'reports'
  | 'tax'
  | 'payroll'
  | 'packaging'
  | 'intercompany'
  | 'personal'
  | 'cross-org'
  | 'statements'
  | 'cutover'
  | 'setup'
  | 'practice'

export type FinanceNavItem = {
  key: FinanceRouteKey
  label: string
  href: string
  icon: string
  description: string
  group: 'command' | 'books' | 'ops' | 'exports'
}

/** Canonical portal finance navigation — keep hub + subpages in lockstep. */
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
    description: 'Invoices, bills, payments, bank transactions, and reconciliation.',
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
    description: 'VAT codes, periods, and return prep — no SARS submit.',
    group: 'ops',
  },
  {
    key: 'payroll',
    label: 'Payroll',
    href: '/portal/finance/payroll',
    icon: 'groups',
    description: 'ZA payroll calcs, pay runs, and payslips — no bank payout.',
    group: 'ops',
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
    key: 'practice',
    label: 'Practice',
    href: '/portal/finance/practice',
    icon: 'admin_panel_settings',
    description: 'Role matrix, multi-client switcher, notifications, and audit explorer.',
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
]

export const FINANCE_PRIMARY_TABS: FinanceRouteKey[] = [
  'hub',
  'documents',
  'ledger',
  'reports',
  'tax',
  'payroll',
  'packaging',
  'statements',
  'practice',
  'setup',
]

export function financeNavItem(key: FinanceRouteKey): FinanceNavItem {
  const item = FINANCE_NAV.find((entry) => entry.key === key)
  if (!item) throw new Error(`Unknown finance route key: ${key}`)
  return item
}
