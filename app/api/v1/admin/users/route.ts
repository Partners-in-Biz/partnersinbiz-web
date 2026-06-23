/**
 * GET /api/v1/admin/users
 *
 * Lists all Firebase Auth users for the impersonation / user management page
 * (US-255). Super admins only.
 *
 * Returns the first 1 000 users from Firebase Auth with their Firestore role
 * and linked org where available.
 */
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'

export interface AdminUserView {
  uid: string
  email: string
  displayName: string
  role: string
  orgId: string | null
  createdAt: string | null
  lastSignInTime: string | null
  disabled: boolean
  emailVerified: boolean
}

export const GET = withAuth('admin', async (_req, user) => {
  if (!isSuperAdmin(user)) {
    return apiError('Only super admins can list all users', 403)
  }

  // Fetch up to 1 000 users from Firebase Auth
  const listResult = await adminAuth.listUsers(1000)

  // Fetch Firestore user docs in parallel batches of 10 (avoids Firestore
  // in-query limit while staying within Firebase Admin concurrency)
  const uids = listResult.users.map((u) => u.uid)

  const chunkSize = 10
  const chunks: string[][] = []
  for (let i = 0; i < uids.length; i += chunkSize) {
    chunks.push(uids.slice(i, i + chunkSize))
  }

  const firestoreData = new Map<string, { role?: string; orgId?: string }>()

  await Promise.all(
    chunks.map(async (chunk) => {
      const snap = await adminDb
        .collection('users')
        .where('__name__', 'in', chunk)
        .get()
      for (const doc of snap.docs) {
        const d = doc.data()
        firestoreData.set(doc.id, {
          role: typeof d.role === 'string' ? d.role : undefined,
          orgId: typeof d.orgId === 'string' ? d.orgId : undefined,
        })
      }
    }),
  )

  const users: AdminUserView[] = listResult.users.map((authUser) => {
    const fs = firestoreData.get(authUser.uid)
    return {
      uid: authUser.uid,
      email: authUser.email ?? '',
      displayName: authUser.displayName ?? '',
      role: fs?.role ?? 'unknown',
      orgId: fs?.orgId ?? null,
      createdAt: authUser.metadata.creationTime ?? null,
      lastSignInTime: authUser.metadata.lastSignInTime ?? null,
      disabled: authUser.disabled,
      emailVerified: authUser.emailVerified,
    }
  })

  // Most recently created first
  users.sort((a, b) => {
    const at = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return bt - at
  })

  return apiSuccess({ users })
})
