jest.mock('@/lib/conversations/conversations', () => ({
  getConversation: jest.fn(),
  messagesCollection: jest.fn(),
}))

import { getConversation, messagesCollection } from '@/lib/conversations/conversations'
import {
  attachOpenContextToAssistantMessage,
  buildOpenContextPresentation,
  handoffOpenContextFromCreate,
  MESSAGES_CANVAS_KINDS,
  parseMessagesHandoffIds,
} from '@/lib/messages/openContextHandoff'
import { buildDynamicChatCanvasPromptBlock, MESSAGES_CANVAS_REGISTRY } from '@/lib/messages/dynamicChatCanvasPrompt'

describe('openContextHandoff', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('parses handoff ids from flat body or conversationOrigin', () => {
    expect(parseMessagesHandoffIds({ conversationId: 'c1', responseMessageId: 'm1' }))
      .toEqual({ conversationId: 'c1', responseMessageId: 'm1' })
    expect(parseMessagesHandoffIds({
      conversationOrigin: { conversationId: 'c2', responseMessageId: 'm2' },
    })).toEqual({ conversationId: 'c2', responseMessageId: 'm2' })
  })

  it('builds open_context presentation for every canvas kind', () => {
    for (const kind of MESSAGES_CANVAS_KINDS) {
      const presentation = buildOpenContextPresentation({ kind, id: `${kind}-1`, label: 'Label' })
      expect(presentation.contextRef).toMatchObject({ type: kind, id: `${kind}-1`, label: 'Label' })
      expect(presentation.uiActions[0]).toMatchObject({
        type: 'open_context',
        payload: { kind, id: `${kind}-1` },
      })
    }
  })

  it('attaches open_context to the assistant message', async () => {
    const update = jest.fn(async () => undefined)
    ;(getConversation as jest.Mock).mockResolvedValue({ id: 'c1', orgId: 'org-1' })
    ;(messagesCollection as jest.Mock).mockReturnValue({
      doc: () => ({
        get: async () => ({ exists: true, data: () => ({ role: 'assistant', uiActions: [] }) }),
        update,
      }),
    })

    const presentation = buildOpenContextPresentation({ kind: 'invoice', id: 'inv-1', label: 'INV-1' })
    const result = await attachOpenContextToAssistantMessage({
      orgId: 'org-1',
      conversationId: 'c1',
      responseMessageId: 'asst-1',
      presentation,
    })
    expect(result).toEqual({ attached: true })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      uiActions: [expect.objectContaining({ type: 'open_context', id: 'open-invoice:inv-1' })],
      contextRefs: [expect.objectContaining({ type: 'invoice', id: 'inv-1' })],
    }))
  })

  it('handoffOpenContextFromCreate returns presentation and attaches when ids present', async () => {
    const update = jest.fn(async () => undefined)
    ;(getConversation as jest.Mock).mockResolvedValue({ id: 'c1', orgId: 'org-1' })
    ;(messagesCollection as jest.Mock).mockReturnValue({
      doc: () => ({
        get: async () => ({ exists: true, data: () => ({ role: 'assistant' }) }),
        update,
      }),
    })

    const result = await handoffOpenContextFromCreate({
      orgId: 'org-1',
      body: { conversationId: 'c1', responseMessageId: 'asst-1' },
      kind: 'quote',
      id: 'q-1',
      label: 'Q-1',
    })
    expect(result.contextRef.type).toBe('quote')
    expect(result.messagesAttach).toEqual({ attached: true })
    expect(update).toHaveBeenCalled()
  })

  it('handoffOpenContextFromCreate supports document canvas kind', async () => {
    const update = jest.fn(async () => undefined)
    ;(getConversation as jest.Mock).mockResolvedValue({ id: 'c1', orgId: 'org-1' })
    ;(messagesCollection as jest.Mock).mockReturnValue({
      doc: () => ({
        get: async () => ({ exists: true, data: () => ({ role: 'assistant' }) }),
        update,
      }),
    })

    const result = await handoffOpenContextFromCreate({
      orgId: 'org-1',
      body: { conversationId: 'c1', responseMessageId: 'asst-1' },
      kind: 'document',
      id: 'P1TCk1BSCHYouZkNGwG',
      label: 'Hunt and Gun — Auction Website Corrective Maintenance Plan',
    })
    expect(result.contextRef).toMatchObject({
      type: 'document',
      id: 'P1TCk1BSCHYouZkNGwG',
    })
    expect(result.uiActions[0]).toMatchObject({
      type: 'open_context',
      payload: { kind: 'document', id: 'P1TCk1BSCHYouZkNGwG' },
    })
    expect(result.messagesAttach).toEqual({ attached: true })
    expect(MESSAGES_CANVAS_KINDS).toContain('document')
  })
})

describe('dynamicChatCanvasPrompt', () => {
  it('injects conversation handoff ids and every registered canvas kind', () => {
    const block = buildDynamicChatCanvasPromptBlock({
      conversationId: 'conv-9',
      responseMessageId: 'asst-9',
    })
    expect(block).toContain('conversationId: conv-9')
    expect(block).toContain('responseMessageId: asst-9')
    expect(block).toContain('Messages dynamic chat')
    for (const kind of MESSAGES_CANVAS_KINDS) {
      expect(block).toContain(kind)
      expect(block).toContain(MESSAGES_CANVAS_REGISTRY[kind].create)
    }
    expect(Object.keys(MESSAGES_CANVAS_REGISTRY).sort()).toEqual([...MESSAGES_CANVAS_KINDS].sort())
  })
})
