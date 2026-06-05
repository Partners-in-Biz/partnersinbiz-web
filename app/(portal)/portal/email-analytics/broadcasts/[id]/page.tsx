import {
  BroadcastAnalyticsWorkspace,
  type BroadcastAnalyticsSearchParams,
} from '@/components/email-analytics/BroadcastAnalyticsWorkspace'

export const dynamic = 'force-dynamic'

export default function PortalBroadcastAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams?: Promise<BroadcastAnalyticsSearchParams>
}) {
  return <BroadcastAnalyticsWorkspace params={params} searchParams={searchParams} surface="portal" />
}
