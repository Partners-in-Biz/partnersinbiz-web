import { AdminBacklogSurface } from '@/components/admin/AdminBacklogSurface'

export const dynamic = 'force-dynamic'

export default function AdminDomainsSslPage() {
  return (
    <AdminBacklogSurface
      endpoint="/api/v1/admin/domains/ssl"
      eyebrow="Admin backlog"
      title="SSL certificate status"
      summary="Operator view over custom-domain SSL state so expiring or failed client domains no longer collapse into the generic settings hub."
    />
  )
}
