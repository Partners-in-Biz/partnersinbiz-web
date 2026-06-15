import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import InvoiceDetailPage from '@/app/(portal)/portal/invoicing/[id]/page'

const pushMock = jest.fn()
let mockSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'invoice-draft-1' }),
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => mockSearchParams,
}))

const fetchMock = jest.fn()

describe('InvoiceDetailPage', () => {
  beforeEach(() => {
    pushMock.mockReset()
    fetchMock.mockReset()
    mockSearchParams = new URLSearchParams()
    global.fetch = fetchMock
  })

  it('opens a draft invoice editor from the edit query and saves draft fields', async () => {
    mockSearchParams = new URLSearchParams('edit=draft')
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/invoices/invoice-draft-1') {
        if (init?.method === 'PATCH') {
          return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { id: 'invoice-draft-1' } }) })
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              id: 'invoice-draft-1',
              invoiceNumber: 'COU-003',
              orgId: 'course-digs',
              status: 'draft',
              total: 4200,
              subtotal: 4200,
              taxRate: 0,
              taxAmount: 0,
              currency: 'ZAR',
              notes: 'Initial invoice',
              lineItems: [{ description: 'Development', quantity: 12, unitPrice: 350, amount: 4200 }],
              canEdit: true,
            },
          }),
        })
      }
      if (url === '/api/v1/recurring-schedules?status=all') {
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) })
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    })

    render(<InvoiceDetailPage />)

    expect(await screen.findByRole('heading', { name: 'COU-003' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Line item description/i), { target: { value: 'Updated development' } })
    fireEvent.change(screen.getByLabelText(/Unit price/i), { target: { value: '375' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save draft invoice' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/invoices/invoice-draft-1',
        expect.objectContaining({ method: 'PATCH' }),
      )
    })
    const patchCall = fetchMock.mock.calls.find(([url, init]) => url === '/api/v1/invoices/invoice-draft-1' && init?.method === 'PATCH')
    expect(JSON.parse(patchCall[1].body)).toMatchObject({
      taxRate: 0,
      notes: 'Initial invoice',
      lineItems: [{ description: 'Updated development', quantity: 12, unitPrice: 375 }],
    })
  })

  it('keeps invoice detail actions scoped to the selected organisation query', async () => {
    mockSearchParams = new URLSearchParams('edit=draft&orgId=course-digs&orgSlug=course-digs')
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/invoices/invoice-draft-1?orgId=course-digs') {
        if (init?.method === 'PATCH') {
          return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { id: 'invoice-draft-1' } }) })
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              id: 'invoice-draft-1',
              invoiceNumber: 'COU-003',
              orgId: 'course-digs',
              status: 'draft',
              total: 4200,
              subtotal: 4200,
              taxRate: 0,
              taxAmount: 0,
              currency: 'ZAR',
              notes: 'Initial invoice',
              lineItems: [{ description: 'Development', quantity: 12, unitPrice: 350, amount: 4200 }],
              canEdit: true,
            },
          }),
        })
      }
      if (url === '/api/v1/recurring-schedules?status=all&orgId=course-digs') {
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) })
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    })

    render(<InvoiceDetailPage />)

    expect(await screen.findByRole('heading', { name: 'COU-003' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/invoices/invoice-draft-1?orgId=course-digs')
    expect(screen.getByRole('link', { name: '← Invoicing' })).toHaveAttribute(
      'href',
      '/portal/invoicing?orgId=course-digs&orgSlug=course-digs',
    )
    expect(screen.getByRole('link', { name: '📄 Download PDF' })).toHaveAttribute(
      'href',
      '/api/v1/invoices/invoice-draft-1/pdf?orgId=course-digs',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save draft invoice' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/invoices/invoice-draft-1?orgId=course-digs',
        expect.objectContaining({ method: 'PATCH' }),
      )
    })
  })
})
