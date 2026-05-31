import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import CompanyDetailPage from '@/app/(portal)/portal/companies/[id]/page'
import type { CustomFieldDefinition } from '@/lib/customFields/types'

let mockSearchParams = new URLSearchParams()
let mockCompanyCustomFieldDefinitions: CustomFieldDefinition[] = []

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'company-1' }),
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => mockSearchParams,
}))

describe('Portal company detail page', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams()
    mockCompanyCustomFieldDefinitions = []
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/custom-fields?resource=company') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { definitions: mockCompanyCustomFieldDefinitions } }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              company: {
                id: 'company-1',
                orgId: 'org-1',
                name: 'Acme Holdings',
                lifecycleStage: 'customer',
              },
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1/command-center?limit=100') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              summary: {
                projects: 1,
                serviceWorkspaces: 1,
                relationships: 1,
                orders: 1,
                shipments: 1,
                inventoryItems: 1,
                lowStockItems: 1,
              },
              analytics: {
                accountValue: 12000,
                trackedOrderValue: 2200,
                riskSignals: ['1 low-stock item'],
              },
              contacts: [
                { id: 'contact-1', name: 'Jane Client', email: 'jane@example.com', type: 'client', stage: 'won' },
              ],
              projects: [
                { id: 'project-1', name: 'SEO Sprint', status: 'active' },
              ],
              serviceWorkspaces: [
                { id: 'svc-1', name: 'SEO Workspace', serviceType: 'seo', status: 'active' },
              ],
              relationships: [
                { id: 'rel-1', targetName: 'Partners in Biz', relationshipType: 'supplier', status: 'active' },
              ],
              invoices: [
                { id: 'invoice-1', invoiceNumber: 'INV-001', status: 'sent', total: 1200, currency: 'ZAR' },
              ],
              orders: [
                { id: 'order-1', title: 'Quote-to-delivery', status: 'in_progress', total: 2200, currency: 'ZAR' },
              ],
              shipments: [
                { id: 'shipment-1', status: 'in_transit', carrier: 'Internal delivery' },
              ],
              inventoryItems: [
                { id: 'stock-1', name: 'SEO Hours', sku: 'SEO-HOURS', status: 'low_stock', quantityAvailable: 2 },
              ],
              deals: [],
              quotes: [],
              activities: [],
              documents: [{ id: 'doc-1', title: 'Client proposal', status: 'client_review' }],
            },
          }),
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response)
    }) as jest.Mock
  })

  it('unwraps the company detail API envelope before rendering the header', async () => {
    render(<CompanyDetailPage />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Acme Holdings' })).toBeInTheDocument()
    })
  })

  it('opens profile editing when routed from a list setup action', async () => {
    mockSearchParams = new URLSearchParams('edit=profile')

    render(<CompanyDetailPage />)

    expect(await screen.findByRole('dialog', { name: 'Edit Company' })).toBeInTheDocument()
  })

  it('turns empty company custom fields into a profile capture action', async () => {
    mockCompanyCustomFieldDefinitions = [{
      id: 'field-1',
      orgId: 'org-1',
      resource: 'company',
      key: 'decision_role',
      label: 'Decision role',
      type: 'text',
      required: false,
      order: 0,
      createdAt: null,
      updatedAt: null,
    }]

    render(<CompanyDetailPage />)

    expect(await screen.findByText('No custom fields set.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Capture custom fields for Acme Holdings' }))

    expect(screen.getByRole('dialog', { name: 'Edit Company' })).toBeInTheDocument()
  })

  it('renders linked contacts and invoices instead of placeholder copy', async () => {
    render(<CompanyDetailPage />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Acme Holdings' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('tab', { name: /Contacts/i }))
    await waitFor(() => {
      expect(screen.getByText('Jane Client')).toBeInTheDocument()
    })
    expect(screen.queryByText(/Wave 3 wiring lands/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Invoices/i }))
    await waitFor(() => {
      expect(screen.getByText('INV-001')).toBeInTheDocument()
    })
  })

  it('names sparse linked contact fields on company detail instead of showing dash placeholders', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/custom-fields?resource=company') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { definitions: [] } }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              company: {
                id: 'company-1',
                orgId: 'org-1',
                name: 'Acme Holdings',
                lifecycleStage: 'customer',
              },
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1/command-center?limit=100') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              summary: {},
              analytics: {},
              contacts: [
                { id: 'contact-1', name: 'Jane Client' },
              ],
              deals: [],
              quotes: [],
              invoices: [],
              projects: [],
              serviceWorkspaces: [],
              relationships: [],
              documents: [],
              orders: [],
              shipments: [],
              inventoryItems: [],
              activities: [],
            },
          }),
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response)
    }) as jest.Mock

    render(<CompanyDetailPage />)

    await screen.findByRole('heading', { name: 'Acme Holdings' })
    fireEvent.click(screen.getByRole('tab', { name: /Contacts/i }))

    const row = (await screen.findByRole('link', { name: 'Jane Client' })).closest('tr')
    expect(row).not.toBeNull()
    expect(row as HTMLElement).toHaveTextContent('No email captured')
    expect(row as HTMLElement).toHaveTextContent('Type not set')
    expect(row as HTMLElement).toHaveTextContent('Stage not set')
    expect(screen.queryAllByText('-')).toHaveLength(0)
  })

  it('names linked deal commercial setup gaps on company detail instead of showing dash placeholders', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/custom-fields?resource=company') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { definitions: [] } }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              company: {
                id: 'company-1',
                orgId: 'org-1',
                name: 'Acme Holdings',
                lifecycleStage: 'customer',
              },
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1/command-center?limit=100') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              summary: {},
              analytics: {},
              contacts: [
                { id: 'contact-1', name: 'Jane Client', email: 'jane@example.com' },
              ],
              deals: [
                { id: 'deal-1', title: 'Growth retainer' },
              ],
              quotes: [],
              invoices: [],
              projects: [],
              serviceWorkspaces: [],
              relationships: [],
              documents: [],
              orders: [],
              shipments: [],
              inventoryItems: [],
              activities: [],
            },
          }),
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response)
    }) as jest.Mock

    render(<CompanyDetailPage />)

    await screen.findByRole('heading', { name: 'Acme Holdings' })
    fireEvent.click(screen.getByRole('tab', { name: /Deals/i }))

    const row = (await screen.findByRole('link', { name: 'Growth retainer' })).closest('tr')
    expect(row).not.toBeNull()
    expect(row as HTMLElement).toHaveTextContent('No value captured')
    expect(row as HTMLElement).toHaveTextContent('Stage not set')
    expect(row as HTMLElement).toHaveTextContent('Probability not set')
    expect(screen.queryAllByText('-')).toHaveLength(0)
  })

  it('names linked quote readiness gaps on company detail instead of showing dash placeholders', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/custom-fields?resource=company') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { definitions: [] } }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              company: {
                id: 'company-1',
                orgId: 'org-1',
                name: 'Acme Holdings',
                lifecycleStage: 'customer',
              },
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1/command-center?limit=100') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              summary: {},
              analytics: {},
              contacts: [
                { id: 'contact-1', name: 'Jane Client', email: 'jane@example.com' },
              ],
              deals: [],
              quotes: [
                { id: 'quote-1', quoteNumber: 'Q-001' },
              ],
              invoices: [],
              projects: [],
              serviceWorkspaces: [],
              relationships: [],
              documents: [],
              orders: [],
              shipments: [],
              inventoryItems: [],
              activities: [],
            },
          }),
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response)
    }) as jest.Mock

    render(<CompanyDetailPage />)

    await screen.findByRole('heading', { name: 'Acme Holdings' })
    fireEvent.click(screen.getByRole('tab', { name: /Quotes/i }))

    const row = screen.getByText('Q-001').closest('tr')
    expect(row).not.toBeNull()
    expect(row as HTMLElement).toHaveTextContent('Quote status not set')
    expect(row as HTMLElement).toHaveTextContent('No total captured')
    expect(row as HTMLElement).toHaveTextContent('Valid date not set')
    expect(screen.queryAllByText('-')).toHaveLength(0)
  })

  it('names linked invoice billing readiness gaps on company detail instead of showing dash placeholders', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/custom-fields?resource=company') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { definitions: [] } }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              company: {
                id: 'company-1',
                orgId: 'org-1',
                name: 'Acme Holdings',
                lifecycleStage: 'customer',
              },
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1/command-center?limit=100') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              summary: {},
              analytics: {},
              contacts: [
                { id: 'contact-1', name: 'Jane Client', email: 'jane@example.com' },
              ],
              deals: [],
              quotes: [],
              invoices: [
                { id: 'invoice-1', invoiceNumber: 'INV-001' },
              ],
              projects: [],
              serviceWorkspaces: [],
              relationships: [],
              documents: [],
              orders: [],
              shipments: [],
              inventoryItems: [],
              activities: [],
            },
          }),
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response)
    }) as jest.Mock

    render(<CompanyDetailPage />)

    await screen.findByRole('heading', { name: 'Acme Holdings' })
    fireEvent.click(screen.getByRole('tab', { name: /Invoices/i }))

    const row = screen.getByText('INV-001').closest('tr')
    expect(row).not.toBeNull()
    expect(row as HTMLElement).toHaveTextContent('Invoice status not set')
    expect(row as HTMLElement).toHaveTextContent('No total captured')
    expect(row as HTMLElement).toHaveTextContent('Due date not set')
    expect(screen.queryAllByText('-')).toHaveLength(0)
  })

  it('names linked order fulfillment readiness gaps on company detail instead of raw ids and dash placeholders', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/custom-fields?resource=company') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { definitions: [] } }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              company: {
                id: 'company-1',
                orgId: 'org-1',
                name: 'Acme Holdings',
                lifecycleStage: 'customer',
              },
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1/command-center?limit=100') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              summary: {},
              analytics: {},
              contacts: [
                { id: 'contact-1', name: 'Jane Client', email: 'jane@example.com' },
              ],
              deals: [],
              quotes: [],
              invoices: [],
              projects: [],
              serviceWorkspaces: [],
              relationships: [],
              documents: [],
              orders: [
                { id: 'order-1' },
              ],
              shipments: [],
              inventoryItems: [],
              activities: [],
            },
          }),
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response)
    }) as jest.Mock

    render(<CompanyDetailPage />)

    await screen.findByRole('heading', { name: 'Acme Holdings' })
    fireEvent.click(screen.getByRole('tab', { name: /Orders/i }))

    expect(screen.getByText('Fulfillment order name missing')).toBeInTheDocument()
    expect(screen.getByText(/Fulfillment status not set/)).toBeInTheDocument()
    expect(screen.getByText(/No total captured/)).toBeInTheDocument()
    expect(screen.getByText(/Order status not set/)).toBeInTheDocument()
    expect(screen.queryByText('order-1')).not.toBeInTheDocument()
    expect(screen.queryAllByText('-')).toHaveLength(0)
  })

  it('names linked shipment delivery readiness gaps on company detail instead of raw ids and dash placeholders', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/custom-fields?resource=company') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { definitions: [] } }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              company: {
                id: 'company-1',
                orgId: 'org-1',
                name: 'Acme Holdings',
                lifecycleStage: 'customer',
              },
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1/command-center?limit=100') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              summary: {},
              analytics: {},
              contacts: [
                { id: 'contact-1', name: 'Jane Client', email: 'jane@example.com' },
              ],
              deals: [],
              quotes: [],
              invoices: [],
              projects: [],
              serviceWorkspaces: [],
              relationships: [],
              documents: [],
              orders: [],
              shipments: [
                { id: 'shipment-1' },
              ],
              inventoryItems: [],
              activities: [],
            },
          }),
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response)
    }) as jest.Mock

    render(<CompanyDetailPage />)

    await screen.findByRole('heading', { name: 'Acme Holdings' })
    fireEvent.click(screen.getByRole('tab', { name: /Shipments/i }))

    expect(screen.getByText('Carrier not set')).toBeInTheDocument()
    expect(screen.getByText(/Tracking number not set/)).toBeInTheDocument()
    expect(screen.getByText(/Expected delivery not set/)).toBeInTheDocument()
    expect(screen.getByText(/Shipment status not set/)).toBeInTheDocument()
    expect(screen.queryByText('shipment-1')).not.toBeInTheDocument()
    expect(screen.queryAllByText('-')).toHaveLength(0)
  })

  it('names linked inventory readiness gaps on company detail instead of raw ids and silent blanks', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/custom-fields?resource=company') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { definitions: [] } }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              company: {
                id: 'company-1',
                orgId: 'org-1',
                name: 'Acme Holdings',
                lifecycleStage: 'customer',
              },
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1/command-center?limit=100') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              summary: {},
              analytics: {},
              contacts: [
                { id: 'contact-1', name: 'Jane Client', email: 'jane@example.com' },
              ],
              deals: [],
              quotes: [],
              invoices: [],
              projects: [],
              serviceWorkspaces: [],
              relationships: [],
              documents: [],
              orders: [],
              shipments: [],
              inventoryItems: [
                { id: 'stock-1' },
              ],
              activities: [],
            },
          }),
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response)
    }) as jest.Mock

    render(<CompanyDetailPage />)

    await screen.findByRole('heading', { name: 'Acme Holdings' })
    fireEvent.click(screen.getByRole('tab', { name: /Inventory/i }))

    expect(screen.getByText('Inventory item name missing')).toBeInTheDocument()
    expect(screen.getByText(/SKU not set/)).toBeInTheDocument()
    expect(screen.getByText(/Quantity not captured/)).toBeInTheDocument()
    expect(screen.getByText(/Inventory status not set/)).toBeInTheDocument()
    expect(screen.queryByText('stock-1')).not.toBeInTheDocument()
    expect(screen.queryAllByText('-')).toHaveLength(0)
  })

  it('surfaces CRM OS command-center tabs for delivery, commerce, and collaboration', async () => {
    render(<CompanyDetailPage />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Acme Holdings' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('tab', { name: /Projects/i }))
    expect(await screen.findByText('SEO Sprint')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Services/i }))
    expect(await screen.findByText('SEO Workspace')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Orders/i }))
    expect(await screen.findByText('Quote-to-delivery')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Inventory/i }))
    expect(await screen.findByText('SEO Hours')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Analytics/i }))
    expect(await screen.findByText(/Account value/i)).toBeInTheDocument()
  })

  it('turns company analytics into an operating brief with direct next actions', async () => {
    render(<CompanyDetailPage />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Acme Holdings' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('tab', { name: /Analytics/i }))

    expect(await screen.findByText('Account operating brief')).toBeInTheDocument()
    expect(screen.getAllByText('1 low-stock item').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Open Inventory tab' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open Inventory tab' }))

    expect(await screen.findByText('SEO Hours')).toBeInTheDocument()
  })

  it('turns clear company analytics risk into a leadership review action', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/custom-fields?resource=company') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { definitions: [] } }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              company: {
                id: 'company-1',
                orgId: 'org-1',
                name: 'Acme Holdings',
                lifecycleStage: 'customer',
              },
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1/command-center?limit=100') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              summary: {},
              analytics: {
                riskSignals: [],
              },
              contacts: [],
              deals: [],
              quotes: [],
              invoices: [],
              projects: [],
              serviceWorkspaces: [],
              relationships: [],
              documents: [],
              orders: [],
              shipments: [],
              inventoryItems: [],
              activities: [],
            },
          }),
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response)
    }) as jest.Mock

    render(<CompanyDetailPage />)

    expect(await screen.findByRole('heading', { name: 'Acme Holdings' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Analytics/i }))

    expect(await screen.findByText('Risk watch clear')).toBeInTheDocument()
    expect(screen.getByText('Keep leadership risk reviewable')).toBeInTheDocument()
    expect(
      screen.getByText(
        'No active risk signals are flagged for Acme Holdings. Review invoices, orders, and inventory so finance, delivery, and relationship risk stay visible before the account surprises leadership.',
      ),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Review invoices, orders, and inventory for Acme Holdings' }))

    expect(await screen.findByRole('tab', { name: /Invoices/i })).toHaveAttribute('aria-selected', 'true')
  })

  it('turns an empty company contacts tab into a prefilled create-contact action', async () => {
    const postContact = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { id: 'contact-new' } }),
    } as Response)

    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/crm/custom-fields?resource=company') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { definitions: [] } }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              company: {
                id: 'company-1',
                orgId: 'org-1',
                name: 'Acme Holdings',
                lifecycleStage: 'customer',
              },
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1/command-center?limit=100') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              summary: {},
              analytics: {},
              contacts: [],
              deals: [],
              quotes: [],
              invoices: [],
              projects: [],
              serviceWorkspaces: [],
              relationships: [],
              documents: [],
              orders: [],
              shipments: [],
              inventoryItems: [],
              activities: [],
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/contacts' && init?.method === 'POST') {
        return postContact(input, init)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response)
    }) as jest.Mock

    render(<CompanyDetailPage />)

    await screen.findByRole('heading', { name: 'Acme Holdings' })
    fireEvent.click(screen.getByRole('tab', { name: /Contacts/i }))

    fireEvent.click(await screen.findByRole('button', { name: 'Add first contact for Acme Holdings' }))
    expect(screen.getByText('New contact')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Acme Holdings')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Morgan Buyer' } })
    fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'morgan@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /save contact/i }))

    await waitFor(() => {
      expect(postContact).toHaveBeenCalledWith(
        '/api/v1/crm/contacts',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"companyId":"company-1"'),
        }),
      )
    })
    expect(JSON.parse((postContact.mock.calls[0][1] as RequestInit).body as string)).toEqual(
      expect.objectContaining({
        name: 'Morgan Buyer',
        email: 'morgan@example.com',
        company: 'Acme Holdings',
        companyId: 'company-1',
        companyName: 'Acme Holdings',
      }),
    )
  })

  it('turns an empty company deals tab into a prefilled create-deal action when a contact exists', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/custom-fields?resource=company') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { definitions: [] } }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              company: {
                id: 'company-1',
                orgId: 'org-1',
                name: 'Acme Holdings',
                lifecycleStage: 'customer',
              },
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1/command-center?limit=100') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              summary: {},
              analytics: {},
              contacts: [
                { id: 'contact-1', name: 'Jane Client', email: 'jane@example.com', type: 'client', stage: 'won' },
              ],
              deals: [],
              quotes: [],
              invoices: [],
              projects: [],
              serviceWorkspaces: [],
              relationships: [],
              documents: [],
              orders: [],
              shipments: [],
              inventoryItems: [],
              activities: [],
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/pipelines') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: [
              {
                id: 'pipeline-1',
                name: 'Sales pipeline',
                isDefault: true,
                stages: [{ id: 'stage-1', label: 'Discovery', kind: 'open', order: 1, probability: 25 }],
              },
            ],
          }),
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response)
    }) as jest.Mock

    render(<CompanyDetailPage />)

    await screen.findByRole('heading', { name: 'Acme Holdings' })
    fireEvent.click(screen.getByRole('tab', { name: /Deals/i }))

    fireEvent.click(await screen.findByRole('button', { name: 'Create first deal for Acme Holdings' }))

    expect(await screen.findByRole('dialog', { name: 'Create deal' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search contacts...')).toHaveValue('Jane Client')
    expect(screen.getByText('Acme Holdings')).toBeInTheDocument()
  })

  it('turns an empty company activity tab into a first-note action anchored to a linked contact', async () => {
    const postActivity = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { id: 'activity-1' } }),
    } as Response)

    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/crm/custom-fields?resource=company') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { definitions: [] } }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              company: {
                id: 'company-1',
                orgId: 'org-1',
                name: 'Acme Holdings',
                lifecycleStage: 'customer',
              },
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1/command-center?limit=100') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              summary: {},
              analytics: {},
              contacts: [
                { id: 'contact-1', name: 'Jane Client', email: 'jane@example.com', type: 'client', stage: 'won' },
              ],
              deals: [],
              quotes: [],
              invoices: [],
              projects: [],
              serviceWorkspaces: [],
              relationships: [],
              documents: [],
              orders: [],
              shipments: [],
              inventoryItems: [],
              activities: [],
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/activities' && init?.method === 'POST') {
        return postActivity(input, init)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response)
    }) as jest.Mock

    render(<CompanyDetailPage />)

    await screen.findByRole('heading', { name: 'Acme Holdings' })
    fireEvent.click(screen.getByRole('tab', { name: /Activity/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Log first note for Acme Holdings' }))

    expect(screen.getByLabelText('Company note')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Company note'), {
      target: { value: 'Discussed launch priorities and next decision date.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }))

    await waitFor(() => {
      expect(postActivity).toHaveBeenCalledWith(
        '/api/v1/crm/activities',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"contactId":"contact-1"'),
        }),
      )
    })
    expect(JSON.parse((postActivity.mock.calls[0][1] as RequestInit).body as string)).toEqual(
      expect.objectContaining({
        contactId: 'contact-1',
        companyId: 'company-1',
        type: 'note',
        summary: 'Discussed launch priorities and next decision date.',
        metadata: expect.objectContaining({
          source: 'company_detail',
          companyName: 'Acme Holdings',
          contactName: 'Jane Client',
        }),
      }),
    )
  })

  it('turns an empty company quotes tab into a create-quote action from the first linked deal', async () => {
    const postQuote = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { id: 'quote-new', quoteNumber: 'Q-ACM-001' } }),
    } as Response)

    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/crm/custom-fields?resource=company') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { definitions: [] } }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              company: {
                id: 'company-1',
                orgId: 'org-1',
                name: 'Acme Holdings',
                lifecycleStage: 'customer',
              },
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1/command-center?limit=100') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              summary: {},
              analytics: {},
              contacts: [
                { id: 'contact-1', name: 'Jane Client', email: 'jane@example.com', type: 'client', stage: 'won' },
              ],
              deals: [
                {
                  id: 'deal-1',
                  title: 'Growth retainer',
                  contactId: 'contact-1',
                  value: 24000,
                  currency: 'ZAR',
                  probability: 70,
                },
              ],
              quotes: [],
              invoices: [],
              projects: [],
              serviceWorkspaces: [],
              relationships: [],
              documents: [],
              orders: [],
              shipments: [],
              inventoryItems: [],
              activities: [],
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/quotes' && init?.method === 'POST') {
        return postQuote(input, init)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response)
    }) as jest.Mock

    render(<CompanyDetailPage />)

    await screen.findByRole('heading', { name: 'Acme Holdings' })
    fireEvent.click(screen.getByRole('tab', { name: /Quotes/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Create quote from Growth retainer' }))

    await waitFor(() => {
      expect(postQuote).toHaveBeenCalledWith(
        '/api/v1/quotes',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"dealId":"deal-1"'),
        }),
      )
    })
    expect(JSON.parse((postQuote.mock.calls[0][1] as RequestInit).body as string)).toEqual(
      expect.objectContaining({
        dealId: 'deal-1',
        contactId: 'contact-1',
        companyId: 'company-1',
        currency: 'ZAR',
        lineItems: [
          {
            description: 'Growth retainer',
            quantity: 1,
            unitPrice: 24000,
          },
        ],
      }),
    )
  })

  it('turns an empty company projects tab into a create-project action anchored to the first linked contact', async () => {
    const postProject = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { id: 'project-new' } }),
    } as Response)

    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/crm/custom-fields?resource=company') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { definitions: [] } }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              company: {
                id: 'company-1',
                orgId: 'org-1',
                name: 'Acme Holdings',
                lifecycleStage: 'customer',
              },
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1/command-center?limit=100') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              summary: {},
              analytics: {},
              contacts: [
                { id: 'contact-1', name: 'Jane Client', email: 'jane@example.com', type: 'client', stage: 'won' },
              ],
              deals: [],
              quotes: [],
              invoices: [],
              projects: [],
              serviceWorkspaces: [],
              relationships: [],
              documents: [],
              orders: [],
              shipments: [],
              inventoryItems: [],
              activities: [],
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/projects' && init?.method === 'POST') {
        return postProject(input, init)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response)
    }) as jest.Mock

    render(<CompanyDetailPage />)

    await screen.findByRole('heading', { name: 'Acme Holdings' })
    fireEvent.click(screen.getByRole('tab', { name: /Projects/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Create discovery project for Acme Holdings' }))

    await waitFor(() => {
      expect(postProject).toHaveBeenCalledWith(
        '/api/v1/projects',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"companyId":"company-1"'),
        }),
      )
    })
    expect(JSON.parse((postProject.mock.calls[0][1] as RequestInit).body as string)).toEqual(
      expect.objectContaining({
        name: 'Acme Holdings discovery project',
        status: 'discovery',
        companyId: 'company-1',
        contactId: 'contact-1',
        recipientEmail: 'jane@example.com',
        recipientName: 'Jane Client',
        recipientCompanyName: 'Acme Holdings',
      }),
    )
  })

  it('turns an empty company services tab into a create-service-workspace action', async () => {
    const postServiceWorkspace = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { serviceWorkspace: { id: 'svc-new' } } }),
    } as Response)

    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/crm/custom-fields?resource=company') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { definitions: [] } }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              company: {
                id: 'company-1',
                orgId: 'org-1',
                name: 'Acme Holdings',
                lifecycleStage: 'customer',
              },
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1/command-center?limit=100') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              summary: {},
              analytics: {},
              contacts: [
                { id: 'contact-1', name: 'Jane Client', email: 'jane@example.com', type: 'client', stage: 'won' },
              ],
              deals: [],
              quotes: [],
              invoices: [],
              projects: [
                { id: 'project-1', name: 'Discovery sprint', status: 'active' },
              ],
              serviceWorkspaces: [],
              relationships: [],
              documents: [],
              orders: [],
              shipments: [],
              inventoryItems: [],
              activities: [],
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/service-workspaces' && init?.method === 'POST') {
        return postServiceWorkspace(input, init)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response)
    }) as jest.Mock

    render(<CompanyDetailPage />)

    await screen.findByRole('heading', { name: 'Acme Holdings' })
    fireEvent.click(screen.getByRole('tab', { name: /Services/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Create service workspace for Acme Holdings' }))

    await waitFor(() => {
      expect(postServiceWorkspace).toHaveBeenCalledWith(
        '/api/v1/service-workspaces',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"companyId":"company-1"'),
        }),
      )
    })
    expect(JSON.parse((postServiceWorkspace.mock.calls[0][1] as RequestInit).body as string)).toEqual(
      expect.objectContaining({
        companyId: 'company-1',
        contactId: 'contact-1',
        projectId: 'project-1',
        linkedProjectIds: ['project-1'],
        name: 'Acme Holdings service workspace',
        serviceType: 'custom',
        status: 'active',
        visibility: 'relationship',
      }),
    )
  })

  it('turns an empty company documents tab into a linked sales proposal draft action', async () => {
    const postDocument = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { id: 'doc-new' } }),
    } as Response)

    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/crm/custom-fields?resource=company') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { definitions: [] } }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              company: {
                id: 'company-1',
                orgId: 'org-1',
                linkedOrgId: 'client-org-1',
                name: 'Acme Holdings',
                lifecycleStage: 'customer',
              },
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1/command-center?limit=100') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              summary: {},
              analytics: {},
              contacts: [
                { id: 'contact-1', name: 'Jane Client', email: 'jane@example.com', type: 'client', stage: 'won' },
              ],
              deals: [],
              quotes: [],
              invoices: [],
              projects: [],
              serviceWorkspaces: [],
              relationships: [],
              documents: [],
              orders: [],
              shipments: [],
              inventoryItems: [],
              activities: [],
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/client-documents' && init?.method === 'POST') {
        return postDocument(input, init)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response)
    }) as jest.Mock

    render(<CompanyDetailPage />)

    await screen.findByRole('heading', { name: 'Acme Holdings' })
    fireEvent.click(screen.getByRole('tab', { name: /Documents/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Create sales proposal for Acme Holdings' }))

    await waitFor(() => {
      expect(postDocument).toHaveBeenCalledWith(
        '/api/v1/client-documents',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"companyId":"company-1"'),
        }),
      )
    })
    expect(JSON.parse((postDocument.mock.calls[0][1] as RequestInit).body as string)).toEqual(
      expect.objectContaining({
        title: 'Acme Holdings sales proposal',
        type: 'sales_proposal',
        linked: {
          companyId: 'company-1',
          clientOrgId: 'client-org-1',
        },
      }),
    )
  })

  it('turns an empty company relationships tab into a linked relationship action', async () => {
    const postRelationship = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { relationship: { id: 'rel-new' } } }),
    } as Response)

    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/crm/custom-fields?resource=company') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { definitions: [] } }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              company: {
                id: 'company-1',
                orgId: 'org-1',
                linkedOrgId: 'client-org-1',
                name: 'Acme Holdings',
                lifecycleStage: 'customer',
              },
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1/command-center?limit=100') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              summary: {},
              analytics: {},
              contacts: [
                { id: 'contact-1', name: 'Jane Client', email: 'jane@example.com', type: 'client', stage: 'won' },
              ],
              deals: [],
              quotes: [],
              invoices: [],
              projects: [],
              serviceWorkspaces: [],
              relationships: [],
              documents: [],
              orders: [],
              shipments: [],
              inventoryItems: [],
              activities: [],
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/relationships' && init?.method === 'POST') {
        return postRelationship(input, init)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response)
    }) as jest.Mock

    render(<CompanyDetailPage />)

    await screen.findByRole('heading', { name: 'Acme Holdings' })
    fireEvent.click(screen.getByRole('tab', { name: /Relationships/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Create relationship for Acme Holdings' }))

    await waitFor(() => {
      expect(postRelationship).toHaveBeenCalledWith(
        '/api/v1/crm/relationships',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"sourceCompanyId":"company-1"'),
        }),
      )
    })
    expect(JSON.parse((postRelationship.mock.calls[0][1] as RequestInit).body as string)).toEqual(
      expect.objectContaining({
        sourceCompanyId: 'company-1',
        sourceContactId: 'contact-1',
        targetOrgId: 'client-org-1',
        targetName: 'Acme Holdings',
        relationshipType: 'customer',
        status: 'active',
        sharedCapabilities: ['crm', 'projects', 'documents', 'services'],
        visibility: 'relationship',
        approvalState: 'approved',
      }),
    )
  })

  it('turns an empty company invoices tab into an accepted quote conversion action', async () => {
    const convertQuote = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { invoiceId: 'invoice-new', invoiceNumber: 'INV-002' } }),
    } as Response)

    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/crm/custom-fields?resource=company') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { definitions: [] } }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              company: {
                id: 'company-1',
                orgId: 'org-1',
                linkedOrgId: 'client-org-1',
                name: 'Acme Holdings',
                lifecycleStage: 'customer',
              },
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1/command-center?limit=100') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              summary: {},
              analytics: {},
              contacts: [
                { id: 'contact-1', name: 'Jane Client', email: 'jane@example.com', type: 'client', stage: 'won' },
              ],
              deals: [],
              quotes: [
                { id: 'quote-1', quoteNumber: 'QUO-001', status: 'accepted', total: 12000, currency: 'ZAR' },
              ],
              invoices: [],
              projects: [],
              serviceWorkspaces: [],
              relationships: [],
              documents: [],
              orders: [],
              shipments: [],
              inventoryItems: [],
              activities: [],
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/quotes/quote-1' && init?.method === 'PATCH') {
        return convertQuote(input, init)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response)
    }) as jest.Mock

    render(<CompanyDetailPage />)

    await screen.findByRole('heading', { name: 'Acme Holdings' })
    fireEvent.click(screen.getByRole('tab', { name: /Invoices/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Create invoice from QUO-001' }))

    await waitFor(() => {
      expect(convertQuote).toHaveBeenCalledWith(
        '/api/v1/quotes/quote-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ action: 'convert-to-invoice' }),
        }),
      )
    })
  })

  it('turns an empty company orders tab into a fulfillment order action from the first invoice', async () => {
    const postOrder = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { order: { id: 'order-new' } } }),
    } as Response)

    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/crm/custom-fields?resource=company') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { definitions: [] } }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              company: {
                id: 'company-1',
                orgId: 'org-1',
                linkedOrgId: 'client-org-1',
                name: 'Acme Holdings',
                lifecycleStage: 'customer',
              },
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1/command-center?limit=100') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              summary: {},
              analytics: {},
              contacts: [
                { id: 'contact-1', name: 'Jane Client', email: 'jane@example.com', type: 'client', stage: 'won' },
              ],
              deals: [],
              quotes: [],
              invoices: [
                { id: 'invoice-1', invoiceNumber: 'INV-001', status: 'sent', total: 12000, currency: 'ZAR' },
              ],
              projects: [],
              serviceWorkspaces: [],
              relationships: [],
              documents: [],
              orders: [],
              shipments: [],
              inventoryItems: [],
              activities: [],
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/orders' && init?.method === 'POST') {
        return postOrder(input, init)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response)
    }) as jest.Mock

    render(<CompanyDetailPage />)

    await screen.findByRole('heading', { name: 'Acme Holdings' })
    fireEvent.click(screen.getByRole('tab', { name: /Orders/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Create fulfillment order from INV-001' }))

    await waitFor(() => {
      expect(postOrder).toHaveBeenCalledWith(
        '/api/v1/orders',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"invoiceId":"invoice-1"'),
        }),
      )
    })
    expect(JSON.parse((postOrder.mock.calls[0][1] as RequestInit).body as string)).toEqual(
      expect.objectContaining({
        companyId: 'company-1',
        contactId: 'contact-1',
        invoiceId: 'invoice-1',
        title: 'Acme Holdings fulfillment order',
        status: 'confirmed',
        fulfillmentStatus: 'not_started',
        total: 12000,
        currency: 'ZAR',
        visibility: 'relationship',
        approvalState: 'approved',
      }),
    )
  })

  it('turns an empty company shipments tab into a shipment action from the first order', async () => {
    const postShipment = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { shipment: { id: 'shipment-new' } } }),
    } as Response)

    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/crm/custom-fields?resource=company') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { definitions: [] } }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              company: {
                id: 'company-1',
                orgId: 'org-1',
                linkedOrgId: 'client-org-1',
                name: 'Acme Holdings',
                lifecycleStage: 'customer',
              },
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1/command-center?limit=100') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              summary: {},
              analytics: {},
              contacts: [
                { id: 'contact-1', name: 'Jane Client', email: 'jane@example.com', type: 'client', stage: 'won' },
              ],
              deals: [],
              quotes: [],
              invoices: [],
              projects: [],
              serviceWorkspaces: [],
              relationships: [],
              documents: [],
              orders: [
                { id: 'order-1', title: 'Acme Holdings fulfillment order', status: 'confirmed', fulfillmentStatus: 'not_started', total: 12000, currency: 'ZAR' },
              ],
              shipments: [],
              inventoryItems: [],
              activities: [],
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/shipments' && init?.method === 'POST') {
        return postShipment(input, init)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response)
    }) as jest.Mock

    render(<CompanyDetailPage />)

    await screen.findByRole('heading', { name: 'Acme Holdings' })
    fireEvent.click(screen.getByRole('tab', { name: /Shipments/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Create shipment for Acme Holdings fulfillment order' }))

    await waitFor(() => {
      expect(postShipment).toHaveBeenCalledWith(
        '/api/v1/shipments',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"orderId":"order-1"'),
        }),
      )
    })
    expect(JSON.parse((postShipment.mock.calls[0][1] as RequestInit).body as string)).toEqual(
      expect.objectContaining({
        companyId: 'company-1',
        orderId: 'order-1',
        status: 'pending',
        carrier: 'Internal delivery',
        visibility: 'relationship',
        approvalState: 'approved',
      }),
    )
  })

  it('turns an empty company inventory tab into a tracked inventory item action', async () => {
    const postInventoryItem = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { inventoryItem: { id: 'stock-new' } } }),
    } as Response)

    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/crm/custom-fields?resource=company') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { definitions: [] } }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              company: {
                id: 'company-1',
                orgId: 'org-1',
                linkedOrgId: 'client-org-1',
                name: 'Acme Holdings',
                lifecycleStage: 'customer',
              },
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1/command-center?limit=100') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              summary: {},
              analytics: {},
              contacts: [],
              deals: [],
              quotes: [],
              invoices: [],
              projects: [],
              serviceWorkspaces: [],
              relationships: [],
              documents: [],
              orders: [],
              shipments: [],
              inventoryItems: [],
              activities: [],
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/inventory-items' && init?.method === 'POST') {
        return postInventoryItem(input, init)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response)
    }) as jest.Mock

    render(<CompanyDetailPage />)

    await screen.findByRole('heading', { name: 'Acme Holdings' })
    fireEvent.click(screen.getByRole('tab', { name: /Inventory/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Create inventory item for Acme Holdings' }))

    await waitFor(() => {
      expect(postInventoryItem).toHaveBeenCalledWith(
        '/api/v1/inventory-items',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"companyId":"company-1"'),
        }),
      )
    })
    expect(JSON.parse((postInventoryItem.mock.calls[0][1] as RequestInit).body as string)).toEqual(
      expect.objectContaining({
        companyId: 'company-1',
        name: 'Acme Holdings tracked inventory',
        sku: 'ACME-HOLDINGS-TRACKED',
        quantityAvailable: 0,
        quantityReserved: 0,
        lowStockThreshold: 1,
        unit: 'item',
        location: 'Client account',
        visibility: 'relationship',
        approvalState: 'approved',
      }),
    )
  })
})
