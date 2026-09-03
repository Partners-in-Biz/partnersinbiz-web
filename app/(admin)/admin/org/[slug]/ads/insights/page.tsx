// app/(admin)/admin/org/[slug]/ads/insights/page.tsx
import { resolveOrgIdBySlug } from '@/lib/organizations/resolve-by-slug'
import { listCampaigns } from '@/lib/ads/campaigns/store'

interface Params { slug: string }

export default async function InsightsRollupPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const orgId = await resolveOrgIdBySlug(slug)
  if (!orgId) return <p className="pib-page-sub">Org not found.</p>

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
    <section className="space-y-8">
      <header>
        <p className="eyebrow">Ads · Insights</p>
        <h1 className="pib-page-title mt-2">Insights</h1>
        <p className="pib-page-sub">Meta paid ad performance across this workspace.</p>
      </header>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Kpi label="Today's spend" value={`$${todaySpend.toFixed(2)}`} />
        <Kpi label="7d spend" value={`$${weekSpend.toFixed(2)}`} />
        <Kpi label="30d spend" value={`$${monthSpend.toFixed(2)}`} />
        <Kpi label="7d impressions" value={weekImpressions.toLocaleString()} />
        <Kpi label="7d conversions" value={weekConversions.toLocaleString()} />
      </div>

      <section className="space-y-3">
        <h2 className="pib-label">
          Active campaigns ({campaigns.length})
        </h2>
        {campaigns.length === 0 ? (
          <div className="pib-empty-state">
            
            <p className="pib-empty-state-description">No active campaigns. Client-approved campaigns can be launched from the admin Campaigns tab after spend gates pass.</p>
          </div>
        ) : (
          <div className="pib-surface pib-surface-list">
            <ul className="divide-y divide-[var(--color-pib-line)]">
              {campaigns.map((c) => (
                <li key={c.id} className="px-4 py-3 text-sm">
                  <a
                    href={`/admin/org/${slug}/ads/campaigns/${c.id}/insights`}
                    className="text-[var(--color-pib-text)] hover:text-[var(--st-danger)]"
                  >
                    {c.name}
                  </a>
                  <span className="ml-2 text-xs text-[var(--color-pib-text-muted)]">{c.objective.toLowerCase()}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </section>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="pib-stat-card">
      <div className="pib-label mb-0">{label}</div>
      <div className="mt-1 pib-page-title text-2xl">{value}</div>
    </div>
  )
}
