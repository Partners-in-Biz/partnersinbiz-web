import { notFound, redirect } from 'next/navigation'
import { GeoSeoWorkspace } from '@/components/geo-seo/GeoSeoWorkspace'
import { loadGeoSeoWorkspaces } from '@/lib/geo-seo/workspaces'
import { resolvePortalSeoUser } from '../seo/portalSeoScope'

export const dynamic = 'force-dynamic'

type PortalGeoSeoSearchParams = {
  orgId?: string
  orgSlug?: string
  sourceCompanyId?: string
  sourceCompanyName?: string
}

function clean(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export default async function PortalGeoSeoPage({
  searchParams,
}: {
  searchParams?: Promise<PortalGeoSeoSearchParams>
} = {}) {
  const params = await searchParams
  const scope = {
    orgId: clean(params?.orgId),
    orgSlug: clean(params?.orgSlug),
    sourceCompanyId: clean(params?.sourceCompanyId),
    sourceCompanyName: clean(params?.sourceCompanyName),
  }
  const user = await resolvePortalSeoUser(scope.orgId)
  if (!user) redirect('/login')
  if (user.forbidden) notFound()

  const orgId = user.orgId
  const workspaces = orgId ? await loadGeoSeoWorkspaces(orgId) : []

  return (
    <GeoSeoWorkspace
      surface="portal"
      workspaces={workspaces}
      orgScope={{ ...scope, orgId }}
      basePath="/portal/geo-seo"
    />
  )
}
