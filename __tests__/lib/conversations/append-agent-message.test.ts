/**
 * @jest-environment node
 */
const mockGetConversation = jest.fn()
const mockCreateMessage = jest.fn()
const mockTouchConversation = jest.fn()
const mockGetAgentRoom = jest.fn()
const mockGetOrgTeam = jest.fn()

jest.mock('@/lib/conversations/conversations', () => ({
  getConversation: (...args: unknown[]) => mockGetConversation(...args),
  createMessage: (...args: unknown[]) => mockCreateMessage(...args),
  touchConversation: (...args: unknown[]) => mockTouchConversation(...args),
}))

jest.mock('@/lib/agent-rooms/store', () => ({
  getAgentRoom: (...args: unknown[]) => mockGetAgentRoom(...args),
}))

jest.mock('@/lib/org-teams/store', () => ({
  getOrgTeam: (...args: unknown[]) => mockGetOrgTeam(...args),
}))

import { appendAgentMessage } from '@/lib/conversations/append-agent-message'

describe('appendAgentMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetConversation.mockResolvedValue({
      id: 'conv-1',
      orgId: 'org-1',
      participantAgentIds: ['maya', 'pip'],
      participants: [{ kind: 'agent', agentId: 'maya', name: 'Maya' }],
      participantUids: ['admin-1'],
      agentRoom: { roomId: 'org-1_growth-desk' },
    })
    mockCreateMessage.mockImplementation(async (_convId: string, input: Record<string, unknown>) => ({
      id: 'msg-room-1',
      ...input,
    }))
    mockTouchConversation.mockResolvedValue(undefined)
    mockGetAgentRoom.mockResolvedValue({
      roomId: 'org-1_growth-desk',
      orgId: 'org-1',
      humanTeamIds: ['org-1_growth'],
      members: [{ agentId: 'maya', deviceId: 'device-a' }],
    })
    mockGetOrgTeam.mockResolvedValue({
      teamId: 'org-1_growth',
      status: 'active',
      memberUserIds: ['peet', 'sam'],
    })
  })

  it('attributes a room-turn to the agent and stores the device badge', async () => {
    const message = await appendAgentMessage({
      convId: 'conv-1',
      agentId: 'maya',
      content: 'Draft is ready.',
      deviceBadge: { deviceId: 'device-a', label: "Peet's Mac" },
    })
    expect(message.authorId).toBe('agent:maya')
    expect(message.dispatchAgentId).toBe('maya')
    expect(message.deviceBadge).toEqual({ deviceId: 'device-a', label: "Peet's Mac" })
    expect(mockCreateMessage).toHaveBeenCalledWith('conv-1', expect.objectContaining({
      authorId: 'agent:maya',
      dispatchAgentId: 'maya',
      deviceBadge: { deviceId: 'device-a', label: "Peet's Mac" },
    }))
    expect(mockTouchConversation).toHaveBeenCalledWith('conv-1', 'Draft is ready.', 'assistant', 'msg-room-1')
  })

  it('sets needsYou and unread for human team members on @user escalation', async () => {
    await appendAgentMessage({
      convId: 'conv-1',
      agentId: 'maya',
      content: 'Need a decision @user before I send.',
    })
    expect(mockGetAgentRoom).toHaveBeenCalledWith('org-1', 'org-1_growth-desk')
    expect(mockGetOrgTeam).toHaveBeenCalledWith('org-1', 'org-1_growth')
    expect(mockTouchConversation).toHaveBeenCalledWith(
      'conv-1',
      'Need a decision @user before I send.',
      'assistant',
      'msg-room-1',
      undefined,
      { extraUnreadUserIds: ['peet', 'sam'], needsYou: true },
    )
  })
})
