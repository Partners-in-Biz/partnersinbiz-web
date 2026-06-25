import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PermissionsPage from '@/app/(portal)/portal/settings/permissions/page'

const fetchMock = jest.fn()
let mockSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}))

// The page loads two endpoints on mount: the role × feature matrix
// (/api/v1/org/roles) and the CRM guardrails (/api/v1/portal/settings/permissions).
// These helpers keep the matrix load happy so the tests can focus on the
// guardrail toggles, which is what this suite guards.
function rolesPayload() {
  // Return an empty body so the page keeps its valid default matrix/owner state.
  // (Returning a partial `matrix: {}` would make the matrix render read
  // matrix[role][feature] off undefined rows and throw.)
  return {
    ok: true,
    json: () => Promise.resolve({}),
  }
}

function guardrailsPayload(permissions: {
  membersCanDeleteContacts: boolean
  membersCanExportContacts: boolean
  membersCanSendCampaigns: boolean
}) {
  return {
    ok: true,
    json: () => Promise.resolve({ permissions }),
  }
}

beforeAll(() => {
  Object.defineProperty(global, 'fetch', {
    configurable: true,
    value: fetchMock,
  })
})

beforeEach(() => {
  mockSearchParams = new URLSearchParams()
  fetchMock.mockReset()
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('/api/v1/org/roles')) return Promise.resolve(rolesPayload())
    return Promise.resolve(
      guardrailsPayload({
        membersCanDeleteContacts: false,
        membersCanExportContacts: false,
        membersCanSendCampaigns: true,
      }),
    )
  })
})

describe('PermissionsPage', () => {
  it('renders the CRM action guardrail toggles with their loaded state', async () => {
    render(<PermissionsPage />)

    expect(await screen.findByRole('heading', { name: 'Permissions' })).toBeInTheDocument()

    expect(screen.getByRole('region', { name: 'Advanced CRM guardrails' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'CRM action guardrails' })).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Enable Members can delete contacts' })).toHaveAttribute(
        'aria-pressed',
        'false',
      )
    })
    expect(screen.getByRole('button', { name: 'Enable Members can export contacts' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByRole('button', { name: 'Disable Members can create and send campaigns' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('rolls back a failed CRM guardrail save and surfaces the error', async () => {
    fetchMock.mockReset()
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/v1/org/roles')) return Promise.resolve(rolesPayload())
      if (init?.method === 'PATCH') {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: 'Only owners can change CRM permissions' }),
        })
      }
      return Promise.resolve(
        guardrailsPayload({
          membersCanDeleteContacts: true,
          membersCanExportContacts: true,
          membersCanSendCampaigns: false,
        }),
      )
    })

    render(<PermissionsPage />)

    expect(await screen.findByRole('heading', { name: 'Permissions' })).toBeInTheDocument()

    const deleteToggle = await screen.findByRole('button', { name: 'Disable Members can delete contacts' })
    expect(deleteToggle).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(deleteToggle)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/portal/settings/permissions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ membersCanDeleteContacts: false }),
      })
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('Only owners can change CRM permissions')

    // Optimistic flip is rolled back, so the toggle returns to its loaded state.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Disable Members can delete contacts' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    })
  })

  it('loads and saves guardrails through the active company workspace scope', async () => {
    mockSearchParams = new URLSearchParams({
      orgId: 'lumen-org',
      orgSlug: 'lumen-speeds',
      sourceCompanyId: 'company-1',
      sourceCompanyName: 'Lumen',
    })
    fetchMock.mockReset()
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/v1/org/roles')) return Promise.resolve(rolesPayload())
      if (url === '/api/v1/portal/settings/permissions?orgId=lumen-org' && !init?.method) {
        return Promise.resolve(
          guardrailsPayload({
            membersCanDeleteContacts: false,
            membersCanExportContacts: false,
            membersCanSendCampaigns: true,
          }),
        )
      }
      if (url === '/api/v1/portal/settings/permissions?orgId=lumen-org' && init?.method === 'PATCH') {
        return Promise.resolve(
          guardrailsPayload({
            membersCanDeleteContacts: false,
            membersCanExportContacts: false,
            membersCanSendCampaigns: false,
          }),
        )
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: `unexpected fetch: ${url}` }) })
    })

    render(<PermissionsPage />)

    expect(await screen.findByRole('heading', { name: 'Permissions' })).toBeInTheDocument()

    const campaignsToggle = await screen.findByRole('button', {
      name: 'Disable Members can create and send campaigns',
    })
    fireEvent.click(campaignsToggle)

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
