// app/(admin)/admin/org/[slug]/ads/experiments/[id]/page.tsx
// Sub-5 Batch 2B — Experiment detail page
import { resolveOrgIdBySlug } from '@/lib/organizations/resolve-by-slug'
import { getExperiment, listResults } from '@/lib/ads/experiments/store'
import { ExperimentDetailClient } from '@/components/ads/ExperimentDetailClient'
import type {
  ExperimentDetailPlain,
  ExperimentResultPlain,
} from '@/components/ads/ExperimentDetailClient'
import Link from 'next/link'

interface Params {
  slug: string
  id: string
}

export default async function ExperimentDetailPage({
  params,
}: {
  params: Promise<Params>
}) {
  const { slug, id } = await params
  const orgId = await resolveOrgIdBySlug(slug)
  if (!orgId) return <div className="text-white/60">Org not found.</div>

  const experiment = await getExperiment(id)
  if (!experiment || experiment.orgId !== orgId) {
    return <div className="text-white/60">Experiment not found.</div>
  }

  const results = await listResults({ experimentId: id })

  // Serialize for client component
  const expPlain: ExperimentDetailPlain = {
    id: experiment.id,
    name: experiment.name,
    description: experiment.description,
    status: experiment.status,
    platform: experiment.platform,
    level: experiment.level,
    parentEntityId: experiment.parentEntityId,
    sourceEntityId: experiment.sourceEntityId,
    successMetric: experiment.successMetric,
    minDays: experiment.minDays,
    significanceThreshold: experiment.significanceThreshold,
    autoWinner: experiment.autoWinner,
    variants: experiment.variants.map((v) => ({
      id: v.id,
      name: v.name,
      trafficPercent: v.trafficPercent,
      entityId: v.entityId,
    })),
    declaredWinnerVariantId: experiment.declaredWinnerVariantId,
    significance: experiment.significance
      ? {
          pValue: experiment.significance.pValue,
          confident: experiment.significance.confident,
          winnerVariantId: experiment.significance.winnerVariantId,
        }
      : undefined,
    startedAt: experiment.startedAt
      ? { seconds: (experiment.startedAt as { seconds: number }).seconds }
      : null,
    endedAt: experiment.endedAt
      ? { seconds: (experiment.endedAt as { seconds: number }).seconds }
      : null,
    archivedAt: experiment.archivedAt ?? undefined,
  }

  const resultsPlain: ExperimentResultPlain[] = results.map((r) => ({
    id: r.id,
    variantId: r.variantId,
    fromDate: r.fromDate,
    toDate: r.toDate,
    impressions: r.impressions,
    clicks: r.clicks,
    conversions: r.conversions,
    spendCents: r.spendCents,
    ctr: r.ctr,
    cpc: r.cpc,
    cpa: r.cpa,
    convRate: r.convRate,
    computedAt: r.computedAt
      ? { seconds: (r.computedAt as { seconds: number }).seconds }
      : undefined,
  }))

  return (
    <section className="space-y-4">
      <ExperimentDetailClient
        experiment={expPlain}
        results={resultsPlain}
        orgSlug={slug}
      />
    </section>
  )
}
