import { notFound, redirect } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { getBrandKitForOrg } from '@/lib/brand-kit/store'
import { EmailCampaignEditor } from '@/components/campaigns/EmailCampaignEditor'
import type { EmailDocument } from '@/lib/email-builder/types'
import {
  resolvePortalCampaignUser,
  scopedPortalHref,
  scopeFromSearchParams,
  type PortalCampaignSearchParams,
} from '../../../portalCampaignScope'

export const dynamic = 'force-dynamic'

function toIso(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'object') {
    const ts = value as { toDate?: () => Date; _seconds?: number; seconds?: number }
    if (typeof ts.toDate === 'function') {
      try { return ts.toDate().toISOString() } catch { return null }
    }
    const seconds = ts._seconds ?? ts.seconds
    if (typeof seconds === 'number') return new Date(seconds * 1000).toISOString()
  }
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    return Number.isNaN(ms) ? null : new Date(ms).toISOString()
  }
  return null
}

export default async function EditEmailCampaignPage({
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

  const snap = await adminDb.collection('campaigns').doc(id).get()
  if (!snap.exists) notFound()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = snap.data() as any
  if (data.orgId !== user.orgId) notFound()
  if (data.deleted) notFound()

  const [brandKit, domainSnap] = await Promise.all([
    getBrandKitForOrg(data.orgId),
    data.fromDomainId
      ? adminDb.collection('email_domains').doc(data.fromDomainId).get()
      : Promise.resolve(null),
  ])

  const hasVerifiedDomain = Boolean(
    domainSnap && domainSnap.exists && domainSnap.data()?.status === 'verified' && domainSnap.data()?.deleted !== true,
  )

  const emailDocument: EmailDocument | null =
    data.emailDocument && typeof data.emailDocument === 'object' ? (data.emailDocument as EmailDocument) : null

  const overviewHref = scopedPortalHref(`/portal/campaigns/email/${id}`, scope)

  return (
    <EmailCampaignEditor
      campaign={{
        id: snap.id,
        orgId: data.orgId,
        name: typeof data.name === 'string' ? data.name : 'Untitled campaign',
        subject: typeof data.subject === 'string' ? data.subject : '',
        previewText: typeof data.previewText === 'string' ? data.previewText : '',
        status: typeof data.status === 'string' ? data.status : 'draft',
        emailDocument,
        scheduledAtIso: toIso(data.scheduledAt),
        postalAddress: brandKit.postalAddress || '',
        hasVerifiedDomain,
      }}
      overviewHref={overviewHref}
      brandPrimary={brandKit.primaryColor}
      brandBackground={brandKit.backgroundColor}
    />
  )
}
