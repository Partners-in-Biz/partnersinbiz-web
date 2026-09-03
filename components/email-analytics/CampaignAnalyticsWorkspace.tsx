'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { CountBar, LineChart } from '@/components/email-analytics/charts'
import { PageHeader } from '@/components/ui/AppFoundation'
import { scopedApiPath, scopedPortalPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'
import type { CampaignDetailedStats } from '@/lib/email-analytics/aggregate'

export type CampaignAnalyticsSearchParams = {
  orgId?: string
  orgSlug?: string
  sourceCompanyId?: string
  sourceCompanyName?: string
}

type CampaignAnalyticsWorkspaceProps = {
  params: Promise<{ id: string }>
  searchParams?: Promise<CampaignAnalyticsSearchParams>
  surface: 'admin' | 'portal'
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function scopeFromParams(params?: CampaignAnalyticsSearchParams): PortalOrgRouteScope {
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

const STATUS_LABEL: Record<CampaignDetailedStats['contactActivity'][number]['status'], string> = {
  clicked: 'Clicked',
  opened: 'Opened',
  bounced: 'Bounced',
  delivered: 'Delivered',
  sent: 'Sent',
  none: ' - ',
}

export function CampaignAnalyticsWorkspace({
  params,
  searchParams,
  surface,
}: CampaignAnalyticsWorkspaceProps) {
  const [id, setId] = useState<string | null>(null)
  const [orgScope, setOrgScope] = useState<PortalOrgRouteScope>({})
  const [data, setData] = useState<CampaignDetailedStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let cancelled = false

    Promise.all([params, searchParams ?? Promise.resolve({})])
      .then(([resolvedParams, resolvedSearchParams]) => {
        if (cancelled) return
        const campaignId = resolvedParams.id
        const nextScope = scopeFromParams(resolvedSearchParams)
        setId(campaignId)
        setOrgScope(nextScope)
        setLoading(true)
        setData(null)
        setError(null)

        const detailPath = scopedApiPath(`/api/v1/email-analytics/campaigns/${campaignId}`, nextScope)
        return fetch(detailPath)
          .then((r) => r.json())
          .then((body) => {
            if (cancelled) return
            if (body.success) setData(body.data ?? body)
            else setError(body.error ?? 'Failed to load campaign analytics')
          })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load campaign analytics')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [params, searchParams])

  async function handleExport() {
    if (!id) return
    setExporting(true)
    try {
      const exportPath = scopedApiPath(`/api/v1/email-analytics/campaigns/${id}/export`, orgScope)
      const res = await fetch(exportPath)
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `campaign-${id}-activity.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      // Best-effort  -  surface nothing intrusive; the button just re-enables.
    } finally {
      setExporting(false)
    }
  }

  const backHref =
    surface === 'portal'
      ? scopedPortalPath('/portal/campaigns', orgScope)
      : '/portal/campaigns'
  const shellClass =
    surface === 'portal'
      ? 'mx-auto max-w-5xl space-y-6 p-4'
      : 'mx-auto max-w-5xl space-y-6 p-4 md:p-6'

  if (loading) {
    return (
      <div
        className={
          surface === 'portal'
            ? 'pib-skeleton h-40 rounded-[6px]'
            : 'pib-skeleton h-40 rounded-[6px]'
        }
      />
    )
  }

  if (error || !data) {
    return (
      <div className={surface === 'portal' ? 'mx-auto max-w-5xl space-y-4' : 'p-6 max-w-3xl mx-auto space-y-4'}>
        <BackLink href={backHref} surface={surface} />
        <p className={surface === 'portal' ? 'text-sm text-[var(--color-pib-text-muted)]' : 'text-sm text-[var(--color-pib-text-muted)]'}>
          {error ?? 'Campaign analytics not found.'}
        </p>
      </div>
    )
  }

  const { stats, rates, timeline, topClicks, topDomains, contactActivity } = data
  const maxClick = topClicks[0]?.clicks ?? 1

  return (
    <div className={shellClass} data-module-accent="blue">
      <div className="flex items-center justify-between gap-3">
        <BackLink href={backHref} surface={surface} />
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting || contactActivity.length === 0}
          className="btn-pib-secondary btn-pib-sm disabled:opacity-40"
        >
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      <PageHeader
        accent="blue"
        eyebrow={surface === 'portal' ? 'Email campaign' : undefined}
        title={data.name}
        description={`ID: ${id}`}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi surface={surface} label="Audience" value={stats.audienceSize} />
        <Kpi surface={surface} label="Sent" value={stats.sent} />
        <Kpi surface={surface} label="Delivered" value={stats.delivered} sub={pct(rates.deliveryRate)} />
        <Kpi surface={surface} label="Unique opens" value={stats.opened} sub={pct(rates.openRate)} />
        <Kpi surface={surface} label="Unique clicks" value={stats.clicked} sub={pct(rates.clickRate)} />
        <Kpi surface={surface} label="Hard bounces" value={stats.hardBounced} sub={pct(rates.hardBounceRate)} tone="warn" />
        <Kpi surface={surface} label="Soft bounces" value={stats.softBounced} tone="warn" />
        <Kpi surface={surface} label="Unsubscribed" value={stats.unsubscribed} sub={pct(rates.unsubRate)} tone="warn" />
      </div>

      <Section surface={surface} title="Opens over time">
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
            <div className="space-y-2">
              {topClicks.map((c, i) => (
                <CountBar key={`${c.url}|${i}`} label={c.url} value={c.clicks} max={maxClick} />
              ))}
            </div>
          )}
        </Section>

        <Section surface={surface} title="Top domains">
          {topDomains.length === 0 ? (
            <Empty surface={surface}>No recipient domains recorded.</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead className={surface === 'portal' ? 'text-left text-[var(--color-pib-text-muted)]' : 'text-left text-[var(--color-pib-text-muted)]'}>
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
                    className={surface === 'portal' ? 'border-t border-[var(--color-pib-line)]' : 'border-t border-[var(--color-pib-line)]'}
                  >
                    <td className={surface === 'portal' ? 'py-2 text-[var(--color-pib-text)]' : 'py-2 text-[var(--color-pib-text)]'}>
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

      <Section surface={surface} title={`Contact activity (${contactActivity.length})`}>
        {contactActivity.length === 0 ? (
          <Empty surface={surface}>No contact-level activity yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={surface === 'portal' ? 'text-left text-[var(--color-pib-text-muted)]' : 'text-left text-[var(--color-pib-text-muted)]'}>
                <tr>
                  <th className="py-2">Contact</th>
                  <th className="py-2 text-right">Sent</th>
                  <th className="py-2 text-right">Opened</th>
                  <th className="py-2 text-right">Clicked</th>
                  <th className="py-2 text-right">Bounced</th>
                  <th className="py-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {contactActivity.slice(0, 250).map((r) => (
                  <tr
                    key={r.contactId}
                    className={surface === 'portal' ? 'border-t border-[var(--color-pib-line)]' : 'border-t border-[var(--color-pib-line)]'}
                  >
                    <td className={surface === 'portal' ? 'py-2 text-[var(--color-pib-text)]' : 'py-2 text-[var(--color-pib-text)]'}>
                      <div className="font-medium">{r.name || r.email || r.contactId}</div>
                      {r.name && r.email && (
                        <div className={surface === 'portal' ? 'text-xs text-[var(--color-pib-text-muted)]' : 'text-xs text-[var(--color-pib-text-muted)]'}>
                          {r.email}
                        </div>
                      )}
                    </td>
                    <td className="py-2 text-right tabular-nums">{r.sent}</td>
                    <td className="py-2 text-right tabular-nums">{r.opened}</td>
                    <td className="py-2 text-right tabular-nums">{r.clicked}</td>
                    <td className="py-2 text-right tabular-nums">{r.bounced}</td>
                    <td className="py-2 text-right">{STATUS_LABEL[r.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {contactActivity.length > 250 && (
              <p className={surface === 'portal' ? 'mt-2 text-xs text-[var(--color-pib-text-muted)]' : 'mt-2 text-xs text-[var(--color-pib-text-muted)]'}>
                Showing first 250 of {contactActivity.length}. Export CSV for the full list.
              </p>
            )}
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
      className={surface === 'portal' ? 'text-sm text-[var(--color-pib-accent)] hover:underline' : 'text-sm text-[var(--color-pib-blue)] hover:underline'}
    >
      Back to campaigns
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
    <div
      data-module-accent="blue"
      className={
        surface === 'portal'
          ? 'pib-stat-card rounded-[6px] border border-[var(--color-pib-line)] bg-white/[0.03] p-3'
          : 'pib-stat-card rounded-[6px] border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-3'
      }
    >
      <div className="pib-label text-[10px] tracking-[0.14em] text-[var(--color-pib-text-muted)]">{label}</div>
      <div
        className={
          tone === 'warn'
            ? 'mt-1 text-xl  tabular-nums tracking-tight text-[var(--st-danger)]'
            : 'mt-1 text-xl  tabular-nums tracking-tight text-[var(--color-pib-text)]'
        }
      >
        {value.toLocaleString()}
      </div>
      {sub && <div className="mt-0.5 text-xs text-[var(--color-pib-text-muted)]">{sub}</div>}
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
      <h2 className={surface === 'portal' ? 'mb-2 text-sm font-medium text-[var(--color-pib-text-muted)]' : 'mb-2 text-sm font-medium text-[var(--color-pib-text-muted)]'}>
        {title}
      </h2>
      <div className={surface === 'portal' ? 'rounded-[6px] border border-[var(--color-pib-line)] bg-white/[0.03] p-4' : 'rounded-[6px] border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4'}>
        {children}
      </div>
    </section>
  )
}

function Empty({ children, surface }: { children: ReactNode; surface: 'admin' | 'portal' }) {
  return (
    <div className={surface === 'portal' ? 'text-sm text-[var(--color-pib-text-muted)]' : 'text-sm text-[var(--color-pib-text-muted)]'}>
      {children}
    </div>
  )
}
