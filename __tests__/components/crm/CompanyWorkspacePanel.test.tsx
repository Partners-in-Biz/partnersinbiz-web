import { render, screen } from '@testing-library/react'
import { CompanyWorkspacePanel } from '@/components/crm/CompanyWorkspacePanel'

describe('CompanyWorkspacePanel', () => {
  it('links a CRM company to the full admin organisation workspace when a linked org exists', () => {
    render(
      <CompanyWorkspacePanel
        companyName="Lumen"
        mode="admin"
        workspace={{ id: 'client-org', slug: 'lumen-speeds', name: 'Lumen Speeds' }}
      />,
    )

    expect(screen.getByText('Lumen Speeds workspace')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open marketing workspace for Lumen' })).toHaveAttribute('href', '/admin/org/lumen-speeds/marketing')
    expect(screen.getByRole('link', { name: 'Open SEO workspace for Lumen' })).toHaveAttribute('href', '/admin/org/lumen-speeds/seo')
    expect(screen.getByRole('link', { name: 'Open social workspace for Lumen' })).toHaveAttribute('href', '/admin/org/lumen-speeds/social')
    expect(screen.getByRole('link', { name: 'Open ads workspace for Lumen' })).toHaveAttribute('href', '/admin/org/lumen-speeds/ads/campaigns')
    expect(screen.getByRole('link', { name: 'Open research workspace for Lumen' })).toHaveAttribute('href', '/admin/org/lumen-speeds/research')
    expect(screen.getByRole('link', { name: 'Open reports workspace for Lumen' })).toHaveAttribute('href', '/admin/reports?orgId=client-org')
    expect(screen.getByRole('link', { name: 'Open projects workspace for Lumen' })).toHaveAttribute('href', '/admin/org/lumen-speeds/projects')
    expect(screen.getByRole('link', { name: 'Open documents workspace for Lumen' })).toHaveAttribute('href', '/admin/org/lumen-speeds/documents')
  })

  it('keeps linked company workspace cards scoped to the linked organisation when rendered from portal CRM', () => {
    render(
      <CompanyWorkspacePanel
        companyName="Lumen"
        mode="portal"
        workspace={{ id: 'client-org', slug: 'lumen-speeds', name: 'Lumen Speeds' }}
      />,
    )

    expect(screen.getByRole('link', { name: 'Open marketing workspace for Lumen' })).toHaveAttribute('href', '/portal/marketing?orgId=client-org&orgSlug=lumen-speeds')
    expect(screen.getByRole('link', { name: 'Open campaigns workspace for Lumen' })).toHaveAttribute('href', '/portal/campaigns?orgId=client-org&orgSlug=lumen-speeds')
    expect(screen.getByRole('link', { name: 'Open SEO workspace for Lumen' })).toHaveAttribute('href', '/portal/seo?orgId=client-org&orgSlug=lumen-speeds')
    expect(screen.getByRole('link', { name: 'Open social workspace for Lumen' })).toHaveAttribute('href', '/portal/social?orgId=client-org&orgSlug=lumen-speeds')
    expect(screen.getByRole('link', { name: 'Open ads workspace for Lumen' })).toHaveAttribute('href', '/portal/ads?orgId=client-org&orgSlug=lumen-speeds')
    expect(screen.getByRole('link', { name: 'Open research workspace for Lumen' })).toHaveAttribute('href', '/portal/research?orgId=client-org&orgSlug=lumen-speeds')
    expect(screen.getByRole('link', { name: 'Open reports workspace for Lumen' })).toHaveAttribute('href', '/portal/reports?orgId=client-org&orgSlug=lumen-speeds')
    expect(screen.getByRole('link', { name: 'Open projects workspace for Lumen' })).toHaveAttribute('href', '/portal/projects?orgId=client-org&orgSlug=lumen-speeds')
    expect(screen.getByRole('link', { name: 'Open documents workspace for Lumen' })).toHaveAttribute('href', '/portal/documents?orgId=client-org&orgSlug=lumen-speeds')
    expect(screen.getByRole('link', { name: 'Open brand workspace for Lumen' })).toHaveAttribute('href', '/portal/branding?orgId=client-org&orgSlug=lumen-speeds')
    expect(screen.getByRole('link', { name: 'Open communications workspace for Lumen' })).toHaveAttribute('href', '/portal/messages?orgId=client-org&orgSlug=lumen-speeds')
    expect(screen.getByRole('link', { name: 'Open capture sources workspace for Lumen' })).toHaveAttribute('href', '/portal/capture-sources?orgId=client-org&orgSlug=lumen-speeds')
    expect(screen.getByRole('link', { name: 'Open integrations workspace for Lumen' })).toHaveAttribute('href', '/portal/integrations?orgId=client-org&orgSlug=lumen-speeds')
    expect(screen.getByRole('link', { name: 'Open email domains workspace for Lumen' })).toHaveAttribute('href', '/portal/email-domains?orgId=client-org&orgSlug=lumen-speeds')
    expect(screen.getByRole('link', { name: 'Open settings workspace for Lumen' })).toHaveAttribute('href', '/portal/settings/organization?orgId=client-org&orgSlug=lumen-speeds')
    expect(screen.getByRole('link', { name: 'Open wiki workspace for Lumen' })).toHaveAttribute('href', '/portal/wiki?orgId=client-org&orgSlug=lumen-speeds')
    expect(screen.getByRole('link', { name: 'Open Lumen Speeds dashboard for Lumen' })).toHaveAttribute('href', '/portal/dashboard?orgId=client-org&orgSlug=lumen-speeds')
  })

  it('shows a relationship setup state when the company is not linked to an organisation', () => {
    render(<CompanyWorkspacePanel companyName="Standalone prospect" mode="admin" workspace={null} />)

    expect(screen.getByText('CRM-only company workspace')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Open marketing workspace/i })).not.toBeInTheDocument()
  })
})
