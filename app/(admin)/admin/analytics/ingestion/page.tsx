import { AdminBacklogSurface } from '@/components/admin/AdminBacklogSurface'

export const dynamic = 'force-dynamic'

export default function AdminAnalyticsIngestionPage() {
  return (
    <AdminBacklogSurface
      endpoint="/api/v1/admin/analytics/ingestion"
      eyebrow="Admin backlog"
      title="Analytics ingestion monitor"
      summary="Accepted analytics-event flow, property volume, and recent sample events for operator monitoring."
    />
  )
}
