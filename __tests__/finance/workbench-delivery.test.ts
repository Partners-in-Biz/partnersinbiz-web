import { checkFinanceCommandOrgScope } from '@/lib/finance/http-guards'
import { FINANCE_HTTP_ENTRYPOINTS, FINANCE_UI_SHIPPED, FINANCE_UI_BOUNDARY_NOTE } from '@/lib/finance/service-boundaries'

describe('finance workbench delivery contract', () => {
  test('HTTP inventory includes foundation commands and queries', () => {
    expect(FINANCE_HTTP_ENTRYPOINTS).toEqual(expect.arrayContaining([
      'app/api/v1/finance/foundation/commands/route.ts',
      'app/api/v1/finance/foundation/queries/route.ts',
      'app/api/v1/finance/reports/queries/route.ts',
    ]))
    expect(FINANCE_UI_SHIPPED).toBe(true)
    expect(FINANCE_UI_BOUNDARY_NOTE).toMatch(/foundation workbench shipped/i)
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
