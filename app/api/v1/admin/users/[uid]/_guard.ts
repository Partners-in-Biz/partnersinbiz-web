/**
 * Shared guard helpers for per-user admin actions (US-254 / US-255).
 *
 * A "super admin" target is a Firestore users/{uid} doc with role === 'admin'
 * and no allowedOrgIds (mirrors isSuperAdmin in lib/api/platformAdmin). Such
 * targets must never be suspended, deleted, or impersonated by another admin.
 */
import { adminDb } from '@/lib/firebase/admin'

export interface TargetUserMeta {
  role: string | null
  allowedOrgIds: string[]
  isSuperAdmin: boolean
  email?: string | null
  displayName?: string | null
}

/**
 * Resolve the target user's role + allowedOrgIds from Firestore and decide
 * whether they are a super admin. A missing Firestore doc is treated as a
 * non-admin (role unknown) — only an explicit admin role with empty
 * allowedOrgIds counts as a protected super admin.
 */
export async function resolveTargetMeta(uid: string): Promise<TargetUserMeta> {
  const snap = await adminDb.collection('users').doc(uid).get()
  if (!snap.exists) {
    return { role: null, allowedOrgIds: [], isSuperAdmin: false }
  }
  const d = snap.data() ?? {}
  const role = typeof d.role === 'string' ? d.role : null
  const allowedOrgIds = Array.isArray(d.allowedOrgIds)
    ? d.allowedOrgIds.filter((x: unknown): x is string => typeof x === 'string' && !!x)
    : []
  const isSuperAdmin = role === 'admin' && allowedOrgIds.length === 0
  return {
    role,
    allowedOrgIds,
    isSuperAdmin,
    email: typeof d.email === 'string' ? d.email : null,
    displayName: typeof d.displayName === 'string' ? d.displayName : null,
  }
}
