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
import type { Organization, OrgMember } from '@/lib/organizations/types'
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

export const GET = withAuth(
  'client',
  async (_req: NextRequest, user: ApiUser, context?: unknown) => {
    const { orgId: orgIdParam } = await (context as Params).params
    const scope = resolveOrgScope(user, orgIdParam)
    if (!scope.ok) return apiError(scope.error, scope.status)

    const callerIsAdmin = user.role === 'admin' || user.role === 'ai'

    const contacts: ContactEntry[] = []
    const orgDoc = await adminDb.collection('organizations').doc(scope.orgId).get()
    if (!orgDoc.exists) return apiError('Organisation not found', 404)
    const org = orgDoc.data() as Organization
    const members: OrgMember[] = org.members ?? []

    if (callerIsAdmin) {
      // Admin: return all org members with their Firestore user details
      const resolved = await Promise.all(
        members.map(async (m) => {
          const details = await fetchUserDetails(m.userId)
          // Treat org member roles (owner/admin/member/viewer) as admin vs client
          const contactRole: 'admin' | 'client' =
            m.role === 'owner' || m.role === 'admin' ? 'admin' : 'client'
          return {
            uid: m.userId,
            role: contactRole,
            ...details,
          } as ContactEntry
        }),
      )
      contacts.push(...resolved)
    } else {
      const resolvedMembers = await Promise.all(
        members
          .filter((m) => m.userId !== user.uid)
          .map(async (m) => {
            const details = await fetchUserDetails(m.userId)
            const contactRole: 'admin' | 'client' =
              m.role === 'owner' || m.role === 'admin' ? 'admin' : 'client'
            return { uid: m.userId, role: contactRole, ...details } as ContactEntry
          }),
      )
      contacts.push(...resolvedMembers)

      const existingUids = new Set(contacts.map((c) => c.uid))
      contacts.push(...(await listPlatformAdmins()).filter((a) => a.uid !== user.uid && !existingUids.has(a.uid)))
    }

    return apiSuccess(contacts)
  },
)
