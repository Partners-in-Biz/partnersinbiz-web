/**
 * GET  /api/v1/organizations/[id]/members/client — search existing client users
 * POST /api/v1/organizations/[id]/members/client — add an existing client user
 */
import { NextRequest } from 'next/server'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { apiSuccess, apiError } from '@/lib/api/response'
import { logActivity } from '@/lib/activity/log'
import type { Organization, OrgMember } from '@/lib/organizations/types'
import { ACCESS_SCOPE_OPTIONS, parseMemberMetadata } from '@/lib/organizations/memberMetadata'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

interface ClientUserData {
  displayName?: string
  email?: string
  photoURL?: string
  role?: string
  orgId?: string
  orgIds?: unknown
}

function normalizeOrgIds(userData: ClientUserData, orgId: string): string[] {
  const ids = new Set<string>()

  if (Array.isArray(userData.orgIds)) {
    for (const id of userData.orgIds) {
      if (typeof id === 'string' && id.trim()) ids.add(id.trim())
    }
  }

  if (typeof userData.orgId === 'string' && userData.orgId.trim()) {
    ids.add(userData.orgId.trim())
  }

  ids.add(orgId)
  return Array.from(ids)
}

async function loadOrg(id: string) {
  const orgDoc = await adminDb.collection('organizations').doc(id).get()
  if (!orgDoc.exists) return null
  return orgDoc.data() as Organization
}

export const GET = withAuth('admin', async (req: NextRequest, user, ctx) => {
  const { id } = await (ctx as Params).params

  if (!canAccessOrg(user, id)) return apiError('Forbidden', 403)

  const org = await loadOrg(id)
  if (!org) return apiError('Organisation not found', 404)

  const q = req.nextUrl.searchParams.get('q')?.trim().toLowerCase() ?? ''
  if (q.length < 2) {
    return apiSuccess([], 200, { total: 0, page: 1, limit: 0 })
  }

  const existingMemberIds = new Set((org.members ?? []).map((m) => m.userId))
  const userSnapshot = await adminDb
    .collection('users')
    .where('role', '==', 'client')
    .get()

  const matches = userSnapshot.docs
    .map((doc) => {
      const data = doc.data() as ClientUserData
      return {
        uid: doc.id,
        email: data.email ?? '',
        displayName: data.displayName ?? data.email ?? 'Client',
        photoURL: data.photoURL,
      }
    })
    .filter((client) => !existingMemberIds.has(client.uid))
    .filter((client) => {
      const email = client.email.toLowerCase()
      const displayName = client.displayName.toLowerCase()
      return email.includes(q) || displayName.includes(q)
    })
    .slice(0, 20)

  return apiSuccess(matches, 200, {
    total: matches.length,
    page: 1,
    limit: 20,
  })
})

export const POST = withAuth('admin', async (req: NextRequest, user, ctx) => {
  const { id } = await (ctx as Params).params

  if (!canAccessOrg(user, id)) return apiError('Forbidden', 403)

  const body = await req.json().catch(() => ({}))
  const uid = typeof body.uid === 'string' ? body.uid.trim() : ''
  const role = typeof body.role === 'string' ? body.role.trim() : 'member'
  const memberMetadata = parseMemberMetadata(body)

  if (!uid) return apiError('uid is required', 400)

  const validRoles = ['admin', 'member', 'viewer']
  if (!validRoles.includes(role)) {
    return apiError(`role must be one of: ${validRoles.join(', ')}`, 400)
  }
  if (typeof body.accessScope === 'string' && !ACCESS_SCOPE_OPTIONS.includes(body.accessScope as never)) {
    return apiError(`accessScope must be one of: ${ACCESS_SCOPE_OPTIONS.join(', ')}`, 400)
  }

  const org = await loadOrg(id)
  if (!org) return apiError('Organisation not found', 404)

  const alreadyMember = (org.members ?? []).some((m) => m.userId === uid)
  if (alreadyMember) {
    return apiError('User is already a member of this organisation', 409)
  }

  const userRef = adminDb.collection('users').doc(uid)
  const userDoc = await userRef.get()
  if (!userDoc.exists) {
    return apiError('Client user not found', 404)
  }

  const userData = userDoc.data() as ClientUserData
  if (userData.role !== 'client') {
    return apiError('Only client users can be added through this flow', 400)
  }

  const newMember: OrgMember = {
    userId: uid,
    role: role as OrgMember['role'],
    joinedAt: Timestamp.now(),
    invitedBy: user.uid,
    ...memberMetadata,
  }

  const updatedMembers = [...(org.members ?? []), newMember]
  await adminDb.collection('organizations').doc(id).update({
    members: updatedMembers,
    updatedAt: FieldValue.serverTimestamp(),
  })

  await userRef.set(
    {
      orgIds: normalizeOrgIds(userData, id),
      ...(userData.orgId ? {} : { orgId: id }),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )

  const [firstName = '', ...lastNameParts] = (userData.displayName ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  await adminDb.collection('orgMembers').doc(`${id}_${uid}`).set(
    {
      orgId: id,
      uid,
      firstName,
      lastName: lastNameParts.join(' '),
      avatarUrl: userData.photoURL ?? '',
      role,
      ...memberMetadata,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )

  logActivity({
    orgId: id,
    type: 'org_member_added',
    actorId: user.uid,
    actorName: user.uid,
    actorRole: user.role === 'ai' ? 'ai' : 'admin',
    description: 'Added existing client to organization',
    entityId: uid,
    entityType: 'organization',
  }).catch(() => {})

  return apiSuccess(
    {
      ...newMember,
      displayName: userData.displayName,
      email: userData.email,
      photoURL: userData.photoURL,
    },
    201,
  )
})
