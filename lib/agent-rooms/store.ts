import { canPullAgentToDevice, canStartLinkedAgent } from '@/lib/agents/org-agent-policy'
import { isValidAgentId } from '@/lib/agents/types'
import { adminDb } from '@/lib/firebase/admin'
import { memberCanUseAgentOnRuntime, resolveMemberAccessPolicy } from '@/lib/orgMembers/access-policy'
import { ORG_TEAMS_COLLECTION } from '@/lib/org-teams/types'
import {
  AGENT_ROOMS_COLLECTION,
  AGENT_ROOM_MAX_MEMBERS,
  AGENT_ROOM_MIN_MEMBERS,
  AGENT_ROOM_SLUG_RE,
  agentRoomId,
  memberKey,
  normalizeAccessScope,
  normalizeAgentRoomSlug,
  personalAgentRoomId,
  type AgentRoom,
  type AgentRoomAccessScope,
  type AgentRoomMember,
} from './types'

interface RefLike { id: string; path?: string }
interface SnapshotLike { exists: boolean; data(): Record<string, unknown> | undefined }
interface TransactionLike {
  get(ref: RefLike): Promise<SnapshotLike>
  create(ref: RefLike, value: Record<string, unknown>): void
  set(ref: RefLike, value: Record<string, unknown>, options?: { merge?: boolean }): void
  update(ref: RefLike, value: Record<string, unknown>): void
}
interface QueryDocLike { id: string; data(): Record<string, unknown> }
interface QuerySnapshotLike { docs: QueryDocLike[] }
interface QueryLike {
  where(field: string, op: string, value: unknown): QueryLike
  get(): Promise<QuerySnapshotLike>
}
interface DocumentLike extends RefLike {
  get(): Promise<SnapshotLike>
}
interface CollectionLike extends QueryLike {
  doc(id: string): DocumentLike
}
interface DbLike {
  collection(name: string): CollectionLike
  runTransaction<T>(fn: (tx: TransactionLike) => Promise<T>): Promise<T>
}

export interface AgentRoomStoreOptions {
  db?: DbLike
  now?: () => unknown
  /**
   * When set, returns organisation rooms plus the viewer's personal rooms only.
   * Implementation lists all rooms for the org and filters in memory (no composite
   * Firestore index for accessScope + ownerUserId yet).
   */
  viewerUserId?: string
}

const AGENTS = 'agent_team'
const DEVICES = 'linked_devices'
const GRANTS = 'linked_device_grants'
const MEMBERS = 'orgMembers'

function timestamp(options: AgentRoomStoreOptions): unknown {
  return options.now ? options.now() : new Date().toISOString()
}

function asRoom(id: string, data: Record<string, unknown> | undefined): AgentRoom | null {
  if (!data) return null
  const members = normalizeMembers(data.members)
  const accessScope = normalizeAccessScope(data.accessScope)
  const ownerUserId = typeof data.ownerUserId === 'string' && data.ownerUserId.trim()
    ? data.ownerUserId.trim()
    : null
  return {
    roomId: id,
    orgId: String(data.orgId ?? ''),
    slug: String(data.slug ?? ''),
    name: String(data.name ?? ''),
    pictureUrl: typeof data.pictureUrl === 'string' ? data.pictureUrl : null,
    members,
    humanTeamIds: Array.isArray(data.humanTeamIds)
      ? data.humanTeamIds.filter((value): value is string => typeof value === 'string')
      : [],
    conversationId: String(data.conversationId ?? ''),
    allowOrgWideDms: false,
    accessScope,
    ownerUserId: accessScope === 'personal' ? ownerUserId : null,
    projectionVersion: Number(data.projectionVersion ?? 0),
    status: data.status === 'archived' ? 'archived' : 'active',
    createdByUserId: String(data.createdByUserId ?? ''),
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    ...(data.archivedAt !== undefined ? { archivedAt: data.archivedAt } : {}),
  }
}

export function normalizeMembers(value: unknown): AgentRoomMember[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const members: AgentRoomMember[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const agentId = typeof row.agentId === 'string' ? row.agentId.trim() : ''
    if (!isValidAgentId(agentId)) continue
    const deviceId = typeof row.deviceId === 'string' && row.deviceId.trim()
      ? row.deviceId.trim()
      : null
    const member = { agentId, deviceId }
    const key = memberKey(member)
    if (seen.has(key)) continue
    seen.add(key)
    members.push(member)
  }
  return members
}

function normalizePictureUrl(value: unknown): string | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string') throw new Error('agent rooms: pictureUrl must be a string')
  const url = value.trim()
  if (!url) return null
  if (url.length > 500) throw new Error('agent rooms: pictureUrl is too long')
  if (!/^https?:\/\//i.test(url) && !url.startsWith('/')) {
    throw new Error('agent rooms: pictureUrl must be http(s) or a site path')
  }
  return url
}

function normalizeName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : ''
  if (name.length < 1 || name.length > 80) throw new Error('agent rooms: name must be 1..80 characters')
  return name
}

function cleanTeamIds(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map((value) => value.trim()))]
}

function roomVisibleToViewer(room: AgentRoom, viewerUserId: string | undefined): boolean {
  if (!viewerUserId) return true
  if (room.accessScope !== 'personal') return true
  return room.ownerUserId === viewerUserId
}

async function assertMembers(
  tx: TransactionLike,
  db: DbLike,
  orgId: string,
  members: AgentRoomMember[],
  roomContext: { accessScope: AgentRoomAccessScope; ownerUserId: string | null },
): Promise<void> {
  if (members.length < AGENT_ROOM_MIN_MEMBERS || members.length > AGENT_ROOM_MAX_MEMBERS) {
    throw new Error(`agent rooms: members must be ${AGENT_ROOM_MIN_MEMBERS}..${AGENT_ROOM_MAX_MEMBERS}`)
  }

  let ownerMembership: Record<string, unknown> | undefined
  let orgManager = false
  if (roomContext.accessScope === 'personal' && roomContext.ownerUserId) {
    const memberSnap = await tx.get(db.collection(MEMBERS).doc(`${orgId}_${roomContext.ownerUserId}`))
    ownerMembership = memberSnap.data()
    const role = typeof ownerMembership?.role === 'string' ? ownerMembership.role : ''
    orgManager = role === 'owner' || role === 'admin'
  }

  for (const member of members) {
    const agentSnap = await tx.get(db.collection(AGENTS).doc(member.agentId))
    const agent = agentSnap.data()
    if (!agentSnap.exists || !agent) throw new Error(`agent rooms: unknown agent: ${member.agentId}`)
    if (agent.enabled === false) throw new Error(`agent rooms: agent is disabled: ${member.agentId}`)
    const scopeOrgId = typeof agent.scopeOrgId === 'string' ? agent.scopeOrgId : ''
    if (scopeOrgId && scopeOrgId !== orgId) {
      throw new Error(`agent rooms: agent is not visible to this organisation: ${member.agentId}`)
    }

    const agentAccessScope = agent.accessScope === 'personal' ? 'personal' : 'organization'
    const agentOwnerUserId = typeof agent.ownerUserId === 'string' ? agent.ownerUserId : undefined

    if (roomContext.accessScope === 'organization') {
      // Close the org-room personal-agent gap: personal agents never seat in org rooms.
      if (agentAccessScope === 'personal') {
        throw new Error(`agent rooms: personal agents cannot join organisation rooms: ${member.agentId}`)
      }
    } else {
      const ownerUserId = roomContext.ownerUserId
      if (!ownerUserId) throw new Error('agent rooms: personal room requires ownerUserId')
      if (agentAccessScope === 'personal' && agentOwnerUserId !== ownerUserId) {
        throw new Error(`agent rooms: cannot seat another member's personal agent: ${member.agentId}`)
      }

      let deviceOwnerUserId: string | undefined
      if (member.deviceId) {
        const deviceSnap = await tx.get(db.collection(DEVICES).doc(member.deviceId))
        const device = deviceSnap.data()
        if (!deviceSnap.exists || !device) throw new Error(`agent rooms: device not found: ${member.deviceId}`)
        deviceOwnerUserId = typeof device.ownerUserId === 'string' ? device.ownerUserId : undefined
        if (deviceOwnerUserId !== ownerUserId) {
          throw new Error(`agent rooms: personal room devices must be owner-owned: ${member.deviceId}`)
        }
      }

      const accessPolicy = resolveMemberAccessPolicy({
        role: (typeof ownerMembership?.role === 'string' ? ownerMembership.role : 'member') as 'owner' | 'admin' | 'member' | 'viewer',
        accessScope: ownerMembership?.accessScope,
        accessPolicy: ownerMembership?.accessPolicy,
      })
      const runtimeTargetId = member.deviceId ? `linked-device:${member.deviceId}` : `user:${ownerUserId}`
      const explicitlyGranted = memberCanUseAgentOnRuntime(accessPolicy, runtimeTargetId, member.agentId)
      const pullable = canPullAgentToDevice({
        agent: {
          agentId: member.agentId,
          enabled: agent.enabled !== false,
          scopeOrgId: scopeOrgId || undefined,
          ownerUserId: agentOwnerUserId,
          accessScope: agentAccessScope,
          agentKind: typeof agent.agentKind === 'string' ? agent.agentKind : undefined,
          marketplaceTemplateId: typeof agent.marketplaceTemplateId === 'string' ? agent.marketplaceTemplateId : undefined,
        },
        actorUserId: ownerUserId,
        orgId,
        orgManager,
        explicitlyGranted,
      })
      const startable = canStartLinkedAgent({
        accessScope: agentAccessScope,
        ownerUserId: agentOwnerUserId,
        actorUserId: ownerUserId,
        callerRole: orgManager ? 'admin' : 'client',
        selectedDeviceOwnerUserId: member.deviceId ? deviceOwnerUserId : ownerUserId,
        explicitlyGranted,
      })
      if (!pullable && !startable) {
        throw new Error(`agent rooms: owner cannot start agent in personal room: ${member.agentId}`)
      }
    }

    if (!member.deviceId) continue
    const grantSnap = await tx.get(db.collection(GRANTS).doc(`${orgId}_${member.deviceId}`))
    const grant = grantSnap.data()
    if (!grantSnap.exists || !grant || grant.status !== 'active' || grant.orgId !== orgId) {
      throw new Error(`agent rooms: device has no active grant: ${member.deviceId}`)
    }
    const deviceSnap = await tx.get(db.collection(DEVICES).doc(member.deviceId))
    const device = deviceSnap.data()
    if (!deviceSnap.exists || !device) throw new Error(`agent rooms: device not found: ${member.deviceId}`)
    const available = Array.isArray(device.availableAgents) ? device.availableAgents : []
    const reported = available.some((entry) => {
      if (!entry || typeof entry !== 'object') return false
      const row = entry as Record<string, unknown>
      return row.orgId === orgId && row.agentId === member.agentId
    })
    if (!reported) {
      throw new Error(`agent rooms: device does not report agent ${member.agentId}`)
    }
  }
}

async function assertHumanTeams(
  tx: TransactionLike,
  db: DbLike,
  orgId: string,
  teamIds: string[],
): Promise<void> {
  for (const teamId of teamIds) {
    const snap = await tx.get(db.collection(ORG_TEAMS_COLLECTION).doc(teamId))
    const team = snap.data()
    if (!snap.exists || !team || team.orgId !== orgId || team.status !== 'active') {
      throw new Error(`agent rooms: human team is not active: ${teamId}`)
    }
  }
}

export async function createAgentRoom(input: {
  orgId: string
  slug: string
  name: string
  pictureUrl?: string | null
  members: AgentRoomMember[]
  humanTeamIds?: string[]
  conversationId: string
  actorUserId: string
  accessScope?: AgentRoomAccessScope
  ownerUserId?: string | null
}, options: AgentRoomStoreOptions = {}): Promise<AgentRoom> {
  const orgId = input.orgId.trim()
  const slug = normalizeAgentRoomSlug(input.slug)
  const name = normalizeName(input.name)
  const pictureUrl = normalizePictureUrl(input.pictureUrl)
  const members = normalizeMembers(input.members)
  const accessScope = normalizeAccessScope(input.accessScope)
  const ownerUserId = accessScope === 'personal'
    ? (typeof input.ownerUserId === 'string' && input.ownerUserId.trim()
      ? input.ownerUserId.trim()
      : input.actorUserId)
    : null
  const humanTeamIds = accessScope === 'personal' ? [] : cleanTeamIds(input.humanTeamIds)
  const conversationId = input.conversationId.trim()
  if (!orgId) throw new Error('agent rooms: orgId is required')
  if (!AGENT_ROOM_SLUG_RE.test(slug)) throw new Error('agent rooms: invalid slug')
  if (!conversationId) throw new Error('agent rooms: conversationId is required')
  if (accessScope === 'personal' && !ownerUserId) {
    throw new Error('agent rooms: personal room requires ownerUserId')
  }

  const roomId = accessScope === 'personal'
    ? personalAgentRoomId(orgId, ownerUserId!, slug)
    : agentRoomId(orgId, slug)
  const db = options.db ?? (adminDb as unknown as DbLike)
  return db.runTransaction(async (tx) => {
    const roomRef = db.collection(AGENT_ROOMS_COLLECTION).doc(roomId)
    const existing = await tx.get(roomRef)
    if (existing.exists) throw new Error('agent rooms: slug already exists')
    await assertMembers(tx, db, orgId, members, { accessScope, ownerUserId })
    await assertHumanTeams(tx, db, orgId, humanTeamIds)
    const at = timestamp(options)
    const room: AgentRoom = {
      roomId,
      orgId,
      slug,
      name,
      pictureUrl,
      members,
      humanTeamIds,
      conversationId,
      allowOrgWideDms: false,
      accessScope,
      ownerUserId,
      projectionVersion: 1,
      status: 'active',
      createdByUserId: input.actorUserId,
      createdAt: at,
      updatedAt: at,
    }
    tx.create(roomRef, { ...room })
    return room
  })
}

export async function updateAgentRoom(input: {
  orgId: string
  roomId: string
  name?: string
  pictureUrl?: string | null
  members?: AgentRoomMember[]
  humanTeamIds?: string[]
}, options: AgentRoomStoreOptions = {}): Promise<AgentRoom> {
  const db = options.db ?? (adminDb as unknown as DbLike)
  return db.runTransaction(async (tx) => {
    const roomRef = db.collection(AGENT_ROOMS_COLLECTION).doc(input.roomId)
    const snap = await tx.get(roomRef)
    const room = asRoom(input.roomId, snap.data())
    if (!snap.exists || !room || room.orgId !== input.orgId) throw new Error('agent rooms: room not found')
    if (room.status === 'archived') throw new Error('agent rooms: room is archived')
    const name = input.name !== undefined ? normalizeName(input.name) : room.name
    const pictureUrl = input.pictureUrl !== undefined ? normalizePictureUrl(input.pictureUrl) : room.pictureUrl
    const members = input.members !== undefined ? normalizeMembers(input.members) : room.members
    const humanTeamIds = room.accessScope === 'personal'
      ? []
      : (input.humanTeamIds !== undefined ? cleanTeamIds(input.humanTeamIds) : room.humanTeamIds)
    if (input.members !== undefined) {
      await assertMembers(tx, db, input.orgId, members, {
        accessScope: room.accessScope,
        ownerUserId: room.ownerUserId,
      })
    }
    if (input.humanTeamIds !== undefined && room.accessScope !== 'personal') {
      await assertHumanTeams(tx, db, input.orgId, humanTeamIds)
    }
    const at = timestamp(options)
    const updated: AgentRoom = {
      ...room,
      name,
      pictureUrl,
      members,
      humanTeamIds,
      projectionVersion: room.projectionVersion + 1,
      updatedAt: at,
    }
    tx.update(roomRef, {
      name,
      pictureUrl,
      members,
      humanTeamIds,
      projectionVersion: updated.projectionVersion,
      updatedAt: at,
    })
    return updated
  })
}

export async function archiveAgentRoom(input: {
  orgId: string
  roomId: string
}, options: AgentRoomStoreOptions = {}): Promise<AgentRoom> {
  const db = options.db ?? (adminDb as unknown as DbLike)
  return db.runTransaction(async (tx) => {
    const roomRef = db.collection(AGENT_ROOMS_COLLECTION).doc(input.roomId)
    const snap = await tx.get(roomRef)
    const room = asRoom(input.roomId, snap.data())
    if (!snap.exists || !room || room.orgId !== input.orgId) throw new Error('agent rooms: room not found')
    if (room.status === 'archived') return room
    const at = timestamp(options)
    const updated: AgentRoom = {
      ...room,
      status: 'archived',
      archivedAt: at,
      projectionVersion: room.projectionVersion + 1,
      updatedAt: at,
    }
    tx.update(roomRef, {
      status: 'archived',
      archivedAt: at,
      projectionVersion: updated.projectionVersion,
      updatedAt: at,
    })
    return updated
  })
}

export async function getAgentRoomById(roomId: string, options: AgentRoomStoreOptions = {}): Promise<AgentRoom | null> {
  const db = options.db ?? (adminDb as unknown as DbLike)
  const result = await db.collection(AGENT_ROOMS_COLLECTION).doc(roomId).get()
  return asRoom(roomId, result.data())
}

export async function getAgentRoom(orgId: string, roomId: string, options: AgentRoomStoreOptions = {}): Promise<AgentRoom | null> {
  const room = await getAgentRoomById(roomId, options)
  if (!room || room.orgId !== orgId) return null
  return room
}

export async function listAgentRooms(orgId: string, options: AgentRoomStoreOptions = {}): Promise<AgentRoom[]> {
  const db = options.db ?? (adminDb as unknown as DbLike)
  const snap = await db.collection(AGENT_ROOMS_COLLECTION).where('orgId', '==', orgId).get()
  // Filter personal rooms in memory by viewerUserId — avoids a composite index for now.
  return snap.docs
    .map((doc) => asRoom(doc.id, doc.data()))
    .filter((room): room is AgentRoom => Boolean(room))
    .filter((room) => roomVisibleToViewer(room, options.viewerUserId))
    .sort((a, b) => a.name.localeCompare(b.name))
}
