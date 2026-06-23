import { AdminBacklogSurface } from '@/components/admin/AdminBacklogSurface'

export const dynamic = 'force-dynamic'

export default function AdminDomainsPage() {
  return (
    <AdminBacklogSurface
      endpoint="/api/v1/admin/domains"
      eyebrow="Admin backlog"
      title="White-label domains"
      summary="Custom-domain inventory for client portals, including DNS/verification state and operator links back to the owning org settings."
    />
  )
}
