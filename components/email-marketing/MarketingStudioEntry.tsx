'use client'

import { HubPage } from '@/components/navigation/HubPage'
import { buildMarketingHubProps } from '@/components/navigation/marketingHubConfig'
import { useFeatureFlag, useFeatureFlags } from '@/components/portal/FeatureFlagsProvider'
import type { PortalOrgRouteScope } from '@/lib/portal/scoped-routing'
import { CompanyMarketingSection } from '@/components/marketing/CompanyMarketingSection'
import { MarketingStudioDashboard } from './MarketingStudioDashboard'

export function MarketingStudioEntry({ scope }: { scope: PortalOrgRouteScope }) {
  const enabled = useFeatureFlag('emailMarketingStudioV2')
  const { loading } = useFeatureFlags()
  const inCompanyWorkspace = Boolean(scope.sourceCompanyId?.trim())

  if (loading) {
    return <div className="pib-card min-h-40" role="status" aria-label="Loading marketing workspace" />
  }

  if (enabled) return <MarketingStudioDashboard scope={scope} />

  return (
    <HubPage {...buildMarketingHubProps({
      surface: 'portal',
      orgId: scope.orgId ?? undefined,
      orgSlug: scope.orgSlug ?? undefined,
      sourceCompanyId: scope.sourceCompanyId ?? undefined,
      sourceCompanyName: scope.sourceCompanyName ?? undefined,
    })}>
      {inCompanyWorkspace ? null : <CompanyMarketingSection scope={scope} />}
    </HubPage>
  )
}
