import { redirect, notFound } from 'next/navigation'
import { getAd } from '@/lib/ads/ads/store'
import { AdCreativeDetailWorkspace } from '@/components/ads/AdCreativeDetailWorkspace'
import { CommentThread } from '@/components/ads/CommentThread'
import {
  resolvePortalAdsUser,
  scopedPortalHref,
  scopeFromSearchParams,
  type PortalAdsSearchParams,
} from '../../portalAdsScope'

export const dynamic = 'force-dynamic'

export default async function PortalAdDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams?: Promise<PortalAdsSearchParams>
}) {
  const { id } = await params
  const resolvedSearchParams = await searchParams
  const scope = scopeFromSearchParams(resolvedSearchParams)
  const user = await resolvePortalAdsUser(scope.orgId)
  if (!user) redirect('/login')
  if (user.forbidden) notFound()

  const ad = await getAd(id)
  if (!ad || ad.orgId !== user.orgId) notFound()

  return (
    <AdCreativeDetailWorkspace
      ad={ad}
      backHref={scopedPortalHref(`/portal/ads/campaigns/${ad.campaignId}`, scope)}
      backLabel="Campaign"
      commentsSlot={<CommentThread adId={id} orgId={scope.orgId} currentUserUid={user.uid} isAdmin={false} />}
    />
  )
}
