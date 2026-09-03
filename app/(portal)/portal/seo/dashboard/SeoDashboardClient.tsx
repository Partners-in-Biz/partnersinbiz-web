'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { TrendChart } from '@/components/seo/TrendChart'
import { SeoToolHeader, type SprintOption } from '@/components/seo/SeoToolHeader'
import { StatCard } from '@/components/ui/StatCard'
import { fetchSeo } from '@/components/seo/seoToolClient'
import type { SeoDashboard } from '@/lib/seo/dashboard'
import { Icon } from '@/components/studio'

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`
}

function DeltaPill({ value, invert }: { value: number | undefined; invert?: boolean }) {
  if (value === undefined || value === 0) return null
  const good = invert ? value > 0 : value > 0
  const sign = value > 0 ? '+' : ''
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] ${good ? 'text-emerald-300' : 'text-red-300'}`}>
      <Icon name={value > 0 ? 'trending_up' : 'trending_down'} />
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
    <div className="space-y-4" data-module-accent="green">
      <SeoToolHeader
        eyebrow="Search performance"
        title="SEO Dashboard"
        description="Organic visibility, authority, and traffic trend across your tracked keywords."
        sprints={sprints}
        activeSprintId={activeSprintId}
        action={
          <button onClick={runAudit} disabled={running || !d.sprintId} className="st-btn st-btn--primary st-btn--sm disabled:opacity-50">
            <span className={`inline-flex ${running ? 'animate-spin' : ''}`}>
              <Icon name={running ? 'autorenew' : 'radar'} />
            </span>
            {running ? 'Running' : 'Run new audit'}
          </button>
        }
      />

      {!d.sprintId && (
        <div className="st-panel p-5 text-center text-sm text-[var(--color-pib-text-muted)]">
          No active SEO sprint yet. Once your sprint is set up, this dashboard will populate from Search Console.
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard accent="green" label="Impressions" value={d.totals.impressions.toLocaleString('en-ZA')} icon="visibility" detail={<DeltaPill value={d.deltas?.impressions} />} />
        <StatCard accent="green" label="Clicks" value={d.totals.clicks.toLocaleString('en-ZA')} icon="ads_click" detail={<DeltaPill value={d.deltas?.clicks} />} />
        <StatCard accent="green" label="Avg position" value={d.totals.avgPosition ? `#${d.totals.avgPosition}` : '-'} icon="format_list_numbered" detail={<DeltaPill value={d.deltas?.avgPosition} invert />} />
        <StatCard accent="green" label="CTR" value={pct(d.totals.ctr)} icon="percent" />
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard accent="green" label="Domain authority" value={d.domainAuthority !== null ? String(d.domainAuthority) : ' - '} icon="shield" />
        <StatCard accent="green" label="Backlinks" value={d.backlinks.total.toLocaleString('en-ZA')} icon="link" detail={`${d.backlinks.referringDomains} referring domains`} />
        <StatCard accent="green" label="Keywords tracked" value={String(d.keywords.tracked)} icon="key" detail={`${d.keywords.top10} in top 10`} />
        <StatCard accent="green" label="Top 3 rankings" value={String(d.keywords.top3)} icon="emoji_events" />
      </section>

      <section className="pib-card-section">
        <div className="pib-card-section-header flex items-center justify-between">
          <div>
            <h3 className="text-sm">90-day traffic trend</h3>
            <p className="text-xs text-[var(--color-pib-text-muted)]">Impressions and clicks from Search Console pulls.</p>
          </div>
          {d.lastUpdatedAt && <span className="pib-pill pib-pill-success text-[10px]">Updated {d.lastUpdatedAt}</span>}
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
          <h3 className="text-sm">Top pages</h3>
          <p className="text-xs text-[var(--color-pib-text-muted)]">Highest-traffic pages across tracked keywords.</p>
        </div>
        {d.topPages.length === 0 ? (
          <div className="p-5 text-center text-sm text-[var(--color-pib-text-muted)]">No page-level data yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] text-left">
                  <th className="px-5 py-3 sc-tiny !text-[10px]">Page</th>
                  <th className="px-5 py-3 sc-tiny !text-[10px] text-right">Impressions</th>
                  <th className="px-5 py-3 sc-tiny !text-[10px] text-right">Clicks</th>
                  <th className="px-5 py-3 sc-tiny !text-[10px] text-right">CTR</th>
                  <th className="px-5 py-3 sc-tiny !text-[10px] text-right">Avg pos</th>
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
        <div className="fixed bottom-5 right-5 z-50 border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-sm">
          {msg}
        </div>
      )}
    </div>
  )
}
