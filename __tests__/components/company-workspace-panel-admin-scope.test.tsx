import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { CompanyWorkspacePanel } from '@/components/crm/CompanyWorkspacePanel'

describe('CompanyWorkspacePanel admin org scope', () => {
  it('keeps linked workspace actions on admin org routes instead of generic portal routes', () => {
    render(
      <CompanyWorkspacePanel
        companyName="Lumen"
        mode="admin"
        workspace={{ id: 'client-org', orgId: 'client-org', slug: 'lumen-speeds', orgSlug: 'lumen-speeds', name: 'Lumen Speeds' }}
      />,
    )

    expect(screen.getByText('Operator organisation workspace')).toBeInTheDocument()
    expect(screen.getByText('Run PiB operator work for this selected client org. Links stay inside the admin command surface with the slug scope visible in the URL.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open reports workspace for Lumen' })).toHaveAttribute('href', '/admin/org/lumen-speeds/dashboard?panel=reports')
    expect(screen.getByRole('link', { name: 'Open email domains workspace for Lumen' })).toHaveAttribute('href', '/admin/org/lumen-speeds/email-domains')

    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('href') ?? '').not.toMatch(/^\/portal/)
    }
  })
})
