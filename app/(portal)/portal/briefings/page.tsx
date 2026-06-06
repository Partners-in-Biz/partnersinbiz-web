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

export default async function PortalBriefingsPage({
  searchParams,
}: {
  searchParams?: Promise<PageSearchParams>
}) {
  const routeScope = scopeFromSearchParams(toUrlSearchParams(await searchParams))
  return <BriefingControlDesk mode="portal" portalScope={routeScope} />
}
