// app/(admin)/admin/org/[slug]/ads/budgets/[id]/page.tsx
// Sub-4 Batch 2B  -  Budget detail page
import Link from 'next/link'
import { resolveOrgIdBySlug } from '@/lib/organizations/resolve-by-slug'
import { getBudget, listEvents } from '@/lib/ads/budgets/store'
import { BudgetDetailClient } from '@/components/ads/BudgetDetailClient'

interface Params {
  slug: string
  id: string
}

export default async function BudgetDetailPage({
  params,
}: {
  params: Promise<Params>
}) {
  const { slug, id } = await params
  const orgId = await resolveOrgIdBySlug(slug)
  if (!orgId) return <div className="pib-empty-state-description">Org not found.</div>

  const budget = await getBudget(id)
  if (!budget || budget.orgId !== orgId) {
    return <div className="pib-empty-state-description">Budget not found.</div>
  }

  const events = await listEvents({ budgetId: id, limit: 100 })

  // Serialize Timestamps for client component
  const budgetPlain = {
    id: budget.id,
    orgId: budget.orgId,
    name: budget.name,
    description: budget.description,
    scope: budget.scope,
    platform: budget.platform,
    campaignId: budget.campaignId,
    capCents: budget.capCents,
    currencyCode: budget.currencyCode,
    period: budget.period,
    currentSpendCents: budget.currentSpendCents,
    currentSpendPercent: budget.currentSpendPercent,
    autoPause: budget.autoPause,
    autoResumeOnRollover: budget.autoResumeOnRollover,
    alertThresholds: budget.alertThresholds,
    archivedAt: budget.archivedAt ?? undefined,
  }

  const eventsPlain = events.map((ev) => ({
    id: ev.id,
    type: ev.type,
    spendCents: ev.spendCents,
    percent: ev.percent,
    threshold: ev.threshold,
    pausedCampaignIds: ev.pausedCampaignIds,
    occurredAt: { seconds: (ev.occurredAt as { seconds: number }).seconds },
  }))

  return (
    <section className="space-y-8">
      <header>
        <Link
          href={`/admin/org/${slug}/ads/budgets`}
          className="eyebrow hover:text-[var(--color-pib-text)]"
        >
          ← Budgets
        </Link>
        <h1 className="pib-page-title mt-2">{budget.name}</h1>
        {budget.description && (
          <p className="pib-page-sub">{budget.description}</p>
        )}
      </header>

      <BudgetDetailClient
        budget={budgetPlain}
        events={eventsPlain}
        orgSlug={slug}
      />
    </section>
  )
}
