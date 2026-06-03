import { fireEvent, render, screen } from '@testing-library/react'
import { DealLineItemsEditor } from '@/components/crm/DealLineItemsEditor'

describe('DealLineItemsEditor', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      json: async () => ({ success: true, data: [] }),
    } as Response))
  })

  it('turns an empty commercial table into a quote readiness action', async () => {
    render(
      <DealLineItemsEditor
        value={[]}
        onChange={jest.fn()}
        currency="ZAR"
        orgId="org-1"
      />,
    )

    expect(screen.getByRole('heading', { name: 'Build the first quote line' })).toBeInTheDocument()
    expect(screen.getByText('Quote value missing')).toBeInTheDocument()
    expect(screen.getByText('Add a product, service, or ad-hoc item so sales, delivery, and leadership can see what this opportunity is worth.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add first quote item' }))

    expect(await screen.findByPlaceholderText('Product name…')).toBeInTheDocument()
  })

  it('names quote item draft confirm and cancel actions by commercial context', async () => {
    render(
      <DealLineItemsEditor
        value={[]}
        onChange={jest.fn()}
        currency="ZAR"
        orgId="org-1"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add first quote item' }))

    expect(await screen.findByRole('button', { name: 'Add quote item' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel quote item draft' })).toBeInTheDocument()
  })

  it('names quote item removal by the active line item', () => {
    render(
      <DealLineItemsEditor
        value={[
          {
            name: 'Discovery Sprint',
            qty: 1,
            unitPrice: 12000,
            total: 12000,
            currency: 'ZAR',
          },
        ]}
        onChange={jest.fn()}
        currency="ZAR"
        orgId="org-1"
      />,
    )

    expect(screen.getByRole('button', { name: 'Remove quote item Discovery Sprint' })).toBeInTheDocument()
  })
})
