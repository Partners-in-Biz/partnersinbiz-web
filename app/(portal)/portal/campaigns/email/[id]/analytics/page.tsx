import {
  CampaignAnalyticsWorkspace,
  type CampaignAnalyticsSearchParams,
} from '@/components/email-analytics/CampaignAnalyticsWorkspace'

export const dynamic = 'force-dynamic'

export default function PortalCampaignAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams?: Promise<CampaignAnalyticsSearchParams>
}) {
  return <CampaignAnalyticsWorkspace params={params} searchParams={searchParams} surface="portal" />
}
