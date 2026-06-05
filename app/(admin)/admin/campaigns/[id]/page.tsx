import { redirectToOrgCampaignCockpit } from './redirectToOrgCampaignCockpit'

export const dynamic = 'force-dynamic'

export default async function CampaignOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return redirectToOrgCampaignCockpit(id)
}
