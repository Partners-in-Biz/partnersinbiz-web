import { redirect } from 'next/navigation'
import { legacyCampaignRedirectPath, type LegacyCampaignRedirectSearchParams } from './legacyCampaignRedirectScope'

export const dynamic = 'force-dynamic'

export default async function LegacyContentCampaignsRedirect({
  searchParams,
}: {
  searchParams?: Promise<LegacyCampaignRedirectSearchParams>
} = {}) {
  const params = await searchParams
  redirect(legacyCampaignRedirectPath('/portal/campaigns', params))
}
