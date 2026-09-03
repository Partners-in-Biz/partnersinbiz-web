import { render, screen } from '@testing-library/react'
import { CrmPipelineLedger, weightedSharePercent } from '@/components/crm/CrmPipelineLedger'

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

const metrics = {
  openDealsCount: 100,
  openDealsValue: 1_565_498,
  weightedPipelineValue: 736_198,
  wonThisMonthCount: 0,
  wonThisMonthValue: 0,
  lostThisMonthCount: 0,
  totalContacts: 396,
  newThisMonth: 0,
  activeLeads: 371,
  conversionRate: 0.056,
  convertedClients: 22,
}

describe('CrmPipelineLedger', () => {
  it('gives the open pipeline a full money figure and a weighted share of that book', () => {
    render(<CrmPipelineLedger metrics={metrics} />)

    expect(screen.getByRole('region', { name: 'CRM pipeline ledger' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open pipeline R\s?1\s?565\s?498/ })).toHaveAttribute('href', '/portal/deals')
    expect(screen.getByText('100 active deals')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Weighted forecast R\s?736\s?198, 47 percent of open pipeline/ }))
      .toHaveAttribute('href', '/portal/deals?view=forecast')
    expect(screen.getByText(/47% of open/)).toBeInTheDocument()
  })

  it('keeps supporting counts as instrument rows instead of a cloned card strip', () => {
    render(<CrmPipelineLedger metrics={metrics} />)

    expect(screen.getByRole('link', { name: /Won this month R\s?0/ })).toHaveAttribute('href', '/portal/deals?view=list')
    expect(screen.getByRole('link', { name: 'Lost this month 0' })).toHaveAttribute('href', '/portal/deals?view=list&stage=lost')
    expect(screen.getByRole('link', { name: 'Total contacts 396' })).toHaveAttribute('href', '/portal/contacts')
    expect(screen.getByRole('link', { name: 'New this month 0' })).toHaveAttribute('href', '/portal/contacts')
    expect(screen.getByRole('link', { name: 'Active leads 371' })).toHaveAttribute('href', '/portal/contacts')
    expect(screen.getByRole('link', { name: 'Conversion rate 5.6%' })).toHaveAttribute('href', '/portal/reports/crm')
    expect(screen.getByText('22 converted to clients')).toBeInTheDocument()
    expect(screen.getByText('No losses logged')).toBeInTheDocument()
  })

  it('honours workspace-scoped hrefs', () => {
    render(
      <CrmPipelineLedger
        metrics={metrics}
        buildHref={(path) => `${path}${path.includes('?') ? '&' : '?'}orgId=org-1`}
      />,
    )

    expect(screen.getByRole('link', { name: /Open pipeline/ })).toHaveAttribute('href', '/portal/deals?orgId=org-1')
    expect(screen.getByRole('link', { name: /Weighted forecast/ }))
      .toHaveAttribute('href', '/portal/deals?view=forecast&orgId=org-1')
    expect(screen.getByRole('link', { name: 'Conversion rate 5.6%' }))
      .toHaveAttribute('href', '/portal/reports/crm?orgId=org-1')
  })

  it('caps a missing or inverted weighted share at honest bounds', () => {
    expect(weightedSharePercent(0, 100)).toBe(0)
    expect(weightedSharePercent(100, 0)).toBe(0)
    expect(weightedSharePercent(100, 47)).toBe(47)
    expect(weightedSharePercent(100, 250)).toBe(100)
  })
})
