import { redirect, notFound } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { loadCampaignWithAssets } from '@/lib/campaigns/load'
import type { PreviewBrand } from '@/components/campaign-preview'
import {
  CampaignCockpitFrame,
  campaignMonthLabel,
} from '@/components/campaign-cockpit/CampaignCockpitFrame'
import { toPreviewBrand, type BrandColorsLike } from '@/lib/organizations/toPreviewBrand'
import { CampaignCockpitClient } from '@/components/campaign-cockpit/CampaignCockpitClient'
import { resolvePortalCampaignUser } from '../../../campaigns/portalCampaignScope'
import { isPersonalCampaignRecord } from '@/lib/social/account-scope'

export const dynamic = 'force-dynamic'

export default async function PersonalCampaignCockpitPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await resolvePortalCampaignUser()
  if (!user) redirect('/login')
  if (user.forbidden) notFound()

  const { id } = await params
  const loaded = await loadCampaignWithAssets(id)
  if (!loaded) notFound()

  const { campaign, assets } = loaded
  if (!user.orgId || campaign.orgId !== user.orgId) notFound()
  if (!isPersonalCampaignRecord(campaign) || campaign.ownerUid !== user.uid) notFound()

  const orgSnap = await adminDb.collection('organizations').doc(user.orgId).get()
  const org = orgSnap.data() ?? {}
  const settings = (org.settings ?? {}) as Record<string, unknown>
  const brandColors = (settings.brandColors ?? undefined) as BrandColorsLike | undefined
  const orgName = typeof org.name === 'string' ? org.name : ''
  const previewBrand: PreviewBrand | undefined = toPreviewBrand(brandColors, org.brandProfile, orgName)

  return (
    <CampaignCockpitFrame brandColors={brandColors}>
      <CampaignCockpitClient
        campaignId={id}
        campaign={campaign}
        assets={assets}
        brand={previewBrand}
        orgName={orgName}
        monthLabel={campaignMonthLabel(campaign.createdAt)}
        shareToken={campaign.shareToken}
        shareEnabled={campaign.shareEnabled !== false}
        backHref="/portal/personal/campaigns"
        backLabel="Personal campaigns"
        basePath={`/portal/personal/campaigns/${id}`}
        assetApprovalMode="client"
        showClientBlogApprovals
      />
    </CampaignCockpitFrame>
  )
}
