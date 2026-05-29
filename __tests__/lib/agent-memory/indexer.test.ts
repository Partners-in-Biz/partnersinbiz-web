const mockEmbedMany = jest.fn()
const mockSet = jest.fn()
const mockDelete = jest.fn()
const mockGet = jest.fn()
const mockDoc = jest.fn()
const mockWhere = jest.fn()
const mockLimit = jest.fn()
const mockCollection = jest.fn()
const mockFieldVector = jest.fn((embedding: number[]) => ({ __vector: embedding }))
const mockServerTimestamp = jest.fn(() => 'SERVER_TIMESTAMP')

export {}

jest.mock('ai', () => ({
  embedMany: (input: unknown) => mockEmbedMany(input),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    vector: (embedding: number[]) => mockFieldVector(embedding),
    serverTimestamp: () => mockServerTimestamp(),
  },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

beforeEach(() => {
  jest.clearAllMocks()
  const docRef = { set: mockSet }
  mockDoc.mockReturnValue(docRef)
  const query = { where: mockWhere, limit: mockLimit, get: mockGet }
  mockWhere.mockReturnValue(query)
  mockLimit.mockReturnValue(query)
  mockCollection.mockReturnValue({ ...query, doc: mockDoc })
  mockGet.mockResolvedValue({ docs: [] })
  mockEmbedMany.mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]], usage: { tokens: 9 } })
})

describe('agent memory indexer', () => {
  it('embeds chunks and writes deterministic vector documents', async () => {
    const { indexAgentMemorySources } = await import('@/lib/agent-memory/indexer')

    const result = await indexAgentMemorySources([
      {
        orgId: 'org-1',
        sourceType: 'company',
        sourceId: 'company-1',
        title: 'John Plumbing',
        text: 'Pretoria plumbing client.',
        entityRefs: [{ type: 'company', id: 'company-1', label: 'John Plumbing' }],
      },
    ])

    expect(result).toMatchObject({ sources: 1, chunks: 1, embedded: 1, skipped: 0 })
    expect(mockEmbedMany).toHaveBeenCalledWith(expect.objectContaining({
      model: 'openai/text-embedding-3-small',
      values: [expect.stringContaining('John Plumbing')],
    }))
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      sourceType: 'company',
      sourceId: 'company-1',
      embedding: { __vector: [0.1, 0.2, 0.3] },
      embeddingModel: 'openai/text-embedding-3-small',
      embeddingDimension: 1536,
      indexedAt: 'SERVER_TIMESTAMP',
    }), { merge: true })
  })

  it('skips deleted sources instead of embedding stale content', async () => {
    const { indexAgentMemorySources } = await import('@/lib/agent-memory/indexer')

    const result = await indexAgentMemorySources([
      {
        orgId: 'org-1',
        sourceType: 'company',
        sourceId: 'deleted-company',
        title: 'Deleted',
        text: 'Should not be embedded',
        deleted: true,
      },
    ])

    expect(result).toMatchObject({ sources: 1, chunks: 0, embedded: 0, skipped: 1 })
    expect(mockEmbedMany).not.toHaveBeenCalled()
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('deletes stale chunks for a source before writing fresh embeddings', async () => {
    mockGet.mockResolvedValueOnce({
      docs: [{
        id: 'stale-chunk',
        data: () => ({ sourceHash: 'old-hash', chunkIndex: 0 }),
        ref: { delete: mockDelete },
      }],
    })
    const { indexAgentMemorySources } = await import('@/lib/agent-memory/indexer')

    const result = await indexAgentMemorySources([
      {
        orgId: 'org-1',
        sourceType: 'company',
        sourceId: 'company-1',
        title: 'John Plumbing',
        text: 'Updated client profile.',
      },
    ])

    expect(result.embedded).toBe(1)
    expect(mockDelete).toHaveBeenCalledTimes(1)
    expect(mockSet).toHaveBeenCalled()
  })
})
