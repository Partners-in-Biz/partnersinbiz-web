// app/(admin)/admin/org/[slug]/ads/insights/page.tsx
import { resolveOrgIdBySlug } from '@/lib/organizations/resolve-by-slug'
import { listCampaigns } from '@/lib/ads/campaigns/store'

interface Params { slug: string }

export default async function InsightsRollupPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const orgId = await resolveOrgIdBySlug(slug)
  if (!orgId) return <div className="text-white/60">Org not found.</div>

  const { adminDb } = await import('@/lib/firebase/admin')
  const today = new Date().toISOString().slice(0, 10)
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)

  async function sumWindow(since: string, metric: string): Promise<number> {
    const snap = await adminDb
      .collection('metrics')
      .where('orgId', '==', orgId)
      .where('source', '==', 'meta_ads')
      .where('level', '==', 'campaign')
      .where('metric', '==', metric)
      .where('date', '>=', since)
      .get()
    return snap.docs.reduce((sum, d) => sum + ((d.data() as { value?: number }).value ?? 0), 0)
  }

  const [todaySpend, weekSpend, monthSpend, weekImpressions, weekConversions] = await Promise.all([
    sumWindow(today, 'ad_spend'),
    sumWindow(sevenDaysAgo, 'ad_spend'),
    sumWindow(thirtyDaysAgo, 'ad_spend'),
    sumWindow(sevenDaysAgo, 'impressions'),
    sumWindow(sevenDaysAgo, 'conversions'),
  ])

  const campaigns = await listCampaigns({ orgId, status: 'ACTIVE' })

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Insights</h1>
        <p className="mt-1 text-sm text-white/60">Meta paid ad performance across this workspace.</p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Today&apos;s spend" value={`$${todaySpend.toFixed(2)}`} />
        <Kpi label="7d spend" value={`$${weekSpend.toFixed(2)}`} />
        <Kpi label="30d spend" value={`$${monthSpend.toFixed(2)}`} />
        <Kpi label="7d impressions" value={weekImpressions.toLocaleString()} />
        <Kpi label="7d conversions" value={weekConversions.toLocaleString()} />
      </div>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-white/40">
          Active campaigns ({campaigns.length})
        </h2>
        {campaigns.length === 0 ? (
          <p className="mt-2 text-sm text-white/40">No active campaigns. Client-approved campaigns can be launched from the admin Campaigns tab after spend gates pass.</p>
        ) : (
          <ul className="mt-2 divide-y divide-white/5 rounded border border-white/10">
            {campaigns.map((c) => (
              <li key={c.id} className="px-4 py-3 text-sm">
                <a
                  href={`/admin/org/${slug}/ads/campaigns/${c.id}/insights`}
                  className="hover:text-[#F5A623]"
                >
                  {c.name}
                </a>
                <span className="ml-2 text-xs text-white/40">{c.objective.toLowerCase()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 p-4">
      <div className="text-xs uppercase tracking-wide text-white/40">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  )
}
