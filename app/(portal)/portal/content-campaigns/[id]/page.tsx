import { redirect } from 'next/navigation'
import { legacyCampaignRedirectPath, type LegacyCampaignRedirectSearchParams } from '../legacyCampaignRedirectScope'

export const dynamic = 'force-dynamic'

export default async function LegacyContentCampaignRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams?: Promise<LegacyCampaignRedirectSearchParams>
}) {
  const { id } = await params
  const query = await searchParams
  redirect(legacyCampaignRedirectPath(`/portal/campaigns/${id}`, query))
}
