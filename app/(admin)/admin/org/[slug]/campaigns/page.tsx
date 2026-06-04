import Link from 'next/link'
import { adminDb } from '@/lib/firebase/admin'
import { resolveOrgIdBySlug } from '@/lib/organizations/resolve-by-slug'
import { serializeForClient } from '@/lib/campaigns/serialize'
import { listCampaigns as listAdCampaigns } from '@/lib/ads/campaigns/store'
import {
  CampaignsWorkspace,
  type CampaignWorkspaceRecord,
} from '@/components/campaigns/CampaignsWorkspace'
import { QuickEmailCampaignCreator } from './QuickEmailCampaignCreator'

export const dynamic = 'force-dynamic'

function isContentCampaign(campaign: CampaignWorkspaceRecord): boolean {
  return Boolean(campaign.clientType || campaign.brandIdentity || campaign.research)
}

function dateValue(record: CampaignWorkspaceRecord): number {
  return typeof record.createdAt === 'string' ? Date.parse(record.createdAt) || 0 : 0
}

export default async function CampaignsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const orgId = await resolveOrgIdBySlug(slug)
  if (!orgId) {
    return <div className="pib-card p-8 text-sm text-[var(--color-pib-text-muted)]">Organisation not found.</div>
  }

  const [orgSnap, campaignsSnap, broadcastsSnap, requestSnap, adCampaignsRaw] = await Promise.all([
    adminDb.collection('organizations').doc(orgId).get(),
    adminDb.collection('campaigns').where('orgId', '==', orgId).where('deleted', '==', false).get(),
    adminDb.collection('broadcasts').where('orgId', '==', orgId).get(),
    adminDb.collection('campaign_requests').where('orgId', '==', orgId).where('deleted', '==', false).get(),
    listAdCampaigns({ orgId }),
  ])

  const orgName = (orgSnap.data()?.name as string | undefined) ?? 'Workspace'
  const campaigns = campaignsSnap.docs
    .map((doc) => serializeForClient({ id: doc.id, ...doc.data() }) as CampaignWorkspaceRecord)
    .sort((a, b) => dateValue(b) - dateValue(a))

  const broadcasts = broadcastsSnap.docs
    .map((doc) => serializeForClient({ id: doc.id, ...doc.data() }) as CampaignWorkspaceRecord)
    .filter((item) => item.deleted !== true)
    .sort((a, b) => dateValue(b) - dateValue(a))

  const requests = requestSnap.docs
    .map((doc) => serializeForClient({ id: doc.id, ...doc.data() }) as CampaignWorkspaceRecord)
    .sort((a, b) => dateValue(b) - dateValue(a))

  const contentCampaigns = campaigns.filter(isContentCampaign)
  const emailPrograms = campaigns.filter((campaign) => !isContentCampaign(campaign))
  const adCampaigns = adCampaignsRaw.map((campaign) => serializeForClient(campaign) as CampaignWorkspaceRecord)

  return (
    <CampaignsWorkspace
      surface="admin"
      eyebrow={orgName}
      orgName={orgName}
      description="Content, email, broadcasts, ads, and client campaign requests in one workspace view."
      contentCampaigns={contentCampaigns}
      emailPrograms={emailPrograms}
      broadcasts={broadcasts}
      adCampaigns={adCampaigns}
      requests={requests}
      workflowPanel={<QuickEmailCampaignCreator orgId={orgId} slug={slug} />}
      actions={
        <>
          <Link href="/admin/campaigns" className="pib-btn-secondary">
            <span className="material-symbols-outlined text-[18px]">palette</span>
            Content engine
          </Link>
          <Link href="/admin/broadcasts" className="pib-btn-secondary">
            <span className="material-symbols-outlined text-[18px]">mail</span>
            Broadcast
          </Link>
          <Link href={`/admin/org/${slug}/ads/campaigns/new`} className="pib-btn-primary">
            <span className="material-symbols-outlined text-[18px]">ads_click</span>
            Ad campaign
          </Link>
        </>
      }
      hrefs={{
        content: (campaign) => `/admin/org/${slug}/social/${campaign.id}`,
        email: (campaign) => `/admin/org/${slug}/campaigns/${campaign.id}`,
        broadcast: (broadcast) => `/admin/broadcasts/${broadcast.id}`,
        ad: (campaign) => `/admin/org/${slug}/ads/campaigns/${campaign.id}`,
      }}
    />
  )
}
