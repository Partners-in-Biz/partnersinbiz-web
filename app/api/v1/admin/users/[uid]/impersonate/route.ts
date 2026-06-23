/**
 * POST /api/v1/admin/users/[uid]/impersonate
 *
 * Generates a Firebase custom token for the target user so an admin can
 * sign in as them (US-255 — User impersonation).
 *
 * Super admins only. The token is short-lived (1 hour) and must be exchanged
 * for an ID token via signInWithCustomToken on the client.
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

export const POST = withAuth('admin', async (_req: NextRequest, user, context?: Params) => {
  if (!isSuperAdmin(user)) {
    return apiError('Only super admins can impersonate users', 403)
  }

  const { uid } = await (context as Params).params

  if (!uid || typeof uid !== 'string') {
    return apiError('uid is required', 400)
  }

  // Verify the target user exists before issuing a token
  let authUser
  try {
    authUser = await adminAuth.getUser(uid)
  } catch {
    return apiError('User not found', 404)
  }

  // Prevent admins from impersonating themselves (confusing UX, not a security
  // issue but a usability guardrail)
  if (uid === user.uid) {
    return apiError('Cannot impersonate yourself', 400)
  }

  // US-255: refuse to impersonate another super admin. Resolving onto another
  // super admin's session would hand the impersonator unrestricted access in
  // a way that bypasses the audit trail's intent.
  const meta = await resolveTargetMeta(uid)
  if (meta.isSuperAdmin) {
    return apiError('Cannot impersonate another super admin', 403)
  }

  const customToken = await adminAuth.createCustomToken(uid, {
    impersonatedBy: user.uid,
    impersonatedAt: new Date().toISOString(),
  })

  await writeAdminAudit(user, {
    action: 'user.impersonate',
    targetUid: uid,
    orgId: meta.allowedOrgIds[0] ?? null,
    summary: `Impersonated user ${authUser.email ?? uid}`,
    metadata: { email: authUser.email ?? null, targetRole: meta.role },
  })

  return apiSuccess({ customToken, targetEmail: authUser.email ?? null })
})
