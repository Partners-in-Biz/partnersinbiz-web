import { resolvePlatformAgentBoardHref } from '@/lib/admin/dashboard-links'

describe('admin dashboard links', () => {
  it('uses the real platform workspace agent board route when the platform org is known', () => {
    expect(resolvePlatformAgentBoardHref([
      { id: 'org-1', slug: 'acme', type: 'client' },
      { id: 'pib-platform-owner', slug: 'partners-in-biz', type: 'platform_owner' },
    ])).toBe('/admin/org/partners-in-biz/agent/board')
  })

  it('falls back to the agents index instead of the removed legacy board route', () => {
    expect(resolvePlatformAgentBoardHref([])).toBe('/admin/agents')
  })
})
