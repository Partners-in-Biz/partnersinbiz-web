import {
  buildHermesConversationSuggestion,
  classifyInboundMessage,
  shouldAutoReplyAfterHours,
} from '@/lib/communications/automation'
import type { Conversation, ConversationMessage } from '@/lib/communications/types'

describe('communications automation', () => {
  it('classifies STOP as an opt-out request', () => {
    const result = classifyInboundMessage('STOP please', 'whatsapp')

    expect(result.intent).toBe('opt_out')
    expect(result.recommendedActions).toEqual(['suppress_contact', 'mark_conversation_resolved'])
  })

  it('classifies points balance requests', () => {
    const result = classifyInboundMessage('What is my balance?', 'sms')

    expect(result.intent).toBe('balance_request')
    expect(result.recommendedActions).toEqual(['send_profile_balance', 'keep_conversation_open'])
  })

  it('prioritises urgent support signals', () => {
    const result = classifyInboundMessage('Urgent, my OTP is not working', 'whatsapp')

    expect(result.intent).toBe('urgent_support')
    expect(result.priority).toBe('urgent')
  })

  it('keeps Hermes as an internal copilot in V1', () => {
    const conversation: Conversation = {
      id: 'conv-1',
      orgId: 'org-1',
      channel: 'whatsapp',
      status: 'open',
      priority: 'normal',
      contactId: 'contact-1',
      contactSnapshot: { name: 'Sarah', phone: '+27825551234' },
      queueId: 'support',
      assigneeAgentId: null,
      assigneeUserId: null,
      labels: [],
      campaignId: null,
      lastMessageAt: null,
      snoozedUntil: null,
      createdAt: null,
      updatedAt: null,
    }
    const messages: ConversationMessage[] = [
      {
        id: 'msg-1',
        orgId: 'org-1',
        conversationId: 'conv-1',
        channel: 'whatsapp',
        direction: 'inbound',
        body: 'Please send my balance',
        status: 'received',
        createdAt: null,
      },
    ]

    const suggestion = buildHermesConversationSuggestion({
      conversation,
      messages,
      profile: { pointsBalance: 1240 },
    })

    expect(suggestion.mode).toBe('internal_copilot')
    expect(suggestion.directSendAllowed).toBe(false)
    expect(suggestion.recommendedOwnerAgentId).toBe('nora')
    expect(suggestion.draftReply.toLowerCase()).toContain('balance')
  })

  it('detects after-hours windows in the organisation timezone', () => {
    expect(
      shouldAutoReplyAfterHours({
        now: new Date('2026-05-28T18:30:00.000Z'),
        timezone: 'Africa/Johannesburg',
        businessHours: {
          daysOfWeek: [1, 2, 3, 4, 5],
          startHourLocal: 8,
          endHourLocal: 17,
        },
      }),
    ).toBe(true)
  })
})
