import { adminDb } from '@/lib/firebase/admin'
import { isActiveOrgMembershipRow } from '@/lib/orgMembers/active-membership'
import {
  ORG_TEAMS_COLLECTION,
  ORG_TEAM_MAX_MEMBERS,
  ORG_TEAM_SLUG_RE,
  normalizeOrgTeamSlug,
  orgTeamId,
  type OrgTeam,
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

export interface OrgTeamStoreOptions {
  db?: DbLike
  now?: () => unknown
}

const MEMBERS = 'orgMembers'

function timestamp(options: OrgTeamStoreOptions): unknown {
  return options.now ? options.now() : new Date().toISOString()
}

function asTeam(id: string, data: Record<string, unknown> | undefined): OrgTeam | null {
  if (!data) return null
  return {
    teamId: id,
    orgId: String(data.orgId ?? ''),
    slug: String(data.slug ?? ''),
    name: String(data.name ?? ''),
    description: typeof data.description === 'string' ? data.description : '',
    memberUserIds: Array.isArray(data.memberUserIds)
      ? data.memberUserIds.filter((value): value is string => typeof value === 'string')
      : [],
    leadUserIds: Array.isArray(data.leadUserIds)
      ? data.leadUserIds.filter((value): value is string => typeof value === 'string')
      : [],
    createdByUserId: String(data.createdByUserId ?? ''),
    status: data.status === 'archived' ? 'archived' : 'active',
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    ...(data.archivedAt !== undefined ? { archivedAt: data.archivedAt } : {}),
  }
}

function cleanUserIds(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map((value) => value.trim()))]
}

function memberTeamIds(row: Record<string, unknown> | undefined): string[] {
  return Array.isArray(row?.teamIds)
    ? row.teamIds.filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    : []
}

async function assertActiveMembers(
  tx: TransactionLike,
  db: DbLike,
  orgId: string,
  userIds: string[],
): Promise<void> {
  for (const userId of userIds) {
    const snap = await tx.get(db.collection(MEMBERS).doc(`${orgId}_${userId}`))
    const row = snap.data()
    const active = isActiveOrgMembershipRow(row)
      && (row?.orgId === orgId || row?.orgId == null)
      && (row?.uid === userId || row?.userId === userId || !row?.uid)
    if (!snap.exists || !active) {
      throw new Error(`org teams: user is not an active member: ${userId}`)
    }
  }
}

function assertLeadsAreMembers(memberUserIds: string[], leadUserIds: string[]): void {
  for (const leadId of leadUserIds) {
    if (!memberUserIds.includes(leadId)) {
      throw new Error('org teams: lead must also be a member')
    }
  }
}

export async function createOrgTeam(input: {
  orgId: string
  slug: string
  name: string
  description?: string
  actorUserId: string
  memberUserIds?: string[]
  leadUserIds?: string[]
}, options: OrgTeamStoreOptions = {}): Promise<OrgTeam> {
  const orgId = input.orgId.trim()
  const slug = normalizeOrgTeamSlug(input.slug)
  const name = input.name.trim()
  const description = (input.description ?? '').trim()
  if (!orgId) throw new Error('org teams: orgId is required')
  if (!ORG_TEAM_SLUG_RE.test(slug)) throw new Error('org teams: invalid slug')
  if (name.length < 1 || name.length > 80) throw new Error('org teams: name must be 1..80 characters')
  if (description.length > 500) throw new Error('org teams: description must be at most 500 characters')

  const memberUserIds = cleanUserIds(input.memberUserIds)
  const leadUserIds = cleanUserIds(input.leadUserIds)
  if (memberUserIds.length > ORG_TEAM_MAX_MEMBERS) throw new Error('org teams: too many members')
  assertLeadsAreMembers(memberUserIds, leadUserIds)

  const teamId = orgTeamId(orgId, slug)
  const db = options.db ?? (adminDb as unknown as DbLike)
  return db.runTransaction(async (tx) => {
    const teamRef = db.collection(ORG_TEAMS_COLLECTION).doc(teamId)
    const existing = await tx.get(teamRef)
    if (existing.exists) throw new Error('org teams: slug already exists')
    await assertActiveMembers(tx, db, orgId, memberUserIds)
    const at = timestamp(options)
    const team: OrgTeam = {
      teamId,
      orgId,
      slug,
      name,
      description,
      memberUserIds,
      leadUserIds,
      createdByUserId: input.actorUserId,
      status: 'active',
      createdAt: at,
      updatedAt: at,
    }
    tx.create(teamRef, { ...team })
    for (const userId of memberUserIds) {
      const memberRef = db.collection(MEMBERS).doc(`${orgId}_${userId}`)
      const memberSnap = await tx.get(memberRef)
      const next = [...new Set([...memberTeamIds(memberSnap.data()), teamId])]
      tx.update(memberRef, { teamIds: next })
    }
    return team
  })
}

export async function updateOrgTeam(input: {
  orgId: string
  teamId: string
  actorUserId: string
  name?: string
  description?: string
}, options: OrgTeamStoreOptions = {}): Promise<OrgTeam> {
  const db = options.db ?? (adminDb as unknown as DbLike)
  return db.runTransaction(async (tx) => {
    const teamRef = db.collection(ORG_TEAMS_COLLECTION).doc(input.teamId)
    const snap = await tx.get(teamRef)
    const team = asTeam(input.teamId, snap.data())
    if (!snap.exists || !team || team.orgId !== input.orgId) throw new Error('org teams: team not found')
    if (team.status === 'archived') throw new Error('org teams: team is archived')
    const nextName = input.name !== undefined ? input.name.trim() : team.name
    const nextDescription = input.description !== undefined ? input.description.trim() : team.description
    if (nextName.length < 1 || nextName.length > 80) throw new Error('org teams: name must be 1..80 characters')
    if (nextDescription.length > 500) throw new Error('org teams: description must be at most 500 characters')
    const at = timestamp(options)
    const updated: OrgTeam = { ...team, name: nextName, description: nextDescription, updatedAt: at }
    tx.update(teamRef, { name: nextName, description: nextDescription, updatedAt: at })
    return updated
  })
}

export async function setOrgTeamMembers(input: {
  orgId: string
  teamId: string
  actorUserId: string
  memberUserIds: string[]
  leadUserIds: string[]
}, options: OrgTeamStoreOptions = {}): Promise<OrgTeam> {
  const memberUserIds = cleanUserIds(input.memberUserIds)
  const leadUserIds = cleanUserIds(input.leadUserIds)
  if (memberUserIds.length > ORG_TEAM_MAX_MEMBERS) throw new Error('org teams: too many members')
  assertLeadsAreMembers(memberUserIds, leadUserIds)

  const db = options.db ?? (adminDb as unknown as DbLike)
  return db.runTransaction(async (tx) => {
    const teamRef = db.collection(ORG_TEAMS_COLLECTION).doc(input.teamId)
    const snap = await tx.get(teamRef)
    const team = asTeam(input.teamId, snap.data())
    if (!snap.exists || !team || team.orgId !== input.orgId) throw new Error('org teams: team not found')
    if (team.status === 'archived') throw new Error('org teams: team is archived')
    await assertActiveMembers(tx, db, input.orgId, memberUserIds)

    const added = memberUserIds.filter((userId) => !team.memberUserIds.includes(userId))
    const removed = team.memberUserIds.filter((userId) => !memberUserIds.includes(userId))
    const at = timestamp(options)
    const updated: OrgTeam = { ...team, memberUserIds, leadUserIds, updatedAt: at }
    tx.update(teamRef, { memberUserIds, leadUserIds, updatedAt: at })

    for (const userId of added) {
      const memberRef = db.collection(MEMBERS).doc(`${input.orgId}_${userId}`)
      const memberSnap = await tx.get(memberRef)
      tx.update(memberRef, { teamIds: [...new Set([...memberTeamIds(memberSnap.data()), input.teamId])] })
    }
    for (const userId of removed) {
      const memberRef = db.collection(MEMBERS).doc(`${input.orgId}_${userId}`)
      const memberSnap = await tx.get(memberRef)
      tx.update(memberRef, { teamIds: memberTeamIds(memberSnap.data()).filter((id) => id !== input.teamId) })
    }
    return updated
  })
}

export async function archiveOrgTeam(input: {
  orgId: string
  teamId: string
  actorUserId: string
}, options: OrgTeamStoreOptions = {}): Promise<OrgTeam> {
  const db = options.db ?? (adminDb as unknown as DbLike)
  return db.runTransaction(async (tx) => {
    const teamRef = db.collection(ORG_TEAMS_COLLECTION).doc(input.teamId)
    const snap = await tx.get(teamRef)
    const team = asTeam(input.teamId, snap.data())
    if (!snap.exists || !team || team.orgId !== input.orgId) throw new Error('org teams: team not found')
    if (team.status === 'archived') return team
    const at = timestamp(options)
    const updated: OrgTeam = { ...team, status: 'archived', archivedAt: at, updatedAt: at }
    tx.update(teamRef, { status: 'archived', archivedAt: at, updatedAt: at })
    for (const userId of team.memberUserIds) {
      const memberRef = db.collection(MEMBERS).doc(`${input.orgId}_${userId}`)
      const memberSnap = await tx.get(memberRef)
      if (!memberSnap.exists) continue
      tx.update(memberRef, { teamIds: memberTeamIds(memberSnap.data()).filter((id) => id !== input.teamId) })
    }
    return updated
  })
}

export async function getOrgTeam(orgId: string, teamId: string, options: OrgTeamStoreOptions = {}): Promise<OrgTeam | null> {
  const db = options.db ?? (adminDb as unknown as DbLike)
  const result = await db.collection(ORG_TEAMS_COLLECTION).doc(teamId).get()
  const team = asTeam(teamId, result.data())
  if (!team || team.orgId !== orgId) return null
  return team
}

export async function listOrgTeams(
  orgId: string,
  options: OrgTeamStoreOptions & { includeArchived?: boolean } = {},
): Promise<OrgTeam[]> {
  const db = (options.db ?? adminDb) as unknown as DbLike
  const snap = await db.collection(ORG_TEAMS_COLLECTION).where('orgId', '==', orgId).get()
  return snap.docs
    .map((doc) => asTeam(doc.id, doc.data()))
    .filter((team): team is OrgTeam => Boolean(team && (options.includeArchived || team.status === 'active')))
    .sort((left, right) => left.name.localeCompare(right.name))
}

export async function listOrgTeamsForUser(
  orgId: string,
  userId: string,
  options: OrgTeamStoreOptions = {},
): Promise<OrgTeam[]> {
  const teams = await listOrgTeams(orgId, { ...options, includeArchived: false })
  return teams.filter((team) => team.memberUserIds.includes(userId))
}

export async function removeUserFromAllOrgTeams(input: {
  orgId: string
  userId: string
}, options: OrgTeamStoreOptions = {}): Promise<string[]> {
  const db = options.db ?? (adminDb as unknown as DbLike)
  return db.runTransaction(async (tx) => {
    const teamsSnap = await db.collection(ORG_TEAMS_COLLECTION).where('orgId', '==', input.orgId).get()
    const touched: string[] = []
    const at = timestamp(options)
    for (const doc of teamsSnap.docs) {
      const team = asTeam(doc.id, doc.data())
      if (!team || team.status !== 'active' || !team.memberUserIds.includes(input.userId)) continue
      const teamRef = db.collection(ORG_TEAMS_COLLECTION).doc(team.teamId)
      tx.update(teamRef, {
        memberUserIds: team.memberUserIds.filter((id) => id !== input.userId),
        leadUserIds: team.leadUserIds.filter((id) => id !== input.userId),
        updatedAt: at,
      })
      touched.push(team.teamId)
    }
    const memberRef = db.collection(MEMBERS).doc(`${input.orgId}_${input.userId}`)
    const memberSnap = await tx.get(memberRef)
    if (memberSnap.exists) {
      tx.update(memberRef, { teamIds: [] })
    }
    return touched
  })
}
