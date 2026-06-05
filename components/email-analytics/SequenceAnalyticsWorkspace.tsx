'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { BarChart, Donut } from '@/components/admin/email-analytics/charts'
import { scopedApiPath, scopedPortalPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'
import type { SequenceDetailedStats } from '@/lib/email-analytics/aggregate'

export type SequenceAnalyticsSearchParams = {
  orgId?: string
  orgSlug?: string
}

type SequenceAnalyticsWorkspaceProps = {
  params: Promise<{ id: string }>
  searchParams?: Promise<SequenceAnalyticsSearchParams>
  surface: 'admin' | 'portal'
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function scopeFromParams(params?: SequenceAnalyticsSearchParams): PortalOrgRouteScope {
  return {
    orgId: clean(params?.orgId) || undefined,
    orgSlug: clean(params?.orgSlug) || undefined,
  }
}

export function SequenceAnalyticsWorkspace({
  params,
  searchParams,
  surface,
}: SequenceAnalyticsWorkspaceProps) {
  const [id, setId] = useState<string | null>(null)
  const [orgScope, setOrgScope] = useState<PortalOrgRouteScope>({})
  const [data, setData] = useState<SequenceDetailedStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    Promise.all([params, searchParams ?? Promise.resolve({})])
      .then(([resolvedParams, resolvedSearchParams]) => {
        if (cancelled) return
        const nextScope = scopeFromParams(resolvedSearchParams)
        const sequenceId = resolvedParams.id
        setId(sequenceId)
        setOrgScope(nextScope)
        setLoading(true)
        setError(null)
        setData(null)

        return fetch(scopedApiPath(`/api/v1/email-analytics/sequences/${sequenceId}`, nextScope))
          .then((r) => r.json())
          .then((body) => {
            if (cancelled) return
            if (body.success) setData(body.data)
            else setError(body.error ?? 'Failed to load sequence analytics')
          })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load sequence analytics')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [params, searchParams])

  const backHref =
    surface === 'portal'
      ? scopedPortalPath('/portal/email-analytics', orgScope)
      : '/admin/email-analytics'

  const shellClass =
    surface === 'portal'
      ? 'mx-auto max-w-5xl space-y-6'
      : 'p-6 max-w-5xl mx-auto space-y-6'

  if (loading) {
    return (
      <div className={surface === 'portal' ? 'pib-skeleton h-40 rounded-xl' : 'p-6 h-40 rounded-xl bg-surface-container animate-pulse'} />
    )
  }

  if (error || !data) {
    return (
      <div className={surface === 'portal' ? 'mx-auto max-w-5xl space-y-4' : 'p-6 max-w-3xl mx-auto space-y-4'}>
        <BackLink href={backHref} surface={surface} />
        <p className={surface === 'portal' ? 'text-sm text-[var(--color-pib-text-muted)]' : 'text-sm text-on-surface-variant'}>
          {error ?? 'Sequence analytics not found.'}
        </p>
      </div>
    )
  }

  const { totalEnrollments, byStatus, stepFunnel, averageCompletionDays, sequence, insights } = data
  const sequenceName = sequence?.name || 'Sequence'
  const sequenceDescription = sequence?.description || `ID: ${id ?? data.sequenceId}`
  const statusData = Object.entries(byStatus)
    .filter(([, value]) => value > 0)
    .map(([label, value]) => ({ label, value }))

  return (
    <div className={shellClass}>
      <BackLink href={backHref} surface={surface} />
      <header>
        {surface === 'portal' && <p className="eyebrow">Email nurture</p>}
        <h1 className={surface === 'portal' ? 'pib-page-title mt-2' : 'text-2xl font-semibold text-on-surface'}>
          {sequenceName} performance
        </h1>
        <p className={surface === 'portal' ? 'pib-page-sub mt-2' : 'mt-2 text-sm text-on-surface-variant'}>
          {sequenceDescription}
        </p>
        <p className={surface === 'portal' ? 'mt-2 text-xs text-[var(--color-pib-text-muted)]' : 'mt-2 text-xs text-on-surface-variant'}>
          {formatStatus(sequence?.status)} · {formatSteps(sequence?.stepsCount ?? stepFunnel.length)}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <Kpi surface={surface} label="Total enrolled" value={totalEnrollments} />
        <Kpi surface={surface} label="Active" value={byStatus.active ?? 0} />
        <Kpi surface={surface} label="Completed" value={byStatus.completed ?? 0} />
        <Kpi
          surface={surface}
          label="Avg completion"
          value={averageCompletionDays}
          sub={averageCompletionDays > 0 ? 'days' : '-'}
        />
        <Kpi surface={surface} label="Open rate" value={formatPercent(insights?.openRate ?? 0)} />
        <Kpi surface={surface} label="Click rate" value={formatPercent(insights?.clickRate ?? 0)} />
      </div>

      {insights?.nextActions?.length > 0 && (
        <Section surface={surface} title="Agent next moves">
          <ul className={surface === 'portal' ? 'space-y-2 text-sm text-[var(--color-pib-text)]' : 'space-y-2 text-sm text-on-surface'}>
            {insights.nextActions.map((action) => (
              <li key={action} className="flex gap-2">
                <span
                  className={
                    surface === 'portal'
                      ? 'mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-pib-accent)]'
                      : 'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500'
                  }
                />
                <span>{action}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Section surface={surface} title="Enrollment status">
          {statusData.length === 0 ? <Empty surface={surface}>No enrollments yet.</Empty> : <Donut data={statusData} />}
        </Section>
        <Section surface={surface} title="Step funnel">
          {stepFunnel.length === 0 ? (
            <Empty surface={surface}>No steps defined.</Empty>
          ) : (
            <BarChart
              data={stepFunnel.map((step) => ({
                label: `Step ${step.stepNumber}`,
                value: step.sent,
              }))}
            />
          )}
        </Section>
      </div>

      {stepFunnel.length > 0 && (
        <Section surface={surface} title="Step performance">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead className={surface === 'portal' ? 'text-left text-[var(--color-pib-text-muted)]' : 'text-left text-on-surface-variant'}>
                <tr>
                  <th className="py-2">#</th>
                  <th className="py-2">Subject</th>
                  <th className="py-2 text-right">Sent</th>
                  <th className="py-2 text-right">Opened</th>
                  <th className="py-2 text-right">Clicked</th>
                  <th className="py-2 text-right">Drop-off</th>
                </tr>
              </thead>
              <tbody>
                {stepFunnel.map((step) => (
                  <tr
                    key={step.stepNumber}
                    className={surface === 'portal' ? 'border-t border-[var(--color-pib-line)]' : 'border-t border-outline-variant'}
                  >
                    <td className="py-2 tabular-nums">{step.stepNumber}</td>
                    <td className={surface === 'portal' ? 'py-2 text-[var(--color-pib-text)]' : 'py-2 text-on-surface'}>
                      {step.subject || (
                        <em className={surface === 'portal' ? 'text-[var(--color-pib-text-muted)]' : 'text-on-surface-variant'}>
                          (no subject)
                        </em>
                      )}
                    </td>
                    <td className="py-2 text-right tabular-nums">{step.sent}</td>
                    <td className="py-2 text-right tabular-nums">{step.opened}</td>
                    <td className="py-2 text-right tabular-nums">{step.clicked}</td>
                    <td className="py-2 text-right tabular-nums">{step.dropOffPercent.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
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
  surface,
}: {
  label: string
  value: number | string
  sub?: string
  surface: 'admin' | 'portal'
}) {
  const displayValue = typeof value === 'number' ? value.toLocaleString() : value
  return (
    <div className={surface === 'portal' ? 'rounded-xl border border-[var(--color-pib-line)] bg-white/[0.03] p-4' : 'rounded-xl bg-surface-container p-4'}>
      <div className={surface === 'portal' ? 'text-xs text-[var(--color-pib-text-muted)]' : 'text-xs text-on-surface-variant'}>
        {label}
      </div>
      <div className={surface === 'portal' ? 'text-2xl font-semibold text-[var(--color-pib-text)]' : 'text-2xl font-semibold text-on-surface'}>
        {displayValue}
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

function formatStatus(status?: string): string {
  if (!status) return 'Sequence'
  return `${status.charAt(0).toUpperCase()}${status.slice(1)} sequence`
}

function formatSteps(count: number): string {
  return `${count} ${count === 1 ? 'step' : 'steps'}`
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}
