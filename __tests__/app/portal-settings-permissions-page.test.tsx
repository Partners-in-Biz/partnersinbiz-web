import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

  it('summarizes permission risk and rolls back failed CRM permission saves', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          permissions: {
            membersCanDeleteContacts: true,
            membersCanExportContacts: true,
            membersCanSendCampaigns: false,
          },
        }),
    })
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Only owners can change CRM permissions' }),
    })

    render(<PermissionsPage />)

    expect(await screen.findByRole('heading', { name: 'Permissions' })).toBeInTheDocument()

    const commandCenter = screen.getByRole('region', { name: 'CRM permission guardrails' })
    expect(within(commandCenter).getByRole('heading', { name: 'CRM permission guardrails' })).toBeInTheDocument()
    expect(within(commandCenter).getByText('2 elevated controls')).toBeInTheDocument()
    expect(within(commandCenter).getByText('1 restricted')).toBeInTheDocument()
    expect(within(commandCenter).getByText('3 fixed safeguards')).toBeInTheDocument()

    const deleteToggle = screen.getByRole('button', { name: 'Stop members from deleting contacts' })
    expect(deleteToggle).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(deleteToggle)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/portal/settings/permissions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ membersCanDeleteContacts: false }),
      })
    })

    expect(await screen.findByRole('status', { name: 'CRM permission save failed' })).toHaveTextContent(
      'Only owners can change CRM permissions',
    )
    expect(screen.getByRole('button', { name: 'Stop members from deleting contacts' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})
