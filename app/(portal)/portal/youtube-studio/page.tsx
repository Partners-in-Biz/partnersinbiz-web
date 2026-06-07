import type { ReactNode } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { YouTubeStudioPlaceholder } from '@/components/youtube-studio/YouTubeStudioPlaceholder'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isPortalModuleEnabled } from '@/lib/organizations/portal-modules'
import { canUsePortalOrg, resolvePortalActiveOrgId } from '@/lib/portal/org-access'

export const dynamic = 'force-dynamic'

type PortalYouTubeStudioSearchParams = {
  orgId?: string
}

type PortalYouTubeStudioUser =
  | { orgId: string; forbidden?: false }
  | { orgId?: undefined; forbidden: true }

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

async function resolvePortalYouTubeStudioUser(requestedOrgId?: string): Promise<PortalYouTubeStudioUser | null> {
  const cookieStore = await cookies()
  const cookieName = process.env.SESSION_COOKIE_NAME ?? '__session'
  const session = cookieStore.get(cookieName)?.value
  if (!session) return null

  try {
    const decoded = await adminAuth.verifySessionCookie(session, true)
    const userDoc = await adminDb.collection('users').doc(decoded.uid).get()
    const userData = userDoc.data() ?? {}
    const requested = cleanString(requestedOrgId)

    if (requested) {
      const allowed = await canUsePortalOrg(decoded.uid, userData, requested)
      if (!allowed) return { forbidden: true }
      return { orgId: requested }
    }

    const orgId = await resolvePortalActiveOrgId(decoded.uid, userData)
    return orgId ? { orgId } : null
  } catch {
    return null
  }
}

function PortalYouTubeStudioUnavailable({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
      <div className="rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-card)] p-6 text-sm text-[var(--color-pib-text)]">
        {children}
      </div>
    </main>
  )
}

export default async function PortalYouTubeStudioPage({
  searchParams,
}: {
  searchParams?: Promise<PortalYouTubeStudioSearchParams>
}) {
  const params = await searchParams
  const user = await resolvePortalYouTubeStudioUser(params?.orgId)
  if (!user) redirect('/login')
  if (user.forbidden) {
    return <PortalYouTubeStudioUnavailable>You do not have access to this organisation.</PortalYouTubeStudioUnavailable>
  }

  const orgDoc = await adminDb.collection('organizations').doc(user.orgId).get()
  if (!orgDoc.exists) {
    return <PortalYouTubeStudioUnavailable>Organisation not found.</PortalYouTubeStudioUnavailable>
  }

  if (!isPortalModuleEnabled(orgDoc.data()?.settings, 'youtubeStudio')) {
    return <PortalYouTubeStudioUnavailable>YouTube Studio is not enabled for this portal.</PortalYouTubeStudioUnavailable>
  }

  return <YouTubeStudioPlaceholder surface="portal" />
}
