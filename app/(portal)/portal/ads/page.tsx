import { notFound, redirect } from 'next/navigation'
import { listCampaigns } from '@/lib/ads/campaigns/store'
import { listConnections } from '@/lib/ads/connections/store'
import { summarizeAdConnections } from '@/lib/ads/provider-display'
import { AdCampaignsWorkspace } from '@/components/ads/AdCampaignsWorkspace'
import { BulkApproveButton } from '@/components/ads/BulkApproveButton'
import { FeatureGate } from '@/components/paywall/FeatureGate'
import {
  resolvePortalAdsUser,
  scopedPortalHref,
  scopeFromSearchParams,
  type PortalAdsSearchParams,
} from './portalAdsScope'

export const dynamic = 'force-dynamic'

export default async function PortalAdsListPage({
  searchParams,
}: {
  searchParams?: Promise<PortalAdsSearchParams>
}) {
  const params = await searchParams
  const scope = scopeFromSearchParams(params)
  const user = await resolvePortalAdsUser(scope.orgId)
  if (!user) redirect('/login')
  if (user.forbidden) notFound()
  if (!user.orgId) {
    return (
      <div className="pib-card p-10 text-center text-sm text-[var(--color-pib-text-muted)]">
        No organisation linked to this account.
      </div>
    )
  }

  const [campaigns, connections] = await Promise.all([
    listCampaigns({ orgId: user.orgId }),
    listConnections({ orgId: user.orgId }),
  ])
  const awaiting = campaigns.filter((c) => c.reviewState === 'awaiting')

  return (
    <FeatureGate feature="ads">
      <AdCampaignsWorkspace
        surface="portal"
        title=""
        campaigns={campaigns}
        connectionSummaries={summarizeAdConnections(connections)}
        campaignHref={(campaign) => scopedPortalHref(`/portal/ads/campaigns/${campaign.id}`, scope)}
        bulkReviewAction={
          awaiting.length > 0 ? <BulkApproveButton count={awaiting.length} orgId={scope.orgId} /> : null
        }
        emptyTitle="No campaigns yet."
        emptyBody="Partners in Biz will draft your first campaigns and submit them here for your approval."
      />
    </FeatureGate>
  )
}
