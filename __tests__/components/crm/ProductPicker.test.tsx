import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ProductPicker } from '@/components/crm/ProductPicker'

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

describe('ProductPicker', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      json: async () => ({ success: true, data: [] }),
    } as Response))
  })

  it('turns an empty product catalog into a settings action', async () => {
    render(
      <ProductPicker
        orgId="org-1"
        orgScope={{
          orgId: 'org-1',
          orgSlug: 'lumen-speeds',
          sourceCompanyId: 'company-1',
          sourceCompanyName: 'Lumen',
        }}
        onSelect={jest.fn()}
      />,
    )

    const input = await screen.findByRole('textbox')
    await waitFor(() => expect(input).toHaveAttribute('placeholder', 'Search products…'))
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/products?limit=200&orgId=org-1')

    fireEvent.focus(input)

    expect(await screen.findByText('No products set up yet')).toBeInTheDocument()

    const catalogLink = screen.getByRole('link', { name: 'Open product catalog to create quote-ready products' })
    expect(catalogLink).toHaveAttribute(
      'href',
      '/portal/settings/products?orgId=org-1&orgSlug=lumen-speeds&sourceCompanyId=company-1&sourceCompanyName=Lumen',
    )
  })

  it('names sparse catalog products before quote selection', async () => {
    const onSelect = jest.fn()
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          products: [
            {
              id: 'product-sparse',
              orgId: 'org-1',
              name: '',
              description: '',
              currency: 'ZAR',
              unitPrice: 1500,
              unit: '',
              active: true,
              createdAt: null,
              updatedAt: null,
            },
          ],
        },
      }),
    } as Response))

    render(<ProductPicker orgId="org-1" onSelect={onSelect} />)

    const input = await screen.findByRole('textbox')
    await waitFor(() => expect(input).not.toBeDisabled())

    fireEvent.focus(input)

    expect(await screen.findByRole('option', { name: /Product name missing/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Select product Product name missing' }))

    expect(input).toHaveValue('Product name missing')
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      id: 'product-sparse',
      name: 'Product name missing',
    }))
  })
})
