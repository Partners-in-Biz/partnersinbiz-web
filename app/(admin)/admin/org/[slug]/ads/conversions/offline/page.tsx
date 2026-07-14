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
  if (!orgId) return <div className="pib-empty-state-description">Org not found.</div>

  const [batches, actions] = await Promise.all([
    listBatches({ orgId }),
    listConversionActions({ orgId }),
  ])

  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow">Ads · Conversions</p>
        <h1 className="pib-page-title mt-2">Offline Conversions</h1>
        <p className="pib-page-sub">
          Upload an operator-vetted CSV of offline conversion events to reconcile against the client Conversion Actions.
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
