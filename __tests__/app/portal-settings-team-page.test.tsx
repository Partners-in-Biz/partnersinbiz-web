import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import TeamPage from '@/app/(portal)/portal/settings/team/page'

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
  fetchMock.mockReset()
  mockSearchParams = new URLSearchParams()
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/api/v1/portal/settings/team') {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            members: [
              {
                uid: 'current-admin',
                firstName: 'Mandy',
                lastName: 'Manager',
                jobTitle: 'Operations lead',
                avatarUrl: '',
                role: 'admin',
              },
              {
                uid: 'sales-rep',
                firstName: 'Sam',
                lastName: 'Sales',
                jobTitle: 'Sales rep',
                avatarUrl: '',
                role: 'member',
              },
            ],
          }),
      })
    }
    if (url === '/api/v1/portal/settings/profile') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ profile: { role: 'admin' } }),
      })
    }
    if (url === '/api/v1/portal/org') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ user: { uid: 'current-admin' } }),
      })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  })
})

describe('TeamPage', () => {
  it('preserves company workspace scope across team list and access mutations', async () => {
    mockSearchParams = new URLSearchParams({
      orgId: 'org-1',
      orgSlug: 'lumen-speeds',
      sourceCompanyId: 'company-1',
      sourceCompanyName: 'Lumen',
    })

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/portal/settings/team?orgId=org-1') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              members: [
                {
                  uid: 'current-admin',
                  firstName: 'Mandy',
                  lastName: 'Manager',
                  jobTitle: 'Operations lead',
                  avatarUrl: '',
                  role: 'owner',
                },
                {
                  uid: 'sales-rep',
                  firstName: 'Sam',
                  lastName: 'Sales',
                  jobTitle: 'Sales rep',
                  avatarUrl: '',
                  role: 'member',
                },
              ],
            }),
        })
      }
      if (url === '/api/v1/portal/settings/profile?orgId=org-1') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ profile: { role: 'owner' } }),
        })
      }
      if (url === '/api/v1/portal/org') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ user: { uid: 'current-admin' } }),
        })
      }
      if (url === '/api/v1/portal/settings/team/sales-rep/role?orgId=org-1' && init?.method === 'PATCH') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ role: 'viewer' }) })
      }
      if (url === '/api/v1/portal/settings/team/invite?orgId=org-1' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ uid: 'new-user' }) })
      }
      if (url === '/api/v1/portal/settings/team/sales-rep?orgId=org-1' && init?.method === 'DELETE') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ removed: 'sales-rep' }) })
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    })

    render(<TeamPage />)

    expect(await screen.findByText('Sam Sales')).toBeInTheDocument()
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/portal/settings/team?orgId=org-1')
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/portal/settings/profile?orgId=org-1')
    })

    fireEvent.change(screen.getByRole('combobox', { name: 'Change role for Sam Sales' }), {
      target: { value: 'viewer' },
    })
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/portal/settings/team/sales-rep/role?orgId=org-1', expect.objectContaining({ method: 'PATCH' }))
    })

    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
      target: { value: 'new@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/portal/settings/team/invite?orgId=org-1', expect.objectContaining({ method: 'POST' }))
    })

    fireEvent.click(screen.getByRole('button', { name: 'Remove Sam Sales' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove Sam Sales from workspace' }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/portal/settings/team/sales-rep?orgId=org-1', { method: 'DELETE' })
    })
  })

  it('names team administration controls for employee-scale CRM work', async () => {
    render(<TeamPage />)

    expect(await screen.findByRole('heading', { name: 'Team' })).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Sam Sales')).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: 'Remove Sam Sales' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'person_remove' })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Role' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Workspace access' })).toBeInTheDocument()
  })

  it('surfaces team access governance gaps for employee-scale CRM work', async () => {
    render(<TeamPage />)

    expect(await screen.findByRole('heading', { name: 'Team' })).toBeInTheDocument()

    const governance = await screen.findByRole('region', { name: 'Team access governance' })
    expect(within(governance).getByRole('heading', { name: 'Employee access needs CRM coverage' })).toBeInTheDocument()
    expect(within(governance).getByText('A CEO needs at least one clearly assigned CRM or sales operator before contacts, deals, and follow-ups can scale across the team.')).toBeInTheDocument()
    expect(within(governance).getByText('2 members')).toBeInTheDocument()
    expect(within(governance).getByText('1 admin')).toBeInTheDocument()
    expect(within(governance).getByText('0 CRM/sales')).toBeInTheDocument()
    expect(within(governance).getByText('0 reviewers')).toBeInTheDocument()

    fireEvent.click(within(governance).getByRole('button', { name: 'Prepare CRM sales invite' }))

    expect(screen.getByRole('combobox', { name: 'Workspace access' })).toHaveValue('crm')
    expect(screen.getByRole('textbox', { name: 'Department' })).toHaveValue('Sales')
  })

  it('uses an in-page confirmation before removing workspace members', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)

    render(<TeamPage />)

    expect(await screen.findByText('Sam Sales')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove Sam Sales' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: 'Remove Sam Sales from this workspace?' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'This removes their access to CRM contacts, deals, projects, and workspace data. Existing activity history remains available for audit.',
      ),
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/v1/portal/settings/team/sales-rep', expect.any(Object))

    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove Sam Sales from workspace' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/portal/settings/team/sales-rep', { method: 'DELETE' })
    })
    expect(screen.queryByText('Sam Sales')).not.toBeInTheDocument()

    confirmSpy.mockRestore()
  })
})
