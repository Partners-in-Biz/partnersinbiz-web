import { fireEvent, render, screen } from '@testing-library/react'
import ProductsPage from '@/app/(portal)/portal/settings/products/page'

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
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/products') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { products: [] } }),
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
})
