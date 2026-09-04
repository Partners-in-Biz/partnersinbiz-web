import type { ApiUser } from '@/lib/api/types'
import { getAgent } from '@/lib/agents/team'
import { createConversation, createMessage } from '@/lib/conversations/conversations'
import { appendSystemEvent } from '@/lib/conversations/system-events'
import type { AgentParticipant, HumanParticipant } from '@/lib/conversations/types'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { canManageOrgAs } from '@/lib/orgMembers/permissions'
import { orgFeatureFlagEnabled } from '@/lib/organizations/feature-flags'
import { projectAgentRoomAfterWrite } from './projection'
import {
  archiveAgentRoom,
  createAgentRoom,
  getAgentRoom,
  updateAgentRoom,
  type AgentRoomStoreOptions,
} from './store'
import {
  agentRoomId,
  memberKey,
  normalizeAccessScope,
  normalizeAgentRoomSlug,
  personalAgentRoomId,
  type AgentRoom,
  type AgentRoomAccessScope,
  type AgentRoomMember,
} from './types'

/** Org-admin gate used by drift adopt/revert (not per-room). */
export async function assertCanManageAgentRooms(user: ApiUser, orgId: string): Promise<void> {
  const allowed = await canManageOrgAs(user, orgId, 'admin')
  if (!allowed) throw new Error('agent rooms: administrator required')
}

export async function assertCanManageAgentRoom(user: ApiUser, room: AgentRoom): Promise<void> {
  if (room.accessScope === 'personal') {
    if (room.ownerUserId === user.uid) return
    throw new Error('agent rooms: room owner required')
  }
  const allowed = await canManageOrgAs(user, room.orgId, 'admin')
  if (!allowed) throw new Error('agent rooms: administrator required')
}

export async function assertCanCreateAgentRoom(
  user: ApiUser,
  orgId: string,
  accessScope: AgentRoomAccessScope,
): Promise<void> {
  if (accessScope === 'personal') {
    if (!canAccessOrg(user, orgId)) throw new Error('agent rooms: organisation membership required')
    const roomsOn = await orgFeatureFlagEnabled(orgId, 'agentRoomsEnabled')
    const personalOn = await orgFeatureFlagEnabled(orgId, 'personalAgentRoomsEnabled')
    if (!roomsOn || !personalOn) throw new Error('agent rooms: personal rooms are disabled')
    return
  }
  await assertCanManageAgentRooms(user, orgId)
}

function membersChanged(previous: AgentRoomMember[], next: AgentRoomMember[]): {
  added: AgentRoomMember[]
  removed: AgentRoomMember[]
} {
  const prevKeys = new Set(previous.map(memberKey))
  const nextKeys = new Set(next.map(memberKey))
  return {
    added: next.filter((member) => !prevKeys.has(memberKey(member))),
    removed: previous.filter((member) => !nextKeys.has(memberKey(member))),
  }
}

async function emitMemberSystemEvents(input: {
  conversationId: string
  previous: AgentRoomMember[]
  next: AgentRoomMember[]
  actorLabel: string
}): Promise<void> {
  if (!input.conversationId) return
  const { added, removed } = membersChanged(input.previous, input.next)
  for (const member of added) {
    try {
      await appendSystemEvent({
        convId: input.conversationId,
        agentId: member.agentId,
        event: {
          eventKind: 'room_member_added',
          actorKind: 'system',
          actorLabel: input.actorLabel,
          summary: `Added @${member.agentId}${member.deviceId ? ` on ${member.deviceId}` : ''}`,
        },
      })
    } catch {
      // best-effort
    }
  }
  for (const member of removed) {
    try {
      await appendSystemEvent({
        convId: input.conversationId,
        agentId: member.agentId,
        event: {
          eventKind: 'room_member_removed',
          actorKind: 'system',
          actorLabel: input.actorLabel,
          summary: `Removed @${member.agentId}${member.deviceId ? ` on ${member.deviceId}` : ''}`,
        },
      })
    } catch {
      // best-effort
    }
  }
}

async function projectBestEffort(room: AgentRoom, actorUserId: string, previousMembers?: AgentRoomMember[]): Promise<void> {
  try {
    await projectAgentRoomAfterWrite({ room, actorUserId, previousMembers })
  } catch {
    // best-effort
  }
}

export async function createAgentRoomWithMirror(input: {
  orgId: string
  slug: string
  name: string
  pictureUrl?: string | null
  members: AgentRoomMember[]
  humanTeamIds?: string[]
  accessScope?: AgentRoomAccessScope
  actor: ApiUser
}, options: AgentRoomStoreOptions = {}): Promise<AgentRoom> {
  const slug = normalizeAgentRoomSlug(input.slug)
  const accessScope = normalizeAccessScope(input.accessScope)
  const ownerUserId = accessScope === 'personal' ? input.actor.uid : null
  const roomId = accessScope === 'personal'
    ? personalAgentRoomId(input.orgId, input.actor.uid, slug)
    : agentRoomId(input.orgId, slug)
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
  // Personal rooms: owner is the sole human participant; no human teams.
  const humanTeamIds = accessScope === 'personal' ? [] : input.humanTeamIds
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
  const room = await createAgentRoom({
    orgId: input.orgId,
    slug,
    name: input.name,
    pictureUrl: input.pictureUrl,
    members: input.members,
    humanTeamIds,
    conversationId: conversation.id,
    actorUserId: input.actor.uid,
    accessScope,
    ownerUserId,
  }, options)
  await projectBestEffort(room, input.actor.uid)
  return room
}

export async function updateAgentRoomWithMirror(input: {
  orgId: string
  roomId: string
  name?: string
  pictureUrl?: string | null
  members?: AgentRoomMember[]
  humanTeamIds?: string[]
  actorUserId: string
  actorLabel?: string
}, options: AgentRoomStoreOptions = {}): Promise<AgentRoom> {
  const previous = await getAgentRoom(input.orgId, input.roomId, options)
  if (!previous) throw new Error('agent rooms: room not found')
  const room = await updateAgentRoom({
    orgId: input.orgId,
    roomId: input.roomId,
    name: input.name,
    pictureUrl: input.pictureUrl,
    members: input.members,
    humanTeamIds: input.humanTeamIds,
  }, options)
  if (input.members !== undefined) {
    await emitMemberSystemEvents({
      conversationId: room.conversationId,
      previous: previous.members,
      next: room.members,
      actorLabel: input.actorLabel || 'System',
    })
  }
  await projectBestEffort(room, input.actorUserId, previous.members)
  return room
}

export async function archiveAgentRoomWithMirror(input: {
  orgId: string
  roomId: string
  actorUserId?: string
}, options: AgentRoomStoreOptions = {}): Promise<AgentRoom> {
  const room = await archiveAgentRoom(input, options)
  if (room.conversationId) {
    try {
      await appendSystemEvent({
        convId: room.conversationId,
        event: {
          eventKind: 'room_archived',
          actorKind: 'system',
          actorLabel: 'System',
          summary: 'This room was archived',
        },
        content: 'This room was archived',
      })
    } catch {
      await createMessage(room.conversationId, {
        conversationId: room.conversationId,
        role: 'system',
        content: 'This room was archived',
        authorKind: 'system',
        authorId: 'system',
        authorDisplayName: 'System',
      })
    }
  }
  await projectBestEffort(room, input.actorUserId || room.createdByUserId || 'system')
  return room
}
