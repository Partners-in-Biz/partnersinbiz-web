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

function documentDoc(id: string, data: Record<string, unknown>) {
  return {
    id,
    data: () => data,
  }
}

describe('document business insight signals', () => {
  it('scores stale client reviews, requested changes, and blocking publish assumptions', async () => {
    mockGet.mockResolvedValue({
      docs: [
        documentDoc('doc-review-1', {
          orgId: 'pib-platform-owner',
          title: 'Lumen launch sign-off',
          status: 'client_review',
          approvalMode: 'operational',
          updatedAt: '2026-06-01T09:00:00.000Z',
        }),
        documentDoc('doc-changes-1', {
          orgId: 'pib-platform-owner',
          title: 'Acme build spec',
          status: 'changes_requested',
          approvalMode: 'operational',
          updatedAt: '2026-06-10T09:00:00.000Z',
        }),
        documentDoc('doc-blocked-1', {
          orgId: 'pib-platform-owner',
          title: 'Revenue proposal',
          status: 'internal_review',
          approvalMode: 'formal_acceptance',
          assumptions: [
            { id: 'a1', severity: 'blocks_publish', status: 'open', text: 'Pricing evidence is missing' },
            { id: 'a2', severity: 'needs_review', status: 'open', text: 'Check timeline' },
          ],
          updatedAt: '2026-06-12T09:00:00.000Z',
        }),
        documentDoc('doc-approved-1', {
          orgId: 'pib-platform-owner',
          title: 'Accepted proposal',
          status: 'accepted',
          approvalMode: 'formal_acceptance',
          assumptions: [{ id: 'a3', severity: 'blocks_publish', status: 'resolved', text: 'Resolved' }],
          updatedAt: '2026-06-12T09:00:00.000Z',
        }),
      ],
    })

    const { collectDocumentBusinessInsightSignals } = await import('@/lib/loop-engine/document-business-signals')
    const result = await collectDocumentBusinessInsightSignals({
      orgId: 'pib-platform-owner',
      existingSuppressionKeys: ['documents:changes-requested:pib-platform-owner'],
      limit: 25,
      now: new Date('2026-06-13T12:00:00.000Z'),
    })

    expect(mockCollection).toHaveBeenCalledWith('client_documents')
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'pib-platform-owner')
    expect(mockLimit).toHaveBeenCalledWith(25)
    expect(result.documentsScanned).toBe(4)
    expect(result.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metric: 'client_documents_waiting_for_review',
        value: 1,
        source: 'document-business-signals',
      }),
      expect.objectContaining({
        metric: 'client_documents_changes_requested',
        value: 1,
      }),
      expect.objectContaining({
        metric: 'client_documents_blocking_publish_assumptions',
        value: 1,
      }),
    ]))
    expect(result.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        lane: 'documents',
        insightKind: 'stale-work',
        metric: 'client_documents_waiting_for_review',
        value: 1,
        suppressionKey: 'documents:waiting-for-review:pib-platform-owner',
        blocksActiveCommercialLoop: true,
        hasNewSourceItem: true,
        sourceLinks: [expect.objectContaining({ id: 'doc-review-1', type: 'client-document' })],
      }),
      expect.objectContaining({
        lane: 'documents',
        insightKind: 'follow-up-gap',
        metric: 'client_documents_changes_requested',
        value: 1,
        suppressionKey: 'documents:changes-requested:pib-platform-owner',
        hasNewSourceItem: false,
      }),
      expect.objectContaining({
        lane: 'documents',
        insightKind: 'risk',
        metric: 'client_documents_blocking_publish_assumptions',
        value: 1,
        suppressionKey: 'documents:blocking-publish-assumptions:pib-platform-owner',
      }),
    ]))
  })

  it('refreshes a document metric snapshot by metric name', async () => {
    mockGet.mockResolvedValue({
      docs: [
        documentDoc('doc-review-1', {
          orgId: 'pib-platform-owner',
          title: 'Lumen launch sign-off',
          status: 'client_review',
          updatedAt: '2026-06-01T09:00:00.000Z',
        }),
      ],
    })

    const { refreshDocumentBusinessInsightMetric } = await import('@/lib/loop-engine/document-business-signals')
    const result = await refreshDocumentBusinessInsightMetric({
      orgId: 'pib-platform-owner',
      metric: 'client_documents_waiting_for_review',
      now: new Date('2026-06-13T12:00:00.000Z'),
    })

    expect(result).toEqual(expect.objectContaining({
      metric: 'client_documents_waiting_for_review',
      value: 1,
      capturedAt: '2026-06-13T12:00:00.000Z',
      source: 'document-business-signals',
    }))
  })
})
