import { notFound, redirect } from 'next/navigation'
import { GeoSeoWorkspaceDetail } from '@/components/geo-seo/GeoSeoWorkspaceDetail'
import { loadGeoSeoWorkspace } from '@/lib/geo-seo/workspaces'
import { scopedPortalPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'
import { resolvePortalSeoUser } from '../../../seo/portalSeoScope'

export const dynamic = 'force-dynamic'

type PortalGeoSeoWorkspaceSearchParams = {
  orgId?: string
  orgSlug?: string
  sourceCompanyId?: string
  sourceCompanyName?: string
}

function clean(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export default async function PortalGeoSeoWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams?: Promise<PortalGeoSeoWorkspaceSearchParams>
}) {
  const [{ id }, rawParams] = await Promise.all([params, searchParams])
  const requestedScope: PortalOrgRouteScope = {
    orgId: clean(rawParams?.orgId),
    orgSlug: clean(rawParams?.orgSlug),
    sourceCompanyId: clean(rawParams?.sourceCompanyId),
    sourceCompanyName: clean(rawParams?.sourceCompanyName),
  }
  const user = await resolvePortalSeoUser(requestedScope.orgId ?? undefined)
  if (!user) redirect('/login')
  if (user.forbidden || !user.orgId) notFound()

  const workspace = await loadGeoSeoWorkspace(id, user.orgId)
  if (!workspace) notFound()

  const orgScope: PortalOrgRouteScope = { ...requestedScope, orgId: user.orgId }
  return (
    <GeoSeoWorkspaceDetail
      surface="portal"
      workspace={workspace}
      orgScope={orgScope}
      backHref={scopedPortalPath('/portal/geo-seo', orgScope)}
    />
  )
}
