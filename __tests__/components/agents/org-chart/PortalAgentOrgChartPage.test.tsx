import { render, screen, waitFor } from '@testing-library/react'
import PortalAgentOrgChartPage from '@/app/(portal)/portal/settings/agents/org-chart/page'

jest.mock('@/lib/portal/usePortalOrgScope', () => ({
  usePortalOrgScope: () => ({ orgId: 'pib-platform-owner', orgSlug: 'partners-in-biz' }),
}))

jest.mock('@/components/agents/org-chart/AgentOrgChartClient', () => ({
  __esModule: true,
  default: (props: { agentsListUrl: string; allowRuntimeTab?: boolean; allowLiveRuntimeSync?: boolean }) => (
    <div
      data-testid="agent-org-chart-client"
      data-agents-url={props.agentsListUrl}
      data-runtime-tab={String(Boolean(props.allowRuntimeTab))}
      data-runtime-sync={String(Boolean(props.allowLiveRuntimeSync))}
    />
  ),
}))

describe('PortalAgentOrgChartPage platform admin runtime access', () => {
  beforeEach(() => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        org: { id: 'pib-platform-owner', name: 'Partners in Biz' },
        user: { role: 'admin', memberRole: 'owner' },
      }),
    }))
  })

  it('uses the full admin agent registry and runtime panel for platform admins', async () => {
    render(<PortalAgentOrgChartPage />)

    const chart = await screen.findByTestId('agent-org-chart-client')
    await waitFor(() => {
      expect(chart).toHaveAttribute('data-agents-url', '/api/v1/admin/agents')
      expect(chart).toHaveAttribute('data-runtime-tab', 'true')
      expect(chart).toHaveAttribute('data-runtime-sync', 'true')
    })
  })

  it('keeps organisation owners without platform admin authority on the restricted view', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        org: { id: 'pib-platform-owner', name: 'Partners in Biz' },
        user: { role: 'user', memberRole: 'owner' },
      }),
    }))

    render(<PortalAgentOrgChartPage />)

    const chart = await screen.findByTestId('agent-org-chart-client')
    await waitFor(() => {
      expect(chart).toHaveAttribute('data-agents-url', '/api/v1/portal/settings/agents')
      expect(chart).toHaveAttribute('data-runtime-tab', 'false')
      expect(chart).toHaveAttribute('data-runtime-sync', 'false')
    })
  })
})
