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
    expect(FINANCE_HTTP_ENTRYPOINTS).toEqual(expect.arrayContaining([
      'app/api/v1/finance/foundation/commands/route.ts',
      'app/api/v1/finance/foundation/queries/route.ts',
      'app/api/v1/finance/reports/queries/route.ts',
      'app/api/v1/finance/tax/commands/route.ts',
      'app/api/v1/finance/tax/queries/route.ts',
      'app/api/v1/finance/documents/commands/route.ts',
      'app/api/v1/finance/documents/queries/route.ts',
      'app/api/v1/finance/intercompany/commands/route.ts',
      'app/api/v1/finance/intercompany/queries/route.ts',
      'app/api/v1/finance/payroll/commands/route.ts',
      'app/api/v1/finance/payroll/queries/route.ts',
      'app/api/v1/finance/personal/commands/route.ts',
      'app/api/v1/finance/personal/queries/route.ts',
      'app/api/v1/finance/cross-org/commands/route.ts',
      'app/api/v1/finance/cross-org/queries/route.ts',
      'app/api/v1/finance/statements/commands/route.ts',
      'app/api/v1/finance/statements/queries/route.ts',
      'app/api/v1/finance/cutover/commands/route.ts',
      'app/api/v1/finance/cutover/queries/route.ts',
      'app/api/v1/finance/packaging/commands/route.ts',
      'app/api/v1/finance/packaging/queries/route.ts',
    ]))
    expect(FINANCE_HTTP_ENTRYPOINTS).toHaveLength(21)
    expect(FINANCE_UI_SHIPPED).toBe(true)
    expect(FINANCE_UI_BOUNDARY_NOTE).toMatch(/foundation workbench shipped/i)
    expect(FINANCE_UI_BOUNDARY_NOTE).toMatch(/documents/i)
    expect(FINANCE_UI_BOUNDARY_NOTE).toMatch(/payroll/i)
    expect(FINANCE_UI_BOUNDARY_NOTE).toMatch(/personal/i)
    expect(FINANCE_UI_BOUNDARY_NOTE).toMatch(/cross-org/i)
    expect(FINANCE_UI_BOUNDARY_NOTE).toMatch(/statement/i)
    expect(FINANCE_UI_BOUNDARY_NOTE).toMatch(/cutover/i)
    expect(FINANCE_UI_BOUNDARY_NOTE).toMatch(/packaging/i)
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
    ]
    for (const rel of pages) {
      expect(existsSync(path.join(root, rel))).toBe(true)
      const src = pageSource(rel)
      expect(src).toMatch(/['"]use client['"]/)
      expect(src).toMatch(/FinanceModuleFrame/)
      if (!rel.endsWith('/setup/page.tsx')) {
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
