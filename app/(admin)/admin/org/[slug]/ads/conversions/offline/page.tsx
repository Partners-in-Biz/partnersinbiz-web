// app/(admin)/admin/org/[slug]/ads/conversions/offline/page.tsx
// Server component: list offline conversion batches + upload form.

import { resolveOrgIdBySlug } from '@/lib/organizations/resolve-by-slug'
import { listBatches } from '@/lib/ads/offline-conversions/store'
import { listConversionActions } from '@/lib/ads/conversion-actions/store'
import { OfflineBatchesListClient } from '@/components/ads/OfflineBatchesListClient'

interface Params { slug: string }

export default async function OfflineConversionsPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const orgId = await resolveOrgIdBySlug(slug)
  if (!orgId) return <div className="text-white/60">Org not found.</div>

  const [batches, actions] = await Promise.all([
    listBatches({ orgId }),
    listConversionActions({ orgId }),
  ])

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Offline Conversions</h1>
        <p className="text-sm text-white/50">
          Upload a CSV of offline conversion events to reconcile against your Conversion Actions.
        </p>
      </header>
      <OfflineBatchesListClient
        orgSlug={slug}
        orgId={orgId}
        initialBatches={batches}
        conversionActions={actions}
      />
    </div>
  )
}
