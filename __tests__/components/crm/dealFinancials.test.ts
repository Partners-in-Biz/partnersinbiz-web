import { lineItemDisplayTotal, lineItemsDisplayTotal } from '@/components/crm/dealFinancials'

describe('dealFinancials', () => {
  it('uses the persisted discounted line total when present', () => {
    expect(lineItemDisplayTotal({ name: 'Strategy', qty: 2, unitPrice: 1000, discount: 25, total: 1500 })).toBe(1500)
  })

  it('falls back to quantity times unit price when total is missing', () => {
    expect(lineItemDisplayTotal({ name: 'Support', qty: 3, unitPrice: 500 })).toBe(1500)
  })

  it('sums display totals across mixed line items', () => {
    expect(lineItemsDisplayTotal([
      { name: 'Discounted', qty: 2, unitPrice: 1000, discount: 25, total: 1500 },
      { name: 'Fallback', qty: 3, unitPrice: 500 },
    ])).toBe(3000)
  })
})
