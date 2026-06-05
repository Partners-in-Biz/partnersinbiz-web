'use client'

import { useSearchParams } from 'next/navigation'
import { scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'
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
  const searchParams = useSearchParams()
  const scope = scopeFromSearchParams(searchParams)
  const campaignsHref = scopedPortalPath('/portal/campaigns', scope)
  const campaignBasePath = scopedPortalPath(`/portal/campaigns/${props.campaignId}`, scope)

  return (
    <CampaignCockpitClient
      {...props}
      backHref={campaignsHref}
      backLabel="Campaigns"
      basePath={campaignBasePath}
      assetApprovalMode="client"
      showClientBlogApprovals
    />
  )
}
