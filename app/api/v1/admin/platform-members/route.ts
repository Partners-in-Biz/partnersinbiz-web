/**
 * GET /api/v1/admin/platform-members
 *
 * Lists client-login users and the client organisations they are linked to.
 * This is super-admin only because it exposes cross-client identity data.
 */
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
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

const VALID_ORG_ROLES: OrgRole[] = ['owner', 'admin', 'member', 'viewer']

export const POST = withAuth('admin', async (req, user) => {
  if (!isSuperAdmin(user)) {
    return apiError('Only super admins can create platform members', 403)
  }

  const body = await req.json().catch(() => ({}))
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
  const role = (typeof body.role === 'string' ? body.role : 'member') as OrgRole

  if (!email) return apiError('email is required', 400)
  if (!name) return apiError('name is required', 400)
  if (!orgId) return apiError('orgId is required', 400)
  if (password.length < 8) return apiError('password must be at least 8 characters', 400)
  if (!VALID_ORG_ROLES.includes(role)) {
    return apiError(`role must be one of: ${VALID_ORG_ROLES.join(', ')}`, 400)
  }

  const orgRef = adminDb.collection('organizations').doc(orgId)
  const orgDoc = await orgRef.get()
  if (!orgDoc.exists) return apiError('Organisation not found', 404)
  const org = orgDoc.data() as Organization
  if (org.active === false || org.status === 'churned') {
    return apiError('Cannot add members to an inactive organisation', 400)
  }

  let uid: string
  let createdAuthUser = false
  try {
    const existing = await adminAuth.getUserByEmail(email)
    uid = existing.uid
  } catch (err: unknown) {
    const code = (err as { code?: string } | null)?.code
    if (code !== 'auth/user-not-found') throw err
    const created = await adminAuth.createUser({ email, displayName: name, password })
    uid = created.uid
    createdAuthUser = true
  }

  const alreadyMember = (org.members ?? []).some((member) => member.userId === uid)
  if (alreadyMember) {
    if (createdAuthUser) {
      await adminAuth.deleteUser(uid).catch(() => undefined)
    }
    return apiError('This user is already a member of this organisation', 409)
  }

  if (!createdAuthUser) {
    await adminAuth.updateUser(uid, { displayName: name, password })
  }

  const userRef = adminDb.collection('users').doc(uid)
  const existingUserDoc = await userRef.get()
  const existingUser = existingUserDoc.data() ?? {}
  const existingRole = typeof existingUser.role === 'string' ? existingUser.role : undefined
  if (existingRole && existingRole !== 'client') {
    if (createdAuthUser) {
      await adminAuth.deleteUser(uid).catch(() => undefined)
    }
    return apiError(
      `A user with this email already exists as role "${existingRole}". Resolve that account first.`,
      409,
    )
  }

  const existingOrgIds = stringArray(existingUser.orgIds)
  const primaryOrgId = typeof existingUser.orgId === 'string' ? existingUser.orgId : undefined
  if (primaryOrgId && !existingOrgIds.includes(primaryOrgId)) existingOrgIds.unshift(primaryOrgId)
  if (!existingOrgIds.includes(orgId)) existingOrgIds.push(orgId)

  await userRef.set(
    {
      uid,
      email,
      displayName: name,
      role: 'client',
      orgId: primaryOrgId ?? orgId,
      orgIds: existingOrgIds,
      createdAt: existingUserDoc.exists ? existingUser.createdAt ?? FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )

  await orgRef.update({
    members: [
      ...(org.members ?? []),
      {
        userId: uid,
        role,
        joinedAt: Timestamp.now(),
        invitedBy: user.uid,
      },
    ],
    updatedAt: FieldValue.serverTimestamp(),
  })

  await adminDb
    .collection('orgMembers')
    .doc(`${orgId}_${uid}`)
    .set(
      {
        orgId,
        uid,
        firstName: name.split(' ')[0] ?? '',
        lastName: name.split(' ').slice(1).join(' '),
        jobTitle: '',
        phone: '',
        avatarUrl: '',
        role,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )

  return apiSuccess(
    {
      uid,
      email,
      displayName: name,
      role,
      orgId,
    },
    201,
  )
})
