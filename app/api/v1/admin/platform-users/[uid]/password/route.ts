/**
 * PATCH /api/v1/admin/platform-users/[uid]/password
 *
 * Allows a super admin to set an internal platform user's Firebase Auth password.
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ uid: string }> }

export const PATCH = withAuth('admin', async (req: NextRequest, user, ctx) => {
  if (!isSuperAdmin(user)) return apiError('Only super admins can set platform user passwords', 403)
  const { uid } = await (ctx as Params).params

  const body = await req.json().catch(() => ({}))
  const password = typeof body.password === 'string' ? body.password : ''
  if (password.length < 8) return apiError('Password must be at least 8 characters', 400)

  const ref = adminDb.collection('users').doc(uid)
  const doc = await ref.get()
  if (!doc.exists) return apiError('User not found', 404)
  if (doc.data()?.role !== 'admin') return apiError('Not a platform admin', 404)

  await adminAuth.updateUser(uid, { password })
  await ref.set({ updatedAt: FieldValue.serverTimestamp() }, { merge: true })

  return apiSuccess({ uid, passwordUpdated: true })
})
