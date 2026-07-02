const mockGet = jest.fn()
const mockLimit = jest.fn(() => ({ get: mockGet }))
const mockOrderBy = jest.fn(() => ({ limit: mockLimit }))
const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    increment: jest.fn((value: number) => ({ increment: value })),
    serverTimestamp: jest.fn(() => ({ serverTimestamp: true })),
  },
}))

function timestamp(ms: number) {
  return { toMillis: () => ms }
}

function doc(id: string, createdAtMs: number, content: string) {
  return {
    id,
    data: () => ({
      conversationId: 'conv-1',
      role: 'assistant',
      authorKind: 'agent',
      authorId: 'agent:pip',
      content,
      status: 'completed',
      createdAt: timestamp(createdAtMs),
    }),
    ref: { update: jest.fn() },
  }
}

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  mockCollection.mockReturnValue({
    doc: () => ({
      collection: () => ({
        orderBy: mockOrderBy,
      }),
    }),
  })
})

describe('listMessages', () => {
  it('reads the latest bounded window and returns it oldest-to-newest for chat rendering', async () => {
    mockGet.mockResolvedValue({
      docs: [
        doc('newest', 3000, 'Newest CEO relay'),
        doc('middle', 2000, 'Middle CEO relay'),
        doc('oldest-in-window', 1000, 'Oldest relay still in latest window'),
      ],
    })

    const { listMessages } = await import('@/lib/conversations/conversations')
    const messages = await listMessages('conv-1', 3)

    expect(mockCollection).toHaveBeenCalledWith('conversations')
    expect(mockOrderBy).toHaveBeenCalledWith('createdAt', 'desc')
    expect(mockLimit).toHaveBeenCalledWith(3)
    expect(messages.map((message) => message.id)).toEqual([
      'oldest-in-window',
      'middle',
      'newest',
    ])
  })
})
