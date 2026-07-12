import { render, screen } from '@testing-library/react'
import { MarketingStudioDashboard } from '@/components/email-marketing/MarketingStudioDashboard'

const scope = {
  orgId: 'client-org',
  orgSlug: 'lumen-speeds',
  sourceCompanyId: 'company-1',
  sourceCompanyName: 'Lumen',
}

describe('MarketingStudioDashboard', () => {
  it('renders a compact, honest front door over existing email routes', () => {
    render(<MarketingStudioDashboard scope={scope} />)

    expect(screen.getByRole('heading', { name: 'Marketing Studio' })).toBeInTheDocument()
    expect(screen.getByText(/Lumen/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /create email campaign/i })).toHaveAttribute(
      'href',
      '/portal/campaigns/email/new?orgId=client-org&orgSlug=lumen-speeds&sourceCompanyId=company-1&sourceCompanyName=Lumen',
    )

    const navigation = screen.getByRole('navigation', { name: 'Marketing Studio' })
    expect(navigation).toHaveClass('overflow-x-auto')
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute(
      'href',
      '/portal/marketing?orgId=client-org&orgSlug=lumen-speeds&sourceCompanyId=company-1&sourceCompanyName=Lumen',
    )
    expect(screen.getByRole('link', { name: 'Campaigns' })).toHaveAttribute(
      'href',
      '/portal/campaigns?orgId=client-org&orgSlug=lumen-speeds&sourceCompanyId=company-1&sourceCompanyName=Lumen',
    )
    expect(screen.getByRole('link', { name: 'Journeys' })).toHaveAttribute(
      'href',
      '/portal/sequences?orgId=client-org&orgSlug=lumen-speeds&sourceCompanyId=company-1&sourceCompanyName=Lumen',
    )
    expect(screen.getByRole('link', { name: 'Inbox & replies' })).toHaveAttribute(
      'href',
      '/portal/email/inbound?orgId=client-org&orgSlug=lumen-speeds&sourceCompanyId=company-1&sourceCompanyName=Lumen',
    )
    expect(screen.getByRole('link', { name: 'Deliverability' })).toHaveAttribute(
      'href',
      '/portal/email-deliverability?orgId=client-org&orgSlug=lumen-speeds&sourceCompanyId=company-1&sourceCompanyName=Lumen',
    )

    expect(screen.getByRole('heading', { name: 'Work queue' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /broadcasts/i })).toHaveAttribute(
      'href',
      '/portal/broadcasts?orgId=client-org&orgSlug=lumen-speeds&sourceCompanyId=company-1&sourceCompanyName=Lumen',
    )
    expect(screen.getByRole('heading', { name: 'Sender health' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /domain setup/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /list health/i })).toBeInTheDocument()

    expect(screen.queryByText(/revenue/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/qualified leads/i)).not.toBeInTheDocument()
  })
})
