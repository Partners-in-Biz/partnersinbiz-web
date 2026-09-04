const getAgent = jest.fn(async (agentId: string) => ({ agentId, name: agentId === 'pip' ? 'Pip' : 'Maya' }))
const createConversation = jest.fn(async () => ({ id: 'conv-room-1' }))
const createMessage = jest.fn(async () => ({ id: 'msg-1' }))
const appendSystemEvent = jest.fn(async () => ({ id: 'evt-1' }))
const createAgentRoom = jest.fn(async (input: {
  slug: string
  conversationId: string
  accessScope?: string
  ownerUserId?: string | null
  actorUserId: string
}) => ({
  roomId: input.accessScope === 'personal'
    ? `org-1_u_${input.actorUserId}_${input.slug}`
    : `org-1_${input.slug}`,
  conversationId: input.conversationId,
  status: 'active',
  projectionVersion: 1,
  accessScope: input.accessScope ?? 'organization',
  ownerUserId: input.ownerUserId ?? null,
  members: [
    { agentId: 'pip', deviceId: null },
    { agentId: 'maya', deviceId: 'device-a' },
  ],
  orgId: 'org-1',
}))
const archiveAgentRoom = jest.fn(async () => ({
  roomId: 'org-1_growth-desk',
  conversationId: 'conv-room-1',
  status: 'archived',
  projectionVersion: 2,
  members: [
    { agentId: 'pip', deviceId: null },
    { agentId: 'maya', deviceId: 'device-a' },
  ],
  orgId: 'org-1',
  createdByUserId: 'admin-1',
}))
const updateAgentRoom = jest.fn(async () => ({
  roomId: 'org-1_growth-desk',
  conversationId: 'conv-room-1',
  status: 'active',
  projectionVersion: 2,
  members: [
    { agentId: 'pip', deviceId: null },
    { agentId: 'sage', deviceId: null },
  ],
  orgId: 'org-1',
}))
const getAgentRoom = jest.fn(async () => ({
  roomId: 'org-1_growth-desk',
  conversationId: 'conv-room-1',
  status: 'active',
  members: [
    { agentId: 'pip', deviceId: null },
    { agentId: 'maya', deviceId: 'device-a' },
  ],
  orgId: 'org-1',
  accessScope: 'organization',
  ownerUserId: null,
}))
const projectAgentRoomAfterWrite = jest.fn(async () => undefined)
const canManageOrgAs = jest.fn(async () => true)
const canAccessOrg = jest.fn(() => true)
const orgFeatureFlagEnabled = jest.fn(async () => true)

jest.mock('@/lib/agents/team', () => ({
  getAgent: (...args: unknown[]) => getAgent(...args as [string]),
}))
jest.mock('@/lib/conversations/conversations', () => ({
  createConversation: (...args: unknown[]) => createConversation(...args as []),
  createMessage: (...args: unknown[]) => createMessage(...args as []),
}))
jest.mock('@/lib/conversations/system-events', () => ({
  appendSystemEvent: (...args: unknown[]) => appendSystemEvent(...args as []),
}))
jest.mock('@/lib/agent-rooms/store', () => ({
  createAgentRoom: (...args: unknown[]) => createAgentRoom(...args as []),
  archiveAgentRoom: (...args: unknown[]) => archiveAgentRoom(...args as []),
  updateAgentRoom: (...args: unknown[]) => updateAgentRoom(...args as []),
  getAgentRoom: (...args: unknown[]) => getAgentRoom(...args as []),
}))
jest.mock('@/lib/agent-rooms/projection', () => ({
  projectAgentRoomAfterWrite: (...args: unknown[]) => projectAgentRoomAfterWrite(...args as []),
}))
jest.mock('@/lib/orgMembers/permissions', () => ({
  canManageOrgAs: (...args: unknown[]) => canManageOrgAs(...args as []),
}))
jest.mock('@/lib/api/platformAdmin', () => ({
  canAccessOrg: (...args: unknown[]) => canAccessOrg(...args as []),
}))
jest.mock('@/lib/organizations/feature-flags', () => ({
  orgFeatureFlagEnabled: (...args: unknown[]) => orgFeatureFlagEnabled(...args as []),
}))

import {
  archiveAgentRoomWithMirror,
  assertCanCreateAgentRoom,
  assertCanManageAgentRoom,
  createAgentRoomWithMirror,
  updateAgentRoomWithMirror,
} from '@/lib/agent-rooms/service'

describe('agent room service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    canManageOrgAs.mockResolvedValue(true)
    canAccessOrg.mockReturnValue(true)
    orgFeatureFlagEnabled.mockResolvedValue(true)
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
      accessScope: 'organization',
      ownerUserId: null,
    }), expect.anything())
    expect(projectAgentRoomAfterWrite).toHaveBeenCalled()
    expect(room.conversationId).toBe('conv-room-1')
  })

  it('mirrors a personal room with owner as sole human and empty humanTeamIds', async () => {
    await createAgentRoomWithMirror({
      orgId: 'org-1',
      slug: 'desk',
      name: 'My desk',
      members: [
        { agentId: 'pip', deviceId: null },
        { agentId: 'maya', deviceId: null },
      ],
      humanTeamIds: ['org-1_growth'],
      accessScope: 'personal',
      actor: { uid: 'user-1', role: 'client', orgId: 'org-1' },
    })
    expect(createConversation).toHaveBeenCalledWith(expect.objectContaining({
      agentRoom: { roomId: 'org-1_u_user-1_desk' },
      participants: expect.arrayContaining([
        expect.objectContaining({ kind: 'user', uid: 'user-1' }),
      ]),
    }))
    expect(createAgentRoom).toHaveBeenCalledWith(expect.objectContaining({
      accessScope: 'personal',
      ownerUserId: 'user-1',
      humanTeamIds: [],
    }), expect.anything())
  })

  it('archives the room and appends a system event without deleting the conversation', async () => {
    const room = await archiveAgentRoomWithMirror({ orgId: 'org-1', roomId: 'org-1_growth-desk', actorUserId: 'admin-1' })
    expect(room.status).toBe('archived')
    expect(appendSystemEvent).toHaveBeenCalledWith(expect.objectContaining({
      convId: 'conv-room-1',
      content: 'This room was archived',
    }))
    expect(projectAgentRoomAfterWrite).toHaveBeenCalled()
  })

  it('projects and emits member system events on update', async () => {
    await updateAgentRoomWithMirror({
      orgId: 'org-1',
      roomId: 'org-1_growth-desk',
      members: [
        { agentId: 'pip', deviceId: null },
        { agentId: 'sage', deviceId: null },
      ],
      actorUserId: 'admin-1',
    })
    expect(appendSystemEvent).toHaveBeenCalled()
    expect(projectAgentRoomAfterWrite).toHaveBeenCalled()
  })

  it('assertCanManageAgentRoom allows personal owner and org admin only', async () => {
    await expect(assertCanManageAgentRoom(
      { uid: 'user-1', role: 'client', orgId: 'org-1' },
      {
        roomId: 'org-1_u_user-1_desk',
        orgId: 'org-1',
        accessScope: 'personal',
        ownerUserId: 'user-1',
      } as never,
    )).resolves.toBeUndefined()

    await expect(assertCanManageAgentRoom(
      { uid: 'user-2', role: 'client', orgId: 'org-1' },
      {
        roomId: 'org-1_u_user-1_desk',
        orgId: 'org-1',
        accessScope: 'personal',
        ownerUserId: 'user-1',
      } as never,
    )).rejects.toThrow('room owner required')

    canManageOrgAs.mockResolvedValueOnce(false)
    await expect(assertCanManageAgentRoom(
      { uid: 'user-2', role: 'client', orgId: 'org-1' },
      {
        roomId: 'org-1_growth-desk',
        orgId: 'org-1',
        accessScope: 'organization',
        ownerUserId: null,
      } as never,
    )).rejects.toThrow('administrator required')
  })

  it('assertCanCreateAgentRoom requires admin for org rooms and both flags for personal', async () => {
    await expect(assertCanCreateAgentRoom(
      { uid: 'admin-1', role: 'client', orgId: 'org-1' },
      'org-1',
      'organization',
    )).resolves.toBeUndefined()

    orgFeatureFlagEnabled.mockImplementation(async (_orgId: string, key: string) => key === 'agentRoomsEnabled')
    await expect(assertCanCreateAgentRoom(
      { uid: 'user-1', role: 'client', orgId: 'org-1' },
      'org-1',
      'personal',
    )).rejects.toThrow('personal rooms are disabled')

    orgFeatureFlagEnabled.mockResolvedValue(true)
    await expect(assertCanCreateAgentRoom(
      { uid: 'user-1', role: 'client', orgId: 'org-1' },
      'org-1',
      'personal',
    )).resolves.toBeUndefined()
  })
})
