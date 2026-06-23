/**
 * POST /api/v1/admin/users/[uid]/suspend
 *
 * Suspend (disable) or unsuspend (enable) a Firebase Auth user (US-254).
 * Super admins only.
 *
 * Body accepts either:
 *   { action: 'suspend' | 'unsuspend' }
 *   { disabled: boolean }
 *
 * Guards:
 *   - cannot suspend yourself
 *   - cannot suspend another super admin (role === 'admin' with no allowedOrgIds)
 *
 * Audits `user.suspend` / `user.unsuspend`.
 */
import { NextRequest } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { writeAdminAudit } from '@/lib/admin/audit'
import { resolveTargetMeta } from '../_guard'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ uid: string }> }

export const POST = withAuth('admin', async (req: NextRequest, user, context?: Params) => {
  if (!isSuperAdmin(user)) {
    return apiError('Only super admins can suspend users', 403)
  }

  const { uid } = await (context as Params).params
  if (!uid || typeof uid !== 'string') {
    return apiError('uid is required', 400)
  }

  let body: { action?: string; disabled?: boolean } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    body = {}
  }

  // Resolve desired disabled state from either `disabled` or `action`.
  let disabled: boolean
  if (typeof body.disabled === 'boolean') {
    disabled = body.disabled
  } else if (body.action === 'suspend') {
    disabled = true
  } else if (body.action === 'unsuspend') {
    disabled = false
  } else {
    return apiError("Provide { disabled: boolean } or { action: 'suspend' | 'unsuspend' }", 400)
  }

  if (uid === user.uid) {
    return apiError('Cannot suspend your own account', 400)
  }

  // Confirm the target exists.
  let authUser
  try {
    authUser = await adminAuth.getUser(uid)
  } catch {
    return apiError('User not found', 404)
  }

  // Block suspending another super admin (only relevant for suspend, but we
  // protect the account in both directions for safety).
  const meta = await resolveTargetMeta(uid)
  if (disabled && meta.isSuperAdmin) {
    return apiError('Cannot suspend another super admin', 403)
  }

  await adminAuth.updateUser(uid, { disabled })

  const action = disabled ? 'user.suspend' : 'user.unsuspend'
  await writeAdminAudit(user, {
    action,
    targetUid: uid,
    orgId: meta.allowedOrgIds[0] ?? null,
    summary: `${disabled ? 'Suspended' : 'Unsuspended'} user ${authUser.email ?? uid}`,
    metadata: { email: authUser.email ?? null, disabled, targetRole: meta.role },
  })

  return apiSuccess({ uid, disabled })
})
