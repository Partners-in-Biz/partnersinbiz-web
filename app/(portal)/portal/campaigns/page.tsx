import type { CSSProperties } from 'react'
import { notFound, redirect } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { getBrandKitForOrg } from '@/lib/brand-kit/store'
import { serializeForClient } from '@/lib/campaigns/serialize'
import { listCampaigns as listAdCampaigns } from '@/lib/ads/campaigns/store'
import {
  CampaignsWorkspace,
  type CampaignWorkspaceRecord,
} from '@/components/campaigns/CampaignsWorkspace'
import { CampaignRequestPanel } from '@/components/campaigns/CampaignRequestPanel'
import type { Sequence } from '@/lib/sequences/types'
import {
  resolvePortalCampaignUser,
  scopedPortalHref,
  scopeFromSearchParams,
  type PortalCampaignSearchParams,
} from './portalCampaignScope'

export const dynamic = 'force-dynamic'

function isContentCampaign(campaign: CampaignWorkspaceRecord): boolean {
  return Boolean(campaign.clientType || campaign.brandIdentity || campaign.research)
}

function dateValue(record: CampaignWorkspaceRecord, field: 'createdAt' | 'updatedAt'): number {
  const value = record[field]
  return typeof value === 'string' ? Date.parse(value) || 0 : 0
}

function sortByCreatedDesc(a: CampaignWorkspaceRecord, b: CampaignWorkspaceRecord): number {
  return dateValue(b, 'createdAt') - dateValue(a, 'createdAt')
}

function sortByUpdatedDesc(a: CampaignWorkspaceRecord, b: CampaignWorkspaceRecord): number {
  return dateValue(b, 'updatedAt') - dateValue(a, 'updatedAt')
}

export default async function PortalCampaignsIndex({
  searchParams,
}: {
  searchParams?: Promise<PortalCampaignSearchParams>
}) {
  const params = await searchParams
  const scope = scopeFromSearchParams(params)
  const user = await resolvePortalCampaignUser(scope.orgId)
  if (!user) redirect('/login')
  if (user.forbidden) notFound()
  if (!user.orgId) {
    return (
      <div className="pib-card p-10 text-center text-sm text-[var(--color-pib-text-muted)]">
        No organisation linked to this account.
      </div>
    )
  }

  const [campaignsSnap, broadcastsSnap, brandKit, requestSnap, adCampaignsRaw] = await Promise.all([
    adminDb
      .collection('campaigns')
      .where('orgId', '==', user.orgId)
      .where('deleted', '==', false)
      .get(),
    adminDb.collection('broadcasts').where('orgId', '==', user.orgId).get(),
    getBrandKitForOrg(user.orgId),
    adminDb
      .collection('campaign_requests')
      .where('orgId', '==', user.orgId)
      .where('deleted', '==', false)
      .get(),
    listAdCampaigns({ orgId: user.orgId }),
  ])

  const [sequencesSnap, enrollmentsSnap, emailsSnap] = await Promise.all([
    adminDb.collection('sequences').where('orgId', '==', user.orgId).get(),
    adminDb.collection('sequence_enrollments').where('orgId', '==', user.orgId).get(),
    adminDb.collection('emails').where('orgId', '==', user.orgId).limit(1000).get(),
  ])

  const allCampaigns = campaignsSnap.docs
    .map((doc) => serializeForClient({ id: doc.id, ...doc.data() }) as CampaignWorkspaceRecord)
    .sort(sortByCreatedDesc)

  const broadcasts = broadcastsSnap.docs
    .map((doc) => serializeForClient({ id: doc.id, ...doc.data() }) as CampaignWorkspaceRecord)
    .filter((broadcast) => broadcast.deleted !== true)
    .sort(sortByCreatedDesc)

  const requests = requestSnap.docs
    .map((doc) => serializeForClient({ id: doc.id, ...doc.data() }) as CampaignWorkspaceRecord)
    .sort(sortByCreatedDesc)

  const contentCampaigns = allCampaigns.filter(isContentCampaign)
  const emailCampaigns = allCampaigns.filter((campaign) => !isContentCampaign(campaign))
  const campaignSequenceIds = new Set(emailCampaigns.map((campaign) => campaign.sequenceId).filter(Boolean))

  const sequenceStats = new Map<
    string,
    { enrolled: number; sent: number; delivered: number; opened: number; clicked: number }
  >()
  for (const doc of enrollmentsSnap.docs) {
    const data = doc.data()
    const sequenceId = typeof data.sequenceId === 'string' ? data.sequenceId : ''
    if (!sequenceId) continue
    const stats = sequenceStats.get(sequenceId) ?? {
      enrolled: 0,
      sent: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
    }
    stats.enrolled += 1
    sequenceStats.set(sequenceId, stats)
  }

  for (const doc of emailsSnap.docs) {
    const data = doc.data()
    const sequenceId = typeof data.sequenceId === 'string' ? data.sequenceId : ''
    if (!sequenceId) continue
    const status = typeof data.status === 'string' ? data.status : ''
    const stats = sequenceStats.get(sequenceId) ?? {
      enrolled: 0,
      sent: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
    }
    if (status === 'sent' || status === 'opened' || status === 'clicked' || data.sentAt) stats.sent += 1
    if ((status === 'sent' || status === 'opened' || status === 'clicked') && !data.bouncedAt) stats.delivered += 1
    if (status === 'opened' || status === 'clicked' || data.openedAt) stats.opened += 1
    if (status === 'clicked' || data.clickedAt) stats.clicked += 1
    sequenceStats.set(sequenceId, stats)
  }

  const sequencePrograms = sequencesSnap.docs
    .map((doc) => serializeForClient({ ...(doc.data() as Sequence), id: doc.id }) as CampaignWorkspaceRecord)
    .filter((sequence) => sequence.deleted !== true && !campaignSequenceIds.has(sequence.id))
    .map((sequence) => ({
      ...sequence,
      kind: 'sequence',
      stats: sequenceStats.get(sequence.id) ?? {
        enrolled: 0,
        sent: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
      },
    }))
    .sort(sortByUpdatedDesc)

  const emailPrograms: CampaignWorkspaceRecord[] = [
    ...emailCampaigns.map((campaign) => ({ ...campaign, kind: 'campaign' })),
    ...sequencePrograms,
  ]

  const adCampaigns = adCampaignsRaw.map((campaign) => serializeForClient(campaign) as CampaignWorkspaceRecord)

  const brandStyle = {
    ['--brand-primary' as string]: brandKit.primaryColor,
    ['--brand-secondary' as string]: brandKit.secondaryColor,
    ['--brand-accent' as string]: brandKit.accentColor,
  } as CSSProperties

  return (
    <CampaignsWorkspace
      surface="portal"
      eyebrow="Client portal"
      description="Content, email, broadcasts, ads, and campaign requests in one workspace view."
      contentCampaigns={contentCampaigns}
      emailPrograms={emailPrograms}
      broadcasts={broadcasts}
      adCampaigns={adCampaigns}
      requests={requests}
      brandStyle={brandStyle}
      newEmailCampaignHref={scopedPortalHref('/portal/campaigns/email/new', scope)}
      enableCampaignDelete
      requestComposer={
        <CampaignRequestPanel
          orgId={scope.orgId}
          sourceCompanyId={scope.sourceCompanyId}
          sourceCompanyName={scope.sourceCompanyName}
        />
      }
      hrefs={{
        content: (campaign) => scopedPortalHref(`/portal/campaigns/${campaign.id}`, scope),
        email: (campaign) =>
          campaign.kind === 'sequence'
            ? scopedPortalHref(`/portal/settings/sequences/${campaign.id}/edit`, scope)
            : scopedPortalHref(`/portal/campaigns/email/${campaign.id}`, scope),
        broadcast: (broadcast) => scopedPortalHref(`/portal/campaigns/broadcast/${broadcast.id}`, scope),
        ad: (campaign) => scopedPortalHref(`/portal/ads/campaigns/${campaign.id}`, scope),
      }}
    />
  )
}
