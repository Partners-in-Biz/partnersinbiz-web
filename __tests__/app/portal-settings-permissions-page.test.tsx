import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import PermissionsPage from '@/app/(portal)/portal/settings/permissions/page'

const fetchMock = jest.fn()
let mockSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}))

beforeAll(() => {
  Object.defineProperty(global, 'fetch', {
    configurable: true,
    value: fetchMock,
  })
})

beforeEach(() => {
  mockSearchParams = new URLSearchParams()
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

  it('loads and saves permission guardrails through the active company workspace scope', async () => {
    mockSearchParams = new URLSearchParams({
      orgId: 'lumen-org',
      orgSlug: 'lumen-speeds',
      sourceCompanyId: 'company-1',
      sourceCompanyName: 'Lumen',
    })
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/portal/settings/permissions?orgId=lumen-org' && !init?.method) {
        return Promise.resolve({
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
      }
      if (url === '/api/v1/portal/settings/permissions?orgId=lumen-org' && init?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              permissions: {
                membersCanDeleteContacts: false,
                membersCanExportContacts: false,
                membersCanSendCampaigns: false,
              },
            }),
        })
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: `unexpected fetch: ${url}` }) })
    })

    render(<PermissionsPage />)

    expect(await screen.findByRole('heading', { name: 'Permissions' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Stop members from creating and sending campaigns' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/portal/settings/permissions?orgId=lumen-org')
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/portal/settings/permissions?orgId=lumen-org', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ membersCanSendCampaigns: false }),
      })
      expect(fetchMock).not.toHaveBeenCalledWith('/api/v1/portal/settings/permissions')
    })
  })
})
