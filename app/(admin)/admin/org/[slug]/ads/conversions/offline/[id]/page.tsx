// app/(admin)/admin/org/[slug]/ads/conversions/offline/[id]/page.tsx
// Detail view: single batch + paginated rows + Retry Failed button.

import { resolveOrgIdBySlug } from '@/lib/organizations/resolve-by-slug'
import { getBatch, listRows } from '@/lib/ads/offline-conversions/store'
import { OfflineBatchDetailClient } from '@/components/ads/OfflineBatchDetailClient'

interface Params { slug: string; id: string }

export default async function OfflineBatchDetailPage({ params }: { params: Promise<Params> }) {
  const { slug, id } = await params
  const orgId = await resolveOrgIdBySlug(slug)
  if (!orgId) return <div className="pib-empty-state-description">Org not found.</div>

  const batch = await getBatch(id)
  if (!batch || batch.orgId !== orgId) return <div className="pib-empty-state-description">Batch not found.</div>

  const rows = await listRows({ batchId: id })

  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow">Ads · Conversions</p>
        <h1 className="pib-page-title mt-2">Offline Conversion Batch</h1>
        <p className="pib-page-sub font-mono">{id}</p>
      </header>
      <OfflineBatchDetailClient orgSlug={slug} orgId={orgId} batch={batch} initialRows={rows} />
    </div>
  )
}
