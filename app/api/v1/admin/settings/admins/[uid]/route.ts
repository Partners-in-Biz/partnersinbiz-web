// app/api/v1/admin/settings/admins/[uid]/route.ts
// PATCH (super-admin): update an admin's adminRole and/or active status.
// Deactivating also disables the Firebase Auth account; reactivating re-enables.
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { serializeGovernance, cleanStr, actorOf } from '@/lib/governance/firestore'
import { ADMIN_ROLES, type AdminRole } from '../route'

export const dynamic = 'force-dynamic'

export const PATCH = withAuth('admin', async (req, user, context) => {
  if (!isSuperAdmin(user)) return apiError('Forbidden', 403)
  try {
    const params = await context?.params
    const uid = cleanStr(params?.uid, 200)
    if (!uid) return apiError('Missing admin uid', 400)

    const userRef = adminDb.collection('users').doc(uid)
    const snap = await userRef.get()
    if (!snap.exists || snap.data()?.role !== 'admin') return apiError('Admin not found', 404)

    const raw = await req.json().catch(() => ({}))
    const update: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorOf(user),
    }

    if (typeof raw.adminRole === 'string') {
      if (!(ADMIN_ROLES as readonly string[]).includes(raw.adminRole)) {
        return apiError(`adminRole must be one of: ${ADMIN_ROLES.join(', ')}`, 400)
      }
      const adminRole = raw.adminRole as AdminRole
      update.adminRole = adminRole
      if (adminRole === 'superadmin') update.allowedOrgIds = []
    }

    let activeChange: boolean | undefined
    if (typeof raw.active === 'boolean') {
      activeChange = raw.active
      update.active = raw.active
    }

    await userRef.set(update, { merge: true })

    // Sync Firebase Auth disabled flag when active status changes.
    if (typeof activeChange === 'boolean') {
      try {
        await adminAuth.updateUser(uid, { disabled: !activeChange })
      } catch {
        /* auth user may not exist for a legacy record — ignore */
      }
    }

    const fresh = await userRef.get()
    const data = fresh.data() ?? {}
    return apiSuccess(
      serializeGovernance({
        uid,
        email: data.email ?? '',
        name: data.name ?? '',
        adminRole: data.adminRole ?? 'support',
        allowedOrgIds: Array.isArray(data.allowedOrgIds) ? data.allowedOrgIds : [],
        active: data.active !== false,
      }),
    )
  } catch (err) {
    return apiErrorFromException(err)
  }
})
