import { AdminBacklogSurface } from '@/components/admin/AdminBacklogSurface'

export const dynamic = 'force-dynamic'

export default function AdminPropertiesPage() {
  return (
    <AdminBacklogSurface
      endpoint="/api/v1/admin/properties"
      eyebrow="Admin backlog"
      title="Properties control plane"
      summary="Platform-wide property inventory, ingest key state, and org handoff links. This replaces the old portal redirect with a bounded operator surface."
    />
  )
}
