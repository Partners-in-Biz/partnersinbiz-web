import { render, screen, within } from '@testing-library/react'
import { GeoSeoWorkspace, type GeoSeoWorkspaceRecord } from '@/components/geo-seo/GeoSeoWorkspace'
import { GeoSeoWorkspaceDetail } from '@/components/geo-seo/GeoSeoWorkspaceDetail'

const workspace: GeoSeoWorkspaceRecord = {
  id: 'geo-1',
  siteName: 'Lumen Speeds',
  siteUrl: 'https://lumen.example',
  status: 'active',
  mode: 'foundation_sprint',
  currentGeoScore: 72,
  previousGeoScore: 64,
  lastAuditAt: '2026-06-01T10:00:00.000Z',
  nextAuditAt: '2026-07-01T10:00:00.000Z',
  linkedSeoSprintId: 'seo-1',
  auditState: 'needs-review',
  reportState: 'draft',
}

describe('GeoSeoWorkspace', () => {
  it('renders GEO SEO as a sibling workspace with workspace, audit, and report states', () => {
    render(<GeoSeoWorkspace workspaces={[workspace]} />)

    expect(screen.getByRole('heading', { name: 'GEO SEO Manager' })).toBeInTheDocument()
    expect(screen.getByText(/AI search visibility operating system/)).toBeInTheDocument()
    expect(screen.getByText((_, element) => element?.textContent === 'Workspace active')).toBeInTheDocument()
    expect(screen.getByText((_, element) => element?.textContent === 'Audit needs-review')).toBeInTheDocument()
    expect(screen.getByText((_, element) => element?.textContent === 'Report draft')).toBeInTheDocument()
    expect(screen.getByText('+8 pts')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open workspace/i })).toHaveAttribute('href', '/portal/geo-seo/workspaces/geo-1')
  })

  it('preserves CRM source-company and linked-organisation context in the banner and links', () => {
    render(
      <GeoSeoWorkspace
        surface="portal"
        workspaces={[workspace]}
        orgScope={{
          orgId: 'linked-org',
          orgSlug: 'lumen-speeds',
          sourceCompanyId: 'company-1',
          sourceCompanyName: 'Lumen CRM',
        }}
      />,
    )

    expect(screen.getByRole('region', { name: 'CRM company workspace context' })).toBeInTheDocument()
    expect(screen.getByText('Lumen CRM is linked to lumen-speeds')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open workspace/i })).toHaveAttribute(
      'href',
      '/portal/geo-seo/workspaces/geo-1?orgId=linked-org&orgSlug=lumen-speeds&sourceCompanyId=company-1&sourceCompanyName=Lumen+CRM',
    )
  })

  it('keeps client-visible report actions gated until approval', () => {
    render(<GeoSeoWorkspace workspaces={[workspace]} />)

    expect(screen.getByText('Client report actions gated')).toBeInTheDocument()
    expect(screen.getByText(/Share, publish, and client-visible report actions require explicit approval/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Publish report/i })).not.toBeInTheDocument()
  })

  it('preserves Marketing Hub, source-company, linked-org, and workspace context on detail pages', () => {
    render(
      <GeoSeoWorkspaceDetail
        surface="admin"
        workspace={{ ...workspace, sourceCompanyName: 'Lumen CRM' }}
        orgScope={{ orgId: 'linked-org', orgSlug: 'lumen-speeds', sourceCompanyName: 'Lumen CRM' }}
        backHref="/admin/org/lumen-speeds/geo-seo"
      />,
    )

    const breadcrumbs = screen.getByRole('navigation', { name: 'GEO SEO workspace breadcrumbs' })
    expect(within(breadcrumbs).getByRole('link', { name: 'Marketing Hub' })).toHaveAttribute('href', '/admin')
    expect(within(breadcrumbs).getByRole('link', { name: 'GEO SEO' })).toHaveAttribute('href', '/admin/org/lumen-speeds/geo-seo')
    expect(within(breadcrumbs).getByText('Lumen CRM → lumen-speeds')).toBeInTheDocument()
    expect(within(breadcrumbs).getByText('Lumen Speeds')).toBeInTheDocument()
    expect(screen.getByText('Lumen CRM is linked to lumen-speeds')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Publish report/i })).not.toBeInTheDocument()
  })
})
