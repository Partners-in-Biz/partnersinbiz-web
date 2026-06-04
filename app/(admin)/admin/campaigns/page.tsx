import { Timestamp } from 'firebase-admin/firestore'
import type * as FirebaseFirestore from 'firebase-admin/firestore'
import { redirect } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { getCurrentAdminUserFromCookies } from '@/lib/api/currentAdmin'
import { restrictedAdminOrgIds } from '@/lib/api/platformAdmin'
import {
  CampaignsWorkspace,
  type CampaignWorkspaceRecord,
} from '@/components/campaigns/CampaignsWorkspace'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(value: any): any {
  if (value === null || value === undefined) return value
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (Array.isArray(value)) return value.map(serialize)
  if (typeof value === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(value)) out[k] = serialize(v)
    return out
  }
  return value
}

export default async function CampaignsIndexPage() {
  const user = await getCurrentAdminUserFromCookies()
  if (!user) redirect('/login')
  const allowedOrgIds = restrictedAdminOrgIds(user)

  let query: FirebaseFirestore.Query = adminDb.collection('campaigns')
  if (allowedOrgIds.length > 0 && allowedOrgIds.length <= 30) {
    query = query.where('orgId', 'in', allowedOrgIds)
  } else {
    query = query.where('deleted', '==', false)
  }

  const snap = await query.get()

  const campaigns = snap.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d) => serialize({ id: d.id, ...(d.data() as any) }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((c: any) => c.deleted !== true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((c: any) => allowedOrgIds.length === 0 || allowedOrgIds.includes(String(c.orgId ?? '')))
    // Only content-engine campaigns (have clientType + brandIdentity OR research). Filter out legacy email-program campaigns sharing the collection.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((c: any) => c.clientType || c.brandIdentity || c.research)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .sort((a: any, b: any) => {
      const at = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return bt - at
    }) as CampaignWorkspaceRecord[]

  return (
    <CampaignsWorkspace
      surface="admin"
      eyebrow="Platform"
      description="Multi-org content campaigns across research, brand, blogs, videos, and social."
      contentCampaigns={campaigns}
      emailPrograms={[]}
      broadcasts={[]}
      adCampaigns={[]}
      requests={[]}
      visibleSections={['content']}
      contentMeta={(campaign) => (
        <div className="space-y-1">
          <p>
            {String(campaign.clientType ?? '—')} · org: <code>{String(campaign.orgId ?? '—')}</code>
          </p>
          {Array.isArray(campaign.calendar) && (
            <p>{campaign.calendar.length} planned slots</p>
          )}
          {campaign.shareEnabled !== false && typeof campaign.shareToken === 'string' && (
            <p className="text-[var(--color-pib-accent)] truncate">
              /c/{campaign.shareToken.slice(0, 12)}…
            </p>
          )}
        </div>
      )}
      hrefs={{
        content: (campaign) => `/admin/campaigns/${campaign.id}`,
        email: (campaign) => `/admin/campaigns/${campaign.id}`,
        broadcast: (broadcast) => `/admin/broadcasts/${broadcast.id}`,
        ad: (campaign) => `/admin/ads/campaigns/${campaign.id}`,
      }}
    />
  )
}
