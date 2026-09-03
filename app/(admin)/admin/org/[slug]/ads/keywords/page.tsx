// app/(admin)/admin/org/[slug]/ads/keywords/page.tsx
// Keywords directory page  -  MVP landing.
// Keyword management is scoped to an ad group (Google Ad Group), so we direct
// admins to the ad group detail page which mounts KeywordEditor directly.
// A full cross-org keyword listing would require an index scan with no adSetId
// filter and is deferred until there is a clear product need.
// Sub-3a Phase 2 Batch 4.

import Link from 'next/link'
import { resolveOrgIdBySlug } from '@/lib/organizations/resolve-by-slug'
import { listCampaigns } from '@/lib/ads/campaigns/store'
import { listAdSets } from '@/lib/ads/adsets/store'
import type { AdPlatform } from '@/lib/ads/types'

interface Params {
  slug: string
}

export default async function KeywordsPage({
  params,
}: {
  params: Promise<Params>
}) {
  const { slug } = await params
  const orgId = await resolveOrgIdBySlug(slug)
  if (!orgId) return <p className="pib-page-sub">Org not found.</p>

  const [campaigns, adSets] = await Promise.all([
    listCampaigns({ orgId, platform: 'google' as AdPlatform }),
    listAdSets({ orgId }),
  ])

  const googleAdSets = adSets.filter((a) => a.platform === 'google')

  return (
    <article className="space-y-8">
      <header>
        <p className="eyebrow">Ads · Keywords</p>
        <h1 className="pib-page-title mt-2">Keywords</h1>
        <p className="pib-page-sub">
          Keywords are managed per ad group. Select an ad group below to view and edit its keywords.
        </p>
      </header>

      {googleAdSets.length === 0 ? (
        <div className="pib-empty-state">
          
          <p className="pib-empty-state-description">
            No Google ad groups yet.{' '}
            <Link
              href={`/admin/org/${slug}/ads/campaigns/new`}
              className="text-[var(--st-danger)] hover:underline"
            >
              Create a Google Search campaign
            </Link>{' '}
            to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {campaigns.map((campaign) => {
            const sets = googleAdSets.filter((a) => a.campaignId === campaign.id)
            if (sets.length === 0) return null
            return (
              <section key={campaign.id} className="space-y-2">
                <h2 className="pib-label">
                  {campaign.name}
                </h2>
                <div className="pib-surface pib-surface-list">
                  <ul className="divide-y divide-[var(--color-pib-line)]">
                    {sets.map((adSet) => (
                      <li key={adSet.id}>
                        <Link
                          href={`/admin/org/${slug}/ads/ad-sets/${adSet.id}`}
                          className="flex items-center justify-between px-4 py-3 text-sm hover:bg-[var(--color-row-hover)] transition-colors"
                        >
                          <span className="font-medium text-[var(--color-pib-text)]">{adSet.name}</span>
                          <span className="text-xs text-[var(--st-danger)]">Manage keywords →</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )
          })}
        </div>
      )}
    </article>
  )
}
