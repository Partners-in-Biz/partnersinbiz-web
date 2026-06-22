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
  try {
    await adminAuth.getUser(uid)
  } catch {
    return apiError('User not found', 404)
  }

  // Prevent admins from impersonating themselves (confusing UX, not a security
  // issue but a usability guardrail)
  if (uid === user.uid) {
    return apiError('Cannot impersonate yourself', 400)
  }

  const customToken = await adminAuth.createCustomToken(uid, {
    impersonatedBy: user.uid,
    impersonatedAt: new Date().toISOString(),
  })

  return apiSuccess({ customToken })
})
