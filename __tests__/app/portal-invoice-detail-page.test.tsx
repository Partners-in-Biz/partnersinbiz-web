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

  it('shows EFT instructions and uploads proof for payable received invoices', async () => {
    mockSearchParams = new URLSearchParams('orgId=course-digs&orgSlug=course-digs')
    const proofFile = new File(['proof'], 'proof.pdf', { type: 'application/pdf' })

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/invoices/invoice-draft-1?orgId=course-digs') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              id: 'invoice-draft-1',
              invoiceNumber: 'COU-004',
              orgId: 'course-digs',
              status: 'sent',
              total: 5600,
              subtotal: 4869.57,
              taxRate: 15,
              taxAmount: 730.43,
              currency: 'ZAR',
              lineItems: [{ description: 'Sprint retainer', quantity: 1, unitPrice: 4869.57, amount: 4869.57 }],
              clientDetails: { name: 'Course Digs' },
            },
          }),
        })
      }
      if (url === '/api/v1/recurring-schedules?status=all&orgId=course-digs') {
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) })
      }
      if (url === '/api/v1/invoices/invoice-draft-1/payment-instructions?orgId=course-digs') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              invoiceNumber: 'COU-004',
              total: 5600,
              currency: 'ZAR',
              dueDate: '2026-06-30T00:00:00.000Z',
              eft: {
                bankingDetails: {
                  bankName: 'FNB',
                  accountName: 'Partners in Biz',
                  accountNumber: '123456789',
                  branchCode: '250655',
                },
                reference: 'COU-004',
                proofOfPaymentEmail: 'billing@partnersinbiz.online',
              },
              paypal: { available: false, url: null },
              publicViewUrl: 'https://partnersinbiz.online/invoice/public-token-1',
            },
          }),
        })
      }
      if (url === '/api/v1/portal/invoices/invoice-draft-1/payment-proof-upload?orgId=course-digs' && init?.method === 'POST') {
        const body = init.body as FormData
        expect(body.get('file')).toBe(proofFile)
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { id: 'upload-1', name: 'proof.pdf' } }),
        })
      }
      if (url === '/api/v1/invoices/invoice-draft-1/payment-proof?orgId=course-digs' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { id: 'invoice-draft-1', status: 'payment_pending_verification' } }),
        })
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    })

    render(<InvoiceDetailPage />)

    expect(await screen.findByRole('heading', { name: 'COU-004' })).toBeInTheDocument()
    expect(await screen.findByText('FNB')).toBeInTheDocument()
    expect(screen.getByText('123456789')).toBeInTheDocument()
    expect(screen.getByText(/VAT \(15%\)/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open public invoice/i })).toHaveAttribute(
      'href',
      'https://partnersinbiz.online/invoice/public-token-1',
    )

    fireEvent.change(screen.getByLabelText(/Upload payment proof/i), {
      target: { files: [proofFile] },
    })
    fireEvent.change(screen.getByLabelText(/Payment note/i), {
      target: { value: 'Paid from Nedbank business account' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Submit proof of payment/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/portal/invoices/invoice-draft-1/payment-proof-upload?orgId=course-digs',
        expect.objectContaining({ method: 'POST' }),
      )
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/invoices/invoice-draft-1/payment-proof?orgId=course-digs',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            fileId: 'upload-1',
            note: 'Paid from Nedbank business account',
          }),
        }),
      )
    })

    expect(await screen.findByText(/Payment proof submitted/i)).toBeInTheDocument()
  })
})
