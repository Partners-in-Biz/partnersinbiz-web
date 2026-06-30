import React from 'react'
import { render, screen } from '@testing-library/react'
import { SettingsNav } from '@/components/settings/SettingsNav'

let mockSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  usePathname: () => '/portal/settings/organization',
  useSearchParams: () => mockSearchParams,
}))

describe('SettingsNav', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams()
  })

  it('names CRM settings navigation links without decorative icon or role text', () => {
    render(
      <SettingsNav
        name="Peet Stander"
        email="hello@partnersinbiz.online"
        initials="PS"
        role="owner"
        collapsed={false}
      />,
    )

    expect(screen.getByRole('link', { name: 'Back to portal' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Organisation details' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Custom fields' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'CRM setup' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Permissions' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Personal marketing' })).toHaveAttribute('href', '/portal/personal/marketing')
    expect(screen.queryByRole('link', { name: /business Organisation details/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Custom fields admin/i })).not.toBeInTheDocument()
  })

  it('preserves linked company workspace scope across workspace settings navigation', () => {
    mockSearchParams = new URLSearchParams({
      orgId: 'lumen-org',
      orgSlug: 'lumen-speeds',
      sourceCompanyId: 'company-1',
      sourceCompanyName: 'Lumen',
    })

    render(
      <SettingsNav
        name="Peet Stander"
        email="hello@partnersinbiz.online"
        initials="PS"
        role="owner"
        collapsed={false}
      />,
    )

    const scope = 'orgId=lumen-org&orgSlug=lumen-speeds&sourceCompanyId=company-1&sourceCompanyName=Lumen'
    expect(screen.getByRole('link', { name: 'Team' })).toHaveAttribute('href', `/portal/settings/team?${scope}`)
    expect(screen.getByRole('link', { name: 'CRM setup' })).toHaveAttribute('href', `/portal/settings/crm-setup?${scope}`)
    expect(screen.getByRole('link', { name: 'Webhooks' })).toHaveAttribute('href', `/portal/settings/webhooks?${scope}`)
    expect(screen.getByRole('link', { name: 'Account settings' })).toHaveAttribute('href', '/portal/settings/account')
  })
})
