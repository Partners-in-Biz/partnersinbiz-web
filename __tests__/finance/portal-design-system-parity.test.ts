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
    'app/(portal)/portal/finance/ess/page.tsx',
    'app/(portal)/portal/finance/packaging/page.tsx',
    'app/(portal)/portal/finance/intercompany/page.tsx',
    'app/(portal)/portal/finance/personal/page.tsx',
    'app/(portal)/portal/finance/cross-org/page.tsx',
    'app/(portal)/portal/finance/statements/page.tsx',
    'app/(portal)/portal/finance/cutover/page.tsx',
    'app/(portal)/portal/finance/setup/page.tsx',
    'app/(portal)/portal/finance/runbooks/page.tsx',
    'app/(portal)/portal/finance/practice/page.tsx',
    'app/(portal)/portal/finance/job-costing/page.tsx',
    'app/(portal)/portal/finance/inventory/page.tsx',
    // Phase 4 competitor-parity surfaces (must keep FinanceModuleFrame + tenant scope helpers)
    'app/(portal)/portal/finance/assets/page.tsx',
    'app/(portal)/portal/finance/revenue-recognition/page.tsx',
    'app/(portal)/portal/finance/bank-rules/page.tsx',
    'app/(portal)/portal/finance/bank-feeds/page.tsx',
    'app/(portal)/portal/finance/budgets/page.tsx',
    'app/(portal)/portal/finance/multi-currency/page.tsx',
    'app/(portal)/portal/finance/period-close/page.tsx',
    'app/(portal)/portal/finance/proving/page.tsx',
    'app/(portal)/portal/finance/expense-claims/page.tsx',
  ]

  test('shared shell components exist', () => {
    for (const rel of [
      'components/finance/FinanceModuleFrame.tsx',
      'components/finance/FinanceScopeBar.tsx',
      'components/finance/FinanceHubCommandRail.tsx',
      'components/finance/FinanceRoleHubModules.tsx',
      'components/finance/FinanceGuidedWorkflowStepper.tsx',
      'components/finance/financeHubMetrics.ts',
      'components/finance/financeRoutes.ts',
      'lib/finance/role-ux/catalog.ts',
      'lib/finance/role-ux/types.ts',
    ]) {
      expect(existsSync(path.join(root, rel))).toBe(true)
    }
    expect(FINANCE_NAV.length).toBeGreaterThanOrEqual(10)
    expect(FINANCE_PRIMARY_TABS).toContain('hub')
    expect(FINANCE_PRIMARY_TABS).toContain('practice')
    expect(FINANCE_PRIMARY_TABS).toContain('runbooks')
    expect(financeNavItem('packaging').href).toBe('/portal/finance/packaging')
    expect(financeNavItem('job-costing').href).toBe('/portal/finance/job-costing')
    expect(financeNavItem('inventory').href).toBe('/portal/finance/inventory')
    expect(financeNavItem('practice').href).toBe('/portal/finance/practice')
    expect(financeNavItem('runbooks').href).toBe('/portal/finance/runbooks')
    expect(financeNavItem('period-close').href).toBe('/portal/finance/period-close')
    expect(FINANCE_PRIMARY_TABS).toContain('period-close')
    expect(financeNavItem('proving').href).toBe('/portal/finance/proving')
    expect(financeNavItem('expense-claims').href).toBe('/portal/finance/expense-claims')
    expect(financeNavItem('ess').href).toBe('/portal/finance/ess')
    expect(financeNavItem('revenue-recognition').href).toBe('/portal/finance/revenue-recognition')
    expect(FINANCE_PRIMARY_TABS).toContain('proving')
    expect(FINANCE_PRIMARY_TABS).toContain('ess')
    expect(FINANCE_PRIMARY_TABS).toContain('revenue-recognition')
  })

  test('all finance portal pages mount FinanceModuleFrame + design-system primitives', () => {
    for (const rel of pages) {
      expect(existsSync(path.join(root, rel))).toBe(true)
      const src = read(rel)
      expect(src).toMatch(/FinanceModuleFrame/)
      expect(src).toMatch(/ModuleShell|FinanceModuleFrame/)
      // Tenant helpers may be direct (scopedPortalPath/orgScope) or via useFinanceBookScope.
      expect(src).toMatch(/scopedPortalPath|scopeFromSearchParams|orgScope|useFinanceBookScope/)
      expect(src).not.toMatch(/Authenticated APIs:/)
    }

    const hub = read('app/(portal)/portal/finance/page.tsx')
    expect(hub).toMatch(/FinanceHubCommandRail/)
    expect(hub).toMatch(/FinanceRoleHubModules/)
    expect(hub).toMatch(/FinanceGuidedWorkflowStepper/)
    expect(hub).toMatch(/finance-hub-stats|StatCard/)
    expect(hub).toMatch(/AR aging|AP aging|buildFinanceHubSnapshot/)
    expect(hub).toMatch(/No SARS/)
    expect(hub).toMatch(/scopedApiPath/)
    expect(hub).toMatch(/X-Org-Id/)

    const practice = read('app/(portal)/portal/finance/practice/page.tsx')
    expect(practice).toMatch(/Notification centre|practice-notifications/)
    expect(practice).toMatch(/practice-audit-export-csv|Export CSV/)
    expect(practice).toMatch(/exportAuditEventsCsv/)
    expect(practice).toMatch(/filterNotificationsForCentre/)
    expect(practice).toMatch(/practice-audit-table|Audit explorer/)
    expect(practice).toMatch(/practice-grants|Firm→client grants|firm→client grants/)
    expect(practice).toMatch(/practice-queue|Practice queue/)
    expect(practice).toMatch(/prepare|review|file-export/)

    const frame = read('components/finance/FinanceModuleFrame.tsx')
    expect(frame).toMatch(/ModuleShell/)
    expect(frame).toMatch(/PageHeader/)
    expect(frame).toMatch(/PageLinkTabs/)
    expect(frame).toMatch(/Status/)
    expect(frame).toMatch(/Button|ButtonLink/)

    const scopeBar = read('components/finance/FinanceScopeBar.tsx')
    expect(scopeBar).toMatch(/ThemedSelect/)
    expect(scopeBar).toMatch(/st-panel|Panel/)
    expect(scopeBar).toMatch(/Status/)
  })

  test('hub and book-scoped pages keep tenant helpers', () => {
    const bookScoped = [
      'app/(portal)/portal/finance/documents/page.tsx',
      'app/(portal)/portal/finance/tax/page.tsx',
      'app/(portal)/portal/finance/payroll/page.tsx',
      'app/(portal)/portal/finance/ess/page.tsx',
      'app/(portal)/portal/finance/packaging/page.tsx',
      'app/(portal)/portal/finance/job-costing/page.tsx',
      'app/(portal)/portal/finance/inventory/page.tsx',
      'app/(portal)/portal/finance/assets/page.tsx',
      'app/(portal)/portal/finance/revenue-recognition/page.tsx',
      'app/(portal)/portal/finance/bank-rules/page.tsx',
      'app/(portal)/portal/finance/bank-feeds/page.tsx',
      'app/(portal)/portal/finance/budgets/page.tsx',
      'app/(portal)/portal/finance/multi-currency/page.tsx',
      'app/(portal)/portal/finance/period-close/page.tsx',
    ]
    for (const rel of bookScoped) {
      const src = read(rel)
      expect(src).toMatch(/FinanceScopeBar/)
      expect(src).toMatch(/useFinanceBookScope/)
    }

    const jobCosting = read('app/(portal)/portal/finance/job-costing/page.tsx')
    expect(jobCosting).toMatch(/StatCard/)
    expect(jobCosting).toMatch(/HudChip/)
    expect(jobCosting).toMatch(/closed-loop|closed loop/i)
    expect(jobCosting).toMatch(/draft_invoice_lines/)
    expect(jobCosting).toMatch(/No SARS/)

    // Nav lock: Phase 4/5 routes remain discoverable from the shared finance nav.
    for (const key of ['assets', 'revenue-recognition', 'bank-rules', 'budgets', 'multi-currency', 'job-costing', 'practice', 'period-close', 'runbooks', 'setup', 'proving', 'ess'] as const) {
      expect(financeNavItem(key).href).toMatch(/^\/portal\/finance/)
    }
  })
})


describe('budgets cash scenarios portal density', () => {
  test('budgets page exposes named scenarios panel and temporary analysis chips', () => {
    const src = require('fs').readFileSync('app/(portal)/portal/finance/budgets/page.tsx', 'utf8')
    expect(src).toContain('cash-scenarios-panel')
    expect(src).toContain('Temporary analysis')
    expect(src).toContain('No permanent CEO dashboard')
    expect(src).toContain('cashflow.scenario.upsert')
    expect(src).toContain('cashflow.scenario.compare')
    expect(src).toContain('cashflow.scenario.snapshot')
    expect(src).toContain('cashflow.actuals.attach')
    expect(src).toContain('StatCard')
    expect(src).toContain('Owner')
    expect(src).toContain('Bookkeeper')
  })
})
