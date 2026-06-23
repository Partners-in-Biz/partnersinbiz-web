import { AdminBacklogSurface } from '@/components/admin/AdminBacklogSurface'

export const dynamic = 'force-dynamic'

export default function AdminAnnouncementsPage() {
  return (
    <AdminBacklogSurface
      endpoint="/api/v1/admin/announcements"
      eyebrow="Admin backlog"
      title="Announcements"
      summary="Operator notices and portal-visible release-note inventory, separated from the general updates council page."
    />
  )
}
