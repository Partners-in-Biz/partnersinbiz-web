import { notFound } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { buildCampaignAssets } from '@/lib/campaigns/assets'
import { serializeForClient } from '@/lib/campaigns/serialize'
import { AssetGrid } from '@/components/campaign-cockpit/AssetGrid'
import '@/components/studio/studio-ui.css'

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
    <main className="mx-auto max-w-7xl px-8 py-16">
      <header className="pib-page-header">
        <p className="sc-tiny">Content campaign · preview</p>
        <h1 className="sc-article__h2 mt-2">{campaign.name}</h1>
        <p className="sc-body mt-2">
          {campaign.research?.taglines?.master
            ? campaign.research.taglines.master
            : 'Read-only preview of campaign assets.'}
        </p>
      </header>

      <div className="mt-8">
        <AssetGrid
          campaignId={doc.id}
          brand={campaign.brandIdentity}
          social={assets.social ?? []}
          blogs={assets.blogs ?? []}
          videos={assets.videos ?? []}
          filter="all"
          readonly
        />
      </div>

      <footer className="mt-10 border-t border-[var(--sc-line)] pt-6">
        <p className="sc-tiny">
          Read-only preview. Sign in at{' '}
          <a href="/portal" className="underline">
            partnersinbiz.online/portal
          </a>{' '}
          to approve, request changes, or schedule.
        </p>
      </footer>
    </main>
  )
}
