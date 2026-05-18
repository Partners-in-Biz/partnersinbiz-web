/**
 * POST /api/v1/admin/platform-users/[uid]/reset
 *
 * Generates a Firebase password-reset link for an internal platform user.
 */
import { NextRequest } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ uid: string }> }

export const POST = withAuth('admin', async (_req: NextRequest, user, ctx) => {
  if (!isSuperAdmin(user)) return apiError('Only super admins can reset platform user passwords', 403)
  const { uid } = await (ctx as Params).params

  const doc = await adminDb.collection('users').doc(uid).get()
  if (!doc.exists) return apiError('User not found', 404)
  const data = doc.data() ?? {}
  if (data.role !== 'admin') return apiError('Not a platform admin', 404)

  const email = typeof data.email === 'string' ? data.email : ''
  if (!email) return apiError('Platform user has no email address', 400)

  await adminAuth.getUser(uid)

  const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://partnersinbiz.online'
  const firebaseLink = await adminAuth.generatePasswordResetLink(email, {
    url: `${BASE_URL}/admin`,
  })
  const setupLink = `${BASE_URL}/auth/reset?link=${encodeURIComponent(firebaseLink)}`

  return apiSuccess({ uid, email, setupLink })
})
