import { notFound, redirect } from 'next/navigation'
import { EmailCampaignDetailWorkspace } from '@/components/campaigns/EmailCampaignDetailWorkspace'
import { EmailCampaignDocumentLinker } from '@/components/campaigns/EmailCampaignDocumentLinker'
import { adminDb } from '@/lib/firebase/admin'
import { getBrandKitForOrg } from '@/lib/brand-kit/store'
import type { Campaign } from '@/lib/campaigns/types'
import type { Sequence } from '@/lib/sequences/types'
import type { EmailDomain } from '@/lib/email/domains'
import {
  resolvePortalCampaignUser,
  scopedPortalHref,
  scopeFromSearchParams,
  type PortalCampaignSearchParams,
} from '../../portalCampaignScope'

export const dynamic = 'force-dynamic'

export default async function PortalEmailCampaignPage({
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

  const campaignSnap = await adminDb.collection('campaigns').doc(id).get()
  if (!campaignSnap.exists) notFound()
  const campaign = { id: campaignSnap.id, ...campaignSnap.data() } as Campaign
  if (campaign.orgId !== user.orgId) notFound()
  if (campaign.deleted) notFound()

  const [sequenceSnap, segmentSnap, domainSnap, brandKit] = await Promise.all([
    campaign.sequenceId
      ? adminDb.collection('sequences').doc(campaign.sequenceId).get()
      : Promise.resolve(null),
    campaign.segmentId
      ? adminDb.collection('crm_segments').doc(campaign.segmentId).get()
      : Promise.resolve(null),
    campaign.fromDomainId
      ? adminDb.collection('email_domains').doc(campaign.fromDomainId).get()
      : Promise.resolve(null),
    getBrandKitForOrg(campaign.orgId),
  ])

  const sequence: Sequence | null =
    sequenceSnap && sequenceSnap.exists
      ? ({ id: sequenceSnap.id, ...sequenceSnap.data() } as Sequence)
      : null

  const segment =
    segmentSnap && segmentSnap.exists
      ? { id: segmentSnap.id, name: (segmentSnap.data()?.name as string) ?? 'Segment' }
      : null

  const domain: EmailDomain | null =
    domainSnap && domainSnap.exists
      ? ({ id: domainSnap.id, ...domainSnap.data() } as EmailDomain)
      : null

  const editHref = scopedPortalHref(`/portal/campaigns/email/${campaign.id}/edit`, scope)
  const editable = campaign.status !== 'active' && campaign.status !== 'completed'

  return (
    <EmailCampaignDetailWorkspace
      campaign={campaign}
      sequence={sequence}
      segment={segment}
      domain={domain}
      brand={{
        brandName: brandKit.brandName,
        primaryColor: brandKit.primaryColor,
        accentColor: brandKit.accentColor,
        textColor: brandKit.textColor,
        mutedTextColor: brandKit.mutedTextColor,
      }}
      backHref={scopedPortalHref('/portal/campaigns', scope)}
      reportHref={scopedPortalHref(`/portal/reports?campaignId=${encodeURIComponent(campaign.id)}`, scope)}
      editHref={editable ? editHref : null}
      actions={<EmailCampaignDocumentLinker />}
    />
  )
}
