import { AdminBacklogSurface } from '@/components/admin/AdminBacklogSurface'

export const dynamic = 'force-dynamic'

export default function AdminReportTemplatesPage() {
  return (
    <AdminBacklogSurface
      endpoint="/api/v1/admin/reports/templates"
      eyebrow="Admin backlog"
      title="Report templates"
      summary="Platform-defined reporting templates available to operators, with the live registry surfaced directly in admin."
    />
  )
}
