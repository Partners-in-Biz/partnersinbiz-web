import React from 'react'
import { render, screen } from '@testing-library/react'
import { SettingsNav } from '@/components/settings/SettingsNav'

jest.mock('next/navigation', () => ({
  usePathname: () => '/portal/settings/organization',
}))

describe('SettingsNav', () => {
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
    expect(screen.queryByRole('link', { name: /business Organisation details/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Custom fields admin/i })).not.toBeInTheDocument()
  })
})
