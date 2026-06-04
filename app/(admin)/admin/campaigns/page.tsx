import { Timestamp } from 'firebase-admin/firestore'
import type * as FirebaseFirestore from 'firebase-admin/firestore'
import { redirect } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { getCurrentAdminUserFromCookies } from '@/lib/api/currentAdmin'
import { restrictedAdminOrgIds } from '@/lib/api/platformAdmin'
import { CampaignProgramCard } from '@/components/campaigns/CampaignProgramCard'

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
    })

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Content campaigns</h1>
          <p className="text-sm text-[var(--color-pib-text-muted)]">
            Multi-channel content runs — research, brand, blogs, videos, 12 weeks of social.
          </p>
        </div>
      </header>

      {campaigns.length === 0 ? (
        <div className="card p-10 text-center text-sm text-[var(--color-pib-text-muted)]">
          No campaigns yet. Run the <code>content-engine</code> skill to produce one — or{' '}
          <code>POST /api/v1/campaigns</code> with a name + clientType to create a shell.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {campaigns.map((c: any) => (
            <CampaignProgramCard
              key={c.id}
              campaign={c}
              href={`/admin/campaigns/${c.id}`}
              meta={
                <div className="space-y-1">
                  <p>
                    {c.clientType ?? '—'} · org: <code>{c.orgId ?? '—'}</code>
                  </p>
                  {c.calendar && Array.isArray(c.calendar) && (
                    <p>{c.calendar.length} planned slots</p>
                  )}
                  {c.shareEnabled !== false && c.shareToken && (
                    <p className="text-[var(--color-pib-accent)] truncate">
                      /c/{c.shareToken.slice(0, 12)}…
                    </p>
                  )}
                </div>
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}
