import { render, screen } from '@testing-library/react'
import { MarketingStudioDashboard } from '@/components/email-marketing/MarketingStudioDashboard'
import { MarketingStudioEntry } from '@/components/email-marketing/MarketingStudioEntry'

jest.mock('@/components/portal/FeatureFlagsProvider', () => ({
  useFeatureFlag: jest.fn(),
  useFeatureFlags: jest.fn(),
}))

import { useFeatureFlag, useFeatureFlags } from '@/components/portal/FeatureFlagsProvider'

const mockUseFeatureFlag = useFeatureFlag as jest.MockedFunction<typeof useFeatureFlag>
const mockUseFeatureFlags = useFeatureFlags as jest.MockedFunction<typeof useFeatureFlags>

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
    expect(screen.getAllByText(/Lumen/).length).toBeGreaterThan(0)
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

  it('keeps the legacy marketing hub while the organisation V2 flag is off', () => {
    mockUseFeatureFlag.mockReturnValue(false)
    mockUseFeatureFlags.mockReturnValue({ flags: {} as never, loading: false })

    render(<MarketingStudioEntry scope={scope} />)

    expect(screen.getByRole('heading', { name: 'Marketing' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Marketing Studio' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Campaigns See content campaigns/ })).toHaveAttribute(
      'href',
      expect.stringContaining('sourceCompanyId=company-1'),
    )
  })

  it('shows Marketing Studio only for opted-in organisations', () => {
    mockUseFeatureFlag.mockReturnValue(true)
    mockUseFeatureFlags.mockReturnValue({ flags: {} as never, loading: false })

    render(<MarketingStudioEntry scope={scope} />)

    expect(screen.getByRole('heading', { name: 'Marketing Studio' })).toBeInTheDocument()
  })
})
