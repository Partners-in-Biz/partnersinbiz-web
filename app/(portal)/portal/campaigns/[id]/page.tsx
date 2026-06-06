import { redirect, notFound } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { loadCampaignWithAssets } from '@/lib/campaigns/load'
import type { PreviewBrand } from '@/components/campaign-preview'
import {
  CampaignCockpitFrame,
  campaignMonthLabel,
} from '@/components/campaign-cockpit/CampaignCockpitFrame'
import { toPreviewBrand, type BrandColorsLike } from '@/lib/organizations/toPreviewBrand'
import { PortalCampaignCockpitClient } from '@/components/campaign-cockpit/PortalCampaignCockpitClient'
import {
  resolvePortalCampaignUser,
  scopedPortalHref,
  scopeFromSearchParams,
  type PortalCampaignSearchParams,
} from '../portalCampaignScope'

export const dynamic = 'force-dynamic'

export default async function PortalCampaignCockpitPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams?: Promise<PortalCampaignSearchParams>
}) {
  const resolvedSearchParams = await searchParams
  const scope = scopeFromSearchParams(resolvedSearchParams)
  const user = await resolvePortalCampaignUser(scope.orgId)
  if (!user) redirect('/login')
  if (user.forbidden) notFound()

  const { id } = await params
  const loaded = await loadCampaignWithAssets(id)
  if (!loaded) notFound()

  const { campaign, assets } = loaded
  if (campaign.orgId !== user.orgId) notFound()

  const isEmailCampaign =
    Boolean(campaign.sequenceId) ||
    (!campaign.clientType && !campaign.research && !campaign.brandIdentity)
  if (isEmailCampaign) {
    redirect(scopedPortalHref(`/portal/campaigns/email/${id}`, scope))
  }

  const orgSnap = await adminDb.collection('organizations').doc(user.orgId!).get()
  const org = orgSnap.data() ?? {}
  const settings = (org.settings ?? {}) as Record<string, unknown>
  const brandColors = (settings.brandColors ?? undefined) as BrandColorsLike | undefined
  const orgName = typeof org.name === 'string' ? org.name : ''
  const previewBrand: PreviewBrand | undefined = toPreviewBrand(brandColors, org.brandProfile, orgName)

  return (
    <CampaignCockpitFrame brandColors={brandColors}>
      <PortalCampaignCockpitClient
        campaignId={id}
        campaign={campaign}
        assets={assets}
        brand={previewBrand}
        orgName={orgName}
        monthLabel={campaignMonthLabel(campaign.createdAt)}
        shareToken={campaign.shareToken}
        shareEnabled={campaign.shareEnabled !== false}
      />
    </CampaignCockpitFrame>
  )
}
