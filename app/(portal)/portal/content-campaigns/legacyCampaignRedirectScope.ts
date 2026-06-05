import { scopedPortalPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'

export type LegacyCampaignRedirectSearchParams = Pick<
  PortalOrgRouteScope,
  'orgId' | 'orgSlug' | 'sourceCompanyId' | 'sourceCompanyName'
>

function clean(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function legacyCampaignRedirectPath(
  path: string,
  params?: LegacyCampaignRedirectSearchParams,
): string {
  return scopedPortalPath(path, {
    orgId: clean(params?.orgId),
    orgSlug: clean(params?.orgSlug),
    sourceCompanyId: clean(params?.sourceCompanyId),
    sourceCompanyName: clean(params?.sourceCompanyName),
  })
}
