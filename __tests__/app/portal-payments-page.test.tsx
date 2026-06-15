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

  it('lets non-paid invoices update status from the payments table while paid invoices stay locked', async () => {
    mockSearchParams = new URLSearchParams('orgId=lumen-org')
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/invoices?view=received&orgId=lumen-org') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: [
              {
                id: 'draft-invoice',
                invoiceNumber: 'COU-003',
                status: 'draft',
                total: 4200,
                currency: 'ZAR',
                issueDate: '2026-06-15',
              },
              {
                id: 'paid-invoice',
                invoiceNumber: 'AHS-001',
                status: 'paid',
                total: 3000,
                currency: 'ZAR',
                issueDate: '2026-05-24',
              },
            ],
          }),
        })
      }
      if (url === '/api/v1/quotes?view=received&orgId=lumen-org') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: { quotes: [] } }) })
      }
      if (url === '/api/v1/invoices/draft-invoice?orgId=lumen-org' && init?.method === 'PATCH') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: { id: 'draft-invoice' } }) })
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
    })

    render(<PaymentsPage />)

    const draftStatus = await screen.findByRole('button', { name: 'Change status for invoice COU-003' })
    expect(draftStatus).toHaveAttribute('aria-haspopup', 'listbox')
    expect(draftStatus).not.toHaveClass('absolute', 'inset-0', 'h-full', 'w-full', 'opacity-0')
    expect(screen.getByTestId('invoice-status-pill-COU-003')).toHaveTextContent('Draft')
    expect(screen.getByText('Paid')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change status for invoice AHS-001' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Download COU-003 PDF' })).toBeInTheDocument()

    fireEvent.click(draftStatus)
    const statusMenu = await screen.findByRole('listbox', { name: 'Change status for invoice COU-003' })
    expect(statusMenu).toHaveClass('bg-[var(--color-pib-surface)]', 'text-[var(--color-pib-text)]')

    fireEvent.click(screen.getByRole('option', { name: 'Overdue' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/invoices/draft-invoice?orgId=lumen-org',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ status: 'overdue' }),
        }),
      )
    })
    await waitFor(() => expect(screen.getByTestId('invoice-status-pill-COU-003')).toHaveTextContent('Overdue'))
  })

  it('links draft invoice numbers to the invoice editing surface without linking non-draft invoices', async () => {
    mockSearchParams = new URLSearchParams(
      'orgId=lumen-org&orgSlug=lumen-speeds&sourceCompanyId=company-1&sourceCompanyName=Lumen',
    )
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/v1/invoices?view=received&orgId=lumen-org') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: [
              {
                id: 'draft-invoice',
                invoiceNumber: 'COU-003',
                status: 'draft',
                total: 4200,
                currency: 'ZAR',
              },
              {
                id: 'sent-invoice',
                invoiceNumber: 'COV-002',
                status: 'sent',
                total: 1000,
                currency: 'ZAR',
              },
            ],
          }),
        })
      }
      if (url === '/api/v1/quotes?view=received&orgId=lumen-org') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: { quotes: [] } }) })
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
    })

    render(<PaymentsPage />)

    expect(await screen.findByRole('link', { name: 'Edit draft invoice COU-003' })).toHaveAttribute(
      'href',
      '/portal/invoicing/draft-invoice?edit=draft&orgId=lumen-org&orgSlug=lumen-speeds&sourceCompanyId=company-1&sourceCompanyName=Lumen',
    )
    expect(screen.queryByRole('link', { name: 'Edit draft invoice COV-002' })).not.toBeInTheDocument()
    expect(screen.getByText('COV-002')).toBeInTheDocument()
  })

  it('frames billing as a finance command center for leaders', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [] }) })

    render(<PaymentsPage />)

    expect(await screen.findByRole('heading', { name: 'Finance command center' })).toBeInTheDocument()
    expect(await screen.findByText('Revenue protected')).toBeInTheDocument()
    expect(screen.getByText('Payment risk')).toBeInTheDocument()
    expect(screen.getByText('Active workspace')).toBeInTheDocument()
  })
})
