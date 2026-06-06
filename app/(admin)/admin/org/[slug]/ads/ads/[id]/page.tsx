import { resolveOrgIdBySlug } from '@/lib/organizations/resolve-by-slug'
import { getAd } from '@/lib/ads/ads/store'
import { getAdSet } from '@/lib/ads/adsets/store'
import { AdCreativeDetailWorkspace } from '@/components/ads/AdCreativeDetailWorkspace'

interface Params {
  slug: string
  id: string
}

export default async function AdDetailPage({
  params,
}: {
  params: Promise<Params>
}) {
  const { slug, id } = await params
  const orgId = await resolveOrgIdBySlug(slug)
  if (!orgId) return <div className="text-white/60">Org not found.</div>
  const ad = await getAd(id)
  if (!ad || ad.orgId !== orgId) return <div className="text-white/60">Ad not found.</div>
  const adSet = await getAdSet(ad.adSetId)

  return (
    <AdCreativeDetailWorkspace
      ad={ad}
      backHref={adSet ? `/admin/org/${slug}/ads/ad-sets/${adSet.id}` : `/admin/org/${slug}/ads/campaigns`}
      backLabel={adSet ? adSet.name : 'Campaigns'}
    />
  )
}
