import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import EmailAnalyticsDashboard from '@/components/email-analytics/EmailAnalyticsDashboard'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { canUsePortalOrg, resolvePortalActiveOrgId } from '@/lib/portal/org-access'

export const dynamic = 'force-dynamic'

type PortalEmailAnalyticsSearchParams = {
  orgId?: string
  orgSlug?: string
  sourceCompanyId?: string
  sourceCompanyName?: string
}

async function currentUser(requestedOrgId?: string): Promise<{ uid: string; orgId?: string; forbidden?: boolean } | null> {
  const cookieStore = await cookies()
  const cookieName = process.env.SESSION_COOKIE_NAME ?? '__session'
  const session = cookieStore.get(cookieName)?.value
  if (!session) return null
  try {
    const decoded = await adminAuth.verifySessionCookie(session, true)
    const userDoc = await adminDb.collection('users').doc(decoded.uid).get()
    const userData = userDoc.data() ?? {}
    const requested = requestedOrgId?.trim() ?? ''
    if (requested) {
      const allowed = await canUsePortalOrg(decoded.uid, userData, requested)
      return allowed ? { uid: decoded.uid, orgId: requested } : { uid: decoded.uid, forbidden: true }
    }

    const orgId = await resolvePortalActiveOrgId(decoded.uid, userData)
    return { uid: decoded.uid, orgId: orgId ?? undefined }
  } catch {
    return null
  }
}

export default async function PortalEmailAnalyticsPage({
  searchParams,
}: {
  searchParams?: Promise<PortalEmailAnalyticsSearchParams>
}) {
  const params = await searchParams
  const user = await currentUser(params?.orgId)
  if (!user) redirect('/login')
  if (user.forbidden) {
    return (
      <div className="pib-card p-10 text-center text-sm text-[var(--color-pib-text-muted)]">
        You do not have access to this organisation.
      </div>
    )
  }
  if (!user.orgId) {
    return (
      <div className="pib-card p-10 text-center text-sm text-[var(--color-pib-text-muted)]">
        No organisation linked to this account.
      </div>
    )
  }

  return (
    <EmailAnalyticsDashboard
      orgId={user.orgId}
      isAdmin={false}
      surface="portal"
      orgScope={{
        orgId: user.orgId,
        orgSlug: params?.orgSlug,
        sourceCompanyId: params?.sourceCompanyId,
        sourceCompanyName: params?.sourceCompanyName,
      }}
    />
  )
}
