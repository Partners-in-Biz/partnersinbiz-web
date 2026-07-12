import { render, screen } from '@testing-library/react'
import PortalMarketingPage from '@/app/(portal)/portal/marketing/page'

describe('PortalMarketingPage', () => {
  it('exposes sequence and automation controls from the marketing hub', async () => {
    render(await PortalMarketingPage({}))

    expect(screen.getByRole('link', { name: 'Sequences' })).toHaveAttribute(
      'href',
      '/portal/settings/sequences',
    )
    expect(screen.getByRole('link', { name: 'Automations' })).toHaveAttribute(
      'href',
      '/portal/settings/automations',
    )
    expect(screen.getByRole('link', { name: 'Email analytics' })).toHaveAttribute(
      'href',
      '/portal/email-analytics',
    )
    expect(screen.getByRole('link', { name: 'Capture sources' })).toHaveAttribute(
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
    expect(screen.getByRole('link', { name: 'Campaigns' })).toHaveAttribute(
      'href',
      `/portal/campaigns?orgId=lumen-org&orgSlug=lumen-speeds${sourceSuffix}`,
    )
    expect(screen.getByRole('link', { name: 'SEO' })).toHaveAttribute(
      'href',
      `/portal/seo?orgId=lumen-org&orgSlug=lumen-speeds${sourceSuffix}`,
    )
    expect(screen.getByRole('link', { name: 'Social overview' })).toHaveAttribute(
      'href',
      `/portal/social?orgId=lumen-org&orgSlug=lumen-speeds${sourceSuffix}`,
    )
  })
})
