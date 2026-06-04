'use client'

import {
  CampaignCockpitClient,
  type CampaignCockpitClientProps,
} from '@/components/campaign-cockpit/CampaignCockpitClient'

type PortalCockpitClientProps = Omit<
  CampaignCockpitClientProps,
  | 'backHref'
  | 'backLabel'
  | 'basePath'
  | 'assetApprovalMode'
  | 'showClientBlogApprovals'
>

export function CockpitClient(props: PortalCockpitClientProps) {
  return (
    <CampaignCockpitClient
      {...props}
      backHref="/portal/campaigns"
      backLabel="Campaigns"
      basePath={`/portal/campaigns/${props.campaignId}`}
      assetApprovalMode="client"
      showClientBlogApprovals
    />
  )
}
