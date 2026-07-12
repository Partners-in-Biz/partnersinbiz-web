'use client'

import { HubPage } from '@/components/navigation/HubPage'
import { buildMarketingHubProps } from '@/components/navigation/marketingHubConfig'
import { useFeatureFlag, useFeatureFlags } from '@/components/portal/FeatureFlagsProvider'
import type { PortalOrgRouteScope } from '@/lib/portal/scoped-routing'
import { MarketingStudioDashboard } from './MarketingStudioDashboard'

export function MarketingStudioEntry({ scope }: { scope: PortalOrgRouteScope }) {
  const enabled = useFeatureFlag('emailMarketingStudioV2')
  const { loading } = useFeatureFlags()

  if (loading) {
    return <div className="pib-card min-h-40 animate-pulse" role="status" aria-label="Loading marketing workspace" />
  }

  if (enabled) return <MarketingStudioDashboard scope={scope} />

  return <HubPage {...buildMarketingHubProps({ surface: 'portal', ...scope })} />
}
