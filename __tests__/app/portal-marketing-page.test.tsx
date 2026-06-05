import { render, screen } from '@testing-library/react'
import PortalMarketingPage from '@/app/(portal)/portal/marketing/page'

describe('PortalMarketingPage', () => {
  it('exposes sequence and automation controls from the marketing hub', async () => {
    render(await PortalMarketingPage({}))

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

  it('keeps marketing cards scoped when opened from a CRM company workspace', async () => {
    render(
      await PortalMarketingPage({
        searchParams: Promise.resolve({
          orgId: 'lumen-org',
          orgSlug: 'lumen-speeds',
          sourceCompanyId: 'company-1',
          sourceCompanyName: 'Lumen',
        }),
      }),
    )

    const sourceSuffix = '&sourceCompanyId=company-1&sourceCompanyName=Lumen'

    expect(screen.getByRole('region', { name: 'CRM company workspace context' })).toBeInTheDocument()
    expect(screen.getByText('Opened from CRM company')).toBeInTheDocument()
    expect(screen.getByText('Lumen is linked to lumen-speeds')).toBeInTheDocument()
    expect(screen.getByText(/New delivery work created here belongs to that organisation/)).toBeInTheDocument()
    expect(screen.getByText('Campaigns').closest('a')).toHaveAttribute(
      'href',
      `/portal/campaigns?orgId=lumen-org&orgSlug=lumen-speeds${sourceSuffix}`,
    )
    expect(screen.getByText('SEO').closest('a')).toHaveAttribute(
      'href',
      `/portal/seo?orgId=lumen-org&orgSlug=lumen-speeds${sourceSuffix}`,
    )
    expect(screen.getByText('Social overview').closest('a')).toHaveAttribute(
      'href',
      `/portal/social?orgId=lumen-org&orgSlug=lumen-speeds${sourceSuffix}`,
    )
  })
})
