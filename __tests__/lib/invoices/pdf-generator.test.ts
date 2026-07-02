import path from 'path'
import { renderInvoicePdf } from '@/lib/invoices/pdf-generator'

describe('renderInvoicePdf', () => {
  it('renders a real, non-empty PDF buffer for a full invoice', async () => {
    const buffer = await renderInvoicePdf({
      id: 'invoice-1',
      invoiceNumber: 'INV-1001',
      status: 'sent',
      currency: 'ZAR',
      issueDate: { _seconds: 1750000000 },
      dueDate: { _seconds: 1751000000 },
      subtotal: 1000,
      taxRate: 15,
      taxAmount: 150,
      total: 1150,
      notes: 'Thank you for your business. Payment due within 14 days.',
      fromDetails: {
        companyName: 'Partners in Biz',
        email: 'billing@partnersinbiz.online',
        phone: '+27 21 555 0100',
        vatNumber: 'ZA4123456789',
        registrationNumber: '2024/123456/07',
        website: 'https://partnersinbiz.online',
        address: {
          line1: '1 Long Street',
          city: 'Cape Town',
          postalCode: '8001',
          country: 'South Africa',
        },
        bankingDetails: {
          bankName: 'First National Bank',
          accountHolder: 'Partners in Biz (Pty) Ltd',
          accountNumber: '62812345678',
          branchCode: '250655',
          swiftCode: 'FIRNZAJJ',
        },
      },
      clientDetails: {
        name: 'Acme Corp',
        email: 'accounts@acme.test',
        address: {
          line1: '22 Main Road',
          city: 'Johannesburg',
          postalCode: '2000',
          country: 'South Africa',
        },
      },
      lineItems: [
        { description: 'Social media management — June', quantity: 1, unitPrice: 600, amount: 600 },
        { description: 'SEO sprint — Week 3', quantity: 2, unitPrice: 200, amount: 400 },
      ],
    })

    expect(Buffer.isBuffer(buffer)).toBe(true)
    expect(buffer.length).toBeGreaterThan(0)
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })

  it('renders a valid PDF buffer with an org logo image included', async () => {
    const buffer = await renderInvoicePdf({
      id: 'invoice-3',
      invoiceNumber: 'INV-1003',
      status: 'sent',
      currency: 'ZAR',
      subtotal: 500,
      taxRate: 0,
      taxAmount: 0,
      total: 500,
      lineItems: [{ description: 'Consulting', quantity: 1, unitPrice: 500, amount: 500 }],
      fromDetails: {
        companyName: 'Partners in Biz',
        logoUrl: path.join(__dirname, '../../../public/pib-logo-512.png'),
        bankingDetails: {
          bankName: 'First National Bank',
          accountHolder: 'Partners in Biz (Pty) Ltd',
          accountNumber: '62812345678',
          branchCode: '250655',
        },
      },
    })

    expect(Buffer.isBuffer(buffer)).toBe(true)
    expect(buffer.length).toBeGreaterThan(0)
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })

  it('renders a valid PDF buffer even with minimal/missing optional invoice fields', async () => {
    const buffer = await renderInvoicePdf({
      id: 'invoice-2',
      invoiceNumber: 'INV-1002',
      status: 'draft',
      currency: 'USD',
      subtotal: 0,
      taxRate: 0,
      taxAmount: 0,
      total: 0,
      lineItems: [],
    })

    expect(Buffer.isBuffer(buffer)).toBe(true)
    expect(buffer.length).toBeGreaterThan(0)
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })
})
