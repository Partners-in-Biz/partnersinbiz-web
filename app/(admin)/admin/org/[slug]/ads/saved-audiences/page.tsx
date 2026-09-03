import Link from 'next/link'
import { resolveOrgIdBySlug } from '@/lib/organizations/resolve-by-slug'
import { listSavedAudiences } from '@/lib/ads/saved-audiences/store'

interface Params { slug: string }

export default async function SavedAudiencesPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const orgId = await resolveOrgIdBySlug(slug)
  if (!orgId) return <p className="pib-page-sub">Org not found.</p>
  const sas = await listSavedAudiences({ orgId })

  return (
    <section className="space-y-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="eyebrow">Ads · Saved Audiences</p>
          <h1 className="pib-page-title mt-2">Saved audiences</h1>
          <p className="pib-page-sub">
            Reusable targeting templates. Apply in one click on any ad set.
          </p>
        </div>
        <Link href={`/admin/org/${slug}/ads/saved-audiences/new`} className="btn-pib-primary text-sm">
          New saved audience
        </Link>
      </header>

      {sas.length === 0 ? (
        <div className="pib-empty-state">
          
          <p className="pib-empty-state-description">No saved audiences yet.</p>
        </div>
      ) : (
        <div className="pib-surface pib-surface-list">
          <ul className="divide-y divide-[var(--color-pib-line)]">
            {sas.map((sa) => (
              <li key={sa.id} className="px-5 py-4">
                <div className="font-medium text-[var(--color-pib-text)]">{sa.name}</div>
                {sa.description && (
                  <div className="mt-0.5 text-xs text-[var(--color-pib-text-muted)]">{sa.description}</div>
                )}
                <div className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
                  {sa.targeting.geo.countries?.join(', ') ?? ' - '} · age {sa.targeting.demographics.ageMin}-{sa.targeting.demographics.ageMax}
                  {sa.targeting.customAudiences?.include?.length ? ` · ${sa.targeting.customAudiences.include.length} CA include` : ''}
                  {sa.targeting.customAudiences?.exclude?.length ? ` · ${sa.targeting.customAudiences.exclude.length} CA exclude` : ''}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
