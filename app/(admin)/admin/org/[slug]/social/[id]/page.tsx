import { notFound } from 'next/navigation'
import { CampaignCockpitClient } from '@/components/campaign-cockpit/CampaignCockpitClient'
import {
  CampaignCockpitFrame,
  campaignMonthLabel,
} from '@/components/campaign-cockpit/CampaignCockpitFrame'
import { adminDb } from '@/lib/firebase/admin'
import { loadCampaignWithAssets } from '@/lib/campaigns/load'
import { resolveOrgIdBySlug } from '@/lib/organizations/resolve-by-slug'
import {
  toPreviewBrand,
  type BrandColorsLike,
} from '@/lib/organizations/toPreviewBrand'

export const dynamic = 'force-dynamic'

export default async function OrgSocialCampaignPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>
}) {
  const { slug, id } = await params
  const orgId = await resolveOrgIdBySlug(slug)
  if (!orgId) notFound()

  const loaded = await loadCampaignWithAssets(id)
  if (!loaded || loaded.campaign.orgId !== orgId) notFound()

  const orgSnap = await adminDb.collection('organizations').doc(orgId).get()
  const org = orgSnap.data() ?? {}
  const settings = (org.settings ?? {}) as Record<string, unknown>
  const brandColors = (settings.brandColors ?? undefined) as BrandColorsLike | undefined
  const orgName = typeof org.name === 'string' ? org.name : ''
  const previewBrand = toPreviewBrand(brandColors, org.brandProfile, orgName)

  return (
    <CampaignCockpitFrame brandColors={brandColors}>
      <CampaignCockpitClient
        campaignId={id}
        campaign={loaded.campaign}
        assets={loaded.assets}
        brand={previewBrand}
        orgName={orgName}
        monthLabel={campaignMonthLabel(loaded.campaign.createdAt)}
        shareToken={loaded.campaign.shareToken}
        shareEnabled={loaded.campaign.shareEnabled !== false}
        backHref={`/admin/org/${slug}/social`}
        backLabel={orgName || 'All campaigns'}
        basePath={`/admin/org/${slug}/social/${id}`}
        assetApprovalMode="direct"
      />
    </CampaignCockpitFrame>
  )
}
