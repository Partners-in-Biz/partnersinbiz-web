import React from 'react'
import { render, screen, within } from '@testing-library/react'
import { readFileSync } from 'fs'
import * as path from 'path'
import { BookStudioAdminWorkspace } from '@/components/book-studio/BookStudioAdminWorkspace'
import { workspaceNav } from '@/components/admin/navConfig'

const root = process.cwd()

function source(file: string) {
  return readFileSync(path.join(root, file), 'utf8')
}

describe('BookStudioAdminWorkspace admin command center', () => {
  it('adds Book Studio to org workspace navigation with nested route activity', () => {
    const nav = workspaceNav('partners')
    const item = nav.find((entry) => entry.label === 'Book Studio')

    expect(item).toMatchObject({
      href: '/admin/org/partners/book-studio',
      icon: 'auto_stories',
      group: 'work',
    })
    expect(item?.activePatterns).toContain('/admin/org/partners/book-studio')
  })

  it('uses governance controls for the top-level selected-org Book Studio route', () => {
    const route = source('app/(admin)/admin/org/[slug]/book-studio/page.tsx')
    const governance = source('components/book-studio/AdminBookStudioGovernanceWorkspace.tsx')
    const sharedPolicyControls = source('components/admin-governance/OrganizationModulePolicyControls.tsx')

    expect(route).toContain('AdminBookStudioGovernanceWorkspace')
    expect(route).not.toContain('BookStudioAdminWorkspace')
    expect(governance).toContain('Book Studio governance')
    expect(governance).toContain('Who can use Book Studio')
    expect(governance).toContain('Default Book Studio templates plus organisation custom templates')
    expect(governance).toContain('What book owners control inside a book project')
    expect(governance).toContain('OrganizationModulePolicyRoleGrid')
    expect(sharedPolicyControls).toContain('Owner')
    expect(sharedPolicyControls).toContain('Admin')
    expect(sharedPolicyControls).toContain('Member')
  })

  it('renders the stage rail, approval gates, safe actions, and empty state without enabling forbidden actions', () => {
    render(<BookStudioAdminWorkspace orgId="pib-platform-owner" orgName="Partners in Biz" />)

    const commandCenter = screen.getByRole('region', { name: 'Book Studio admin command center' })
    for (const stage of ['Intake', 'Research', 'Brief', 'Quality gates', 'Publishing packet', 'Manual upload/review', 'Analytics/reconciliation']) {
      expect(within(commandCenter).getByText(stage)).toBeInTheDocument()
    }

    expect(screen.getByText('No active Book Studio projects yet')).toBeInTheDocument()
    expect(screen.getByText('Create or link a gated Project/Kanban task before production work starts.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Direct store publishing disabled' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Automated marketplace integrations disabled' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Ad spend and review outreach disabled' })).toBeDisabled()
    expect(screen.getAllByRole('link', { name: 'Open Projects/Kanban' })[0]).toHaveAttribute('href', '/admin/org/partners-in-biz/projects')
  })

  it('surfaces blocked, missing-evidence, and error states as approval-gated next work', () => {
    render(
      <BookStudioAdminWorkspace
        orgId="pib-platform-owner"
        orgName="Partners in Biz"
        error="Could not load Book Studio records"
        projects={[
          {
            id: 'book-1',
            title: 'Proof-led growth handbook',
            stage: 'quality_gates',
            risk: 'blocked',
            nextAction: 'Attach rights ledger evidence before packet review',
            gates: [
              { id: 'rights', label: 'Rights ledger', status: 'blocked', owner: 'Iris', evidence: [] },
              { id: 'brief', label: 'Book Brief approval', status: 'passed', owner: 'Peet', evidence: ['doc-1'] },
              { id: 'metadata', label: 'Metadata truthfulness', status: 'warning', owner: 'Theo', evidence: [] },
            ],
          },
        ]}
      />
    )

    expect(screen.getByText('Could not load Book Studio records')).toBeInTheDocument()
    expect(screen.getByText('Proof-led growth handbook')).toBeInTheDocument()
    expect(screen.getByText('blocked by rights')).toBeInTheDocument()
    expect(screen.getAllByText('Missing evidence').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Attach rights ledger evidence before packet review')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Request approval for exact package version' })).toBeDisabled()
  })
})
