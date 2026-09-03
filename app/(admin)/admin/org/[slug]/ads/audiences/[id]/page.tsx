import Link from 'next/link'
import { resolveOrgIdBySlug } from '@/lib/organizations/resolve-by-slug'
import { getCustomAudience } from '@/lib/ads/custom-audiences/store'
import { listAdSets } from '@/lib/ads/adsets/store'
import { CustomAudienceDetailClient } from './CustomAudienceDetailClient'

interface Params { slug: string; id: string }

export default async function CustomAudienceDetailPage({ params }: { params: Promise<Params> }) {
  const { slug, id } = await params
  const orgId = await resolveOrgIdBySlug(slug)
  if (!orgId) return <div className="pib-empty-state-description">Org not found.</div>
  const ca = await getCustomAudience(id)
  if (!ca || ca.orgId !== orgId) return <div className="pib-empty-state-description">Custom audience not found.</div>
  const allAdSets = await listAdSets({ orgId })
  const usingAdSets = allAdSets.filter((s) => {
    const include = s.targeting?.customAudiences?.include ?? []
    const exclude = s.targeting?.customAudiences?.exclude ?? []
    return include.includes(id) || exclude.includes(id)
  })

  return (
    <article className="space-y-8">
      <header>
        <Link href={`/admin/org/${slug}/ads/audiences`} className="eyebrow hover:text-[var(--color-pib-text)]">
          ← Custom audiences
        </Link>
        <h1 className="pib-page-title mt-2">{ca.name}</h1>
        <p className="pib-page-sub">
          {ca.type.toLowerCase().replace('_', ' ')} · {ca.status.toLowerCase()}
          {ca.approximateSize != null && ` · ~${ca.approximateSize.toLocaleString()} users`}
        </p>
      </header>

      <CustomAudienceDetailClient
        orgId={orgId}
        orgSlug={slug}
        caId={ca.id}
        currentStatus={ca.status}
      />

      <section className="space-y-2">
        <h2 className="pib-label">Source</h2>
        <pre className="pib-surface pib-surface-table p-3 text-xs overflow-x-auto">
{JSON.stringify(ca.source, null, 2)}
        </pre>
      </section>

      <section className="space-y-2">
        <h2 className="pib-label">
          Used in {usingAdSets.length} ad {usingAdSets.length === 1 ? 'set' : 'sets'}
        </h2>
        {usingAdSets.length === 0 ? (
          <p className="text-sm text-[var(--color-pib-text-muted)]">Not yet referenced.</p>
        ) : (
          <ul className="pib-surface pib-surface-list divide-y divide-[var(--color-pib-line)]">
            {usingAdSets.map((s) => (
              <li key={s.id} className="px-4 py-3 text-sm">
                <Link href={`/admin/org/${slug}/ads/ad-sets/${s.id}`} className="hover:text-[var(--st-danger)]">
                  {s.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {ca.lastError && (
        <section className="rounded-md border border-[var(--color-error)]/30 bg-[var(--color-error-container)] p-4 text-sm">
          <div className="font-medium text-[var(--color-error)]">Last error</div>
          <div className="mt-1 text-xs text-[var(--color-pib-text-muted)]">{ca.lastError}</div>
        </section>
      )}
    </article>
  )
}
