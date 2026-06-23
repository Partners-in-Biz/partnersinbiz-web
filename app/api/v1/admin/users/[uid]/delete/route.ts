/**
 * DELETE (or POST) /api/v1/admin/users/[uid]/delete
 *
 * Permanently delete a Firebase Auth user and soft-mark their Firestore
 * users/{uid} doc as deleted (US-254). Super admins only.
 *
 * Guards:
 *   - cannot delete yourself
 *   - cannot delete another super admin (role === 'admin' with no allowedOrgIds)
 *
 * Audits `user.delete`.
 */
import { NextRequest } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { writeAdminAudit } from '@/lib/admin/audit'
import type { ApiUser } from '@/lib/api/types'
import { resolveTargetMeta } from '../_guard'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ uid: string }> }

async function handle(_req: NextRequest, user: ApiUser, context?: Params) {
  if (!isSuperAdmin(user)) {
    return apiError('Only super admins can delete users', 403)
  }

  const { uid } = await (context as Params).params
  if (!uid || typeof uid !== 'string') {
    return apiError('uid is required', 400)
  }

  if (uid === user.uid) {
    return apiError('Cannot delete your own account', 400)
  }

  let authUser
  try {
    authUser = await adminAuth.getUser(uid)
  } catch {
    return apiError('User not found', 404)
  }

  const meta = await resolveTargetMeta(uid)
  if (meta.isSuperAdmin) {
    return apiError('Cannot delete another super admin', 403)
  }

  // Soft-mark the Firestore doc before removing the auth record so any audit
  // / lookup tooling can still resolve who the deleted uid was.
  try {
    await adminDb.collection('users').doc(uid).set(
      {
        deleted: true,
        deletedAt: FieldValue.serverTimestamp(),
        deletedBy: user.uid,
      },
      { merge: true },
    )
  } catch (err) {
    console.error('[user.delete] failed to soft-mark Firestore doc', uid, err)
  }

  await adminAuth.deleteUser(uid)

  await writeAdminAudit(user, {
    action: 'user.delete',
    targetUid: uid,
    orgId: meta.allowedOrgIds[0] ?? null,
    summary: `Deleted user ${authUser.email ?? uid}`,
    metadata: { email: authUser.email ?? null, targetRole: meta.role },
  })

  return apiSuccess({ uid, deleted: true })
}

export const DELETE = withAuth('admin', handle)
export const POST = withAuth('admin', handle)
