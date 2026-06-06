import React from 'react'
import { render, screen } from '@testing-library/react'
import AdminUpdatesPage, { ADMIN_UPDATE_AREAS, FUTURE_UPDATE_COUNCIL_STANDARD } from '@/app/(admin)/admin/updates/page'
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

    expect(screen.getByRole('heading', { name: FUTURE_UPDATE_COUNCIL_STANDARD.title })).toBeInTheDocument()
    expect(screen.getByText(FUTURE_UPDATE_COUNCIL_STANDARD.summary)).toBeInTheDocument()
    expect(screen.getByText(FUTURE_UPDATE_COUNCIL_STANDARD.criteria[0])).toBeInTheDocument()
    expect(screen.getByText(FUTURE_UPDATE_COUNCIL_STANDARD.entryFields[3])).toBeInTheDocument()
    expect(screen.getByText(FUTURE_UPDATE_COUNCIL_STANDARD.councilChecks[0])).toBeInTheDocument()

    for (const area of ADMIN_UPDATE_AREAS) {
      expect(screen.getByRole('heading', { name: area.title })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: new RegExp(area.hrefLabel, 'i') })).toHaveAttribute('href', area.href)
      expect(screen.getByText(area.steps[0])).toBeInTheDocument()
      expect(screen.getByText(area.checks[0])).toBeInTheDocument()
    }
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
