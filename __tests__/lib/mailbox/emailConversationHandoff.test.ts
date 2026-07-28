jest.mock('@/lib/conversations/conversations', () => ({
  getConversation: jest.fn(),
  messagesCollection: jest.fn(),
}))

import { getConversation, messagesCollection } from '@/lib/conversations/conversations'
import {
  attachEmailDraftOpenContextToAssistantMessage,
  parseEmailMessagesHandoff,
} from '@/lib/mailbox/emailConversationHandoff'

describe('emailConversationHandoff', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('parses conversation handoff ids from flat body or conversationOrigin', () => {
    expect(parseEmailMessagesHandoff({
      conversationId: 'c1',
      responseMessageId: 'm1',
    })).toEqual({ conversationId: 'c1', responseMessageId: 'm1' })

    expect(parseEmailMessagesHandoff({
      conversationOrigin: { conversationId: 'c2', responseMessageId: 'm2' },
    })).toEqual({ conversationId: 'c2', responseMessageId: 'm2' })
  })

  it('attaches open_context uiActions onto the in-flight assistant message', async () => {
    const update = jest.fn(async () => undefined)
    ;(getConversation as jest.Mock).mockResolvedValue({ id: 'c1', orgId: 'org-1' })
    ;(messagesCollection as jest.Mock).mockReturnValue({
      doc: () => ({
        get: async () => ({
          exists: true,
          data: () => ({ role: 'assistant', uiActions: [] }),
        }),
        update,
      }),
    })

    const result = await attachEmailDraftOpenContextToAssistantMessage({
      orgId: 'org-1',
      conversationId: 'c1',
      responseMessageId: 'asst-1',
      presentation: {
        contextRef: { type: 'email', id: 'draft-1', label: 'Hi', origin: 'manual' },
        uiActions: [{
          id: 'open-email-draft:draft-1',
          type: 'open_context',
          label: 'Review email draft',
          variant: 'primary',
          payload: { kind: 'email', id: 'draft-1', label: 'Hi' },
        }],
      },
    })

    expect(result).toEqual({ attached: true })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      uiActions: [expect.objectContaining({ type: 'open_context', id: 'open-email-draft:draft-1' })],
      contextRefs: [expect.objectContaining({ type: 'email', id: 'draft-1' })],
    }))
  })

  it('skips handoff when conversation/org/message checks fail', async () => {
    ;(getConversation as jest.Mock).mockResolvedValue({ id: 'c1', orgId: 'other-org' })
    const result = await attachEmailDraftOpenContextToAssistantMessage({
      orgId: 'org-1',
      conversationId: 'c1',
      responseMessageId: 'asst-1',
      presentation: {
        contextRef: { type: 'email', id: 'draft-1', label: 'Hi', origin: 'manual' },
        uiActions: [],
      },
    })
    expect(result).toEqual({ attached: false, reason: 'org_mismatch' })
  })
})
