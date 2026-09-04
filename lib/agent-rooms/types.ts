import type { AgentId } from '@/lib/agents/types'
import { ORG_TEAM_SLUG_RE } from '@/lib/org-teams/types'

export const AGENT_ROOMS_COLLECTION = 'agent_rooms'
export const AGENT_ROOM_SLUG_RE = ORG_TEAM_SLUG_RE
export const AGENT_ROOM_MIN_MEMBERS = 2
export const AGENT_ROOM_MAX_MEMBERS = 6

export type AgentRoomStatus = 'active' | 'archived'

export interface AgentRoomMember {
  agentId: AgentId
  deviceId: string | null
}

export interface AgentRoom {
  roomId: string
  orgId: string
  slug: string
  name: string
  pictureUrl: string | null
  members: AgentRoomMember[]
  humanTeamIds: string[]
  conversationId: string
  allowOrgWideDms: false
  projectionVersion: number
  status: AgentRoomStatus
  createdByUserId: string
  createdAt: unknown
  updatedAt: unknown
  archivedAt?: unknown
}

export function agentRoomId(orgId: string, slug: string): string {
  return `${orgId}_${slug}`
}

export function normalizeAgentRoomSlug(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function memberKey(member: AgentRoomMember): string {
  return `${member.agentId}\0${member.deviceId ?? ''}`
}
