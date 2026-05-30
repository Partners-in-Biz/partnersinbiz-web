import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AdminCompanyCommandCenterPage from '@/app/(admin)/admin/org/[slug]/crm/companies/[id]/page'

jest.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'acme-client', id: 'company-1' }),
}))

describe('Admin company command center page', () => {
  beforeEach(() => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/admin/crm/companies/company-1/command-center?orgSlug=acme-client&limit=100') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              company: {
                id: 'company-1',
                orgId: 'org-1',
                name: 'Acme Holdings',
                lifecycleStage: 'customer',
                tier: 'smb',
                industry: 'Creative services',
              },
              summary: {
                contacts: 0,
                deals: 0,
                projects: 0,
                documents: 0,
                serviceWorkspaces: 0,
                relationships: 0,
                quotes: 0,
                invoices: 0,
                orders: 0,
                shipments: 0,
                inventoryItems: 0,
              },
              analytics: {
                riskSignals: [],
              },
              contacts: [],
              deals: [],
              projects: [],
              documents: [],
              serviceWorkspaces: [],
              relationships: [],
              quotes: [],
              invoices: [],
              orders: [],
              shipments: [],
              inventoryItems: [],
              activities: [],
            },
          }),
        } as Response)
      }

      return Promise.resolve({
        ok: false,
        json: async () => ({ error: `Unexpected request: ${url}` }),
      } as Response)
    }) as jest.Mock
  })

  it('turns an empty admin company tab into an operational review state', async () => {
    render(<AdminCompanyCommandCenterPage />)

    expect(await screen.findByText('Admin company command center')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Contacts/i }))

    expect(screen.getByText('Contacts not linked yet')).toBeInTheDocument()
    expect(screen.getByText('Start account context from the client workspace')).toBeInTheDocument()
    expect(
      screen.getByText(
        'No contacts are linked to Acme Holdings yet. Review the company overview or open the portal workspace so relationship ownership, email history, and pipeline handoffs stop living outside CRM.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open portal workspace for Acme Holdings' })).toHaveAttribute('href', '/portal/companies/company-1')

    fireEvent.click(screen.getByRole('button', { name: 'Review overview for Acme Holdings' }))

    await waitFor(() => expect(screen.getByText('Business pulse')).toBeInTheDocument())
  })

  it('turns clear admin company analytics risk into a portal review action', async () => {
    render(<AdminCompanyCommandCenterPage />)

    expect(await screen.findByText('Admin company command center')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Analytics/i }))

    expect(screen.getByText('Risk watch clear')).toBeInTheDocument()
    expect(screen.getByText('Keep leadership risk reviewable')).toBeInTheDocument()
    expect(
      screen.getByText(
        'No active risk signals are flagged for Acme Holdings. Review the portal workspace so finance, delivery, and relationship risk stay visible before the account surprises leadership.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open portal risk review for Acme Holdings' })).toHaveAttribute('href', '/portal/companies/company-1')
  })
})
