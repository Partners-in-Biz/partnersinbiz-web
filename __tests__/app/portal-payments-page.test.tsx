import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PaymentsPage from '@/app/(portal)/portal/payments/page'

let mockSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}))

const fetchMock = jest.fn()

describe('PaymentsPage', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams()
    fetchMock.mockReset()
    global.fetch = fetchMock
  })

  it('keeps invoice, quote, PDF, and quote actions scoped to the active company workspace', async () => {
    mockSearchParams = new URLSearchParams(
      'orgId=lumen-org&orgSlug=lumen-speeds&sourceCompanyId=company-1&sourceCompanyName=Lumen',
    )
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/invoices?view=received&orgId=lumen-org') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: [
              {
                id: 'invoice-1',
                invoiceNumber: 'INV-001',
                status: 'sent',
                total: 25000,
                currency: 'ZAR',
                issueDate: '2026-06-01',
                dueDate: '2026-06-30',
              },
            ],
          }),
        })
      }
      if (url === '/api/v1/quotes?view=received&orgId=lumen-org') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: {
              quotes: [
                {
                  id: 'quote-1',
                  quoteNumber: 'Q-001',
                  status: 'sent',
                  total: 15000,
                  currency: 'ZAR',
                  issueDate: '2026-06-01',
                  validUntil: '2026-06-20',
                },
              ],
            },
          }),
        })
      }
      if (url === '/api/v1/quotes/quote-1?orgId=lumen-org' && init?.method === 'PATCH') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
    })

    render(<PaymentsPage />)

    expect(await screen.findByText('Lumen workspace')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/invoices?view=received&orgId=lumen-org')
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/quotes?view=received&orgId=lumen-org')
    expect(await screen.findByRole('link', { name: 'Download INV-001 PDF' })).toHaveAttribute(
      'href',
      '/api/v1/invoices/invoice-1/pdf?orgId=lumen-org',
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Quotes' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Accept quote Q-001' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/quotes/quote-1?orgId=lumen-org',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ status: 'accepted' }),
        }),
      )
    })
  })

  it('frames billing as a finance command center for leaders', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [] }) })

    render(<PaymentsPage />)

    expect(await screen.findByRole('heading', { name: 'Finance command center' })).toBeInTheDocument()
    expect(screen.getByText('Revenue protected')).toBeInTheDocument()
    expect(screen.getByText('Payment risk')).toBeInTheDocument()
    expect(screen.getByText('Active workspace')).toBeInTheDocument()
  })
})
