const getAgent = jest.fn(async (agentId: string) => ({ agentId, name: agentId === 'pip' ? 'Pip' : 'Maya' }))
const createConversation = jest.fn(async () => ({ id: 'conv-room-1' }))
const createMessage = jest.fn(async () => ({ id: 'msg-1' }))
const createAgentRoom = jest.fn(async (input: { slug: string; conversationId: string }) => ({
  roomId: `org-1_${input.slug}`,
  conversationId: input.conversationId,
  status: 'active',
  projectionVersion: 1,
}))
const archiveAgentRoom = jest.fn(async () => ({
  roomId: 'org-1_growth-desk',
  conversationId: 'conv-room-1',
  status: 'archived',
  projectionVersion: 2,
}))

jest.mock('@/lib/agents/team', () => ({
  getAgent: (...args: unknown[]) => getAgent(...args as [string]),
}))
jest.mock('@/lib/conversations/conversations', () => ({
  createConversation: (...args: unknown[]) => createConversation(...args as []),
  createMessage: (...args: unknown[]) => createMessage(...args as []),
}))
jest.mock('@/lib/agent-rooms/store', () => ({
  createAgentRoom: (...args: unknown[]) => createAgentRoom(...args as []),
  archiveAgentRoom: (...args: unknown[]) => archiveAgentRoom(...args as []),
}))
jest.mock('@/lib/orgMembers/permissions', () => ({
  canManageOrgAs: jest.fn(async () => true),
}))

import { archiveAgentRoomWithMirror, createAgentRoomWithMirror } from '@/lib/agent-rooms/service'

describe('agent room service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('creates the Messages mirror then writes the room with that conversationId', async () => {
    const room = await createAgentRoomWithMirror({
      orgId: 'org-1',
      slug: 'growth-desk',
      name: 'Growth desk',
      members: [
        { agentId: 'pip', deviceId: null },
        { agentId: 'maya', deviceId: 'device-a' },
      ],
      actor: { uid: 'admin-1', role: 'client', orgId: 'org-1' },
    })
    expect(createConversation).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      title: 'Growth desk',
      agentRoom: { roomId: 'org-1_growth-desk' },
      orchestration: {
        mode: 'pip-orchestrator',
        dispatcherAgentId: 'pip',
        requestedAgentIds: ['pip', 'maya'],
      },
    }))
    expect(createAgentRoom).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-room-1',
      actorUserId: 'admin-1',
    }), expect.anything())
    expect(room.conversationId).toBe('conv-room-1')
  })

  it('archives the room and appends a system message without deleting the conversation', async () => {
    const room = await archiveAgentRoomWithMirror({ orgId: 'org-1', roomId: 'org-1_growth-desk' })
    expect(room.status).toBe('archived')
    expect(createMessage).toHaveBeenCalledWith('conv-room-1', expect.objectContaining({
      role: 'system',
      content: 'This room was archived',
    }))
  })
})
