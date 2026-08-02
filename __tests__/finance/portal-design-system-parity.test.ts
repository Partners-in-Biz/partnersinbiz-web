import { buildAgingBuckets, buildFinanceHubSnapshot, sumCashBalance } from '@/components/finance/financeHubMetrics'
import { FINANCE_NAV, FINANCE_PRIMARY_TABS, financeNavItem } from '@/components/finance/financeRoutes'
import { existsSync, readFileSync } from 'fs'
import path from 'path'

const root = process.cwd()

function read(rel: string) {
  return readFileSync(path.join(root, rel), 'utf8')
}

describe('finance hub metrics', () => {
  test('ages AR and AP open items into buckets', () => {
    const asOfDate = '2026-08-02'
    const bucketsAr = buildAgingBuckets(
      [
        { counterpartyRole: 'customer', outstandingMinor: 10000, dueDate: '2026-08-02', status: 'open' },
        { counterpartyRole: 'customer', outstandingMinor: 20000, dueDate: '2026-07-20', status: 'open' },
        { counterpartyRole: 'customer', outstandingMinor: 30000, dueDate: '2026-06-15', status: 'partially_paid' },
        { counterpartyRole: 'customer', outstandingMinor: 40000, dueDate: '2026-04-01', status: 'open' },
        { counterpartyRole: 'customer', outstandingMinor: 999, dueDate: '2026-01-01', status: 'closed' },
        { counterpartyRole: 'supplier', outstandingMinor: 50000, dueDate: '2026-07-01', status: 'open' },
      ],
      'customer',
      asOfDate,
    )
    expect(bucketsAr.find((b) => b.key === 'current')?.amountMinor).toBe(10000)
    expect(bucketsAr.find((b) => b.key === 'd1_30')?.amountMinor).toBe(20000)
    expect(bucketsAr.find((b) => b.key === 'd31_60')?.amountMinor).toBe(30000)
    expect(bucketsAr.find((b) => b.key === 'd90_plus')?.amountMinor).toBe(40000)

    const bucketsAp = buildAgingBuckets(
      [
        { sourceType: 'supplier_bill', outstandingMinor: 12000, dueDate: '2026-08-01', status: 'open' },
        { sourceType: 'customer_invoice', outstandingMinor: 99000, dueDate: '2026-08-01', status: 'open' },
      ],
      'supplier',
      asOfDate,
    )
    expect(bucketsAp.reduce((n, b) => n + b.amountMinor, 0)).toBe(12000)
  })

  test('sums cash balances and builds hub snapshot', () => {
    const cash = sumCashBalance([
      { currentBalanceMinor: 150000, status: 'active' },
      { ledgerBalanceMinor: 25000, status: 'active' },
      { currentBalanceMinor: 999, status: 'closed' },
    ])
    expect(cash).toEqual({ cashMinor: 175000, count: 2 })

    const snapshot = buildFinanceHubSnapshot({
      currency: 'ZAR',
      bankAccounts: [{ currentBalanceMinor: 5000 }],
      openItems: [
        { counterpartyRole: 'customer', outstandingMinor: 1000, dueDate: '2026-08-02', status: 'open' },
        { counterpartyRole: 'supplier', outstandingMinor: 2000, dueDate: '2026-08-02', status: 'open' },
      ],
      periods: [{ status: 'open' }, { status: 'closed' }],
      payRuns: [{ status: 'in_review' }, { status: 'approved_locked' }],
      taxReturns: [{ status: 'prepared' }, { status: 'draft' }],
      packagingPacks: [{ status: 'ready' }, { status: 'archived' }],
      asOfDate: '2026-08-02',
    })

    expect(snapshot.cashMinor).toBe(5000)
    expect(snapshot.arOutstandingMinor).toBe(1000)
    expect(snapshot.apOutstandingMinor).toBe(2000)
    expect(snapshot.openPeriodCount).toBe(1)
    expect(snapshot.payrollRunsInReview).toBe(1)
    expect(snapshot.payrollRunsLocked).toBe(1)
    expect(snapshot.taxReturnsReady).toBe(1)
    expect(snapshot.taxReturnsDraft).toBe(1)
    expect(snapshot.packagingReady).toBe(1)
    expect(snapshot.packagingTotal).toBe(2)
  })
})

describe('finance portal design-system parity', () => {
  const pages = [
    'app/(portal)/portal/finance/page.tsx',
    'app/(portal)/portal/finance/documents/page.tsx',
    'app/(portal)/portal/finance/ledger/page.tsx',
    'app/(portal)/portal/finance/reports/page.tsx',
    'app/(portal)/portal/finance/tax/page.tsx',
    'app/(portal)/portal/finance/payroll/page.tsx',
    'app/(portal)/portal/finance/packaging/page.tsx',
    'app/(portal)/portal/finance/intercompany/page.tsx',
    'app/(portal)/portal/finance/personal/page.tsx',
    'app/(portal)/portal/finance/cross-org/page.tsx',
    'app/(portal)/portal/finance/statements/page.tsx',
    'app/(portal)/portal/finance/cutover/page.tsx',
    'app/(portal)/portal/finance/setup/page.tsx',
    'app/(portal)/portal/finance/practice/page.tsx',
  ]

  test('shared shell components exist', () => {
    for (const rel of [
      'components/finance/FinanceModuleFrame.tsx',
      'components/finance/FinanceScopeBar.tsx',
      'components/finance/FinanceHubCommandRail.tsx',
      'components/finance/financeHubMetrics.ts',
      'components/finance/financeRoutes.ts',
    ]) {
      expect(existsSync(path.join(root, rel))).toBe(true)
    }
    expect(FINANCE_NAV.length).toBeGreaterThanOrEqual(10)
    expect(FINANCE_PRIMARY_TABS).toContain('hub')
    expect(FINANCE_PRIMARY_TABS).toContain('practice')
    expect(financeNavItem('packaging').href).toBe('/portal/finance/packaging')
    expect(financeNavItem('practice').href).toBe('/portal/finance/practice')
  })

  test('all finance portal pages mount FinanceModuleFrame + design-system primitives', () => {
    for (const rel of pages) {
      expect(existsSync(path.join(root, rel))).toBe(true)
      const src = read(rel)
      expect(src).toMatch(/FinanceModuleFrame/)
      expect(src).toMatch(/ModuleShell|FinanceModuleFrame/)
      expect(src).toMatch(/scopedPortalPath|scopeFromSearchParams|orgScope/)
      expect(src).not.toMatch(/Authenticated APIs:/)
    }

    const hub = read('app/(portal)/portal/finance/page.tsx')
    expect(hub).toMatch(/FinanceHubCommandRail/)
    expect(hub).toMatch(/finance-hub-stats|StatCard/)
    expect(hub).toMatch(/AR aging|AP aging|buildFinanceHubSnapshot/)
    expect(hub).toMatch(/No SARS/)
    expect(hub).toMatch(/scopedApiPath/)
    expect(hub).toMatch(/X-Org-Id/)

    const frame = read('components/finance/FinanceModuleFrame.tsx')
    expect(frame).toMatch(/ModuleShell/)
    expect(frame).toMatch(/PageHeader/)
    expect(frame).toMatch(/PageLinkTabs/)
    expect(frame).toMatch(/HudChip/)
    expect(frame).toMatch(/Button/)

    const scopeBar = read('components/finance/FinanceScopeBar.tsx')
    expect(scopeBar).toMatch(/ThemedSelect/)
    expect(scopeBar).toMatch(/Card/)
    expect(scopeBar).toMatch(/HudChip/)
  })

  test('hub and book-scoped pages keep tenant helpers', () => {
    const bookScoped = [
      'app/(portal)/portal/finance/documents/page.tsx',
      'app/(portal)/portal/finance/tax/page.tsx',
      'app/(portal)/portal/finance/payroll/page.tsx',
      'app/(portal)/portal/finance/packaging/page.tsx',
    ]
    for (const rel of bookScoped) {
      const src = read(rel)
      expect(src).toMatch(/FinanceScopeBar/)
      expect(src).toMatch(/useFinanceBookScope/)
    }
  })
})
