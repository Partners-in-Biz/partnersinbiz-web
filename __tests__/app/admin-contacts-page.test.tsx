import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import AdminContactsPage from '@/app/(admin)/admin/crm/contacts/page'

jest.mock('@/lib/contexts/OrgContext', () => ({
  useOrg: () => ({
    selectedOrgId: 'org-1',
    orgs: [],
  }),
}))

describe('Admin CRM contacts page', () => {
  beforeEach(() => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/v1/crm/contacts?')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'contact-owned',
                name: 'Owned Client',
                email: 'owned@example.com',
                companyName: 'Owned Co',
                type: 'client',
                stage: 'contacted',
                assignedTo: 'sales-lead-1',
                lastContactedAt: new Date().toISOString(),
              },
              {
                id: 'contact-unowned',
                name: 'Unowned Prospect',
                email: 'unowned@example.com',
                companyName: 'Open Co',
                type: 'lead',
                stage: 'new',
                assignedTo: '',
                lastContactedAt: null,
              },
            ],
          }),
        } as Response)
      }
      if (url === '/api/v1/portal/settings/team') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            members: [
              {
                uid: 'sales-lead-2',
                firstName: 'Mandy',
                lastName: 'Manager',
                jobTitle: 'Sales lead',
                role: 'admin',
              },
            ],
          }),
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: [] }),
      } as Response)
    }) as jest.Mock
  })

  it('turns an empty workspace into a first-contact operating setup', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/v1/crm/contacts?')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [] }),
        } as Response)
      }
      if (url === '/api/v1/portal/settings/team') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ members: [] }),
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: [] }),
      } as Response)
    }) as jest.Mock

    render(<AdminContactsPage />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Build the first admin contact record' })).toBeInTheDocument()
    })
    expect(screen.getByText(
      'Create the first contact so admin can assign ownership, track follow-up, and give every employee a shared relationship profile before pipeline work starts.'
    )).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Create first admin contact' }))

    expect(screen.getByRole('heading', { name: 'New Contact' })).toBeInTheDocument()
  })

  it('surfaces unowned contacts as a management accountability lens', async () => {
    render(<AdminContactsPage />)

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Owned Client' })).toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: 'Unowned Prospect' })).toBeInTheDocument()

    expect(screen.getByText('Owner coverage')).toBeInTheDocument()
    expect(screen.getByText('1 unowned')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show unowned contacts needing an owner' }))

    expect(screen.queryByRole('link', { name: 'Owned Client' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Unowned Prospect' })).toBeInTheDocument()

    const row = screen.getByRole('link', { name: 'Unowned Prospect' }).closest('tr')
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByText('Unassigned')).toBeInTheDocument()
  })

  it('names sparse contact row and score readiness gaps', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/v1/crm/contacts?')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'contact-sparse',
                name: 'Sparse Prospect',
                email: '',
                company: '',
                companyName: '',
                type: 'lead',
                stage: 'new',
                assignedTo: '',
                lastContactedAt: null,
              },
            ],
          }),
        } as Response)
      }
      if (url === '/api/v1/portal/settings/team') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ members: [] }),
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: [] }),
      } as Response)
    }) as jest.Mock

    render(<AdminContactsPage />)

    const row = (await screen.findByRole('link', { name: 'Sparse Prospect' })).closest('tr')
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByText('Email missing')).toBeInTheDocument()
    expect(within(row as HTMLElement).getByText('Company missing')).toBeInTheDocument()
    expect(within(row as HTMLElement).getByText('Scores not captured')).toBeInTheDocument()
    expect(within(row as HTMLElement).queryByText('—')).not.toBeInTheDocument()

    expect(screen.getByText('Avg lead score')).toBeInTheDocument()
    expect(screen.getAllByText('Not scored').length).toBeGreaterThan(0)
    expect(screen.getByText('ICP not scored · AI not scored')).toBeInTheDocument()
  })

  it('assigns selected unowned contacts to an owner from the list view', async () => {
    render(<AdminContactsPage />)

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Unowned Prospect' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Show unowned contacts needing an owner' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Unowned Prospect for bulk owner assignment' }))
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Mandy Manager - Sales lead' })).toBeInTheDocument()
    })
    fireEvent.change(screen.getByLabelText('Assign selected contacts to owner'), {
      target: { value: 'sales-lead-2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Assign owner to 1 selected contact' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/contacts/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ids: ['contact-unowned'],
          patch: { assignedTo: 'sales-lead-2' },
        }),
      })
    })

    const row = screen.getByRole('link', { name: 'Unowned Prospect' }).closest('tr')
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByText('Owner set')).toBeInTheDocument()
  })
})
