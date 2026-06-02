import React from 'react'
import { render, screen } from '@testing-library/react'
import PermissionsPage from '@/app/(portal)/portal/settings/permissions/page'

const fetchMock = jest.fn()

beforeAll(() => {
  Object.defineProperty(global, 'fetch', {
    configurable: true,
    value: fetchMock,
  })
})

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        permissions: {
          membersCanDeleteContacts: false,
          membersCanExportContacts: false,
          membersCanSendCampaigns: true,
        },
      }),
  })
})

describe('PermissionsPage', () => {
  it('names member permission toggles by current CRM risk state', async () => {
    render(<PermissionsPage />)

    expect(await screen.findByRole('heading', { name: 'Permissions' })).toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Allow members to delete contacts' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByRole('button', { name: 'Allow members to export contacts' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByRole('button', { name: 'Stop members from creating and sending campaigns' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getAllByText('lock')).toHaveLength(3)
    screen.getAllByText('lock').forEach((icon) => {
      expect(icon).toHaveAttribute('aria-hidden', 'true')
    })
  })
})
