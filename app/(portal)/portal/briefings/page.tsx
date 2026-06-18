import { cookies } from 'next/headers'
import { adminAuth } from '@/lib/firebase/admin'
import { BriefingControlDesk } from '@/components/briefing/BriefingControlDesk'
import { scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export const dynamic = 'force-dynamic'

type PageSearchParams = Record<string, string | string[] | undefined>

function toUrlSearchParams(params?: PageSearchParams | null) {
  const searchParams = new URLSearchParams()
  if (!params) return searchParams
  for (const [key, value] of Object.entries(params)) {
    const first = Array.isArray(value) ? value[0] : value
    if (first) searchParams.set(key, first)
  }
  return searchParams
}

async function getCurrentUser() {
  const c = await cookies()
  const sc = c.get(process.env.SESSION_COOKIE_NAME ?? '__session')?.value
  if (!sc) return undefined
  try {
    const d = await adminAuth.verifySessionCookie(sc, true)
    return { uid: d.uid, displayName: (d.name as string) ?? (d.email as string) ?? d.uid }
  } catch {
    return undefined
  }
}

export default async function PortalBriefingsPage({
  searchParams,
}: {
  searchParams?: Promise<PageSearchParams>
}) {
  const routeScope = scopeFromSearchParams(toUrlSearchParams(await searchParams))
  const currentUser = await getCurrentUser()
  return <BriefingControlDesk mode="portal" portalScope={routeScope} currentUser={currentUser} />
}
