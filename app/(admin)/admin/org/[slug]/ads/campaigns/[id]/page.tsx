// app/(admin)/admin/org/[slug]/ads/campaigns/[id]/page.tsx
import { resolveOrgIdBySlug } from '@/lib/organizations/resolve-by-slug'
import { getCampaign } from '@/lib/ads/campaigns/store'
import { listAdSets } from '@/lib/ads/adsets/store'
import { listAds } from '@/lib/ads/ads/store'
import { AdCampaignDetailWorkspace } from '@/components/ads/AdCampaignDetailWorkspace'
import { AdCampaignAdminActions } from '@/components/ads/AdCampaignAdminActions'

interface Params {
  slug: string
  id: string
}

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<Params>
}) {
  const { slug, id } = await params
  const orgId = await resolveOrgIdBySlug(slug)
  if (!orgId) return <div className="text-white/60">Org not found.</div>
  const campaign = await getCampaign(id)
  if (!campaign || campaign.orgId !== orgId) {
    return <div className="text-white/60">Campaign not found.</div>
  }
  const [adSets, ads] = await Promise.all([
    listAdSets({ orgId, campaignId: id }),
    listAds({ orgId, campaignId: id }),
  ])

  return (
    <AdCampaignDetailWorkspace
      surface="admin"
      campaign={campaign}
      adSets={adSets}
      ads={ads}
      backHref={`/admin/org/${slug}/ads/campaigns`}
      actions={
        <AdCampaignAdminActions
          orgId={orgId}
          orgSlug={slug}
          campaignId={id}
          status={campaign.status}
          reviewState={campaign.reviewState}
        />
      }
      adSetHref={(adSet) => `/admin/org/${slug}/ads/ad-sets/${adSet.id}`}
      adHref={(ad) => `/admin/org/${slug}/ads/ads/${ad.id}`}
    />
  )
}
