// app/(admin)/admin/org/[slug]/ads/campaigns/page.tsx
import Link from 'next/link'
import { resolveOrgIdBySlug } from '@/lib/organizations/resolve-by-slug'
import { listCampaigns } from '@/lib/ads/campaigns/store'
import { AdCampaignsWorkspace } from '@/components/ads/AdCampaignsWorkspace'

interface Params {
  slug: string
}

export default async function CampaignsListPage({
  params,
}: {
  params: Promise<Params>
}) {
  const { slug } = await params
  const orgId = await resolveOrgIdBySlug(slug)
  if (!orgId) {
    return <div className="text-white/60">Org not found.</div>
  }
  const campaigns = await listCampaigns({ orgId })

  return (
    <AdCampaignsWorkspace
      surface="admin"
      title="Campaigns"
      description={`${campaigns.length} total - create, launch, pause, and review paid campaigns for this client.`}
      campaigns={campaigns}
      campaignHref={(campaign) => `/admin/org/${slug}/ads/campaigns/${campaign.id}`}
      actions={
        <Link
          href={`/admin/org/${slug}/ads/campaigns/new`}
          className="btn-pib-accent text-sm"
        >
          New campaign
        </Link>
      }
      emptyTitle="No campaigns yet."
      emptyBody="Build the first ad campaign from this Ads workspace."
      emptyAction={
        <Link
          href={`/admin/org/${slug}/ads/campaigns/new`}
          className="btn-pib-accent text-sm"
        >
          Build your first campaign
        </Link>
      }
    />
  )
}
