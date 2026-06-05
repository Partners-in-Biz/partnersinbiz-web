'use client'

import { useSearchParams } from 'next/navigation'
import { scopedApiPath, scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'
import {
  CampaignCockpitClient,
  type CampaignCockpitClientProps,
} from '@/components/campaign-cockpit/CampaignCockpitClient'

type PortalCampaignCockpitClientProps = Omit<
  CampaignCockpitClientProps,
  | 'backHref'
  | 'backLabel'
  | 'basePath'
  | 'assetApprovalMode'
  | 'showClientBlogApprovals'
>

export function PortalCampaignCockpitClient(props: PortalCampaignCockpitClientProps) {
  const searchParams = useSearchParams()
  const scope = scopeFromSearchParams(searchParams)
  const campaignsHref = scopedPortalPath('/portal/campaigns', scope)
  const campaignBasePath = scopedPortalPath(`/portal/campaigns/${props.campaignId}`, scope)
  const campaignAssetsPath = scopedApiPath(`/api/v1/campaigns/${props.campaignId}/assets`, scope)
  const approveAllPath = scopedApiPath(`/api/v1/campaigns/${props.campaignId}/approve-all`, scope)

  return (
    <CampaignCockpitClient
      {...props}
      backHref={campaignsHref}
      backLabel="Campaigns"
      basePath={campaignBasePath}
      assetApprovalMode="client"
      showClientBlogApprovals
      apiPaths={{
        approveAll: approveAllPath,
        assets: campaignAssetsPath,
        clientBlogApprove: (contentId) =>
          scopedApiPath(`/api/v1/seo/content/${encodeURIComponent(contentId)}/client-approve`, scope),
      }}
    />
  )
}
