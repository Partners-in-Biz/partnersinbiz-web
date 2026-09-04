import { createHash } from 'node:crypto'
import { getAgent } from '@/lib/agents/team'
import { isValidAgentId, type AgentId } from '@/lib/agents/types'
import { adminDb } from '@/lib/firebase/admin'
import { managedProfileName, parseManagedProfileName } from '@/lib/linked-computers/managed-profile'
import { getOrgSlug } from '@/lib/organizations/slug'
import { getAgentRoom, listAgentRooms, updateAgentRoom, type AgentRoomStoreOptions } from './store'
import { memberKey, type AgentRoom, type AgentRoomMember } from './types'

export const PROFILE_PROJECTIONS_COLLECTION = 'linked_device_profile_projections'
export const PROJECTION_DRIFT_GRACE_MS = 2 * 60_000
export const OBSERVED_META_MAX_BYTES = 8 * 1024

export interface DesiredProfileMeta {
  title: string
  description: string
  avatar: string | null
  section: string
  groups: string[]
}

export interface BotProjectionRoom {
  roomId: string
  name: string
  pictureUrl: string | null
  memberHandles: string[]
}

export interface BotProjectionPeer {
  handle: string
  url: string
  keyBindingId: string
}

export interface BotProjection {
  profileMeta: DesiredProfileMeta
  rooms: BotProjectionRoom[]
  peers: BotProjectionPeer[]
  projectionVersion: number
}

export interface ProfileProjectionDoc {
  deviceId: string
  orgId: string
  profile: string
  desired: BotProjection
  desiredHash: string
  observedHash: string | null
  observedMeta: Record<string, unknown> | null
  driftedAt: unknown | null
  lastAppliedAt: unknown | null
  projectionVersion: number
}

interface RefLike { id: string; path?: string }
interface SnapshotLike { exists: boolean; data(): Record<string, unknown> | undefined }
interface TransactionLike {
  get(ref: RefLike): Promise<SnapshotLike>
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

export interface ProjectionOptions {
  db?: DbLike
  now?: () => unknown
  nowMs?: () => number
  getAgent?: typeof getAgent
  listAgentRooms?: typeof listAgentRooms
  updateAgentRoom?: typeof updateAgentRoom
  enqueueBotProjectionJob?: (input: {
    deviceId: string
    orgId: string
    actorUserId: string
    agentId: AgentId
    desiredHash: string
    botProjection: BotProjection
  }) => Promise<string>
}

function roomStoreOptions(options: ProjectionOptions): AgentRoomStoreOptions {
  return {
    db: options.db as AgentRoomStoreOptions['db'],
    now: options.now,
  }
}

function resolveDb(options: ProjectionOptions): DbLike {
  return options.db ?? (adminDb as unknown as DbLike)
}

function nowMs(options: ProjectionOptions): number {
  return options.nowMs ? options.nowMs() : Date.now()
}

function timestamp(options: ProjectionOptions): unknown {
  return options.now ? options.now() : new Date(nowMs(options)).toISOString()
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(canonicalize)
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = canonicalize((value as Record<string, unknown>)[key])
  }
  return sorted
}

/** sha256 of canonical JSON (object keys sorted at every level). Stable across key order. */
export function projectionHash(obj: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(obj))).digest('hex')
}

export function profileProjectionId(deviceId: string, profile: string): string {
  return `${deviceId}_${profile}`
}

export function memberHandle(member: AgentRoomMember): string {
  return member.deviceId ? `@${member.agentId}-${member.deviceId}` : `@${member.agentId}`
}

export function agentIdFromProfile(profile: string): AgentId | null {
  const parsed = parseManagedProfileName(profile)
  if (parsed && isValidAgentId(parsed.agentId)) return parsed.agentId
  return isValidAgentId(profile) ? profile : null
}

function asProjection(id: string, data: Record<string, unknown> | undefined): ProfileProjectionDoc | null {
  if (!data) return null
  const desired = data.desired && typeof data.desired === 'object' && !Array.isArray(data.desired)
    ? data.desired as BotProjection
    : null
  if (!desired) return null
  return {
    deviceId: String(data.deviceId ?? ''),
    orgId: String(data.orgId ?? ''),
    profile: String(data.profile ?? ''),
    desired,
    desiredHash: String(data.desiredHash ?? ''),
    observedHash: typeof data.observedHash === 'string' ? data.observedHash : null,
    observedMeta: data.observedMeta && typeof data.observedMeta === 'object' && !Array.isArray(data.observedMeta)
      ? data.observedMeta as Record<string, unknown>
      : null,
    driftedAt: data.driftedAt ?? null,
    lastAppliedAt: data.lastAppliedAt ?? null,
    projectionVersion: Number(data.projectionVersion ?? desired.projectionVersion ?? 0),
  }
}

export async function getProfileProjection(
  orgId: string,
  projectionId: string,
  options: ProjectionOptions = {},
): Promise<ProfileProjectionDoc | null> {
  const db = resolveDb(options)
  const snap = await db.collection(PROFILE_PROJECTIONS_COLLECTION).doc(projectionId).get()
  const projection = asProjection(projectionId, snap.data())
  if (!projection || projection.orgId !== orgId) return null
  return projection
}

export async function desiredProfileMeta(
  orgId: string,
  agentId: AgentId,
  options: ProjectionOptions = {},
): Promise<DesiredProfileMeta> {
  const loadAgent = options.getAgent ?? getAgent
  const agent = await loadAgent(agentId)
  if (!agent) throw new Error(`agent rooms: unknown agent: ${agentId}`)
  const loadRooms = options.listAgentRooms ?? listAgentRooms
  const rooms = await loadRooms(orgId, roomStoreOptions(options))
  const groups = rooms
    .filter((room) => room.status === 'active' && room.members.some((member) => member.agentId === agentId))
    .map((room) => room.slug)
    .sort()
  return {
    title: agent.name,
    description: agent.role,
    avatar: null,
    section: '',
    groups,
  }
}

export async function desiredRoomsForDevice(
  deviceId: string,
  options: ProjectionOptions = {},
): Promise<AgentRoom[]> {
  const db = resolveDb(options)
  const loadRooms = options.listAgentRooms ?? listAgentRooms
  const orgIds = new Set<string>()
  const grants = await db.collection('linked_device_grants')
    .where('deviceId', '==', deviceId)
    .where('status', '==', 'active')
    .get()
  for (const doc of grants.docs) {
    const row = doc.data()
    const orgId = typeof row.orgId === 'string' ? row.orgId : ''
    if (orgId) orgIds.add(orgId)
  }
  const deviceSnap = await db.collection('linked_devices').doc(deviceId).get()
  const deviceOwnerUserId = typeof deviceSnap.data()?.ownerUserId === 'string'
    ? deviceSnap.data()!.ownerUserId as string
    : null
  const rooms: AgentRoom[] = []
  for (const orgId of orgIds) {
    // Load all rooms for the org (no viewer filter) so personal ownership can be checked here.
    const listed = await loadRooms(orgId, roomStoreOptions(options))
    rooms.push(...listed)
  }
  return rooms.filter((room) => {
    if (room.status !== 'active') return false
    if (!room.members.some((member) => member.deviceId === deviceId || member.deviceId === null)) {
      return false
    }
    if (room.accessScope === 'personal') {
      return Boolean(room.ownerUserId && deviceOwnerUserId && room.ownerUserId === deviceOwnerUserId)
    }
    return true
  })
}

async function resolveProfileForMember(
  orgId: string,
  member: AgentRoomMember,
  db: DbLike,
): Promise<string | null> {
  if (member.deviceId) {
    const deviceSnap = await db.collection('linked_devices').doc(member.deviceId).get()
    const available = Array.isArray(deviceSnap.data()?.availableAgents)
      ? deviceSnap.data()!.availableAgents as Array<Record<string, unknown>>
      : []
    const hit = available.find((row) => row.orgId === orgId && row.agentId === member.agentId)
    if (typeof hit?.profile === 'string' && hit.profile.trim()) return hit.profile.trim()
  }
  try {
    const orgSlug = await getOrgSlug(orgId, { db: db as never })
    return managedProfileName(orgSlug, member.agentId)
  } catch {
    return null
  }
}

/**
 * After a room create/update/archive, upsert desired projections for every
 * member device. Platform members (deviceId null) project onto devices that
 * currently report the agent under an active org grant.
 */
export async function projectAgentRoomAfterWrite(input: {
  room: AgentRoom
  actorUserId: string
  previousMembers?: AgentRoomMember[]
}, options: ProjectionOptions = {}): Promise<void> {
  const db = resolveDb(options)
  const targets = new Map<string, { deviceId: string; agentId: AgentId; profile: string }>()

  async function addMember(member: AgentRoomMember): Promise<void> {
    if (!isValidAgentId(member.agentId)) return
    if (member.deviceId) {
      const profile = await resolveProfileForMember(input.room.orgId, member, db)
      if (!profile) return
      targets.set(`${member.deviceId}\0${member.agentId}`, {
        deviceId: member.deviceId,
        agentId: member.agentId,
        profile,
      })
      return
    }
    const grants = await db.collection('linked_device_grants')
      .where('orgId', '==', input.room.orgId)
      .where('status', '==', 'active')
      .get()
    for (const grantDoc of grants.docs) {
      const grant = grantDoc.data()
      const deviceId = typeof grant.deviceId === 'string' ? grant.deviceId : ''
      if (!deviceId) continue
      if (input.room.accessScope === 'personal' && input.room.ownerUserId) {
        const deviceSnap = await db.collection('linked_devices').doc(deviceId).get()
        if (deviceSnap.data()?.ownerUserId !== input.room.ownerUserId) continue
      }
      const deviceSnap = await db.collection('linked_devices').doc(deviceId).get()
      const available = Array.isArray(deviceSnap.data()?.availableAgents)
        ? deviceSnap.data()!.availableAgents as Array<Record<string, unknown>>
        : []
      const hit = available.find((row) => row.orgId === input.room.orgId && row.agentId === member.agentId)
      if (!hit) continue
      const profile = typeof hit.profile === 'string' && hit.profile.trim()
        ? hit.profile.trim()
        : await resolveProfileForMember(input.room.orgId, { agentId: member.agentId, deviceId }, db)
      if (!profile) continue
      targets.set(`${deviceId}\0${member.agentId}`, {
        deviceId,
        agentId: member.agentId,
        profile,
      })
    }
  }

  const seenKeys = new Set<string>()
  for (const member of [...input.room.members, ...(input.previousMembers ?? [])]) {
    const key = memberKey(member)
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    await addMember(member)
  }

  for (const target of targets.values()) {
    try {
      await upsertDesiredProjection({
        orgId: input.room.orgId,
        deviceId: target.deviceId,
        profile: target.profile,
        agentId: target.agentId,
        actorUserId: input.actorUserId,
      }, options)
    } catch {
      // Best-effort: room write already succeeded; projection can catch up on next heartbeat.
    }
  }
}

function roomsToProjection(rooms: AgentRoom[]): { rooms: BotProjectionRoom[]; projectionVersion: number } {
  const projected = rooms
    .map((room) => ({
      roomId: room.roomId,
      name: room.name,
      pictureUrl: room.pictureUrl,
      memberHandles: room.members.map(memberHandle).sort(),
      version: room.projectionVersion,
    }))
    .sort((a, b) => a.roomId.localeCompare(b.roomId))
  return {
    rooms: projected.map(({ version: _version, ...room }) => room),
    projectionVersion: Math.max(1, ...projected.map((room) => room.version), 0),
  }
}

export async function desiredBotProjection(
  orgId: string,
  deviceId: string,
  agentId: AgentId,
  options: ProjectionOptions = {},
): Promise<BotProjection> {
  const profileMeta = await desiredProfileMeta(orgId, agentId, options)
  const deviceRooms = await desiredRoomsForDevice(deviceId, options)
  const agentRooms = deviceRooms.filter((room) => (
    room.orgId === orgId && room.members.some((member) => member.agentId === agentId)
  ))
  const { rooms, projectionVersion } = roomsToProjection(agentRooms)
  return {
    profileMeta,
    rooms,
    peers: [],
    projectionVersion,
  }
}

async function defaultEnqueue(input: {
  deviceId: string
  orgId: string
  actorUserId: string
  agentId: AgentId
  desiredHash: string
  botProjection: BotProjection
}): Promise<string> {
  const { enqueueBotProjectionJob } = await import('@/lib/linked-computers/agent-host-service')
  return enqueueBotProjectionJob(input)
}

export async function upsertDesiredProjection(input: {
  orgId: string
  deviceId: string
  profile: string
  agentId: AgentId
  actorUserId: string
}, options: ProjectionOptions = {}): Promise<{
  projection: ProfileProjectionDoc
  desiredHashChanged: boolean
  enqueuedJobId: string | null
}> {
  const db = resolveDb(options)
  const desired = await desiredBotProjection(input.orgId, input.deviceId, input.agentId, options)
  const desiredHash = projectionHash(desired)
  const projectionId = profileProjectionId(input.deviceId, input.profile)

  const { projection, desiredHashChanged } = await db.runTransaction(async (tx) => {
    const ref = db.collection(PROFILE_PROJECTIONS_COLLECTION).doc(projectionId)
    const snap = await tx.get(ref)
    const existing = asProjection(projectionId, snap.data())
    const changed = !existing || existing.desiredHash !== desiredHash
    const next: ProfileProjectionDoc = {
      deviceId: input.deviceId,
      orgId: input.orgId,
      profile: input.profile,
      desired,
      desiredHash,
      observedHash: existing?.observedHash ?? null,
      observedMeta: existing?.observedMeta ?? null,
      driftedAt: changed ? null : existing?.driftedAt ?? null,
      lastAppliedAt: existing?.lastAppliedAt ?? null,
      projectionVersion: desired.projectionVersion,
    }
    if (snap.exists) tx.set(ref, { ...next }, { merge: true })
    else tx.set(ref, { ...next })
    return { projection: next, desiredHashChanged: changed }
  })

  let enqueuedJobId: string | null = null
  if (desiredHashChanged) {
    const enqueue = options.enqueueBotProjectionJob ?? defaultEnqueue
    enqueuedJobId = await enqueue({
      deviceId: input.deviceId,
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      agentId: input.agentId,
      desiredHash,
      botProjection: desired,
    })
  }
  return { projection, desiredHashChanged, enqueuedJobId }
}

function observedTitle(meta: Record<string, unknown>): string | undefined {
  if (typeof meta.title === 'string' && meta.title.trim()) return meta.title.trim()
  const nested = meta.profileMeta
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const title = (nested as Record<string, unknown>).title
    if (typeof title === 'string' && title.trim()) return title.trim()
  }
  return undefined
}

function observedRooms(meta: Record<string, unknown>): Array<{ roomId: string; name?: string; pictureUrl?: string | null }> {
  if (!Array.isArray(meta.rooms)) return []
  return meta.rooms.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    const roomId = typeof row.roomId === 'string' ? row.roomId.trim() : ''
    if (!roomId) return []
    return [{
      roomId,
      ...(typeof row.name === 'string' ? { name: row.name } : {}),
      ...(row.pictureUrl === null || typeof row.pictureUrl === 'string' ? { pictureUrl: row.pictureUrl } : {}),
    }]
  })
}

export async function adoptProjectionDrift(input: {
  orgId: string
  projectionId: string
  actorUserId: string
}, options: ProjectionOptions = {}): Promise<{ projection: ProfileProjectionDoc; roomIds: string[] }> {
  const db = resolveDb(options)
  const projection = await getProfileProjection(input.orgId, input.projectionId, options)
  if (!projection) throw new Error('agent rooms: projection not found')
  const agentId = agentIdFromProfile(projection.profile)
  if (!agentId) throw new Error('agent rooms: projection profile is not an agent')
  const meta = projection.observedMeta ?? {}
  const title = observedTitle(meta)
  if (title) {
    await db.runTransaction(async (tx) => {
      const ref = db.collection('agent_team').doc(agentId)
      const snap = await tx.get(ref)
      if (!snap.exists) throw new Error(`agent rooms: unknown agent: ${agentId}`)
      tx.update(ref, { name: title, updatedAt: timestamp(options) })
    })
  }

  const patchRoom = options.updateAgentRoom ?? updateAgentRoom
  const roomIds: string[] = []
  for (const room of observedRooms(meta)) {
    const existing = await getAgentRoom(input.orgId, room.roomId, roomStoreOptions(options))
    if (!existing || existing.status === 'archived') continue
    await patchRoom({
      orgId: input.orgId,
      roomId: room.roomId,
      ...(room.name !== undefined ? { name: room.name } : {}),
      ...(room.pictureUrl !== undefined ? { pictureUrl: room.pictureUrl } : {}),
    }, roomStoreOptions(options))
    roomIds.push(room.roomId)
  }

  await db.runTransaction(async (tx) => {
    const ref = db.collection(PROFILE_PROJECTIONS_COLLECTION).doc(input.projectionId)
    const snap = await tx.get(ref)
    if (!snap.exists) return
    tx.update(ref, {
      driftedAt: null,
      lastAppliedAt: timestamp(options),
      observedHash: projection.desiredHash,
    })
  })

  const refreshed = await getProfileProjection(input.orgId, input.projectionId, options)
  return { projection: refreshed ?? projection, roomIds }
}

export async function revertProjectionDrift(input: {
  orgId: string
  projectionId: string
  actorUserId: string
}, options: ProjectionOptions = {}): Promise<{ projection: ProfileProjectionDoc; jobId: string }> {
  const db = resolveDb(options)
  const projection = await getProfileProjection(input.orgId, input.projectionId, options)
  if (!projection) throw new Error('agent rooms: projection not found')
  const agentId = agentIdFromProfile(projection.profile)
  if (!agentId) throw new Error('agent rooms: projection profile is not an agent')
  const enqueue = options.enqueueBotProjectionJob ?? defaultEnqueue
  const jobId = await enqueue({
    deviceId: projection.deviceId,
    orgId: projection.orgId,
    actorUserId: input.actorUserId,
    agentId,
    desiredHash: projection.desiredHash,
    botProjection: projection.desired,
  })
  await db.runTransaction(async (tx) => {
    const ref = db.collection(PROFILE_PROJECTIONS_COLLECTION).doc(input.projectionId)
    const snap = await tx.get(ref)
    if (!snap.exists) return
    tx.update(ref, { driftedAt: null })
  })
  return { projection, jobId }
}

function lastAppliedAtMs(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis()
  }
  return null
}

export function shouldMarkProjectionDrifted(input: {
  desiredHash: string
  observedHash: string | null
  lastAppliedAt: unknown
  nowMs: number
}): boolean {
  if (!input.observedHash || input.observedHash === input.desiredHash) return false
  const applied = lastAppliedAtMs(input.lastAppliedAt)
  if (applied == null) return false
  return input.nowMs - applied >= PROJECTION_DRIFT_GRACE_MS
}

export function capObservedMeta(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const encoded = JSON.stringify(value)
  if (encoded.length > OBSERVED_META_MAX_BYTES) return null
  return value as Record<string, unknown>
}

export async function applyProjectionObservation(input: {
  deviceId: string
  orgId?: string | null
  profile: string
  observedHash: string | null
  observedMeta?: unknown
}, options: ProjectionOptions = {}): Promise<ProfileProjectionDoc | null> {
  const db = resolveDb(options)
  const projectionId = profileProjectionId(input.deviceId, input.profile)
  const observedMeta = capObservedMeta(input.observedMeta)
  const at = timestamp(options)
  const clock = nowMs(options)
  return db.runTransaction(async (tx) => {
    const ref = db.collection(PROFILE_PROJECTIONS_COLLECTION).doc(projectionId)
    const snap = await tx.get(ref)
    const projection = asProjection(projectionId, snap.data())
    if (!projection) return null
    if (input.orgId && projection.orgId !== input.orgId) return projection
    const observedHash = input.observedHash
    if (observedHash && observedHash === projection.desiredHash) {
      tx.update(ref, {
        observedHash,
        driftedAt: null,
        lastAppliedAt: at,
        ...(observedMeta ? { observedMeta } : {}),
      })
      return { ...projection, observedHash, driftedAt: null, lastAppliedAt: at }
    }
    if (shouldMarkProjectionDrifted({
      desiredHash: projection.desiredHash,
      observedHash,
      lastAppliedAt: projection.lastAppliedAt,
      nowMs: clock,
    })) {
      tx.update(ref, {
        observedHash,
        observedMeta,
        driftedAt: at,
      })
      return { ...projection, observedHash, observedMeta, driftedAt: at }
    }
    if (observedHash) {
      tx.update(ref, { observedHash, ...(observedMeta ? { observedMeta } : {}) })
      return { ...projection, observedHash, ...(observedMeta ? { observedMeta } : {}) }
    }
    return projection
  })
}
