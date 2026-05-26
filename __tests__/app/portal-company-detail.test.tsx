import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import CompanyDetailPage from '@/app/(portal)/portal/companies/[id]/page'

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'company-1' }),
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
      if (url === '/api/v1/crm/companies/company-1/contacts?limit=100') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              contacts: [
                { id: 'contact-1', name: 'Jane Client', email: 'jane@example.com', type: 'client', stage: 'won' },
              ],
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/companies/company-1/invoices?limit=100') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              invoices: [
                { id: 'invoice-1', invoiceNumber: 'INV-001', status: 'sent', total: 1200, currency: 'ZAR' },
              ],
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
})
