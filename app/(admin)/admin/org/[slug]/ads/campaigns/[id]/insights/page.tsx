import Link from 'next/link'
import { resolveOrgIdBySlug } from '@/lib/organizations/resolve-by-slug'
import { getCampaign } from '@/lib/ads/campaigns/store'
import { InsightsChart } from '@/components/ads/InsightsChart'
import { RefreshButton } from '@/components/ads/RefreshButton'

interface Params { slug: string; id: string }

export default async function CampaignInsightsPage({ params }: { params: Promise<Params> }) {
  const { slug, id } = await params
  const orgId = await resolveOrgIdBySlug(slug)
  if (!orgId) return <div className="text-white/60">Org not found.</div>
  const campaign = await getCampaign(id)
  if (!campaign || campaign.orgId !== orgId) return <div className="text-white/60">Campaign not found.</div>

  const metaId = (campaign.providerData?.meta as { id?: string } | undefined)?.id

  return (
    <article className="space-y-6">
      <header>
        <Link href={`/admin/org/${slug}/ads/campaigns/${id}`} className="text-xs text-white/40 hover:text-white/60">
          ← {campaign.name}
        </Link>
        <div className="mt-1 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Insights</h1>
          <RefreshButton orgId={orgId} level="campaign" pibEntityId={id} />
        </div>
        {campaign.lastRefreshedAt && (
          <p className="text-xs text-white/40">
            Last refreshed {new Date(campaign.lastRefreshedAt.toMillis()).toLocaleString()}
          </p>
        )}
      </header>

      {!metaId ? (
        <p className="text-sm text-white/40">Campaign is not live yet — record client approval and complete admin launch gates before insights can collect.</p>
      ) : (
        <InsightsChart orgId={orgId} level="campaign" pibEntityId={id} daysBack={7} />
      )}
    </article>
  )
}
