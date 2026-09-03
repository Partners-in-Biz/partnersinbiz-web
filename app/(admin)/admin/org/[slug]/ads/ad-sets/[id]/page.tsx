// app/(admin)/admin/org/[slug]/ads/ad-sets/[id]/page.tsx
// Sub-3a Phase 2 Batch 4  -  mounts KeywordEditor for Google ad sets.
import Link from 'next/link'
import { resolveOrgIdBySlug } from '@/lib/organizations/resolve-by-slug'
import { getAdSet } from '@/lib/ads/adsets/store'
import { listAds } from '@/lib/ads/ads/store'
import { getCampaign } from '@/lib/ads/campaigns/store'
import { AdSetKeywordsSection } from './AdSetKeywordsSection'

interface Params {
  slug: string
  id: string
}

export default async function AdSetDetailPage({
  params,
}: {
  params: Promise<Params>
}) {
  const { slug, id } = await params
  const orgId = await resolveOrgIdBySlug(slug)
  if (!orgId) return <div className="pib-empty-state-description">Org not found.</div>
  const adSet = await getAdSet(id)
  if (!adSet || adSet.orgId !== orgId) {
    return <div className="pib-empty-state-description">Ad set not found.</div>
  }
  const [parent, ads] = await Promise.all([
    getCampaign(adSet.campaignId),
    listAds({ orgId, adSetId: id }),
  ])
  const metaId = (adSet.providerData?.meta as { id?: string } | undefined)?.id

  return (
    <article className="space-y-8">
      <header>
        <Link
          href={
            parent
              ? `/admin/org/${slug}/ads/campaigns/${parent.id}`
              : `/admin/org/${slug}/ads/campaigns`
          }
          className="eyebrow hover:text-[var(--color-pib-text)]"
        >
          ← {parent ? parent.name : 'Campaigns'}
        </Link>
        <h1 className="pib-page-title mt-2">{adSet.name}</h1>
        <p className="pib-page-sub">
          {adSet.optimizationGoal.toLowerCase()} · {adSet.billingEvent.toLowerCase()} · {adSet.status.toLowerCase()}
          {metaId && <> · Meta id <code className="text-[var(--color-pib-text-faint)]">{metaId}</code></>}
        </p>
      </header>

      {adSet.platform !== 'google' && (
        <section className="space-y-2">
          <h2 className="pib-label">Targeting</h2>
          <dl className="pib-card grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-[var(--color-pib-text-muted)]">Countries</dt>
              <dd>{adSet.targeting.geo.countries?.join(', ') ?? ' - '}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-pib-text-muted)]">Age range</dt>
              <dd>
                {adSet.targeting.demographics.ageMin}-{adSet.targeting.demographics.ageMax}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--color-pib-text-muted)]">Genders</dt>
              <dd>{adSet.targeting.demographics.genders?.join(', ') ?? 'All'}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-pib-text-muted)]">Placements</dt>
              <dd>
                {Object.entries(adSet.placements)
                  .filter(([, v]) => v)
                  .map(([k]) => k)
                  .join(', ')}
              </dd>
            </div>
          </dl>
        </section>
      )}

      {/* Keywords panel  -  Google only */}
      {adSet.platform === 'google' && (
        <AdSetKeywordsSection
          orgId={orgId}
          adSetId={id}
          campaignId={adSet.campaignId}
        />
      )}

      <section className="space-y-2">
        <h2 className="pib-label">Ads ({ads.length})</h2>
        <ul className="pib-surface pib-surface-list divide-y divide-[var(--color-pib-line)]">
          {ads.map((a) => (
            <li key={a.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <Link
                href={`/admin/org/${slug}/ads/ads/${a.id}`}
                className="font-medium hover:text-[var(--color-pib-rose)]"
              >
                {a.name} <span className="text-xs text-[var(--color-pib-text-faint)]">{a.format.toLowerCase()}</span>
              </Link>
              <span className="pib-pill pib-pill-rose">{a.status.toLowerCase()}</span>
            </li>
          ))}
        </ul>
      </section>
    </article>
  )
}
