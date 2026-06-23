import React from 'react'
import { render, screen } from '@testing-library/react'

const mockGet = jest.fn()
const mockLimit = jest.fn()
const mockWhere = jest.fn()
const mockCollection = jest.fn()

jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

describe('Public invoice page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    const query = { where: mockWhere, limit: mockLimit, get: mockGet }
    mockWhere.mockReturnValue(query)
    mockLimit.mockReturnValue(query)
    mockCollection.mockReturnValue(query)
  })

  it('renders a read-only invoice view for a valid token', async () => {
    mockGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: 'invoice-1',
          data: () => ({
            invoiceNumber: 'INV-100',
            status: 'sent',
            currency: 'ZAR',
            total: 5600,
            subtotal: 4869.57,
            taxRate: 15,
            taxAmount: 730.43,
            dueDate: { _seconds: 1782777600 },
            lineItems: [{ description: 'Sprint retainer', quantity: 1, unitPrice: 4869.57, amount: 4869.57 }],
            notes: 'Thank you for your business.',
            clientDetails: { name: 'Course Digs' },
            fromDetails: { companyName: 'Partners in Biz', vatNumber: 'VAT-123' },
            publicToken: 'public-token-1',
          }),
        },
      ],
    })
    mockGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: 'platform-org',
          data: () => ({
            billingDetails: {
              bankingDetails: {
                bankName: 'FNB',
                accountHolder: 'Partners in Biz',
                accountNumber: '123456789',
                branchCode: '250655',
              },
            },
            billingEmail: 'billing@partnersinbiz.online',
          }),
        },
      ],
    })

    const Page = (await import('@/app/invoice/[token]/page')).default
    render(await Page({ params: Promise.resolve({ token: 'public-token-1' }) }))

    expect(screen.getByRole('heading', { name: 'INV-100' })).toBeInTheDocument()
    expect(screen.getByText('Course Digs')).toBeInTheDocument()
    expect(screen.getByText(/VAT-123/i)).toBeInTheDocument()
    expect(screen.getByText('FNB')).toBeInTheDocument()
    expect(screen.getByText(/billing@partnersinbiz\.online/i)).toBeInTheDocument()
    expect(screen.getByText(/Thank you for your business\./i)).toBeInTheDocument()
  })
})
