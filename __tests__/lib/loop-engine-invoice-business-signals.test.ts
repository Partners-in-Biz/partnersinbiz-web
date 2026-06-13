const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockLimit = jest.fn()
const mockGet = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
  },
}))

beforeEach(() => {
  jest.clearAllMocks()
  const query = { where: mockWhere, limit: mockLimit, get: mockGet }
  mockCollection.mockReturnValue(query)
  mockWhere.mockReturnValue(query)
  mockLimit.mockReturnValue(query)
})

function invoiceDoc(id: string, data: Record<string, unknown>) {
  return {
    id,
    data: () => data,
  }
}

describe('invoice business insight signals', () => {
  it('scores overdue, payment-proof, draft, and partially-paid invoice risks', async () => {
    mockGet.mockResolvedValue({
      docs: [
        invoiceDoc('overdue-1', {
          orgId: 'pib-platform-owner',
          invoiceNumber: 'INV-001',
          status: 'overdue',
          total: 10_000,
          currency: 'ZAR',
          recipientCompanyName: 'Acme',
          dueDate: '2026-06-01T00:00:00.000Z',
        }),
        invoiceDoc('proof-1', {
          orgId: 'pib-platform-owner',
          invoiceNumber: 'INV-002',
          status: 'payment_pending_verification',
          total: 8_000,
          currency: 'ZAR',
          paymentProofUploadedAt: '2026-06-12T10:00:00.000Z',
        }),
        invoiceDoc('draft-1', {
          orgId: 'pib-platform-owner',
          invoiceNumber: 'INV-003',
          status: 'draft',
          total: 4_000,
          currency: 'ZAR',
          createdAt: '2026-06-10T10:00:00.000Z',
        }),
        invoiceDoc('partial-1', {
          orgId: 'pib-platform-owner',
          invoiceNumber: 'INV-004',
          status: 'partially_paid',
          total: 12_000,
          paidAmount: 5_000,
          currency: 'ZAR',
        }),
        invoiceDoc('paid-1', {
          orgId: 'pib-platform-owner',
          invoiceNumber: 'INV-005',
          status: 'paid',
          total: 99_000,
          currency: 'ZAR',
        }),
      ],
    })

    const { collectInvoiceBusinessInsightSignals } = await import('@/lib/loop-engine/invoice-business-signals')
    const result = await collectInvoiceBusinessInsightSignals({
      orgId: 'pib-platform-owner',
      existingSuppressionKeys: ['invoice:drafts-waiting:pib-platform-owner'],
      limit: 25,
      now: new Date('2026-06-13T12:00:00.000Z'),
    })

    expect(mockCollection).toHaveBeenCalledWith('invoices')
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'pib-platform-owner')
    expect(mockLimit).toHaveBeenCalledWith(25)
    expect(result.invoicesScanned).toBe(5)
    expect(result.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metric: 'invoices_overdue_value',
        value: 10_000,
        source: 'invoice-business-signals',
      }),
      expect.objectContaining({
        metric: 'invoice_payment_proofs_needing_review',
        value: 1,
      }),
      expect.objectContaining({
        metric: 'draft_invoices_waiting_to_send_value',
        value: 4_000,
      }),
      expect.objectContaining({
        metric: 'partially_paid_invoice_outstanding_value',
        value: 7_000,
      }),
    ]))
    expect(result.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        lane: 'invoice',
        insightKind: 'risk',
        metric: 'invoices_overdue_value',
        value: 10_000,
        ownerRole: 'finance',
        approvalGate: 'finance',
        suppressionKey: 'invoice:overdue-value:pib-platform-owner',
        blocksActiveCommercialLoop: true,
        hasNewSourceItem: true,
        sourceLinks: [expect.objectContaining({ id: 'overdue-1', type: 'invoice' })],
      }),
      expect.objectContaining({
        lane: 'invoice',
        insightKind: 'stale-work',
        metric: 'draft_invoices_waiting_to_send_value',
        value: 4_000,
        suppressionKey: 'invoice:drafts-waiting:pib-platform-owner',
        hasNewSourceItem: false,
      }),
    ]))
  })

  it('refreshes an invoice metric snapshot by metric name', async () => {
    mockGet.mockResolvedValue({
      docs: [
        invoiceDoc('overdue-1', {
          orgId: 'pib-platform-owner',
          invoiceNumber: 'INV-001',
          status: 'overdue',
          total: 6_500,
          currency: 'ZAR',
        }),
      ],
    })

    const { refreshInvoiceBusinessInsightMetric } = await import('@/lib/loop-engine/invoice-business-signals')
    const result = await refreshInvoiceBusinessInsightMetric({
      orgId: 'pib-platform-owner',
      metric: 'invoices_overdue_value',
      now: new Date('2026-06-13T12:00:00.000Z'),
    })

    expect(result).toEqual(expect.objectContaining({
      metric: 'invoices_overdue_value',
      value: 6_500,
      capturedAt: '2026-06-13T12:00:00.000Z',
      source: 'invoice-business-signals',
    }))
  })
})
