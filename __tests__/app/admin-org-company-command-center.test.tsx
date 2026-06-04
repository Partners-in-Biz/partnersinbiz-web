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
                contacts: 3,
                deals: 2,
                projects: 1,
                documents: 4,
                serviceWorkspaces: 5,
                relationships: 6,
                quotes: 7,
                invoices: 8,
                orders: 9,
                shipments: 10,
                inventoryItems: 11,
                activities: 12,
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

  it('shows command-center record counts in admin company tabs', async () => {
    render(<AdminCompanyCommandCenterPage />)

    expect(await screen.findByText('Admin company command center')).toBeInTheDocument()

    const tablist = screen.getByRole('tablist', { name: 'Company detail tabs' })
    expect(tablist).toHaveTextContent('Contacts')
    expect(tablist).toHaveTextContent('3')
    expect(tablist).toHaveTextContent('Deals')
    expect(tablist).toHaveTextContent('2')
    expect(tablist).toHaveTextContent('Projects')
    expect(tablist).toHaveTextContent('1')
    expect(tablist).toHaveTextContent('Documents')
    expect(tablist).toHaveTextContent('4')

    fireEvent.click(screen.getByRole('button', { name: 'More company sections' }))

    const moreMenu = screen.getByRole('menu', { name: 'More company sections' })
    expect(moreMenu).toHaveTextContent('5')
    expect(moreMenu).toHaveTextContent('6')
    expect(moreMenu).toHaveTextContent('7')
    expect(moreMenu).toHaveTextContent('8')
    expect(moreMenu).toHaveTextContent('9')
    expect(moreMenu).toHaveTextContent('10')
    expect(moreMenu).toHaveTextContent('11')
    expect(moreMenu).toHaveTextContent('12')
  })

  it('turns linked admin company contact and deal rows into record navigation', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
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
                contacts: 1,
                deals: 1,
                projects: 0,
                documents: 0,
                serviceWorkspaces: 0,
                relationships: 0,
                quotes: 0,
                invoices: 0,
                orders: 0,
                shipments: 0,
                inventoryItems: 0,
                activities: 0,
              },
              analytics: { riskSignals: [] },
              contacts: [{ id: 'contact-1', name: 'Ava Buyer', email: 'ava@example.com', status: 'active' }],
              deals: [{ id: 'deal-1', title: 'Growth Retainer', value: 25000, currency: 'ZAR', stageId: 'proposal' }],
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
    })

    render(<AdminCompanyCommandCenterPage />)

    expect(await screen.findByText('Admin company command center')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Contacts/i }))
    expect(screen.getByRole('link', { name: 'Open Ava Buyer from Acme Holdings admin command center' })).toHaveAttribute(
      'href',
      '/portal/contacts/contact-1',
    )

    fireEvent.click(screen.getByRole('tab', { name: /Deals/i }))
    expect(screen.getByRole('link', { name: 'Open Growth Retainer from Acme Holdings admin command center' })).toHaveAttribute(
      'href',
      '/portal/deals/deal-1',
    )
  })

  it('turns clear admin company analytics risk into a portal review action', async () => {
    render(<AdminCompanyCommandCenterPage />)

    expect(await screen.findByText('Admin company command center')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'More company sections' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Analytics/i }))

    expect(screen.getByText('Risk watch clear')).toBeInTheDocument()
    expect(screen.getByText('Keep leadership risk reviewable')).toBeInTheDocument()
    expect(
      screen.getByText(
        'No active risk signals are flagged for Acme Holdings. Review the portal workspace so finance, delivery, and relationship risk stay visible before the account surprises leadership.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open portal risk review for Acme Holdings' })).toHaveAttribute('href', '/portal/companies/company-1')
  })

  it('surfaces linked organisation workspace actions from the admin CRM company route', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/admin/crm/companies/company-1/command-center?orgSlug=acme-client&limit=100') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              company: {
                id: 'company-1',
                orgId: 'org-1',
                name: 'Lumen',
                linkedOrgId: 'client-org',
                lifecycleStage: 'customer',
              },
              linkedWorkspace: { id: 'client-org', slug: 'lumen-speeds', name: 'Lumen Speeds' },
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
                activities: 0,
              },
              analytics: { riskSignals: [] },
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
    })

    render(<AdminCompanyCommandCenterPage />)

    expect(await screen.findByText('Admin company command center')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Workspace' }))

    expect(screen.getByText('Lumen Speeds workspace')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open marketing workspace for Lumen' })).toHaveAttribute('href', '/admin/org/lumen-speeds/marketing')
    expect(screen.getByRole('link', { name: 'Open SEO workspace for Lumen' })).toHaveAttribute('href', '/admin/org/lumen-speeds/seo')
    expect(screen.getByRole('link', { name: 'Open social workspace for Lumen' })).toHaveAttribute('href', '/admin/org/lumen-speeds/social')
  })
})
