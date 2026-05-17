/**
 * GET /api/v1/admin/platform-members
 *
 * Lists client-login users and the client organisations they are linked to.
 * This is super-admin only because it exposes cross-client identity data.
 */
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import type { Organization, OrgRole } from '@/lib/organizations/types'

export const dynamic = 'force-dynamic'

interface LinkedClientOrg {
  id: string
  name: string
  slug: string
  role?: OrgRole
  source: 'membership' | 'user'
}

export interface PlatformMemberView {
  uid: string
  email: string
  displayName: string
  role: 'client'
  orgId?: string
  orgIds: string[]
  linkedOrgs: LinkedClientOrg[]
  authFound: boolean
  emailVerified?: boolean
  disabled?: boolean
  lastSignInTime?: string | null
  createdAt?: unknown
  updatedAt?: unknown
}

function stringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  for (const item of input) {
    if (typeof item !== 'string') continue
    const value = item.trim()
    if (value && !out.includes(value)) out.push(value)
  }
  return out
}

export const GET = withAuth('admin', async (_req, user) => {
  if (!isSuperAdmin(user)) {
    return apiError('Only super admins can list platform members', 403)
  }

  const [usersSnap, orgsSnap] = await Promise.all([
    adminDb.collection('users').where('role', '==', 'client').get(),
    adminDb.collection('organizations').where('active', '==', true).get(),
  ])

  const orgsById = new Map<string, Organization & { id: string }>()
  const membershipsByUid = new Map<string, LinkedClientOrg[]>()

  for (const doc of orgsSnap.docs) {
    const org = { id: doc.id, ...(doc.data() as Organization) }
    orgsById.set(doc.id, org)
    for (const member of org.members ?? []) {
      if (!member?.userId) continue
      const existing = membershipsByUid.get(member.userId) ?? []
      existing.push({
        id: doc.id,
        name: org.name,
        slug: org.slug,
        role: member.role,
        source: 'membership',
      })
      membershipsByUid.set(member.userId, existing)
    }
  }

  const authResults = await Promise.allSettled(
    usersSnap.docs.map((doc) => adminAuth.getUser(doc.id)),
  )

  const members: PlatformMemberView[] = usersSnap.docs.map((doc, i) => {
    const data = doc.data() ?? {}
    const authUser = authResults[i].status === 'fulfilled' ? authResults[i].value : null
    const orgIds = stringArray(data.orgIds)
    const primaryOrgId = typeof data.orgId === 'string' ? data.orgId : undefined
    if (primaryOrgId && !orgIds.includes(primaryOrgId)) orgIds.unshift(primaryOrgId)

    const linked = new Map<string, LinkedClientOrg>()
    for (const org of membershipsByUid.get(doc.id) ?? []) linked.set(org.id, org)
    for (const orgId of orgIds) {
      if (linked.has(orgId)) continue
      const org = orgsById.get(orgId)
      linked.set(orgId, {
        id: orgId,
        name: org?.name ?? orgId,
        slug: org?.slug ?? orgId,
        source: 'user',
      })
    }

    const email = typeof data.email === 'string' ? data.email : authUser?.email ?? ''
    const displayName =
      typeof data.displayName === 'string' ? data.displayName : authUser?.displayName ?? ''

    return {
      uid: doc.id,
      email,
      displayName,
      role: 'client',
      orgId: primaryOrgId,
      orgIds,
      linkedOrgs: Array.from(linked.values()).sort((a, b) => a.name.localeCompare(b.name)),
      authFound: Boolean(authUser),
      emailVerified: authUser?.emailVerified,
      disabled: authUser?.disabled,
      lastSignInTime: authUser?.metadata?.lastSignInTime ?? null,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    }
  })

  members.sort((a, b) => {
    const aName = a.displayName || a.email
    const bName = b.displayName || b.email
    return aName.localeCompare(bName)
  })

  return apiSuccess(members, 200, {
    total: members.length,
    page: 1,
    limit: members.length,
  })
})
