import {
  CONVERSATION_LIVE_MESSAGE_LIMIT,
  CONVERSATION_LIVE_REFRESH_MS,
  CONVERSATION_LIVE_STREAM_TTL_MS,
  conversationLiveSnapshotSignature,
  encodeConversationLiveEvent,
  parseConversationLiveQuery,
  type ConversationLiveSnapshot,
} from '@/lib/conversations/live-feed'

describe('conversation live feed', () => {
  it('bounds recurring message reads while preserving a responsive cadence', () => {
    expect(CONVERSATION_LIVE_MESSAGE_LIMIT).toBe(20)
    expect(CONVERSATION_LIVE_REFRESH_MS).toBeGreaterThanOrEqual(CONVERSATION_LIVE_STREAM_TTL_MS)
  })

  it('parses and bounds permission-scoped live query parameters', () => {
    expect(parseConversationLiveQuery(
      'https://partnersinbiz.online/api/v1/conversations/live?orgId=org-1&scope=project&scopeRefId=project-1&projectId=project-1&conversationId=conv-1&includeAllScopes=true&limit=500',
    )).toEqual({
      orgId: 'org-1',
      scope: 'project',
      scopeRefId: 'project-1',
      projectId: 'project-1',
      conversationId: 'conv-1',
      includeAllScopes: true,
      limit: 100,
    })
  })

  it('ignores unsupported scopes and malformed limits', () => {
    expect(parseConversationLiveQuery(
      'https://partnersinbiz.online/api/v1/conversations/live?scope=secret&limit=nope',
    )).toEqual({
      orgId: null,
      limit: 30,
    })
  })

  it('does not treat heartbeat emission time as a data change', () => {
    const base: ConversationLiveSnapshot = {
      type: 'snapshot',
      conversations: [],
      conversation: null,
      messages: null,
      presence: null,
      emittedAtMs: 1,
    }
    expect(conversationLiveSnapshotSignature(base)).toBe(
      conversationLiveSnapshotSignature({ ...base, emittedAtMs: 2 }),
    )
  })

  it('encodes browser EventSource-compatible data frames', () => {
    const bytes = encodeConversationLiveEvent({
      type: 'error',
      error: 'stream stopped',
    })
    expect(new TextDecoder().decode(bytes)).toBe(
      'data: {"type":"error","error":"stream stopped"}\n\n',
    )
  })
})
