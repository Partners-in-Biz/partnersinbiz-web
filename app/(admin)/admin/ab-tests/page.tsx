import { AdminBacklogSurface } from '@/components/admin/AdminBacklogSurface'

export const dynamic = 'force-dynamic'

export default function AdminAbTestsPage() {
  return (
    <AdminBacklogSurface
      endpoint="/api/v1/admin/ab-tests"
      eyebrow="Admin backlog"
      title="A/B tests"
      summary="Native experiment inventory built from stored campaign and broadcast A/B configs, with direct result routes instead of a broad dashboard redirect."
    />
  )
}
