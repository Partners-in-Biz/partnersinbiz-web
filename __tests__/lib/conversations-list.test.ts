const mockIndexedGet = jest.fn()
const mockFallbackGet = jest.fn()
const mockIndexedLimit = jest.fn(() => ({ get: mockIndexedGet }))
const mockOrderBy = jest.fn(() => ({ limit: mockIndexedLimit }))
const mockWhere = jest.fn()
const mockCollection = jest.fn(() => ({ where: mockWhere }))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
  getAdminApp: jest.fn(),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    increment: jest.fn((value: number) => ({ increment: value })),
    serverTimestamp: jest.fn(() => ({ serverTimestamp: true })),
  },
}))

jest.mock('firebase-admin/storage', () => ({
  getStorage: jest.fn(),
}))

function timestamp(ms: number) {
  return { toMillis: () => ms }
}

function conversationDoc(id: string, updatedAtMs: number) {
  return {
    id,
    data: () => ({
      orgId: 'pib-platform-owner',
      startedBy: 'admin-1',
      participantUids: ['admin-1'],
      participantAgentIds: ['pip'],
      participants: [],
      title: id,
      archived: false,
      messageCount: 0,
      updatedAt: timestamp(updatedAtMs),
    }),
  }
}

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  mockWhere.mockReturnValue({
    orderBy: mockOrderBy,
    get: mockFallbackGet,
  })
})

describe('listConversations', () => {
  it('falls back to an org query and sorts in memory while the composite index is unavailable', async () => {
    mockIndexedGet.mockRejectedValue(Object.assign(new Error('The query requires an index.'), {
      code: 9,
      details: 'The query requires an index.',
    }))
    mockFallbackGet.mockResolvedValue({
      docs: [
        conversationDoc('older', 1000),
        conversationDoc('newest', 3000),
        conversationDoc('middle', 2000),
      ],
    })

    const { listConversations } = await import('@/lib/conversations/conversations')
    const conversations = await listConversations(
      'pib-platform-owner',
      { uid: 'admin-1', role: 'admin' },
      2,
    )

    expect(mockOrderBy).toHaveBeenCalledWith('updatedAt', 'desc')
    expect(mockFallbackGet).toHaveBeenCalledTimes(1)
    expect(conversations.map((conversation) => conversation.id)).toEqual(['newest', 'middle'])
  })

  it('does not hide unexpected Firestore failures behind the fallback', async () => {
    mockIndexedGet.mockRejectedValue(Object.assign(new Error('permission denied'), { code: 7 }))

    const { listConversations } = await import('@/lib/conversations/conversations')

    await expect(listConversations(
      'pib-platform-owner',
      { uid: 'admin-1', role: 'admin' },
      30,
    )).rejects.toThrow('permission denied')
    expect(mockFallbackGet).not.toHaveBeenCalled()
  })
})
