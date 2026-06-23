'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { TrendChart } from '@/components/seo/TrendChart'
import { SeoToolHeader, type SprintOption } from '@/components/seo/SeoToolHeader'
import { fetchSeo } from '@/components/seo/seoToolClient'
import type { SeoDashboard } from '@/lib/seo/dashboard'

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`
}

function DeltaPill({ value, invert }: { value: number | undefined; invert?: boolean }) {
  if (value === undefined || value === 0) return null
  const good = invert ? value > 0 : value > 0
  const sign = value > 0 ? '+' : ''
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${good ? 'text-emerald-300' : 'text-red-300'}`}>
      <span className="material-symbols-outlined text-[14px]">{value > 0 ? 'trending_up' : 'trending_down'}</span>
      {sign}{value.toLocaleString('en-ZA', { maximumFractionDigits: 1 })}
    </span>
  )
}

export function SeoDashboardClient({
  dashboard,
  sprints,
  activeSprintId,
}: {
  dashboard: SeoDashboard
  sprints: SprintOption[]
  activeSprintId?: string
}) {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function runAudit() {
    if (!dashboard.sprintId) return
    setRunning(true)
    setMsg(null)
    try {
      await fetchSeo(`/api/v1/seo/sprints/${dashboard.sprintId}/audits`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      setMsg('Audit snapshot created')
      router.refresh()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed to run audit')
    } finally {
      setRunning(false)
    }
  }

  const d = dashboard

  return (
    <div className="space-y-6">
      <SeoToolHeader
        eyebrow="Search performance"
        title="SEO Dashboard"
        description="Organic visibility, authority, and traffic trend across your tracked keywords."
        sprints={sprints}
        activeSprintId={activeSprintId}
        action={
          <button onClick={runAudit} disabled={running || !d.sprintId} className="pib-btn-primary text-sm disabled:opacity-50">
            <span className={`material-symbols-outlined text-[18px] ${running ? 'animate-spin' : ''}`}>
              {running ? 'autorenew' : 'radar'}
            </span>
            {running ? 'Running' : 'Run new audit'}
          </button>
        }
      />

      {!d.sprintId && (
        <div className="pib-card p-8 text-center text-sm text-[var(--color-pib-text-muted)]">
          No active SEO sprint yet. Once your sprint is set up, this dashboard will populate from Search Console.
        </div>
      )}

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card label="Impressions" value={d.totals.impressions.toLocaleString('en-ZA')} icon="visibility" delta={<DeltaPill value={d.deltas?.impressions} />} />
        <Card label="Clicks" value={d.totals.clicks.toLocaleString('en-ZA')} icon="ads_click" delta={<DeltaPill value={d.deltas?.clicks} />} />
        <Card label="Avg position" value={d.totals.avgPosition ? `#${d.totals.avgPosition}` : '-'} icon="format_list_numbered" delta={<DeltaPill value={d.deltas?.avgPosition} invert />} />
        <Card label="CTR" value={pct(d.totals.ctr)} icon="percent" />
      </section>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card label="Domain authority" value={d.domainAuthority !== null ? String(d.domainAuthority) : '—'} icon="shield" />
        <Card label="Backlinks" value={d.backlinks.total.toLocaleString('en-ZA')} icon="link" sub={`${d.backlinks.referringDomains} referring domains`} />
        <Card label="Keywords tracked" value={String(d.keywords.tracked)} icon="key" sub={`${d.keywords.top10} in top 10`} />
        <Card label="Top 3 rankings" value={String(d.keywords.top3)} icon="emoji_events" />
      </section>

      <section className="pib-card-section">
        <div className="pib-card-section-header flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">90-day traffic trend</h3>
            <p className="text-xs text-[var(--color-pib-text-muted)]">Impressions and clicks from Search Console pulls.</p>
          </div>
          {d.lastUpdatedAt && <span className="pib-pill text-[10px]">Updated {d.lastUpdatedAt}</span>}
        </div>
        <div className="p-4">
          <TrendChart
            labels={d.trend.map((t) => t.date.slice(5))}
            series={[
              { label: 'Impressions', points: d.trend.map((t) => t.impressions) },
              { label: 'Clicks', points: d.trend.map((t) => t.clicks), color: '#60a5fa' },
            ]}
            height={240}
          />
        </div>
      </section>

      <section className="pib-card-section overflow-hidden">
        <div className="pib-card-section-header">
          <h3 className="text-sm font-semibold">Top pages</h3>
          <p className="text-xs text-[var(--color-pib-text-muted)]">Highest-traffic pages across tracked keywords.</p>
        </div>
        {d.topPages.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--color-pib-text-muted)]">No page-level data yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] text-left">
                  <th className="px-5 py-3 eyebrow !text-[10px]">Page</th>
                  <th className="px-5 py-3 eyebrow !text-[10px] text-right">Impressions</th>
                  <th className="px-5 py-3 eyebrow !text-[10px] text-right">Clicks</th>
                  <th className="px-5 py-3 eyebrow !text-[10px] text-right">CTR</th>
                  <th className="px-5 py-3 eyebrow !text-[10px] text-right">Avg pos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-pib-line)]">
                {d.topPages.map((p) => (
                  <tr key={p.url} className="hover:bg-[var(--color-pib-surface-2)]">
                    <td className="px-5 py-3 max-w-xs truncate">
                      <a href={p.url} target="_blank" rel="noreferrer" className="hover:text-[var(--color-pib-accent)]">
                        {p.url.replace(/^https?:\/\//, '')}
                      </a>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">{p.impressions.toLocaleString('en-ZA')}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{p.clicks.toLocaleString('en-ZA')}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{pct(p.ctr)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{p.avgPosition ? `#${p.avgPosition}` : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {msg && (
        <div className="fixed bottom-5 right-5 z-50 rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-4 py-3 text-sm shadow-2xl">
          {msg}
        </div>
      )}
    </div>
  )
}

function Card({ label, value, icon, sub, delta }: { label: string; value: string; icon: string; sub?: string; delta?: React.ReactNode }) {
  return (
    <div className="pib-stat-card">
      <div className="flex items-start justify-between">
        <p className="eyebrow !text-[10px]">{label}</p>
        <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">{icon}</span>
      </div>
      <p className="mt-3 font-display text-3xl leading-none tracking-tight md:text-4xl">{value}</p>
      <div className="mt-2 flex items-center gap-2">
        {delta}
        {sub && <p className="text-[11px] text-[var(--color-pib-text-muted)]">{sub}</p>}
      </div>
    </div>
  )
}
