import { AdminBacklogSurface } from '@/components/admin/AdminBacklogSurface'

export const dynamic = 'force-dynamic'

export default function AdminSystemAuditLogPage() {
  return (
    <AdminBacklogSurface
      endpoint="/api/v1/admin/audit-log"
      eyebrow="Admin backlog"
      title="Global audit log"
      summary="Recent platform activity across accessible orgs, with sensitive-action visibility and direct links back to the org-level activity history."
    />
  )
}
