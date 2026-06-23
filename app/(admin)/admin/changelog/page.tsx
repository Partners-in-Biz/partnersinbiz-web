import { AdminBacklogSurface } from '@/components/admin/AdminBacklogSurface'

export const dynamic = 'force-dynamic'

export default function AdminChangelogPage() {
  return (
    <AdminBacklogSurface
      endpoint="/api/v1/admin/changelog"
      eyebrow="Admin backlog"
      title="Platform changelog"
      summary="Direct operator view of the changelog entries powering the portal What's new feed."
    />
  )
}
