/**
 * GET  /api/v1/organizations/[id]/members — list members with user details
 * POST /api/v1/organizations/[id]/members — add a member by email
 */
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb, adminAuth } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { logActivity } from '@/lib/activity/log'
import type { Organization, OrgMember, OrgRole } from '@/lib/organizations/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

interface MemberWithDetails extends OrgMember {
  displayName?: string
  email?: string
  photoURL?: string
}

type StoredMember = OrgMember & {
  uid?: string
  displayName?: string
  email?: string
  photoURL?: string
}

function splitName(displayName: string) {
  const [firstName = '', ...rest] = displayName.trim().split(/\s+/).filter(Boolean)
  return { firstName, lastName: rest.join(' ') }
}

export const GET = withAuth('admin', async (req, user, ctx) => {
  const { id } = await (ctx as Params).params

  // Fetch organization
  const orgDoc = await adminDb.collection('organizations').doc(id).get()
  if (!orgDoc.exists) return apiError('Organisation not found', 404)

  const org = orgDoc.data() as Organization
  const members = (org.members ?? []) as StoredMember[]

  // Fetch user details for each member — embedded details, Firestore, then Auth fallback.
  // Some older records used `uid` instead of `userId`, which made the UI render "Unknown".
  const membersWithDetails: MemberWithDetails[] = await Promise.all(
    members.map(async (member) => {
      const userId = member.userId || member.uid || ''
      const userDoc = userId ? await adminDb.collection('users').doc(userId).get() : null
      const userData = userDoc?.data()

      let displayName = (member.displayName || userData?.displayName) as string | undefined
      let email = (member.email || userData?.email) as string | undefined
      const photoURL = (member.photoURL || userData?.photoURL) as string | undefined

      // Fall back to Firebase Auth when the Firestore doc is missing or incomplete
      if (userId && (!displayName || !email)) {
        try {
          const authUser = await adminAuth.getUser(userId)
          displayName = displayName || authUser.displayName || undefined
          email = email || authUser.email || undefined
        } catch {
          // user may not exist in Auth either — leave undefined
        }
      }

      return { ...member, userId, displayName, email, photoURL }
    }),
  )

  return apiSuccess(membersWithDetails, 200, {
    total: membersWithDetails.length,
    page: 1,
    limit: membersWithDetails.length,
  })
})

export const POST = withAuth('admin', async (req, user, ctx) => {
  const { id } = await (ctx as Params).params

  // Parse request body
  const body = await req.json().catch(() => ({}))
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const role = body.role ?? 'member'

  if (!email) return apiError('email is required', 400)

  // Validate role
  const validRoles = ['owner', 'admin', 'member', 'viewer']
  if (!validRoles.includes(role)) {
    return apiError(`role must be one of: ${validRoles.join(', ')}`, 400)
  }

  // Fetch organization
  const orgDoc = await adminDb.collection('organizations').doc(id).get()
  if (!orgDoc.exists) return apiError('Organisation not found', 404)

  const org = orgDoc.data() as Organization

  // Look up user by email
  const userSnapshot = await adminDb
    .collection('users')
    .where('email', '==', email)
    .get()

  if (userSnapshot.empty) {
    return apiError(
      'User not found — they must have a PIB account first',
      404,
    )
  }

  const userDoc = userSnapshot.docs[0]
  const userId = userDoc.id
  const userData = userDoc.data()

  // Check if already a member
  const alreadyMember = (org.members ?? []).some((m) => m.userId === userId)
  if (alreadyMember) {
    return apiError('User is already a member of this organisation', 409)
  }

  // Add member
  const newMember: OrgMember = {
    userId,
    role: role as OrgRole,
    joinedAt: Timestamp.now(),
    invitedBy: user.uid,
  }

  const updatedMembers = [...(org.members ?? []), newMember]
  await adminDb.collection('organizations').doc(id).update({
    members: updatedMembers,
    updatedAt: FieldValue.serverTimestamp(),
  })

  // Mirror orgId onto the user doc so resolveOrgScope finds it without an
  // extra membership query. If the user already belongs to another org,
  // their existing orgId is preserved (multi-org membership not supported
  // in Phase 3 — first-org-bound).
  if (!userData.orgId) {
    try {
      await adminDb.collection('users').doc(userId).set(
        { orgId: id, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      )
    } catch (err) {
      console.error('[members.add] failed to mirror orgId on user doc', err)
    }
  }

  const displayName = (userData.displayName as string | undefined) ?? ''
  const { firstName, lastName } = splitName(displayName)
  await adminDb.collection('orgMembers').doc(`${id}_${userId}`).set(
    {
      orgId: id,
      uid: userId,
      firstName,
      lastName,
      avatarUrl: userData.photoURL ?? '',
      role,
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
    actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
    description: 'Added member to organization',
    entityId: userId,
    entityType: 'organization',
  }).catch(() => {})

  // Return the new member with details
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
