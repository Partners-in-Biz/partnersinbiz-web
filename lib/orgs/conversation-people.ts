/**
 * Shared people list used by New Conversation participant pickers.
 * Prefer the /people URL path — some browser privacy filters block paths
 * containing "contacts".
 */
import { adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'
import { getOrgChatVisibilityPolicy } from '@/lib/conversations/chat-config'
import type { ApiUser } from '@/lib/api/types'
import type { Organization, OrgMember, OrgRole } from '@/lib/organizations/types'

export interface ConversationPerson {
  uid: string
  displayName?: string
  email?: string
  role: 'admin' | 'client'
  department?: string
  jobTitle?: string
  photoURL?: string
}

type LinkedOrgMemberData = Partial<OrgMember> & {
  uid?: unknown
  userId?: unknown
  orgId?: unknown
  firstName?: unknown
  lastName?: unknown
  displayName?: unknown
  avatarUrl?: unknown
  photoURL?: unknown
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isOrgRole(value: unknown): value is OrgRole {
  return value === 'owner' || value === 'admin' || value === 'member' || value === 'viewer'
}

function contactRoleFromOrgRole(role: unknown): 'admin' | 'client' {
  return role === 'owner' || role === 'admin' ? 'admin' : 'client'
}

function displayNameFromProfile(profile: LinkedOrgMemberData, userDetails: { displayName?: string }): string | undefined {
  const firstName = cleanString(profile.firstName)
  const lastName = cleanString(profile.lastName)
  const profileName = [firstName, lastName].filter(Boolean).join(' ')
  return profileName || cleanString(profile.displayName) || cleanString(userDetails.displayName) || undefined
}

async function fetchUserDetails(
  uid: string,
): Promise<{ displayName?: string; email?: string; photoURL?: string }> {
  const doc = await adminDb.collection('users').doc(uid).get()
  const data = doc.data() ?? {}
  return {
    displayName: data.displayName as string | undefined,
    email: data.email as string | undefined,
    photoURL: data.photoURL as string | undefined,
  }
}

async function listPlatformAdmins(): Promise<ConversationPerson[]> {
  const superAdminSnap = await adminDb
    .collection('users')
    .where('role', '==', 'admin')
    .get()

  return superAdminSnap.docs
    .filter((d) => {
      const data = d.data()
      const allowedOrgIds = Array.isArray(data.allowedOrgIds)
        ? data.allowedOrgIds.filter((value: unknown): value is string => typeof value === 'string' && value.length > 0)
        : undefined
      return isSuperAdmin({ uid: d.id, role: data.role as 'admin', allowedOrgIds })
    })
    .map((d) => {
      const data = d.data()
    return {
      uid: d.id,
      role: 'admin' as const,
      displayName: data.displayName as string | undefined,
      email: data.email as string | undefined,
      department: '',
      jobTitle: '',
      photoURL: data.photoURL as string | undefined,
    }
    })
}

function uidFromLinkedMember(orgId: string, docId: string, data: LinkedOrgMemberData): string {
  const uid = cleanString(data.uid) || cleanString(data.userId)
  if (uid) return uid
  const prefix = `${orgId}_`
  return docId.startsWith(prefix) ? docId.slice(prefix.length) : docId
}

async function listLinkedOrgMemberContacts(orgId: string): Promise<ConversationPerson[]> {
  const snapshot = await adminDb.collection('orgMembers').where('orgId', '==', orgId).get()
  const contacts = await Promise.all(snapshot.docs.map(async (doc) => {
    const data = doc.data() as LinkedOrgMemberData
    const uid = uidFromLinkedMember(orgId, doc.id, data)
    if (!uid) return null
    const details = await fetchUserDetails(uid)
    return {
      uid,
      role: contactRoleFromOrgRole(isOrgRole(data.role) ? data.role : 'viewer'),
      displayName: displayNameFromProfile(data, details),
      email: details.email,
      department: cleanString(data.department),
      jobTitle: cleanString(data.jobTitle),
      photoURL: cleanString(data.avatarUrl) || cleanString(data.photoURL) || details.photoURL,
    } as ConversationPerson
  }))

  return contacts.filter((contact): contact is ConversationPerson => Boolean(contact))
}

function dedupeContacts(contacts: ConversationPerson[]): ConversationPerson[] {
  const seen = new Set<string>()
  return contacts.filter((contact) => {
    if (seen.has(contact.uid)) return false
    seen.add(contact.uid)
    return true
  })
}

export async function listConversationPeople(
  orgId: string,
  user: ApiUser,
): Promise<{ ok: true; people: ConversationPerson[] } | { ok: false; error: string; status: number }> {
  const callerIsAdmin = user.role === 'admin' || user.role === 'ai'
  const chatPolicy = callerIsAdmin ? null : await getOrgChatVisibilityPolicy(orgId)
  const includeAdminUsers = chatPolicy ? chatPolicy.enableClientToAdminChat : true
  const includePiBTeamUsers = chatPolicy ? chatPolicy.enableClientToPiBTeamChat : true

  if (orgId === PIB_PLATFORM_ORG_ID && callerIsAdmin) {
    const contacts = dedupeContacts([
      ...(await listPlatformAdmins()),
      ...(await listLinkedOrgMemberContacts(orgId)),
    ]).filter((admin) => admin.uid !== user.uid)
    return { ok: true, people: contacts }
  }

  const contacts: ConversationPerson[] = []
  const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
  if (!orgDoc.exists) return { ok: false, error: 'Organisation not found', status: 404 }
  const org = orgDoc.data() as Organization
  const members: OrgMember[] = org.members ?? []

  if (callerIsAdmin) {
    const resolved = members.length > 0
      ? await Promise.all(
          members.map(async (m) => {
            const details = await fetchUserDetails(m.userId)
            return {
              uid: m.userId,
              role: contactRoleFromOrgRole(m.role),
              department: cleanString(m.department),
              jobTitle: cleanString(m.jobTitle),
              ...details,
            } as ConversationPerson
          }),
        )
      : await listLinkedOrgMemberContacts(orgId)
    contacts.push(...resolved)
  } else {
    const memberContacts = members.length > 0
      ? await Promise.all(
          members.map(async (m) => {
            const details = await fetchUserDetails(m.userId)
            return {
              uid: m.userId,
              role: contactRoleFromOrgRole(m.role),
              department: cleanString(m.department),
              jobTitle: cleanString(m.jobTitle),
              ...details,
            } as ConversationPerson
          }),
        )
      : await listLinkedOrgMemberContacts(orgId)
    const resolvedMembers = memberContacts.filter((m) => m.uid !== user.uid)
    const visibleMembers = includeAdminUsers
      ? resolvedMembers
      : resolvedMembers.filter((member) => member.role !== 'admin')
    contacts.push(...visibleMembers)

    const existingUids = new Set(contacts.map((c) => c.uid))
    const platformAdmins = (await listPlatformAdmins())
      .filter((admin) => admin.uid !== user.uid && !existingUids.has(admin.uid) && includePiBTeamUsers)
    contacts.push(...platformAdmins)
  }

  return { ok: true, people: contacts }
}
