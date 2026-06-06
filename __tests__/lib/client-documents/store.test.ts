const mockDocumentSet = jest.fn()
const mockVersionSet = jest.fn()
const mockDocumentUpdate = jest.fn()
const mockVersionUpdate = jest.fn()
const mockDocumentGet = jest.fn()
const mockDocumentDoc = jest.fn()
const mockVersionDoc = jest.fn()
const mockCollection = jest.fn()
const mockBatchSet = jest.fn()
const mockBatchCommit = jest.fn()
const mockBatch = jest.fn()
const mockTransactionGet = jest.fn()
const mockTransactionUpdate = jest.fn()
const mockRunTransaction = jest.fn()

export {}

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
    batch: mockBatch,
    runTransaction: mockRunTransaction,
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  },
}))

jest.mock('crypto', () => ({
  randomBytes: jest.fn(() => ({ toString: jest.fn(() => 'share-token-1234567890') })),
}))

beforeEach(() => {
  jest.clearAllMocks()

  const versionDoc = { id: 'version-1', set: mockVersionSet, update: mockVersionUpdate }
  const versionsCollection = { doc: mockVersionDoc }
  const documentDoc = {
    id: 'doc-1',
    collection: jest.fn(() => versionsCollection),
    set: mockDocumentSet,
    get: mockDocumentGet,
    update: mockDocumentUpdate,
  }

  mockVersionDoc.mockReturnValue(versionDoc)
  mockDocumentDoc.mockReturnValue(documentDoc)
  mockCollection.mockReturnValue({ doc: mockDocumentDoc })
  mockBatch.mockReturnValue({ set: mockBatchSet, commit: mockBatchCommit })
  mockRunTransaction.mockImplementation(async (callback) =>
    callback({ get: mockTransactionGet, update: mockTransactionUpdate }),
  )
})

describe('client document store', () => {
  it('creates a document and first draft version from template defaults', async () => {
    const { createClientDocument } = await import('@/lib/client-documents/store')

    const result = await createClientDocument({
      title: ' Proposal for Client X ',
      type: 'sales_proposal',
      orgId: 'org-1',
      linked: { dealId: 'deal-1' },
      assumptions: [
        { text: ' Budget needs confirmation ', severity: 'blocks_publish' },
        { text: '   ', severity: 'needs_review' },
      ],
      user: { uid: 'ai-agent', role: 'ai' },
    })
    const { randomBytes } = jest.requireMock('crypto') as { randomBytes: jest.Mock }

    expect(result).toEqual({
      id: 'doc-1',
      versionId: 'version-1',
      shareToken: 'share-token-1234567890',
    })
    expect(randomBytes).toHaveBeenCalledWith(12)
    expect(mockCollection).toHaveBeenCalledWith('client_documents')
    expect(mockBatchSet).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 'doc-1' }),
      expect.objectContaining({
        title: 'Proposal for Client X',
        type: 'sales_proposal',
        orgId: 'org-1',
        templateId: 'sales-proposal-v1',
        status: 'internal_draft',
        linked: { dealId: 'deal-1' },
        currentVersionId: 'version-1',
        approvalMode: 'formal_acceptance',
        shareToken: 'share-token-1234567890',
        shareEnabled: false,
        createdBy: 'ai-agent',
        createdByType: 'agent',
        updatedBy: 'ai-agent',
        updatedByType: 'agent',
        deleted: false,
      }),
    )
    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'doc-1' }),
      expect.objectContaining({
        assumptions: [
          expect.objectContaining({
            id: 'assumption-1',
            text: 'Budget needs confirmation',
            severity: 'blocks_publish',
            status: 'open',
            createdBy: 'ai-agent',
            createdAt: expect.any(String),
          }),
        ],
      }),
    )
    expect(mockBatchSet).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'version-1' }),
      expect.objectContaining({
        documentId: 'doc-1',
        versionNumber: 1,
        status: 'draft',
        blocks: expect.arrayContaining([
          expect.objectContaining({ id: 'hero', required: true }),
          expect.objectContaining({ id: 'approval', required: true }),
        ]),
        theme: expect.objectContaining({
          palette: expect.objectContaining({ accent: '#F5A623' }),
          typography: expect.objectContaining({ body: 'Geist' }),
        }),
        createdBy: 'ai-agent',
        createdByType: 'agent',
        changeSummary: 'Initial draft',
      }),
    )
    expect(mockBatchCommit).toHaveBeenCalledTimes(1)
    expect(mockDocumentSet).not.toHaveBeenCalled()
    expect(mockVersionSet).not.toHaveBeenCalled()
  })

  it('blocks publish when orgId is missing', async () => {
    mockTransactionGet.mockResolvedValue({
      exists: true,
      id: 'doc-1',
      data: () => ({
        status: 'internal_draft',
        currentVersionId: 'version-1',
        shareEnabled: false,
        assumptions: [],
      }),
    })

    const { publishClientDocument } = await import('@/lib/client-documents/store')

    await expect(publishClientDocument('doc-1', { uid: 'u1', role: 'admin' })).rejects.toThrow(
      'orgId is required before publishing',
    )
    expect(mockDocumentUpdate).not.toHaveBeenCalled()
    expect(mockVersionUpdate).not.toHaveBeenCalled()
    expect(mockTransactionUpdate).not.toHaveBeenCalled()
  })

  it('publishes document and current version inside a transaction', async () => {
    mockTransactionGet.mockResolvedValue({
      exists: true,
      id: 'doc-1',
      data: () => ({
        orgId: 'org-1',
        status: 'internal_draft',
        currentVersionId: 'version-1',
        shareEnabled: false,
        linked: { clientOrgId: 'org-1' },
        assumptions: [{ id: 'assumption-1', severity: 'needs_review', status: 'open' }],
      }),
    })

    const { publishClientDocument } = await import('@/lib/client-documents/store')

    await expect(publishClientDocument('doc-1', { uid: 'u1', role: 'admin' }, 'org-1')).resolves.toEqual({
      id: 'doc-1',
      versionId: 'version-1',
      clientOrgIds: ['org-1'],
      multiOrgPublish: false,
    })
    expect(mockRunTransaction).toHaveBeenCalledTimes(1)
    expect(mockTransactionGet).toHaveBeenCalledWith(expect.objectContaining({ id: 'doc-1' }))
    expect(mockVersionDoc).toHaveBeenCalledWith('version-1')
    expect(mockTransactionUpdate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 'doc-1' }),
      expect.objectContaining({
        status: 'client_review',
        latestPublishedVersionId: 'version-1',
        shareEnabled: true,
        updatedBy: 'u1',
        updatedByType: 'user',
      }),
    )
    expect(mockTransactionUpdate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'version-1' }),
      { status: 'published' },
    )
  })

  it('fails safe when publishing without explicit linked client org ids', async () => {
    mockTransactionGet.mockResolvedValue({
      exists: true,
      id: 'doc-1',
      data: () => ({
        orgId: 'org-1',
        status: 'internal_draft',
        currentVersionId: 'version-1',
        shareEnabled: false,
        linked: { companyIds: ['company-1'], contactIds: ['contact-1'] },
        assumptions: [],
      }),
    })

    const { publishClientDocument } = await import('@/lib/client-documents/store')

    await expect(publishClientDocument('doc-1', { uid: 'u1', role: 'admin' }, 'org-1')).rejects.toThrow(
      'Explicit linked client org is required before publishing',
    )
    expect(mockTransactionUpdate).not.toHaveBeenCalled()
  })

  it('requires multi-org publish acknowledgement before exposing a document to multiple client orgs', async () => {
    mockTransactionGet.mockResolvedValue({
      exists: true,
      id: 'doc-1',
      data: () => ({
        orgId: 'pib-platform-owner',
        status: 'internal_draft',
        currentVersionId: 'version-1',
        shareEnabled: false,
        linked: { clientOrgIds: ['client-org-1', 'client-org-2'] },
        assumptions: [],
      }),
    })

    const { publishClientDocument } = await import('@/lib/client-documents/store')

    await expect(publishClientDocument('doc-1', { uid: 'u1', role: 'admin' }, 'pib-platform-owner')).rejects.toThrow(
      'Publishing to multiple client orgs requires explicit acknowledgement',
    )
    expect(mockTransactionUpdate).not.toHaveBeenCalled()
  })

  it('publishes multi-org documents only after explicit acknowledgement', async () => {
    mockTransactionGet.mockResolvedValue({
      exists: true,
      id: 'doc-1',
      data: () => ({
        orgId: 'pib-platform-owner',
        status: 'internal_draft',
        currentVersionId: 'version-1',
        shareEnabled: false,
        linked: { clientOrgIds: ['client-org-1', 'client-org-2'] },
        assumptions: [],
      }),
    })

    const { publishClientDocument } = await import('@/lib/client-documents/store')

    await expect(publishClientDocument('doc-1', { uid: 'u1', role: 'admin' }, 'pib-platform-owner', { acknowledgeMultiOrgPublish: true })).resolves.toEqual({
      id: 'doc-1',
      versionId: 'version-1',
      clientOrgIds: ['client-org-1', 'client-org-2'],
      multiOrgPublish: true,
    })
    expect(mockTransactionUpdate).toHaveBeenCalledTimes(2)
  })

  it('blocks publish when the document org changes inside the transaction', async () => {
    mockTransactionGet.mockResolvedValue({
      exists: true,
      id: 'doc-1',
      data: () => ({
        orgId: 'org-2',
        status: 'internal_draft',
        currentVersionId: 'version-1',
        shareEnabled: false,
        assumptions: [],
      }),
    })

    const { publishClientDocument } = await import('@/lib/client-documents/store')

    await expect(publishClientDocument('doc-1', { uid: 'u1', role: 'admin' }, 'org-1')).rejects.toThrow(
      'Document organisation changed before publishing',
    )
    expect(mockTransactionUpdate).not.toHaveBeenCalled()
  })
})
