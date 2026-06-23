import { AdminBacklogSurface } from '@/components/admin/AdminBacklogSurface'

export const dynamic = 'force-dynamic'

export default function AdminImportToolsPage() {
  return (
    <AdminBacklogSurface
      endpoint="/api/v1/admin/tools/import"
      eyebrow="Admin backlog"
      title="CSV import tools"
      summary="Operator launchers for organization-scoped CSV imports, plus the current live and planned import lanes."
    />
  )
}
