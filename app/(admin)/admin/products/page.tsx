import { AdminBacklogSurface } from '@/components/admin/AdminBacklogSurface'

export const dynamic = 'force-dynamic'

export default function AdminProductsPage() {
  return (
    <AdminBacklogSurface
      endpoint="/api/v1/admin/products"
      eyebrow="Admin backlog"
      title="Products control plane"
      summary="Platform product registry, onboarding offers, and client product catalog health. This replaces the old settings redirect with a concrete operator surface."
    />
  )
}
