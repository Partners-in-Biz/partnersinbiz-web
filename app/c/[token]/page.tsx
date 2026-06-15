import { notFound } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { buildCampaignAssets } from '@/lib/campaigns/assets'
import { serializeForClient } from '@/lib/campaigns/serialize'
import { AssetGrid } from '@/components/campaign-cockpit/AssetGrid'

export const dynamic = 'force-dynamic'

const STRIPPED_FIELDS = ['createdBy', 'createdByType', 'updatedBy', 'updatedByType', 'orgId', 'clientId']

export default async function PublicCampaignSharePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  if (!token || token.length < 8) notFound()

  const snap = await adminDb
    .collection('campaigns')
    .where('shareToken', '==', token)
    .where('deleted', '==', false)
    .limit(1)
    .get()

  if (snap.empty) notFound()
  const doc = snap.docs[0]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = doc.data() as any
  if (data.shareEnabled === false) notFound()

  const stripped = { ...data }
  for (const f of STRIPPED_FIELDS) delete stripped[f]
  const campaign = serializeForClient({ id: doc.id, ...stripped })

  const assets = serializeForClient(await buildCampaignAssets(doc.id))

  return (
    <div className="min-h-screen bg-[var(--color-pib-bg)] text-[var(--color-pib-text)]">
      <div className="max-w-7xl mx-auto px-6 py-10 space-y-10">
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">
            Content campaign · preview
          </p>
          <h1 className="text-3xl font-semibold">{campaign.name}</h1>
          {campaign.research?.taglines?.master && (
            <p className="text-lg text-[var(--color-pib-text-muted)] max-w-2xl">
              {campaign.research.taglines.master}
            </p>
          )}
        </header>

        <AssetGrid
          campaignId={doc.id}
          brand={campaign.brandIdentity}
          social={assets.social ?? []}
          blogs={assets.blogs ?? []}
          videos={assets.videos ?? []}
          filter="all"
          readonly
        />

        <footer className="border-t border-[var(--color-pib-line)] pt-6 text-xs text-[var(--color-pib-text-muted)]">
          Read-only preview. Sign in at{' '}
          <a href="/portal" className="underline">
            partnersinbiz.online/portal
          </a>{' '}
          to approve, request changes, or schedule.
        </footer>
      </div>
    </div>
  )
}
