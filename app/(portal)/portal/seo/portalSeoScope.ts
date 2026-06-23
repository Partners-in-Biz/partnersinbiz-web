import { cookies } from 'next/headers'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { canUsePortalOrg, resolvePortalActiveOrgId } from '@/lib/portal/org-access'

// Re-export client-safe helpers so existing server-side imports keep working.
export {
  scopeFromSearchParams,
  scopedPortalHref,
  type PortalSeoSearchParams,
  type PortalSeoScope,
} from './portalSeoScopeShared'

export type PortalSeoUser =
  | { uid: string; orgId: string; forbidden?: false }
  | { uid: string; orgId?: undefined; forbidden: true }

export async function resolvePortalSeoUser(requestedOrgId?: string): Promise<PortalSeoUser | null> {
  const cookieStore = await cookies()
  const cookieName = process.env.SESSION_COOKIE_NAME ?? '__session'
  const session = cookieStore.get(cookieName)?.value
  if (!session) return null

  try {
    const decoded = await adminAuth.verifySessionCookie(session, true)
    const userDoc = await adminDb.collection('users').doc(decoded.uid).get()
    const userData = userDoc.data() ?? {}
    if (requestedOrgId) {
      const allowed = await canUsePortalOrg(decoded.uid, userData, requestedOrgId)
      if (!allowed) return { uid: decoded.uid, forbidden: true }
      return { uid: decoded.uid, orgId: requestedOrgId }
    }

    const orgId = await resolvePortalActiveOrgId(decoded.uid, userData)
    return orgId ? { uid: decoded.uid, orgId } : null
  } catch {
    return null
  }
}
