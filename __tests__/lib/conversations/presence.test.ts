const mockCollection = jest.fn()
const mockDoc = jest.fn()
const mockDocGet = jest.fn()
const mockDocSet = jest.fn()
const mockWhere = jest.fn()
const mockGet = jest.fn()
const mockOrderBy = jest.fn()

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

import { formatConversationPresenceLine } from '@/lib/conversations/presence-shared'
import {
  heartbeatConversationPresence,
  listConversationPresence,
} from '@/lib/conversations/presence'

beforeEach(() => {
  jest.clearAllMocks()
  const query = { get: mockGet, where: mockWhere, orderBy: mockOrderBy }
  mockWhere.mockReturnValue(query)
  mockDoc.mockReturnValue({ get: mockDocGet, set: mockDocSet })
  mockCollection.mockReturnValue({ where: mockWhere, doc: mockDoc })
})

describe('conversation presence helpers', () => {
  it('formats typing and viewing lines for other collaborators only', () => {
    expect(formatConversationPresenceLine([
      { actorUid: 'me', actorType: 'user', state: 'typing', displayName: 'Peet' },
      { actorUid: 'u2', actorType: 'user', state: 'typing', displayName: 'Alex' },
    ], 'me')).toBe('Alex is typing…')

    expect(formatConversationPresenceLine([
      { actorUid: 'u2', actorType: 'user', state: 'viewing', displayName: 'Alex' },
      { actorUid: 'u3', actorType: 'user', state: 'active', displayName: 'Sam' },
    ], 'me')).toBe('2 others are here')

    expect(formatConversationPresenceLine([
      { actorUid: 'me', actorType: 'user', state: 'viewing', displayName: 'Peet' },
    ], 'me')).toBeNull()
  })

  it('lists active collaborators and filters stale conversation presence', async () => {
    mockGet.mockResolvedValue({
      docs: [
        {
          id: 'conv-1_user-1',
          data: () => ({
            orgId: 'org-1',
            conversationId: 'conv-1',
            actorUid: 'user-1',
            actorType: 'user',
            state: 'typing',
            lastSeenAtMs: 1000,
            expiresAtMs: 5000,
          }),
        },
        {
          id: 'conv-1_user-stale',
          data: () => ({
            orgId: 'org-1',
            conversationId: 'conv-1',
            actorUid: 'stale-user',
            actorType: 'user',
            state: 'active',
            lastSeenAtMs: 1000,
            expiresAtMs: 3000,
          }),
        },
      ],
    })

    // Active expires at 5000; stale at 3000. now=4000 keeps only the active collaborator.
    const presence = await listConversationPresence('conv-1', 'org-1', 4000)

    expect(mockCollection).toHaveBeenCalledWith('conversation_presence')
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'org-1')
    expect(mockWhere).toHaveBeenCalledWith('conversationId', '==', 'conv-1')
    expect(presence).toEqual([
      expect.objectContaining({
        id: 'conv-1_user-1',
        actorUid: 'user-1',
        actorType: 'user',
        state: 'typing',
      }),
    ])
  })

  it('heartbeats conversation presence state and stores activity', async () => {
    mockGet.mockResolvedValue({ docs: [] })
    const presence = await heartbeatConversationPresence('conv-1', 'org-1', {
      displayName: 'Peet',
      state: 'typing',
      lastMessageId: 'msg-1',
    }, { uid: 'user-1', type: 'user' }, 10_000)

    expect(mockDoc).toHaveBeenCalledWith('conv-1_user-1')
    expect(mockDocSet).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      conversationId: 'conv-1',
      actorUid: 'user-1',
      actorType: 'user',
      displayName: 'Peet',
      state: 'typing',
      lastMessageId: 'msg-1',
      lastSeenAt: 'SERVER_TIMESTAMP',
      lastSeenAtMs: 10_000,
      expiresAtMs: 22_000,
    }), { merge: true })
    expect(presence).toMatchObject({
      id: 'conv-1_user-1',
      actorUid: 'user-1',
      state: 'typing',
    })
    expect(mockGet).not.toHaveBeenCalled()
  })
})
