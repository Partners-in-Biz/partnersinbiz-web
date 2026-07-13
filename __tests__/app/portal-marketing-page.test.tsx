import { render, screen } from '@testing-library/react'
import PortalMarketingPage from '@/app/(portal)/portal/marketing/page'
import { useFeatureFlag, useFeatureFlags } from '@/components/portal/FeatureFlagsProvider'

jest.mock('@/components/portal/FeatureFlagsProvider', () => ({
  useFeatureFlag: jest.fn(),
  useFeatureFlags: jest.fn(),
}))

const mockUseFeatureFlag = useFeatureFlag as jest.MockedFunction<typeof useFeatureFlag>
const mockUseFeatureFlags = useFeatureFlags as jest.MockedFunction<typeof useFeatureFlags>

describe('PortalMarketingPage', () => {
  beforeEach(() => {
    mockUseFeatureFlag.mockReturnValue(false)
    mockUseFeatureFlags.mockReturnValue({ flags: {} as never, loading: false })
  })

  it('defaults to the legacy hub and exposes its sequence and automation controls', async () => {
    render(await PortalMarketingPage({}))

    expect(screen.getByRole('heading', { name: 'Marketing' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Marketing Studio' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Journey Sequences/ })).toHaveAttribute(
      'href',
      '/portal/settings/sequences',
    )
    expect(screen.getByRole('link', { name: /Rules Automations/ })).toHaveAttribute(
      'href',
      '/portal/settings/automations',
    )
    expect(screen.getByRole('link', { name: /Reporting Email analytics/ })).toHaveAttribute(
      'href',
      '/portal/email-analytics',
    )
    expect(screen.getByRole('link', { name: /Leads Capture sources/ })).toHaveAttribute(
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
    expect(screen.getByRole('link', { name: /Content Campaigns/ })).toHaveAttribute(
      'href',
      `/portal/campaigns?orgId=lumen-org&orgSlug=lumen-speeds${sourceSuffix}`,
    )
    expect(screen.getByRole('link', { name: /Search SEO/ })).toHaveAttribute(
      'href',
      `/portal/seo?orgId=lumen-org&orgSlug=lumen-speeds${sourceSuffix}`,
    )
    expect(screen.getByRole('link', { name: /Review Social overview/ })).toHaveAttribute(
      'href',
      `/portal/social?orgId=lumen-org&orgSlug=lumen-speeds${sourceSuffix}`,
    )
  })

  it('renders the V2 studio with CRM scope preserved for opted-in organisations', async () => {
    mockUseFeatureFlag.mockReturnValue(true)

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

    const scope = '?orgId=lumen-org&orgSlug=lumen-speeds&sourceCompanyId=company-1&sourceCompanyName=Lumen'

    expect(screen.getByRole('heading', { name: 'Marketing Studio' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Marketing' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute(
      'href',
      `/portal/marketing${scope}`,
    )
    expect(screen.getByRole('link', { name: 'Journeys' })).toHaveAttribute(
      'href',
      `/portal/sequences${scope}`,
    )
    expect(screen.getByRole('link', { name: 'Inbox & replies' })).toHaveAttribute(
      'href',
      `/portal/email/inbound${scope}`,
    )
  })
})
