import { AdminBacklogSurface } from '@/components/admin/AdminBacklogSurface'

export const dynamic = 'force-dynamic'

export default function AdminScrolledbrainAnalyticsPage() {
  return (
    <AdminBacklogSurface
      endpoint="/api/v1/admin/analytics/scrolledbrain"
      eyebrow="Admin backlog"
      title="Scrolledbrain analytics"
      summary="Dedicated ingest and usage view for the Scrolledbrain property, separate from the general admin dashboard."
    />
  )
}
