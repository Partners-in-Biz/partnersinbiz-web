// app/(admin)/admin/org/[slug]/ads/budgets/page.tsx
// Sub-4 Batch 2B — Budget management list page
import { resolveOrgIdBySlug } from '@/lib/organizations/resolve-by-slug'
import { listBudgets } from '@/lib/ads/budgets/store'
import { BudgetsListClient } from '@/components/ads/BudgetsListClient'

interface Params {
  slug: string
}

export default async function BudgetsListPage({
  params,
}: {
  params: Promise<Params>
}) {
  const { slug } = await params
  const orgId = await resolveOrgIdBySlug(slug)
  if (!orgId) {
    return <div className="text-white/60">Org not found.</div>
  }

  const budgets = await listBudgets({ orgId, includeArchived: true })

  // Serialize Firestore Timestamps to plain objects for client component
  const rows = budgets.map((b) => ({
    id: b.id,
    name: b.name,
    scope: b.scope,
    platform: b.platform,
    campaignId: b.campaignId,
    period: b.period,
    capCents: b.capCents,
    currencyCode: b.currencyCode,
    currentSpendPercent: b.currentSpendPercent,
    currentSpendCents: b.currentSpendCents,
    archivedAt: b.archivedAt ? true : undefined,
  }))

  return <BudgetsListClient budgets={rows} orgSlug={slug} />
}
