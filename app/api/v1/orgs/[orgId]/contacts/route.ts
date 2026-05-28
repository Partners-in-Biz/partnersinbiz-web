/**
 * GET /api/v1/orgs/[orgId]/contacts
 *
 * Auth: admin or client
 * Returns: users the caller may start or add to a conversation.
 *
 * Admin callers:
 *   → all org members (from organizations/{orgId}.members)
 *
 * Client callers:
 *   → all org members
 *   → PiB platform super-admins
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'
import type { Organization, OrgMember, OrgRole } from '@/lib/organizations/types'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ orgId: string }> }

interface ContactEntry {
  uid: string
  displayName?: string
  email?: string
  role: 'admin' | 'client'
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

async function listPlatformAdmins(): Promise<ContactEntry[]> {
  const superAdminSnap = await adminDb
    .collection('users')
    .where('role', '==', 'admin')
    .get()

  return superAdminSnap.docs
    .filter((d) => {
      const data = d.data()
      const orgId = data.orgId
      return orgId === undefined || orgId === null || orgId === ''
    })
    .map((d) => {
      const data = d.data()
      return {
        uid: d.id,
        role: 'admin' as const,
        displayName: data.displayName as string | undefined,
        email: data.email as string | undefined,
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

async function listLinkedOrgMemberContacts(orgId: string): Promise<ContactEntry[]> {
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
      photoURL: cleanString(data.avatarUrl) || cleanString(data.photoURL) || details.photoURL,
    } as ContactEntry
  }))

  return contacts.filter((contact): contact is ContactEntry => Boolean(contact))
}

function dedupeContacts(contacts: ContactEntry[]): ContactEntry[] {
  const seen = new Set<string>()
  return contacts.filter((contact) => {
    if (seen.has(contact.uid)) return false
    seen.add(contact.uid)
    return true
  })
}

export const GET = withAuth(
  'client',
  async (_req: NextRequest, user: ApiUser, context?: unknown) => {
    const { orgId: orgIdParam } = await (context as Params).params
    const scope = resolveOrgScope(user, orgIdParam)
    if (!scope.ok) return apiError(scope.error, scope.status)

    const callerIsAdmin = user.role === 'admin' || user.role === 'ai'

    if (scope.orgId === PIB_PLATFORM_ORG_ID && callerIsAdmin) {
      const contacts = dedupeContacts([
        ...(await listPlatformAdmins()),
        ...(await listLinkedOrgMemberContacts(scope.orgId)),
      ]).filter((admin) => admin.uid !== user.uid)
      return apiSuccess(contacts)
    }

    const contacts: ContactEntry[] = []
    const orgDoc = await adminDb.collection('organizations').doc(scope.orgId).get()
    if (!orgDoc.exists) return apiError('Organisation not found', 404)
    const org = orgDoc.data() as Organization
    const members: OrgMember[] = org.members ?? []

    if (callerIsAdmin) {
      // Admin: return all org members with their Firestore user details
      const resolved = members.length > 0
        ? await Promise.all(
            members.map(async (m) => {
              const details = await fetchUserDetails(m.userId)
              return {
                uid: m.userId,
                role: contactRoleFromOrgRole(m.role),
                ...details,
              } as ContactEntry
            }),
          )
        : await listLinkedOrgMemberContacts(scope.orgId)
      contacts.push(...resolved)
    } else {
      const memberContacts = members.length > 0
        ? await Promise.all(
            members.map(async (m) => {
              const details = await fetchUserDetails(m.userId)
              return { uid: m.userId, role: contactRoleFromOrgRole(m.role), ...details } as ContactEntry
            }),
          )
        : await listLinkedOrgMemberContacts(scope.orgId)
      const resolvedMembers = memberContacts.filter((m) => m.uid !== user.uid)
      contacts.push(...resolvedMembers)

      const existingUids = new Set(contacts.map((c) => c.uid))
      contacts.push(...(await listPlatformAdmins()).filter((a) => a.uid !== user.uid && !existingUids.has(a.uid)))
    }

    return apiSuccess(contacts)
  },
)
