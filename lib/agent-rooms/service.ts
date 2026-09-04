import type { ApiUser } from '@/lib/api/types'
import { getAgent } from '@/lib/agents/team'
import { createConversation, createMessage } from '@/lib/conversations/conversations'
import type { AgentParticipant, HumanParticipant } from '@/lib/conversations/types'
import { canManageOrgAs } from '@/lib/orgMembers/permissions'
import {
  archiveAgentRoom,
  createAgentRoom,
  type AgentRoomStoreOptions,
} from './store'
import { agentRoomId, normalizeAgentRoomSlug, type AgentRoom, type AgentRoomMember } from './types'

export async function assertCanManageAgentRooms(user: ApiUser, orgId: string): Promise<void> {
  const allowed = await canManageOrgAs(user, orgId, 'admin')
  if (!allowed) throw new Error('agent rooms: administrator required')
}

export async function createAgentRoomWithMirror(input: {
  orgId: string
  slug: string
  name: string
  pictureUrl?: string | null
  members: AgentRoomMember[]
  humanTeamIds?: string[]
  actor: ApiUser
}, options: AgentRoomStoreOptions = {}): Promise<AgentRoom> {
  const slug = normalizeAgentRoomSlug(input.slug)
  const roomId = agentRoomId(input.orgId, slug)
  const agentParticipants: AgentParticipant[] = []
  for (const member of input.members) {
    const agent = await getAgent(member.agentId)
    agentParticipants.push({
      kind: 'agent',
      agentId: member.agentId,
      name: agent?.name || member.agentId,
    })
  }
  const human: HumanParticipant = {
    kind: 'user',
    uid: input.actor.uid,
    role: input.actor.role === 'admin' ? 'admin' : 'client',
  }
  const conversation = await createConversation({
    orgId: input.orgId,
    startedBy: input.actor.uid,
    title: input.name.trim(),
    participants: [...agentParticipants, human],
    orchestration: {
      mode: 'pip-orchestrator',
      dispatcherAgentId: input.members[0]!.agentId,
      requestedAgentIds: [...new Set(input.members.map((member) => member.agentId))],
    },
    agentRoom: { roomId },
  })
  return createAgentRoom({
    orgId: input.orgId,
    slug,
    name: input.name,
    pictureUrl: input.pictureUrl,
    members: input.members,
    humanTeamIds: input.humanTeamIds,
    conversationId: conversation.id,
    actorUserId: input.actor.uid,
  }, options)
}

export async function archiveAgentRoomWithMirror(input: {
  orgId: string
  roomId: string
}, options: AgentRoomStoreOptions = {}): Promise<AgentRoom> {
  const room = await archiveAgentRoom(input, options)
  if (room.conversationId) {
    await createMessage(room.conversationId, {
      conversationId: room.conversationId,
      role: 'system',
      content: 'This room was archived',
      authorKind: 'system',
      authorId: 'system',
      authorDisplayName: 'System',
    })
  }
  return room
}
