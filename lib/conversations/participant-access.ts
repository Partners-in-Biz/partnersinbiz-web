import { adminDb } from '@/lib/firebase/admin'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import type { HumanParticipant, Participant } from '@/lib/conversations/types'

export class ConversationParticipantError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 = 400,
  ) {
    super(message)
    this.name = 'ConversationParticipantError'
  }
}

export interface ResolveHumanParticipantsPolicy {
  requestingUserRole?: 'admin' | 'client' | 'ai'
  enforceClientChatPolicy?: boolean
  allowClientToAdminChat?: boolean
  allowClientToPiBTeamChat?: boolean
}

type UserProfile = {
  role?: unknown
  displayName?: unknown
  email?: unknown
  allowedOrgIds?: unknown
}

type OrgMemberLike = { uid?: unknown; userId?: unknown }

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function userParticipant(uid: string, profile: UserProfile): HumanParticipant {
  return {
    kind: 'user',
    uid,
    role: profile.role === 'admin' ? 'admin' : 'client',
    ...(cleanString(profile.displayName) ? { displayName: cleanString(profile.displayName) } : {}),
    ...(cleanString(profile.email) ? { email: cleanString(profile.email) } : {}),
  }
}

async function platformSuperAdminUids(): Promise<Set<string>> {
  const snapshot = await adminDb.collection('users').where('role', '==', 'admin').get()
  return new Set(snapshot.docs.filter((doc) => {
    const data = doc.data() as UserProfile
    const allowedOrgIds = Array.isArray(data.allowedOrgIds)
      ? data.allowedOrgIds.filter((value): value is string => typeof value === 'string' && value.length > 0)
      : undefined
    return isSuperAdmin({ uid: doc.id, role: 'admin', allowedOrgIds })
  }).map((doc) => doc.id))
}

export async function organizationMemberUids(orgId: string): Promise<Set<string>> {
  const result = new Set<string>()
  const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
  if (orgId !== PIB_PLATFORM_ORG_ID && !orgDoc.exists) {
    throw new ConversationParticipantError('Organisation not found', 404)
  }

  // `orgMembers` is the canonical, revocable membership source. Do not union
  // the legacy embedded organization.members array: it can retain stale users.
  const linked = await adminDb.collection('orgMembers').where('orgId', '==', orgId).get()
  for (const doc of linked.docs) {
    const data = doc.data() as OrgMemberLike
    const uid = cleanString(data.uid) || cleanString(data.userId)
      || (doc.id.startsWith(`${orgId}_`) ? doc.id.slice(orgId.length + 1) : '')
    if (uid) result.add(uid)
  }
  return result
}

export interface ResolveHumanParticipantsInput {
  orgId: string
  ownerUid: string
  requestedUids: unknown
  existingParticipants?: Participant[]
  policy?: ResolveHumanParticipantsPolicy
}

/**
 * Resolve the human participant set for a post-creation sharing update.
 * The conversation owner is always retained. Other people must be members of
 * the conversation organisation (or platform super-admins, matching creation).
 */
export async function resolveHumanConversationParticipants({
  orgId,
  ownerUid,
  requestedUids,
  existingParticipants = [],
  policy = {},
}: ResolveHumanParticipantsInput): Promise<HumanParticipant[]> {
  if (!Array.isArray(requestedUids)) {
    throw new ConversationParticipantError('participantUids must be an array')
  }

  const orderedUids: string[] = []
  const seen = new Set<string>()
  for (const value of [ownerUid, ...requestedUids]) {
    const uid = cleanString(value)
    if (!uid) throw new ConversationParticipantError('participantUids must contain non-empty user IDs')
    if (!seen.has(uid)) {
      seen.add(uid)
      orderedUids.push(uid)
    }
  }

  const [memberUids, superAdminUids] = await Promise.all([
    organizationMemberUids(orgId),
    platformSuperAdminUids(),
  ])
  memberUids.add(ownerUid)

  const policyClient = {
    enforceClientChatPolicy: false,
    allowClientToAdminChat: true,
    allowClientToPiBTeamChat: false,
    ...policy,
  }

  for (const uid of orderedUids) {
    const allowed = memberUids.has(uid) || superAdminUids.has(uid)
    if (!allowed) {
      throw new ConversationParticipantError(`User ${uid} is not eligible for this organisation`, 403)
    }
    const isPlatformAdmin = superAdminUids.has(uid)
    if (policyClient.enforceClientChatPolicy && uid !== ownerUid && policyClient.requestingUserRole === 'client') {
      const userDoc = await adminDb.collection('users').doc(uid).get()
      const userData = userDoc.exists ? userDoc.data() as { role?: unknown } : {}
      const isAdmin = userData.role === 'admin'

      if (isPlatformAdmin && !policyClient.allowClientToPiBTeamChat) {
        throw new ConversationParticipantError('Client cannot create chats with the PiB team in this organisation', 403)
      }
      if (!isPlatformAdmin && isAdmin && !policyClient.allowClientToAdminChat) {
        throw new ConversationParticipantError('Client cannot create chats with admins in this organisation', 403)
      }
    }
  }

  const existingByUid = new Map(existingParticipants
    .filter((participant): participant is Extract<Participant, { kind: 'user' }> => participant.kind === 'user')
    .map((participant) => [participant.uid, participant]))

  return Promise.all(orderedUids.map(async (uid) => {
    const existing = existingByUid.get(uid)
    if (existing) return existing
    const userDoc = await adminDb.collection('users').doc(uid).get()
    if (!userDoc.exists) throw new ConversationParticipantError(`User ${uid} was not found`, 404)
    return userParticipant(uid, userDoc.data() as UserProfile)
  }))
}
