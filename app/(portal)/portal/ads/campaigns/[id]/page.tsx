import { redirect, notFound } from 'next/navigation'
import { getCampaign } from '@/lib/ads/campaigns/store'
import { listAdSets } from '@/lib/ads/adsets/store'
import { listAds } from '@/lib/ads/ads/store'
import { InsightsChart } from '@/components/ads/InsightsChart'
import { AdCampaignDetailWorkspace } from '@/components/ads/AdCampaignDetailWorkspace'
import { ApprovalActions } from './ApprovalActions'
import {
  resolvePortalAdsUser,
  scopedPortalHref,
  scopeFromSearchParams,
  type PortalAdsSearchParams,
} from '../../portalAdsScope'

export const dynamic = 'force-dynamic'

export default async function PortalAdCampaignDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams?: Promise<PortalAdsSearchParams>
}) {
  const { id } = await params
  const resolvedSearchParams = await searchParams
  const scope = scopeFromSearchParams(resolvedSearchParams)
  const user = await resolvePortalAdsUser(scope.orgId)
  if (!user) redirect('/login')
  if (user.forbidden) notFound()

  const campaign = await getCampaign(id)
  if (!campaign || campaign.orgId !== user.orgId) notFound()

  const [adSets, ads] = await Promise.all([
    listAdSets({ orgId: user.orgId, campaignId: id }),
    listAds({ orgId: user.orgId, campaignId: id }),
  ])

  return (
    <AdCampaignDetailWorkspace
      surface="portal"
      campaign={campaign}
      adSets={adSets}
      ads={ads}
      backHref={scopedPortalHref('/portal/ads', scope)}
      reviewActions={<ApprovalActions campaignId={id} orgId={scope.orgId} />}
      adHref={(ad) => scopedPortalHref(`/portal/ads/ads/${ad.id}`, scope)}
      insights={
        campaign.status !== 'DRAFT' ? (
          <InsightsChart orgId={user.orgId} level="campaign" pibEntityId={id} daysBack={14} />
        ) : null
      }
    />
  )
}
