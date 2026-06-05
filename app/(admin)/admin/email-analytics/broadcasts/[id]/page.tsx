import { BroadcastAnalyticsWorkspace } from '@/components/email-analytics/BroadcastAnalyticsWorkspace'

export const dynamic = 'force-dynamic'

export default function BroadcastAnalyticsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return <BroadcastAnalyticsWorkspace params={params} surface="admin" />
}
