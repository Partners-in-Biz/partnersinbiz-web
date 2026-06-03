import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/crm/products') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { products } }),
        } as Response)
      }
      if (url === '/api/v1/crm/products/product-1' && init?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('turns the empty product catalog into a quote-readiness command center', async () => {
    render(<ProductsPage />)

    expect(await screen.findByText('Build a quote-ready catalog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New product' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Filter products by currency' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Filter products by health' })).toBeInTheDocument()
    expect(screen.getByText('Pricing')).toBeInTheDocument()
    expect(screen.getByText('Units')).toBeInTheDocument()
    expect(screen.getByText('Sales copy')).toBeInTheDocument()
    expect(screen.getByText('Forecasting')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /create the first catalog item/i }))
    expect(screen.getByRole('dialog', { name: 'New product' })).toBeInTheDocument()
  })

  it('warns when products fail to load and gives leaders a retry path', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/products') {
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: 'Product catalog unavailable' }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock

    render(<ProductsPage />)

    expect(await screen.findByRole('heading', { name: 'Product catalog could not load' })).toBeInTheDocument()
    expect(screen.getByText('Product catalog unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Build a quote-ready catalog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry loading products' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })
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

  it('names sparse product rows instead of leaving blank catalog identity', async () => {
    products = [{
      id: 'product-raw-id',
      orgId: 'org-1',
      name: '',
      description: 'Needs naming before the team quotes it',
      unit: 'month',
      unitPrice: 12000,
      currency: 'ZAR',
      createdAt: null,
      updatedAt: null,
    }]

    render(<ProductsPage />)

    expect(await screen.findByText('Product name missing')).toBeInTheDocument()
    expect(screen.queryByText('product-raw-id')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Edit Product name missing/i }))
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

  it('names missing product currency instead of crashing or leaving blank pricing context', async () => {
    products = [{
      id: 'product-1',
      orgId: 'org-1',
      name: 'Audit Sprint',
      description: 'Technical audit',
      unit: 'sprint',
      unitPrice: 9000,
      currency: '',
      createdAt: null,
      updatedAt: null,
    }]

    render(<ProductsPage />)

    expect(await screen.findByText('Audit Sprint')).toBeInTheDocument()
    expect(screen.getByText('Currency not set')).toBeInTheDocument()
    expect(screen.getByText('Missing currency')).toBeInTheDocument()
    expect(screen.queryByText('RangeError')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Fix pricing setup for Audit Sprint/i }))
    expect(screen.getByRole('dialog', { name: 'Edit product' })).toBeInTheDocument()
  })

  it('keeps sparse product rows searchable without crashing the catalog lens', async () => {
    products = [{
      id: 'product-sparse',
      orgId: 'org-1',
      description: '',
      unit: '',
      unitPrice: 0,
      createdAt: null,
      updatedAt: null,
    } as unknown as Product]

    render(<ProductsPage />)

    expect(await screen.findByText('Product name missing')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Search product, unit, currency...'), {
      target: { value: 'missing' },
    })

    expect(screen.getByText('Product name missing')).toBeInTheDocument()
    expect(screen.getByText('Currency not set')).toBeInTheDocument()
    expect(screen.getByText('Missing name, description, unit, price, currency')).toBeInTheDocument()
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

  it('uses an in-page confirmation before deleting catalog products', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)
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

    fireEvent.click(screen.getByRole('button', { name: 'Delete Launch package' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: 'Delete catalog product "Launch package"?' })).toBeInTheDocument()
    expect(screen.getByText('This removes the product from the active catalog used by deal line items, quotes, and revenue reporting. Historical records keep their saved line-item data.')).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/crm/products/product-1', expect.any(Object))
    expect(screen.getByRole('button', { name: 'Cancel delete for catalog product Launch package' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete catalog product Launch package' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/products/product-1', { method: 'DELETE' })
    })
    expect(screen.queryByText('Launch package')).not.toBeInTheDocument()

    confirmSpy.mockRestore()
  })
})
