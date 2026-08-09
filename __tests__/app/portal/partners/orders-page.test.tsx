import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PartnerOrdersPage from '@/app/(portal)/portal/partners/orders/page'

const salesOrder = {
  id: 'order-s1',
  tradeOrderId: 'trade-1',
  direction: 'sales',
  partnerOrderStatus: 'confirmed',
  title: 'Order from Beta Manufacturing',
  total: 120,
  currency: 'ZAR',
  fulfillmentStatus: 'packed',
  invoiceId: 'inv-1',
  lineItems: [
    { productId: 'prod-1', name: 'Red Gadget', qty: 10, unitPrice: 12, total: 120 },
  ],
  shippedQuantities: { 'prod-1': 4 },
  createdAt: { seconds: 1 },
}

function okResponse(body: unknown) {
  return { ok: true, json: async () => body }
}

describe('PartnerOrdersPage — partial shipment control', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn()
      .mockResolvedValueOnce(okResponse({ data: { orders: [salesOrder] } })) // initial load
      .mockResolvedValueOnce(okResponse({ data: { tradeOrderId: 'trade-1', fulfillmentStatus: 'packed', shipmentIds: ['ship-1'] } })) // ship PATCH
      .mockResolvedValueOnce(okResponse({ data: { orders: [salesOrder] } })) // reload after act
    window.confirm = jest.fn(() => true)
  })

  it('opens a partial-quantity form when the supplier clicks Mark shipped', async () => {
    render(<PartnerOrdersPage />)
    await screen.findByText(/Red Gadget/)

    fireEvent.click(screen.getByRole('button', { name: 'Mark shipped' }))

    expect(screen.getByText(/Ship a partial quantity per product/)).toBeTruthy()
    // Outstanding = 10 - 4 = 6, prefilled.
    const qtyInput = screen.getByRole('spinbutton') as HTMLInputElement
    expect(qtyInput.value).toBe('6')
  })

  it('sends a quantities map for a partial shipment', async () => {
    render(<PartnerOrdersPage />)
    await screen.findByText(/Red Gadget/)

    fireEvent.click(screen.getByRole('button', { name: 'Mark shipped' }))
    const qtyInput = screen.getByRole('spinbutton')
    fireEvent.change(qtyInput, { target: { value: '2' } })

    fireEvent.click(screen.getByRole('button', { name: 'Confirm shipment' }))

    await waitFor(() => {
      const patchCall = (global.fetch as jest.Mock).mock.calls.find(([, init]) => init?.method === 'PATCH')
      expect(patchCall).toBeTruthy()
      const body = JSON.parse(patchCall[1].body)
      expect(body).toMatchObject({
        action: 'ship',
        quantities: { 'prod-1': 2 },
      })
    })
    // The form closes after submission.
    await waitFor(() => expect(screen.queryByText(/Ship a partial quantity per product/)).toBeNull())
  })

  it('blocks submission when no quantity is positive', async () => {
    render(<PartnerOrdersPage />)
    await screen.findByText(/Red Gadget/)

    fireEvent.click(screen.getByRole('button', { name: 'Mark shipped' }))
    const qtyInput = screen.getByRole('spinbutton')
    fireEvent.change(qtyInput, { target: { value: '0' } })

    fireEvent.click(screen.getByRole('button', { name: 'Confirm shipment' }))

    expect(await screen.findByText(/Enter a quantity greater than zero/)).toBeTruthy()
    const patchCalls = (global.fetch as jest.Mock).mock.calls.filter(([, init]) => init?.method === 'PATCH')
    expect(patchCalls.length).toBe(0)
  })
})
