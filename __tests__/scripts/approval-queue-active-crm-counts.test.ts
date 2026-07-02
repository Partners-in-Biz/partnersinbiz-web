import { crmCountsFromRows } from '@/scripts/approval-queue-active-crm-counts'

describe('approval queue CRM counts', () => {
  it('counts only active CRM rows so approval decisions do not use broad stale totals', () => {
    const rows = {
      contacts: [
        { id: 'contact-active' },
        { id: 'contact-deleted', deleted: true },
      ],
      companies: [
        { id: 'company-active' },
        { id: 'company-merged-loser', deleted: true },
      ],
      deals: [
        { id: 'deal-active' },
        { id: 'deal-deleted', deleted: true },
      ],
    }

    expect(crmCountsFromRows(rows)).toEqual({
      contacts: 1,
      companies: 1,
      deals: 1,
    })
  })
})
