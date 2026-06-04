import { redirectToOrgCampaignCockpit } from '../redirectToOrgCampaignCockpit'

export const dynamic = 'force-dynamic'

export default async function CampaignVideosTab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return redirectToOrgCampaignCockpit(id, 'videos')
}
