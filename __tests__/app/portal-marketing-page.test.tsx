import { render, screen } from '@testing-library/react'
import PortalMarketingPage from '@/app/(portal)/portal/marketing/page'

describe('PortalMarketingPage', () => {
  it('exposes sequence and automation controls from the marketing hub', () => {
    render(<PortalMarketingPage />)

    expect(screen.getByRole('link', { name: /Sequences/i })).toHaveAttribute(
      'href',
      '/portal/settings/sequences',
    )
    expect(screen.getByRole('link', { name: /Automations/i })).toHaveAttribute(
      'href',
      '/portal/settings/automations',
    )
    expect(screen.getByRole('link', { name: /Email analytics/i })).toHaveAttribute(
      'href',
      '/portal/email-analytics',
    )
    expect(screen.getByRole('link', { name: /Capture sources/i })).toHaveAttribute(
      'href',
      '/portal/capture-sources',
    )
  })
})
