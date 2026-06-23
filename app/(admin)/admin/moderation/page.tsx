import { AdminBacklogSurface } from '@/components/admin/AdminBacklogSurface'

export const dynamic = 'force-dynamic'

export default function AdminModerationPage() {
  return (
    <AdminBacklogSurface
      endpoint="/api/v1/admin/moderation"
      eyebrow="Admin backlog"
      title="Content moderation queue"
      summary="Live approval and moderation pressure across social content and campaign review queues, without dropping operators back on a generic dashboard."
    />
  )
}
