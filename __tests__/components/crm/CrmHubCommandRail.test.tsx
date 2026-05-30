import { render, screen } from '@testing-library/react'
import { CrmHubCommandRail, type CrmHubCommandMetric } from '@/components/crm/CrmHubCommandRail'

const metrics: CrmHubCommandMetric = {
  openDealsCount: 4,
  openDealsValue: 250_000,
  weightedPipelineValue: 120_000,
  recentActivityCount: 7,
  topOpenDealCount: 3,
  lostThisMonthCount: 2,
}

describe('CrmHubCommandRail', () => {
  it('renders operational next steps for sales, analytics, and setup', () => {
    render(<CrmHubCommandRail metrics={metrics} />)

    expect(screen.getByText('CRM operating rail')).toBeInTheDocument()
    expect(screen.getByText(/4 open deals worth/i)).toBeInTheDocument()
    expect(screen.getByText(/7 recent activities/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open pipeline board/i })).toHaveAttribute('href', '/portal/deals')
    expect(screen.getByRole('link', { name: /open crm reports/i })).toHaveAttribute('href', '/portal/reports/crm')
    expect(screen.getByRole('link', { name: /open crm setup/i })).toHaveAttribute('href', '/portal/settings/crm-setup')
  })

  it('surfaces an empty-pipeline action when there are no open deals', () => {
    render(<CrmHubCommandRail metrics={{ ...metrics, openDealsCount: 0, openDealsValue: 0, weightedPipelineValue: 0 }} />)

    expect(screen.getByText('Create the first live opportunity')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open new deal/i })).toHaveAttribute('href', '/portal/deals?create=deal')
  })
})
