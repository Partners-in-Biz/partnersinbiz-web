import {
  appendConversationRealtimeOutboxEvent,
  realtimeOutboxEnabled,
  toRealtimeGatewayDelivery,
} from '@/lib/realtime/outbox'

describe('conversation realtime outbox', () => {
  const originalTransport = process.env.CONVERSATION_REALTIME_TRANSPORT

  afterEach(() => {
    if (originalTransport === undefined) delete process.env.CONVERSATION_REALTIME_TRANSPORT
    else process.env.CONVERSATION_REALTIME_TRANSPORT = originalTransport
  })

  it('is opt-in and treats shadow as a delivery-producing mode', () => {
    delete process.env.CONVERSATION_REALTIME_TRANSPORT
    expect(realtimeOutboxEnabled()).toBe(false)
    process.env.CONVERSATION_REALTIME_TRANSPORT = 'shadow'
    expect(realtimeOutboxEnabled()).toBe(true)
    process.env.CONVERSATION_REALTIME_TRANSPORT = 'enabled'
    expect(realtimeOutboxEnabled()).toBe(true)
  })

  it('writes a safe, monotonic event without a message payload', () => {
    process.env.CONVERSATION_REALTIME_TRANSPORT = 'shadow'
    const outboxRef = { id: 'evt:v1:conv-1:8' }
    const transaction = {
      create: jest.fn(),
    } as unknown as FirebaseFirestore.Transaction
    const conversationRef = {
      firestore: {
        collection: jest.fn(() => ({ doc: jest.fn(() => outboxRef) })),
      },
    } as unknown as FirebaseFirestore.DocumentReference
    const writeConversation = jest.fn()

    const sequence = appendConversationRealtimeOutboxEvent({
      transaction,
      conversationRef,
      conversation: {
        orgId: 'org-1',
        participantUids: ['user-b', 'user-a', 'user-a'],
        accessVersion: 4,
        realtimeSequence: 7,
      },
      conversationId: 'conv-1',
      kind: 'message.created',
      subject: { messageId: 'msg-1' },
      writeConversation,
    })

    expect(sequence).toBe(8)
    expect(writeConversation).toHaveBeenCalledWith(8)
    const event = (transaction.create as unknown as jest.Mock).mock.calls[0][1]
    expect(event).toMatchObject({
      eventId: 'evt:v1:conv-1:8',
      conversationId: 'conv-1',
      recipientUserIds: ['user-a', 'user-b'],
      subject: { messageId: 'msg-1' },
    })
    expect(event).not.toHaveProperty('content')
    expect(toRealtimeGatewayDelivery(event)).toEqual({
      schemaVersion: 1,
      eventId: 'evt:v1:conv-1:8',
      recipientUserIds: ['user-a', 'user-b'],
    })
  })
})
