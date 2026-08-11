import { resolvePortalOrgScope } from '@/lib/portal/scoped-routing'
import { existsSync, readFileSync } from 'fs'
import path from 'path'

const root = process.cwd()

function read(rel: string) {
  return readFileSync(path.join(root, rel), 'utf8')
}

const FINANCE_PAGES = [
  'app/(portal)/portal/finance/page.tsx',
  'app/(portal)/portal/finance/assets/page.tsx',
  'app/(portal)/portal/finance/bank-feeds/page.tsx',
  'app/(portal)/portal/finance/bank-rules/page.tsx',
  'app/(portal)/portal/finance/budgets/page.tsx',
  'app/(portal)/portal/finance/cross-org/page.tsx',
  'app/(portal)/portal/finance/cutover/page.tsx',
  'app/(portal)/portal/finance/documents/page.tsx',
  'app/(portal)/portal/finance/ess/page.tsx',
  'app/(portal)/portal/finance/expense-claims/page.tsx',
  'app/(portal)/portal/finance/intercompany/page.tsx',
  'app/(portal)/portal/finance/inventory/page.tsx',
  'app/(portal)/portal/finance/job-costing/page.tsx',
  'app/(portal)/portal/finance/multi-currency/page.tsx',
  'app/(portal)/portal/finance/packaging/page.tsx',
  'app/(portal)/portal/finance/payroll/page.tsx',
  'app/(portal)/portal/finance/period-close/page.tsx',
  'app/(portal)/portal/finance/personal/page.tsx',
  'app/(portal)/portal/finance/practice/page.tsx',
  'app/(portal)/portal/finance/proving/page.tsx',
  'app/(portal)/portal/finance/reports/page.tsx',
  'app/(portal)/portal/finance/revenue-recognition/page.tsx',
  'app/(portal)/portal/finance/runbooks/page.tsx',
  'app/(portal)/portal/finance/setup/page.tsx',
  'app/(portal)/portal/finance/statements/page.tsx',
  'app/(portal)/portal/finance/tax/page.tsx',
]

describe('usePortalOrgScope — selected-workspace inheritance', () => {
  test('explicit URL orgId stays authoritative (tenant-safe)', () => {
    expect(resolvePortalOrgScope({ orgId: 'client-a' }, 'active-b')).toEqual({
      orgId: 'client-a',
    })
    expect(resolvePortalOrgScope({ orgId: 'client-a', orgSlug: 'a' }, 'active-b')).toEqual({
      orgId: 'client-a',
      orgSlug: 'a',
    })
  })

  test('falls back to the active selected workspace when URL has no orgId', () => {
    expect(resolvePortalOrgScope({}, 'pib-platform-owner')).toEqual({
      orgId: 'pib-platform-owner',
    })
    // Other scope fields are preserved alongside the inherited orgId.
    expect(resolvePortalOrgScope({ orgSlug: 'partners' }, 'pib-platform-owner')).toEqual({
      orgSlug: 'partners',
      orgId: 'pib-platform-owner',
    })
  })

  test('returns an empty scope when neither URL nor active org is present', () => {
    expect(resolvePortalOrgScope({}, '')).toEqual({})
    expect(resolvePortalOrgScope({ orgSlug: 'partners' }, '')).toEqual({
      orgSlug: 'partners',
    })
  })
})

describe('finance portal pages inherit the selected workspace', () => {
  test('usePortalOrgScope exists and falls back to the active-org endpoint', () => {
    const src = read('lib/portal/usePortalOrgScope.ts')
    expect(src).toMatch(/\/api\/v1\/portal\/active-org/)
    expect(src).toMatch(/resolvePortalOrgScope/)
    expect(src).toContain('usePortalOrgScope')
  })

  test('every finance page uses the workspace-inheriting scope hook', () => {
    for (const rel of FINANCE_PAGES) {
      expect(existsSync(path.join(root, rel))).toBe(true)
      const src = read(rel)
      // Tenant helpers may come via useFinanceBookScope (which now uses
      // usePortalOrgScope) or via usePortalOrgScope directly. Either way the
      // page must not gate on raw URL-only scope alone.
      expect(src).toMatch(/usePortalOrgScope|useFinanceBookScope/)
      expect(src).not.toMatch(/scopeFromSearchParams\(searchParams\)/)
    }
  })

  test('useFinanceBookScope delegates to usePortalOrgScope', () => {
    const src = read('components/finance/useFinanceBookScope.ts')
    expect(src).toContain('usePortalOrgScope')
    expect(src).not.toContain('scopeFromSearchParams')
  })

  test('hub page inherits workspace scope without a URL orgId', () => {
    const hub = read('app/(portal)/portal/finance/page.tsx')
    expect(hub).toContain('usePortalOrgScope')
    expect(hub).not.toContain('scopeFromSearchParams')
    expect(hub).not.toContain('useSearchParams')
  })
})

describe('portal messages + agent org chart inherit selected workspace', () => {
  test('messages page uses usePortalOrgScope (not URL-only scope)', () => {
    const src = read('app/(portal)/portal/messages/page.tsx')
    expect(src).toContain('usePortalOrgScope')
    expect(src).not.toMatch(/scopeFromSearchParams\(/)
  })

  test('agent org chart uses usePortalOrgScope and portal/org identity', () => {
    const src = read('app/(portal)/portal/settings/agents/org-chart/page.tsx')
    expect(src).toContain('usePortalOrgScope')
    expect(src).toContain('/api/v1/portal/org')
    // Must not bind the page label to the first membership org as a name fallback.
    expect(src).not.toMatch(/orgs\.find[\s\S]*\|\|\s*orgs\[0\]/)
    expect(src).not.toMatch(/scopeFromSearchParams\(/)
  })

  test('portal shell always scopes nav with activeOrgId when URL has no orgId', () => {
    const src = read('app/(portal)/PortalLayoutClient.tsx')
    expect(src).toContain('const shellOrgId = requestedOrgId || activeOrgId')
    expect(src).toContain('shellOrgId ? scopedShellHref(item.href)')
  })
})
