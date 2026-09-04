import type { AgentId } from '@/lib/agents/types'
import { ORG_TEAM_SLUG_RE } from '@/lib/org-teams/types'

export const AGENT_ROOMS_COLLECTION = 'agent_rooms'
export const AGENT_ROOM_SLUG_RE = ORG_TEAM_SLUG_RE
export const AGENT_ROOM_MIN_MEMBERS = 2
export const AGENT_ROOM_MAX_MEMBERS = 6

export type AgentRoomStatus = 'active' | 'archived'
export type AgentRoomAccessScope = 'personal' | 'organization'

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
  /** personal = owner-only room; organization = org-admin room. Legacy docs default to organization. */
  accessScope: AgentRoomAccessScope
  /** Set when accessScope is personal; null for organisation rooms. */
  ownerUserId: string | null
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

/** Personal room ids keep a stable `_u_{uid}_` segment so they never collide with org slugs. */
export function personalAgentRoomId(orgId: string, uid: string, slug: string): string {
  return `${orgId}_u_${uid}_${slug}`
}

export function normalizeAgentRoomSlug(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function memberKey(member: AgentRoomMember): string {
  return `${member.agentId}\0${member.deviceId ?? ''}`
}

export function normalizeAccessScope(value: unknown): AgentRoomAccessScope {
  return value === 'personal' ? 'personal' : 'organization'
}
