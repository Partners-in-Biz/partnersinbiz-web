/**
 * PATCH /api/v1/organizations/[id]/members/[userId] — update member role
 * DELETE /api/v1/organizations/[id]/members/[userId] — remove a member
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { logActivity } from '@/lib/activity/log'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import type { Organization, OrgRole } from '@/lib/organizations/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string; userId: string }> }

export const PATCH = withAuth('admin', async (req, user, ctx) => {
  const { id, userId: targetUserId } = await (ctx as Params).params
  if (!canAccessOrg(user, id)) return apiError('Forbidden', 403)

  // Parse request body
  const body = await req.json().catch(() => ({}))
  const newRole = body.role as OrgRole | undefined

  if (!newRole) return apiError('role is required', 400)

  // Validate role
  const validRoles: OrgRole[] = ['owner', 'admin', 'member', 'viewer']
  if (!validRoles.includes(newRole)) {
    return apiError(`role must be one of: ${validRoles.join(', ')}`, 400)
  }

  // Fetch organization
  const orgDoc = await adminDb.collection('organizations').doc(id).get()
  if (!orgDoc.exists) return apiError('Organisation not found', 404)

  const org = orgDoc.data() as Organization
  const members = org.members ?? []

  // Find the member
  const memberIndex = members.findIndex((m) => m.userId === targetUserId)
  if (memberIndex === -1) return apiError('User is not a member', 404)

  const member = members[memberIndex]

  // Check if trying to demote the last owner
  if (member.role === 'owner' && newRole !== 'owner') {
    const remainingOwners = members.filter((m) => m.role === 'owner' && m.userId !== targetUserId)
    if (remainingOwners.length === 0) {
      return apiError('Cannot demote the last owner. Assign another owner first.', 409)
    }
  }

  // Update the member role
  const updatedMembers = [...members]
  updatedMembers[memberIndex] = {
    ...member,
    role: newRole,
  }

  await adminDb.collection('organizations').doc(id).update({
    members: updatedMembers,
    updatedAt: FieldValue.serverTimestamp(),
  })

  await adminDb.collection('orgMembers').doc(`${id}_${targetUserId}`).set(
    {
      orgId: id,
      uid: targetUserId,
      role: newRole,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )

  return apiSuccess({ ...updatedMembers[memberIndex] }, 200)
})

export const DELETE = withAuth('admin', async (req, user, ctx) => {
  const { id, userId: targetUserId } = await (ctx as Params).params
  if (!canAccessOrg(user, id)) return apiError('Forbidden', 403)

  // Fetch organization
  const orgDoc = await adminDb.collection('organizations').doc(id).get()
  if (!orgDoc.exists) return apiError('Organisation not found', 404)

  const org = orgDoc.data() as Organization
  const members = org.members ?? []
  const userRef = adminDb.collection('users').doc(targetUserId)
  const userDoc = await userRef.get()
  const userData = userDoc.exists ? userDoc.data() ?? {} : {}
  const userOrgIds = Array.isArray(userData.orgIds)
    ? userData.orgIds.filter((orgId: unknown): orgId is string => typeof orgId === 'string' && orgId.trim().length > 0)
    : []
  const userLinkedToOrg =
    userOrgIds.includes(id) ||
    userData.orgId === id ||
    userData.activeOrgId === id

  // Find the member
  const memberIndex = members.findIndex((m) => m.userId === targetUserId)
  if (memberIndex === -1 && !userLinkedToOrg) return apiError('User is not a member', 404)

  const member = memberIndex >= 0 ? members[memberIndex] : null

  if (member) {
    // Prevent removing the last owner
    if (member.role === 'owner') {
      const remainingOwners = members.filter((m) => m.role === 'owner' && m.userId !== targetUserId)
      if (remainingOwners.length === 0) {
        return apiError('Cannot remove the last owner. Assign another owner first.', 409)
      }
    }

    // Remove the member from the organization's embedded member list.
    const updatedMembers = members.filter((m) => m.userId !== targetUserId)

    await adminDb.collection('organizations').doc(id).update({
      members: updatedMembers,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }

  if (userDoc.exists) {
    const remainingOrgIds = Array.from(new Set([
      ...userOrgIds,
      ...(typeof userData.orgId === 'string' && userData.orgId.trim() ? [userData.orgId.trim()] : []),
      ...(typeof userData.activeOrgId === 'string' && userData.activeOrgId.trim() ? [userData.activeOrgId.trim()] : []),
    ])).filter((orgId) => orgId !== id)

    const userUpdates: Record<string, unknown> = {
      orgIds: remainingOrgIds,
      updatedAt: FieldValue.serverTimestamp(),
    }
    if (userData.orgId === id) {
      userUpdates.orgId = remainingOrgIds[0] ?? FieldValue.delete()
    }
    if (userData.activeOrgId === id) {
      userUpdates.activeOrgId = remainingOrgIds[0] ?? FieldValue.delete()
    }
    await userRef.set(userUpdates, { merge: true })
  }

  await adminDb.collection('orgMembers').doc(`${id}_${targetUserId}`).delete().catch(() => undefined)

  logActivity({
    orgId: id,
    type: 'org_member_removed',
    actorId: user.uid,
    actorName: user.uid,
    actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
    description: 'Removed member from organization',
    entityId: targetUserId,
    entityType: 'organization',
  }).catch(() => {})

  return apiSuccess({ removed: true, userId: targetUserId, cleanedStaleLink: !member })
})
