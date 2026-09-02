import { cookies } from 'next/headers'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { canUsePortalOrg, resolvePortalActiveOrgId } from '@/lib/portal/org-access'
import { scopedPortalPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'

export type PortalAdsSearchParams = {
  orgId?: string
  orgSlug?: string
  sourceCompanyId?: string
  companyId?: string
}

export type PortalAdsScope = {
  orgId?: string
  orgSlug?: string
  sourceCompanyId?: string
}

export type PortalAdsUser =
  | { uid: string; orgId: string; forbidden?: false }
  | { uid: string; orgId?: undefined; forbidden: true }

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function scopeFromSearchParams(params?: PortalAdsSearchParams): PortalAdsScope {
  const sourceCompanyId = cleanString(params?.sourceCompanyId) || cleanString(params?.companyId) || undefined
  return {
    orgId: cleanString(params?.orgId) || undefined,
    orgSlug: cleanString(params?.orgSlug) || undefined,
    ...(sourceCompanyId ? { sourceCompanyId } : {}),
  }
}

export function scopedPortalHref(path: string, scope: PortalAdsScope): string {
  return scopedPortalPath(path, scope as PortalOrgRouteScope)
}

export async function resolvePortalAdsUser(requestedOrgId?: string): Promise<PortalAdsUser | null> {
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
