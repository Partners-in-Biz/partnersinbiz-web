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
