import { cookies } from 'next/headers'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { canUsePortalOrg, resolvePortalActiveOrgId } from '@/lib/portal/org-access'

export type PortalCampaignSearchParams = {
  orgId?: string
  orgSlug?: string
  sourceCompanyId?: string
  sourceCompanyName?: string
}

export type PortalCampaignScope = {
  orgId?: string
  orgSlug?: string
  sourceCompanyId?: string
  sourceCompanyName?: string
}

export type PortalCampaignUser =
  | { uid: string; orgId: string; forbidden?: false }
  | { uid: string; orgId?: undefined; forbidden: true }

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function scopeFromSearchParams(params?: PortalCampaignSearchParams): PortalCampaignScope {
  return {
    orgId: cleanString(params?.orgId) || undefined,
    orgSlug: cleanString(params?.orgSlug) || undefined,
    sourceCompanyId: cleanString(params?.sourceCompanyId) || undefined,
    sourceCompanyName: cleanString(params?.sourceCompanyName) || undefined,
  }
}

export function scopedPortalHref(path: string, scope: PortalCampaignScope) {
  if (!scope.orgId && !scope.orgSlug && !scope.sourceCompanyId && !scope.sourceCompanyName) return path
  const params = new URLSearchParams()
  if (scope.orgId) params.set('orgId', scope.orgId)
  if (scope.orgSlug) params.set('orgSlug', scope.orgSlug)
  if (scope.sourceCompanyId) params.set('sourceCompanyId', scope.sourceCompanyId)
  if (scope.sourceCompanyName) params.set('sourceCompanyName', scope.sourceCompanyName)
  return `${path}${path.includes('?') ? '&' : '?'}${params.toString()}`
}

export async function resolvePortalCampaignUser(requestedOrgId?: string): Promise<PortalCampaignUser | null> {
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
