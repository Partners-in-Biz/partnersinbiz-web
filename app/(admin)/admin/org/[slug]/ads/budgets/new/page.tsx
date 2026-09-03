// app/(admin)/admin/org/[slug]/ads/budgets/new/page.tsx
// Sub-4 Batch 2B  -  Create budget page
import { resolveOrgIdBySlug } from '@/lib/organizations/resolve-by-slug'
import { BudgetCapEditor } from '@/components/ads/BudgetCapEditor'

interface Params {
  slug: string
}

export default async function NewBudgetPage({
  params,
}: {
  params: Promise<Params>
}) {
  const { slug } = await params
  const orgId = await resolveOrgIdBySlug(slug)
  if (!orgId) {
    return <div className="pib-empty-state-description">Org not found.</div>
  }

  return (
    <section className="max-w-2xl space-y-8">
      <header>
        <a
          href={`/admin/org/${slug}/ads/budgets`}
          className="eyebrow hover:text-[var(--color-pib-text)]"
        >
          ← Budgets
        </a>
        <h1 className="pib-page-title mt-2">New budget</h1>
      </header>
      <div className="pib-card">
        <BudgetCapEditor orgId={orgId} orgSlug={slug} />
      </div>
    </section>
  )
}
