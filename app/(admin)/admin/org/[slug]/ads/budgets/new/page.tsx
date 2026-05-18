// app/(admin)/admin/org/[slug]/ads/budgets/new/page.tsx
// Sub-4 Batch 2B — Create budget page
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
    return <div className="text-white/60">Org not found.</div>
  }

  return (
    <section className="max-w-2xl space-y-4">
      <header>
        <a
          href={`/admin/org/${slug}/ads/budgets`}
          className="text-xs text-white/40 hover:text-white/60"
        >
          ← Budgets
        </a>
        <h1 className="mt-1 text-2xl font-semibold">New budget</h1>
      </header>
      <div className="rounded-lg border border-white/10 p-5">
        <BudgetCapEditor orgId={orgId} orgSlug={slug} />
      </div>
    </section>
  )
}
