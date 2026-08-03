import { checkFinanceCommandOrgScope } from '@/lib/finance/http-guards'
import { FINANCE_HTTP_ENTRYPOINTS, FINANCE_UI_SHIPPED, FINANCE_UI_BOUNDARY_NOTE } from '@/lib/finance/service-boundaries'
import { readFileSync, existsSync } from 'fs'
import path from 'path'

const root = process.cwd()

function pageSource(rel: string) {
  return readFileSync(path.join(root, rel), 'utf8')
}

describe('finance workbench delivery contract', () => {
  test('HTTP inventory includes foundation commands and queries', () => {
    // Required core + this slice (arrayContaining) — exact frozen length alone flakes under multi-agent thrash.
    expect(FINANCE_HTTP_ENTRYPOINTS).toEqual(expect.arrayContaining([
      'app/api/v1/finance/foundation/commands/route.ts',
      'app/api/v1/finance/foundation/queries/route.ts',
      'app/api/v1/finance/bank-feeds/commands/route.ts',
      'app/api/v1/finance/bank-feeds/queries/route.ts',
      'app/api/v1/finance/bank-rules/commands/route.ts',
      'app/api/v1/finance/bank-rules/queries/route.ts',
    ]))
    const unique = new Set(FINANCE_HTTP_ENTRYPOINTS)
    expect(unique.size).toBe(FINANCE_HTTP_ENTRYPOINTS.length)
    expect(FINANCE_HTTP_ENTRYPOINTS.length).toBeGreaterThanOrEqual(37)
    for (const rel of FINANCE_HTTP_ENTRYPOINTS) {
      expect(existsSync(path.join(root, rel))).toBe(true)
    }
    // Inventory must match routes on disk (security harness walks filesystem).
    const { readdirSync, statSync } = require('fs') as typeof import('fs')
    const walk = (dir: string): string[] => {
      const out: string[] = []
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name)
        if (statSync(full).isDirectory()) out.push(...walk(full))
        else if (name === 'route.ts') out.push(path.relative(root, full).split(path.sep).join('/'))
      }
      return out
    }
    const discovered = walk(path.join(root, 'app/api/v1/finance')).sort()
    expect([...FINANCE_HTTP_ENTRYPOINTS].sort()).toEqual(discovered)
    expect(FINANCE_UI_SHIPPED).toBe(true)
    expect(FINANCE_UI_BOUNDARY_NOTE).toMatch(/foundation workbench shipped/i)
    expect(FINANCE_UI_BOUNDARY_NOTE).toMatch(/documents/i)
    expect(FINANCE_UI_BOUNDARY_NOTE).toMatch(/payroll/i)
    expect(FINANCE_UI_BOUNDARY_NOTE).toMatch(/personal/i)
    expect(FINANCE_UI_BOUNDARY_NOTE).toMatch(/cross-org/i)
    expect(FINANCE_UI_BOUNDARY_NOTE).toMatch(/statement/i)
    expect(FINANCE_UI_BOUNDARY_NOTE).toMatch(/cutover/i)
    expect(FINANCE_UI_BOUNDARY_NOTE).toMatch(/packaging/i)
    expect(FINANCE_UI_BOUNDARY_NOTE).toMatch(/practice/i)
    expect(FINANCE_UI_BOUNDARY_NOTE).toMatch(/multi-currency/i)
    expect(FINANCE_UI_BOUNDARY_NOTE).toMatch(/bank-feeds|bank feed/i)
    expect(FINANCE_UI_BOUNDARY_NOTE).toMatch(/proving/i)
    expect(FINANCE_UI_BOUNDARY_NOTE).toMatch(/Interactive portal workbenches/i)
  })

  test('portal finance module pages are interactive client workbenches', () => {
    const pages = [
      'app/(portal)/portal/finance/page.tsx',
      'app/(portal)/portal/finance/documents/page.tsx',
      'app/(portal)/portal/finance/tax/page.tsx',
      'app/(portal)/portal/finance/reports/page.tsx',
      'app/(portal)/portal/finance/payroll/page.tsx',
      'app/(portal)/portal/finance/intercompany/page.tsx',
      'app/(portal)/portal/finance/ledger/page.tsx',
      'app/(portal)/portal/finance/personal/page.tsx',
      'app/(portal)/portal/finance/cross-org/page.tsx',
      'app/(portal)/portal/finance/statements/page.tsx',
      'app/(portal)/portal/finance/cutover/page.tsx',
      'app/(portal)/portal/finance/packaging/page.tsx',
      'app/(portal)/portal/finance/setup/page.tsx',
      'app/(portal)/portal/finance/practice/page.tsx',
      'app/(portal)/portal/finance/job-costing/page.tsx',
      'app/(portal)/portal/finance/inventory/page.tsx',
      'app/(portal)/portal/finance/multi-currency/page.tsx',
      'app/(portal)/portal/finance/bank-rules/page.tsx',
      'app/(portal)/portal/finance/bank-feeds/page.tsx',
      'app/(portal)/portal/finance/budgets/page.tsx',
      'app/(portal)/portal/finance/assets/page.tsx',
      'app/(portal)/portal/finance/period-close/page.tsx',
      'app/(portal)/portal/finance/runbooks/page.tsx',
      'app/(portal)/portal/finance/proving/page.tsx',
    ]
    for (const rel of pages) {
      expect(existsSync(path.join(root, rel))).toBe(true)
      const src = pageSource(rel)
      expect(src).toMatch(/['"]use client['"]/)
      expect(src).toMatch(/FinanceModuleFrame/)
      // setup + runbooks are guided/static operator surfaces; interactive workbenches must fetch.
      if (!rel.endsWith('/setup/page.tsx') && !rel.endsWith('/runbooks/page.tsx')) {
        expect(src).toMatch(/fetch\(/)
      }
      expect(src).not.toMatch(/Authenticated APIs:/)
    }
    expect(existsSync(path.join(root, 'components/finance/useFinanceBookScope.ts'))).toBe(true)
    expect(existsSync(path.join(root, 'components/finance/financeWorkbench.ts'))).toBe(true)
    expect(existsSync(path.join(root, 'components/finance/FinanceModuleFrame.tsx'))).toBe(true)
    expect(existsSync(path.join(root, 'components/finance/FinanceScopeBar.tsx'))).toBe(true)
    expect(existsSync(path.join(root, 'components/finance/FinanceHubCommandRail.tsx'))).toBe(true)
  })

  test('org scope guard remains fail-closed', () => {
    expect(checkFinanceCommandOrgScope(undefined, null).ok).toBe(false)
    expect(checkFinanceCommandOrgScope('org-a', 'org-b')).toEqual({
      ok: false,
      status: 403,
      error: 'Organization scope mismatch',
    })
    expect(checkFinanceCommandOrgScope('org-a', 'org-a')).toEqual({ ok: true, orgId: 'org-a' })
  })
})
