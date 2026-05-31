import { fireEvent, render, screen } from '@testing-library/react'
import ProductsPage from '@/app/(portal)/portal/settings/products/page'
import type { Product } from '@/lib/products/types'

let products: Product[] = []

jest.mock('@/components/crm/ProductModal', () => ({
  ProductModal: ({ product, onClose }: { product: unknown; onClose: () => void }) => (
    <div role="dialog" aria-label={product ? 'Edit product' : 'New product'}>
      <p>Product modal open</p>
      <button type="button" onClick={onClose}>Close</button>
    </div>
  ),
}))

describe('Portal settings products page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    products = []
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/products') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { products } }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock
  })

  it('turns the empty product catalog into a quote-readiness command center', async () => {
    render(<ProductsPage />)

    expect(await screen.findByText('Build a quote-ready catalog')).toBeInTheDocument()
    expect(screen.getByText('Pricing')).toBeInTheDocument()
    expect(screen.getByText('Units')).toBeInTheDocument()
    expect(screen.getByText('Sales copy')).toBeInTheDocument()
    expect(screen.getByText('Forecasting')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /create the first catalog item/i }))
    expect(screen.getByRole('dialog', { name: 'New product' })).toBeInTheDocument()
  })

  it('turns missing product description into a direct edit action', async () => {
    products = [{
      id: 'product-1',
      orgId: 'org-1',
      name: 'Growth retainer',
      description: '',
      unit: 'month',
      unitPrice: 15000,
      currency: 'ZAR',
      createdAt: null,
      updatedAt: null,
    }]

    render(<ProductsPage />)

    expect(await screen.findByText('Growth retainer')).toBeInTheDocument()
    expect(screen.getByText('No product description yet.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Add description for Growth retainer/i }))
    expect(screen.getByRole('dialog', { name: 'Edit product' })).toBeInTheDocument()
  })

  it('turns missing product pricing rules into a direct edit action', async () => {
    products = [{
      id: 'product-1',
      orgId: 'org-1',
      name: 'Strategy workshop',
      description: 'Discovery session',
      unit: '',
      unitPrice: 0,
      currency: 'ZAR',
      createdAt: null,
      updatedAt: null,
    }]

    render(<ProductsPage />)

    expect(await screen.findByText('Strategy workshop')).toBeInTheDocument()
    expect(screen.getByText('Missing unit, price')).toBeInTheDocument()
    expect(screen.getByText('Unit not set')).toBeInTheDocument()
    expect(screen.queryByText('—')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Fix pricing setup for Strategy workshop/i }))
    expect(screen.getByRole('dialog', { name: 'Edit product' })).toBeInTheDocument()
  })

  it('treats an empty filtered product view as a reversible catalog lens', async () => {
    products = [{
      id: 'product-1',
      orgId: 'org-1',
      name: 'Launch package',
      description: 'Campaign setup package',
      unit: 'package',
      unitPrice: 25000,
      currency: 'ZAR',
      createdAt: null,
      updatedAt: null,
    }]

    render(<ProductsPage />)

    expect(await screen.findByText('Launch package')).toBeInTheDocument()

    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'needs-work' } })

    expect(await screen.findByRole('heading', { name: 'No products match this view.' })).toBeInTheDocument()
    expect(screen.getByText('Clear the product filters to return to the full quote-ready catalog.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show all products' }))

    expect(await screen.findByText('Launch package')).toBeInTheDocument()
  })
})
