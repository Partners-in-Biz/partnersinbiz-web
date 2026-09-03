// app/(admin)/admin/org/[slug]/ads/conversion-actions/page.tsx
// Sub-3a Phase 6 Batch 3 F  -  admin page for managing conversion actions.

import { resolveOrgIdBySlug } from '@/lib/organizations/resolve-by-slug'
import { listConversionActions } from '@/lib/ads/conversion-actions/store'
import { ConversionActionsClient } from './ConversionActionsClient'

interface Params { slug: string }

export default async function ConversionActionsPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const orgId = await resolveOrgIdBySlug(slug)
  if (!orgId) return <p className="pib-page-sub">Org not found.</p>
  const actions = await listConversionActions({ orgId })
  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow">Ads · Conversion Actions</p>
        <h1 className="pib-page-title mt-2">Conversion Actions</h1>
        <p className="pib-page-sub">
          Define what counts as a conversion. Used for tracking + bid optimization.
        </p>
      </header>
      <ConversionActionsClient orgSlug={slug} orgId={orgId} initialActions={actions} />
    </div>
  )
}
