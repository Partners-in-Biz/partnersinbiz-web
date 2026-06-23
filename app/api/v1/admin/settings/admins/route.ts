// app/api/v1/admin/settings/admins/route.ts
// Admin user management on the shared `users` collection (role === 'admin').
// GET (admin) lists admins + active-session counts. POST (super-admin) invites
// a new admin: creates/links a Firebase Auth user by email and writes the
// users/{uid} admin doc.
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { serializeGovernance, cleanStr, actorOf, toMillis } from '@/lib/governance/firestore'

export const dynamic = 'force-dynamic'

export const ADMIN_ROLES = ['superadmin', 'support', 'finance', 'content'] as const
export type AdminRole = (typeof ADMIN_ROLES)[number]

function normaliseAdminRole(value: unknown, allowedOrgIds: unknown): AdminRole {
  // Super-admins (empty/undefined allowedOrgIds) are always 'superadmin'.
  if (!Array.isArray(allowedOrgIds) || allowedOrgIds.length === 0) {
    if (typeof value === 'string' && (ALLOWED as readonly string[]).includes(value)) {
      return value === 'superadmin' ? 'superadmin' : (value as AdminRole)
    }
    return 'superadmin'
  }
  if (typeof value === 'string' && (ALLOWED as readonly string[]).includes(value)) return value as AdminRole
  return 'support'
}

const ALLOWED = ADMIN_ROLES

/** Count non-revoked session docs under users/{uid}/sessions. */
async function activeSessionCount(uid: string): Promise<number> {
  try {
    const snap = await adminDb.collection('users').doc(uid).collection('sessions').get()
    return snap.docs.filter((d) => d.data()?.revoked !== true).length
  } catch {
    return 0
  }
}

export const GET = withAuth('admin', async () => {
  try {
    const snap = await adminDb.collection('users').where('role', '==', 'admin').get()
    const admins = await Promise.all(
      snap.docs.map(async (doc) => {
        const data = doc.data() ?? {}
        const adminRole = normaliseAdminRole(data.adminRole, data.allowedOrgIds)
        const lastLoginAt = toMillis(data.lastLoginAt)
        return {
          uid: doc.id,
          email: typeof data.email === 'string' ? data.email : '',
          name: typeof data.name === 'string' ? data.name : '',
          adminRole,
          allowedOrgIds: Array.isArray(data.allowedOrgIds) ? data.allowedOrgIds : [],
          active: data.active !== false,
          lastLoginAt: lastLoginAt > 0 ? new Date(lastLoginAt).toISOString() : null,
          activeSessions: await activeSessionCount(doc.id),
        }
      }),
    )
    admins.sort((a, b) => (a.email || '').localeCompare(b.email || ''))
    return apiSuccess(serializeGovernance(admins))
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const POST = withAuth('admin', async (req, user) => {
  if (!isSuperAdmin(user)) return apiError('Forbidden', 403)
  try {
    const raw = await req.json().catch(() => ({}))
    const email = cleanStr(raw.email, 200).toLowerCase()
    const name = cleanStr(raw.name, 200)
    const requestedRole = cleanStr(raw.adminRole, 32)

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return apiError('A valid email is required', 400)
    }
    if (!(ALLOWED as readonly string[]).includes(requestedRole)) {
      return apiError(`adminRole must be one of: ${ADMIN_ROLES.join(', ')}`, 400)
    }
    const adminRole = requestedRole as AdminRole

    // Resolve or create the Firebase Auth user.
    let authUser
    try {
      authUser = await adminAuth.getUserByEmail(email)
    } catch {
      authUser = await adminAuth.createUser({ email, displayName: name || undefined, disabled: false })
    }
    const uid = authUser.uid

    // Reject if this user is already an active admin.
    const userRef = adminDb.collection('users').doc(uid)
    const existing = await userRef.get()
    if (existing.exists && existing.data()?.role === 'admin' && existing.data()?.active !== false) {
      return apiError('This user is already an admin', 409)
    }

    const actor = actorOf(user)
    // superadmin => no org restriction; scoped roles keep any existing allowedOrgIds.
    const allowedOrgIds = adminRole === 'superadmin' ? [] : (existing.data()?.allowedOrgIds ?? [])

    const adminDoc: Record<string, unknown> = {
      role: 'admin',
      adminRole,
      email,
      name: name || existing.data()?.name || '',
      allowedOrgIds,
      active: true,
      invitedBy: actor,
      invitedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }
    await userRef.set(adminDoc, { merge: true })

    // Make sure auth account is enabled.
    if (authUser.disabled) await adminAuth.updateUser(uid, { disabled: false })

    return apiSuccess(
      serializeGovernance({
        uid,
        email,
        name: adminDoc.name,
        adminRole,
        allowedOrgIds,
        active: true,
        lastLoginAt: null,
        activeSessions: 0,
      }),
      201,
    )
  } catch (err) {
    return apiErrorFromException(err)
  }
})
