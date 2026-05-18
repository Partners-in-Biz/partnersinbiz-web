// app/(admin)/admin/org/[slug]/ads/experiments/page.tsx
// Sub-5 Batch 2B — A/B Experiments list page
import { resolveOrgIdBySlug } from '@/lib/organizations/resolve-by-slug'
import { listExperiments } from '@/lib/ads/experiments/store'
import { ExperimentsListClient } from '@/components/ads/ExperimentsListClient'
import type { ExperimentRow } from '@/components/ads/ExperimentsListClient'

interface Params {
  slug: string
}

export default async function ExperimentsListPage({
  params,
}: {
  params: Promise<Params>
}) {
  const { slug } = await params
  const orgId = await resolveOrgIdBySlug(slug)
  if (!orgId) {
    return <div className="text-white/60">Org not found.</div>
  }

  const experiments = await listExperiments({ orgId, includeArchived: true })

  const rows: ExperimentRow[] = experiments.map((e) => ({
    id: e.id,
    name: e.name,
    status: e.status,
    platform: e.platform,
    level: e.level,
    variantCount: e.variants.length,
    startedAt: e.startedAt
      ? { seconds: (e.startedAt as { seconds: number }).seconds }
      : null,
    archivedAt: e.archivedAt ? true : undefined,
    significance: e.significance
      ? {
          pValue: e.significance.pValue,
          confident: e.significance.confident,
          winnerVariantId: e.significance.winnerVariantId,
        }
      : undefined,
  }))

  return <ExperimentsListClient experiments={rows} orgSlug={slug} />
}
