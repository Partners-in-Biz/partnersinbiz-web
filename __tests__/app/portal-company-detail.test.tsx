import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import CompanyDetailPage from '@/app/(portal)/portal/companies/[id]/page'

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'company-1' }),
  useRouter: () => ({ push: jest.fn() }),
}))

describe('Portal company detail page', () => {
  beforeEach(() => {
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
})
