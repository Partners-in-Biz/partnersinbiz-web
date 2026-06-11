'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { BarChart, CountBar, LineChart } from '@/components/email-analytics/charts'
import { scopedApiPath, scopedPortalPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'
import type {
  BroadcastDetailedStats,
  BroadcastHeatmap,
} from '@/lib/email-analytics/aggregate'

export type BroadcastAnalyticsSearchParams = {
  orgId?: string
  orgSlug?: string
  sourceCompanyId?: string
  sourceCompanyName?: string
}

type BroadcastAnalyticsWorkspaceProps = {
  params: Promise<{ id: string }>
  searchParams?: Promise<BroadcastAnalyticsSearchParams>
  surface: 'admin' | 'portal'
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function scopeFromParams(params?: BroadcastAnalyticsSearchParams): PortalOrgRouteScope {
  return {
    orgId: clean(params?.orgId) || undefined,
    orgSlug: clean(params?.orgSlug) || undefined,
    sourceCompanyId: clean(params?.sourceCompanyId) || undefined,
    sourceCompanyName: clean(params?.sourceCompanyName) || undefined,
  }
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

export function BroadcastAnalyticsWorkspace({
  params,
  searchParams,
  surface,
}: BroadcastAnalyticsWorkspaceProps) {
  const [id, setId] = useState<string | null>(null)
  const [orgScope, setOrgScope] = useState<PortalOrgRouteScope>({})
  const [data, setData] = useState<BroadcastDetailedStats | null>(null)
  const [heatmap, setHeatmap] = useState<BroadcastHeatmap | null>(null)
  const [loading, setLoading] = useState(true)
  const [heatmapLoading, setHeatmapLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    Promise.all([params, searchParams ?? Promise.resolve({})])
      .then(([resolvedParams, resolvedSearchParams]) => {
        if (cancelled) return
        const broadcastId = resolvedParams.id
        const nextScope = scopeFromParams(resolvedSearchParams)
        setId(broadcastId)
        setOrgScope(nextScope)
        setLoading(true)
        setHeatmapLoading(true)
        setData(null)
        setHeatmap(null)
        setError(null)

        const detailPath = scopedApiPath(`/api/v1/email-analytics/broadcasts/${broadcastId}`, nextScope)
        const heatmapPath = scopedApiPath(
          `/api/v1/email-analytics/broadcasts/${broadcastId}/heatmap`,
          nextScope,
        )

        return Promise.allSettled([
          fetch(detailPath)
            .then((r) => r.json())
            .then((body) => {
              if (cancelled) return
              if (body.success) setData(body.data)
              else setError(body.error ?? 'Failed to load broadcast analytics')
            }),
          fetch(heatmapPath)
            .then((r) => r.json())
            .then((body) => {
              if (cancelled) return
              if (body.success) setHeatmap(body.data)
            }),
        ])
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load broadcast analytics')
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
          setHeatmapLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [params, searchParams])

  const backHref =
    surface === 'portal'
      ? scopedPortalPath('/portal/email-analytics', orgScope)
      : '/portal/email-analytics'
  const shellClass =
    surface === 'portal'
      ? 'mx-auto max-w-5xl space-y-6'
      : 'p-6 max-w-5xl mx-auto space-y-6'

  if (loading) {
    return (
      <div
        className={
          surface === 'portal'
            ? 'pib-skeleton h-40 rounded-xl'
            : 'p-6 h-40 rounded-xl bg-surface-container animate-pulse'
        }
      />
    )
  }

  if (error || !data) {
    return (
      <div className={surface === 'portal' ? 'mx-auto max-w-5xl space-y-4' : 'p-6 max-w-3xl mx-auto space-y-4'}>
        <BackLink href={backHref} surface={surface} />
        <p className={surface === 'portal' ? 'text-sm text-[var(--color-pib-text-muted)]' : 'text-sm text-on-surface-variant'}>
          {error ?? 'Broadcast analytics not found.'}
        </p>
      </div>
    )
  }

  const { stats, rates, timeline, topClicks, topDomains } = data

  return (
    <div className={shellClass}>
      <BackLink href={backHref} surface={surface} />
      <header>
        {surface === 'portal' && <p className="eyebrow">Email broadcast</p>}
        <h1 className={surface === 'portal' ? 'pib-page-title mt-2' : 'text-2xl font-semibold text-on-surface'}>
          Broadcast detail
        </h1>
        <p className={surface === 'portal' ? 'mt-2 text-xs text-[var(--color-pib-text-muted)]' : 'mt-2 text-xs text-on-surface-variant'}>
          ID: {id}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi surface={surface} label="Audience" value={stats.audienceSize} />
        <Kpi surface={surface} label="Sent" value={stats.sent} />
        <Kpi surface={surface} label="Delivered" value={stats.delivered} sub={pct(rates.deliveryRate)} />
        <Kpi surface={surface} label="Opened" value={stats.opened} sub={pct(rates.openRate)} />
        <Kpi surface={surface} label="Clicked" value={stats.clicked} sub={pct(rates.clickRate)} />
        <Kpi surface={surface} label="Bounced" value={stats.bounced} sub={pct(rates.bounceRate)} tone="warn" />
        <Kpi surface={surface} label="Unsubscribed" value={stats.unsubscribed} sub={pct(rates.unsubRate)} tone="warn" />
        <Kpi surface={surface} label="Failed" value={stats.failed} tone="warn" />
      </div>

      <Section surface={surface} title="Timeline">
        {timeline.length === 0 ? (
          <Empty surface={surface}>No send activity recorded.</Empty>
        ) : (
          <LineChart
            series={[
              { name: 'Sent', points: timeline.map((s) => ({ x: s.date, y: s.sent })) },
              { name: 'Opened', points: timeline.map((s) => ({ x: s.date, y: s.opened })) },
              { name: 'Clicked', points: timeline.map((s) => ({ x: s.date, y: s.clicked })) },
            ]}
          />
        )}
      </Section>

      <div className="grid gap-6 md:grid-cols-2">
        <Section surface={surface} title="Top links clicked">
          {topClicks.length === 0 ? (
            <Empty surface={surface}>No tracked click data.</Empty>
          ) : (
            <BarChart data={topClicks.map((c) => ({ label: c.url, value: c.clicks }))} />
          )}
        </Section>

        <Section surface={surface} title="Top domains">
          {topDomains.length === 0 ? (
            <Empty surface={surface}>No recipient domains recorded.</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead className={surface === 'portal' ? 'text-left text-[var(--color-pib-text-muted)]' : 'text-left text-on-surface-variant'}>
                <tr>
                  <th className="py-2">Domain</th>
                  <th className="py-2 text-right">Sent</th>
                  <th className="py-2 text-right">Open rate</th>
                </tr>
              </thead>
              <tbody>
                {topDomains.map((d) => (
                  <tr
                    key={d.domain}
                    className={surface === 'portal' ? 'border-t border-[var(--color-pib-line)]' : 'border-t border-outline-variant'}
                  >
                    <td className={surface === 'portal' ? 'py-2 text-[var(--color-pib-text)]' : 'py-2 text-on-surface'}>
                      {d.domain}
                    </td>
                    <td className="py-2 text-right tabular-nums">{d.sent}</td>
                    <td className="py-2 text-right tabular-nums">{pct(d.openRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </div>

      <Section surface={surface} title="Link heatmap">
        {heatmapLoading ? (
          <div
            className={
              surface === 'portal'
                ? 'h-32 rounded-lg bg-white/[0.04] animate-pulse'
                : 'h-32 rounded-lg bg-surface-container-high animate-pulse'
            }
          />
        ) : !heatmap || heatmap.linkStats.length === 0 ? (
          <Empty surface={surface}>No tracked link clicks for this broadcast yet.</Empty>
        ) : (
          <div className="space-y-2">
            <div className={surface === 'portal' ? 'mb-2 text-xs text-[var(--color-pib-text-muted)]' : 'mb-2 text-xs text-on-surface-variant'}>
              {heatmap.totalClicks.toLocaleString()} clicks across {heatmap.linkStats.length} link
              {heatmap.linkStats.length === 1 ? '' : 's'}.
            </div>
            {heatmap.linkStats.slice(0, 20).map((link, i) => {
              const max = heatmap.linkStats[0]?.clicks ?? 1
              const label = link.url
              const right = `${link.clicks.toLocaleString()} · ${(link.percentOfTotalClicks * 100).toFixed(1)}%`
              return (
                <CountBar
                  key={`${link.url}|${i}`}
                  label={link.positionInEmail ? `#${link.positionInEmail} · ${label}` : label}
                  value={link.clicks}
                  max={max}
                  rightLabel={right}
                />
              )
            })}
          </div>
        )}
      </Section>
    </div>
  )
}

function BackLink({ href, surface }: { href: string; surface: 'admin' | 'portal' }) {
  return (
    <Link
      href={href}
      className={surface === 'portal' ? 'text-sm text-[var(--color-pib-accent)] hover:underline' : 'text-sm text-amber-500 hover:underline'}
    >
      Back to email analytics
    </Link>
  )
}

function Kpi({
  label,
  value,
  sub,
  tone,
  surface,
}: {
  label: string
  value: number
  sub?: string
  tone?: 'warn'
  surface: 'admin' | 'portal'
}) {
  return (
    <div className={surface === 'portal' ? 'rounded-xl border border-[var(--color-pib-line)] bg-white/[0.03] p-4' : 'rounded-xl bg-surface-container p-4'}>
      <div className={surface === 'portal' ? 'text-xs text-[var(--color-pib-text-muted)]' : 'text-xs text-on-surface-variant'}>
        {label}
      </div>
      <div
        className={
          tone === 'warn'
            ? 'text-2xl font-semibold text-red-400'
            : surface === 'portal'
              ? 'text-2xl font-semibold text-[var(--color-pib-text)]'
              : 'text-2xl font-semibold text-on-surface'
        }
      >
        {value.toLocaleString()}
      </div>
      {sub && (
        <div className={surface === 'portal' ? 'mt-1 text-xs text-[var(--color-pib-text-muted)]' : 'mt-1 text-xs text-on-surface-variant'}>
          {sub}
        </div>
      )}
    </div>
  )
}

function Section({
  title,
  children,
  surface,
}: {
  title: string
  children: ReactNode
  surface: 'admin' | 'portal'
}) {
  return (
    <section>
      <h2 className={surface === 'portal' ? 'mb-2 text-sm font-medium text-[var(--color-pib-text-muted)]' : 'mb-2 text-sm font-medium text-on-surface-variant'}>
        {title}
      </h2>
      <div className={surface === 'portal' ? 'rounded-xl border border-[var(--color-pib-line)] bg-white/[0.03] p-4' : 'rounded-xl bg-surface-container p-4'}>
        {children}
      </div>
    </section>
  )
}

function Empty({ children, surface }: { children: ReactNode; surface: 'admin' | 'portal' }) {
  return (
    <div className={surface === 'portal' ? 'text-sm text-[var(--color-pib-text-muted)]' : 'text-sm text-on-surface-variant'}>
      {children}
    </div>
  )
}
