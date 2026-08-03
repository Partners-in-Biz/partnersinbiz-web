import {
  addCalendarDays,
  agingBucketForDaysPastDue,
  assertNoteApplicationAmount,
  buildAgingReport,
  buildStatementBalances,
  daysBetweenIsoDates,
  filterDocumentsByPortalFilters,
  nextRecurringRunDate,
  projectCreditNoteStatus,
  renderStatementCsv,
} from '@/lib/accounting/ar-ap-depth'

describe('AR/AP depth domain helpers', () => {
  test('ages open items into current/30/60/90 buckets', () => {
    const report = buildAgingReport({
      asOfDate: '2026-08-02',
      currency: 'ZAR',
      role: 'customer',
      openItems: [
        { id: 'oi1', sourceType: 'customer_invoice', sourceId: 'inv1', counterpartyCompanyId: 'c1', counterpartyRole: 'customer', currency: 'ZAR', outstandingMinor: 10000, dueDate: '2026-08-02', status: 'open' },
        { id: 'oi2', sourceType: 'customer_invoice', sourceId: 'inv2', counterpartyCompanyId: 'c1', counterpartyRole: 'customer', currency: 'ZAR', outstandingMinor: 20000, dueDate: '2026-07-20', status: 'open' },
        { id: 'oi3', sourceType: 'customer_invoice', sourceId: 'inv3', counterpartyCompanyId: 'c1', counterpartyRole: 'customer', currency: 'ZAR', outstandingMinor: 30000, dueDate: '2026-06-15', status: 'partially_paid' },
        { id: 'oi4', sourceType: 'customer_invoice', sourceId: 'inv4', counterpartyCompanyId: 'c1', counterpartyRole: 'customer', currency: 'ZAR', outstandingMinor: 40000, dueDate: '2026-04-01', status: 'open' },
        { id: 'oi5', sourceType: 'customer_invoice', sourceId: 'inv5', counterpartyCompanyId: 'c1', counterpartyRole: 'customer', currency: 'ZAR', outstandingMinor: 999, dueDate: '2026-01-01', status: 'closed' },
        { id: 'oi6', sourceType: 'supplier_bill', sourceId: 'b1', counterpartyCompanyId: 's1', counterpartyRole: 'supplier', currency: 'ZAR', outstandingMinor: 50000, dueDate: '2026-07-01', status: 'open' },
      ],
    })
    expect(report.buckets.find((b) => b.key === 'current')?.amountMinor).toBe(10000)
    expect(report.buckets.find((b) => b.key === 'd1_30')?.amountMinor).toBe(20000)
    expect(report.buckets.find((b) => b.key === 'd31_60')?.amountMinor).toBe(30000)
    expect(report.buckets.find((b) => b.key === 'd90_plus')?.amountMinor).toBe(40000)
    expect(report.totalOutstandingMinor).toBe(100000)
    expect(agingBucketForDaysPastDue(daysBetweenIsoDates('2026-05-20', '2026-08-02'))).toBe('d61_90')
  })

  test('projects credit note status and validates applications', () => {
    expect(projectCreditNoteStatus(11500, 11500, 'issued')).toBe('issued')
    expect(projectCreditNoteStatus(11500, 5000, 'issued')).toBe('partially_applied')
    expect(projectCreditNoteStatus(11500, 0, 'issued')).toBe('applied')
    expect(projectCreditNoteStatus(11500, 0, 'voided')).toBe('voided')
    expect(() => assertNoteApplicationAmount(1000, 5000, 1001)).toThrow('note remaining')
    expect(() => assertNoteApplicationAmount(5000, 1000, 1001)).toThrow('target outstanding')
    expect(() => assertNoteApplicationAmount(5000, 1000, 1000)).not.toThrow()
  })

  test('advances recurring run dates and due dates', () => {
    expect(nextRecurringRunDate('2026-07-15', 'weekly')).toBe('2026-07-22')
    expect(nextRecurringRunDate('2026-07-15', 'monthly')).toBe('2026-08-15')
    expect(nextRecurringRunDate('2026-07-15', 'quarterly')).toBe('2026-10-15')
    expect(nextRecurringRunDate('2026-07-15', 'yearly')).toBe('2027-07-15')
    expect(addCalendarDays('2026-07-15', 30)).toBe('2026-08-14')
  })

  test('builds statement balances and CSV export without mass email flags', () => {
    const { closingBalanceMinor, running } = buildStatementBalances({
      openingBalanceMinor: 0,
      lines: [
        { debitMinor: 11500, creditMinor: 0 },
        { debitMinor: 0, creditMinor: 5000 },
        { debitMinor: 0, creditMinor: 1500 },
      ],
    })
    expect(running).toEqual([11500, 6500, 5000])
    expect(closingBalanceMinor).toBe(5000)
    const csv = renderStatementCsv({
      role: 'customer',
      counterpartyName: 'Acme',
      fromDate: '2026-07-01',
      toDate: '2026-07-31',
      currency: 'ZAR',
      openingBalanceMinor: 0,
      closingBalanceMinor: 5000,
      lines: [{
        date: '2026-07-10', documentType: 'customer_invoice', documentNumber: 'INV-000001', description: 'Retainer',
        debitMinor: 11500, creditMinor: 0, balanceMinor: 11500,
      }],
    })
    expect(csv).toContain('massEmailAllowed=false')
    expect(csv).toContain('autoSend=false')
    expect(csv).toContain('INV-000001')
  })

  test('filters portal document rows by status, counterparty and outstanding band', () => {
    const rows = [
      { status: 'issued', issueDate: '2026-07-10', documentNumber: 'INV-000001', outstandingMinor: 11500, customerCompanyId: 'c1' },
      { status: 'paid', issueDate: '2026-07-11', documentNumber: 'INV-000002', outstandingMinor: 0, customerCompanyId: 'c1' },
      { status: 'issued', issueDate: '2026-07-12', documentNumber: 'INV-000003', outstandingMinor: 2000, customerCompanyId: 'c2' },
    ]
    const filtered = filterDocumentsByPortalFilters(rows, {
      status: 'issued', counterpartyCompanyId: 'c1', documentNumberContains: '000', minOutstandingMinor: 1,
    })
    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.documentNumber).toBe('INV-000001')
  })
})
