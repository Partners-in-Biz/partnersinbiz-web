import React from 'react'
import { render, screen } from '@testing-library/react'
import AdminUpdatesPage from '@/app/(admin)/admin/updates/page'
import { OPERATOR_NAV, OPERATOR_NAV_TOPBAR } from '@/components/admin/navConfig'

jest.mock('next/link', () => {
  return function MockLink({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
    return <a href={href} {...props}>{children}</a>
  }
})

describe('Admin updates page', () => {
  it('renders a detailed admin operating map with links, steps, and approval checks', () => {
    render(<AdminUpdatesPage />)

    expect(screen.getByRole('heading', { name: /what changed and where to go/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /start at dashboard/i })).toHaveAttribute('href', '/admin/dashboard')

    expect(screen.getByRole('heading', { name: 'Future updates council standard' })).toBeInTheDocument()
    expect(screen.getByText(/Future entries on this page should be added when the council view/i)).toBeInTheDocument()
    expect(screen.getByText(/Add the update when it changes where admins should go/i)).toBeInTheDocument()
    expect(screen.getByText(/Council view: relevant specialist perspectives/i)).toBeInTheDocument()
    expect(screen.getByText(/Future update entries are internal planning guidance/i)).toBeInTheDocument()

    for (const title of [
      'Mission Control and briefings',
      'Admin dashboard',
      'Organisation admin command pages',
      'Projects, Kanban, and agent tasks',
      'Documents and approvals',
      'Research and intelligence',
      'Marketing, SEO, and social',
      'Agents, skills, and automation',
      'Settings, users, and access',
    ]) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
    }
    expect(screen.getByRole('link', { name: /open agents/i })).toHaveAttribute('href', '/admin/agents')
    expect(screen.getByText(/Check agent health before assigning urgent work/i)).toBeInTheDocument()
    expect(screen.getByText(/Skill policy or config changes are sensitive/i)).toBeInTheDocument()
  })

  it('exposes Updates in the admin sidebar and topbar navigation', () => {
    expect(OPERATOR_NAV).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Updates', href: '/admin/updates', icon: 'new_releases', group: 'work' }),
    ]))
    expect(OPERATOR_NAV_TOPBAR).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Updates', href: '/admin/updates', icon: 'new_releases' }),
    ]))
  })
})
