'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { BarChart, Donut } from '@/components/email-analytics/charts'
import { PageHeader } from '@/components/ui/AppFoundation'
import { scopedApiPath, scopedPortalPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'
import type { SequenceDetailedStats } from '@/lib/email-analytics/aggregate'

export type SequenceAnalyticsSearchParams = {
  orgId?: string
  orgSlug?: string
  sourceCompanyId?: string
  sourceCompanyName?: string
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
    sourceCompanyId: clean(params?.sourceCompanyId) || undefined,
    sourceCompanyName: clean(params?.sourceCompanyName) || undefined,
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
      : '/portal/email-analytics'

  const shellClass =
    surface === 'portal'
      ? 'mx-auto max-w-5xl space-y-4 overflow-hidden rounded-[6px] border border-[var(--color-card-border)] bg-[var(--color-card)]/45 p-3'
      : 'mx-auto max-w-5xl space-y-6 p-4 md:p-6'

  if (loading) {
    return (
      <div className={surface === 'portal' ? 'pib-skeleton h-40 rounded-[6px]' : 'p-6 h-40 rounded-[6px] bg-[var(--color-pib-surface-2)] '} />
    )
  }

  if (error || !data) {
    return (
      <div className={surface === 'portal' ? 'mx-auto max-w-5xl space-y-4' : 'p-6 max-w-3xl mx-auto space-y-4'}>
        <BackLink href={backHref} surface={surface} />
        <p className={surface === 'portal' ? 'text-sm text-[var(--color-pib-text-muted)]' : 'text-sm text-[var(--color-pib-text-muted)]'}>
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
    <div className={shellClass} data-module-accent="blue">
      <BackLink href={backHref} surface={surface} />
      <PageHeader
        accent="blue"
        eyebrow={surface === 'portal' ? 'Email nurture' : undefined}
        title={`${sequenceName} performance`}
        description={sequenceDescription}
        meta={
          <span>
            {formatStatus(sequence?.status)} · {formatSteps(sequence?.stepsCount ?? stepFunnel.length)}
          </span>
        }
      />

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
          <ul className={surface === 'portal' ? 'space-y-2 text-sm text-[var(--color-pib-text)]' : 'space-y-2 text-sm text-[var(--color-pib-text)]'}>
            {insights.nextActions.map((action) => (
              <li key={action} className="flex gap-2">
                <span
                  className={
                    surface === 'portal'
                      ? 'mt-1 h-1.5 w-1.5 shrink-0 rounded bg-primary'
                      : 'mt-1.5 h-1.5 w-1.5 shrink-0 rounded bg-[var(--sc-surface)]'
                  }
                />
                <span>{action}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <div className="grid gap-3 md:grid-cols-2">
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
              <thead className={surface === 'portal' ? 'text-left text-[var(--color-pib-text-muted)]' : 'text-left text-[var(--color-pib-text-muted)]'}>
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
                    className={surface === 'portal' ? 'border-t border-[var(--color-card-border)]' : 'border-t border-[var(--color-pib-line)]'}
                  >
                    <td className="py-2 tabular-nums">{step.stepNumber}</td>
                    <td className={surface === 'portal' ? 'py-2 text-[var(--color-pib-text)]' : 'py-2 text-[var(--color-pib-text)]'}>
                      {step.subject || (
                        <em className={surface === 'portal' ? 'text-[var(--color-pib-text-muted)]' : 'text-[var(--color-pib-text-muted)]'}>
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
      className={surface === 'portal' ? 'text-sm text-primary hover:underline' : 'text-sm text-[var(--sc-ink-soft)] hover:underline'}
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
    <div className={surface === 'portal' ? 'rounded-md border border-[var(--color-card-border)] bg-black/10 p-2' : 'rounded-[6px] bg-[var(--color-pib-surface-2)] p-4'}>
      <div className={surface === 'portal' ? 'text-xs text-[var(--color-pib-text-muted)]' : 'text-xs text-[var(--color-pib-text-muted)]'}>
        {label}
      </div>
      <div className={surface === 'portal' ? 'text-lg  text-[var(--color-pib-text)]' : 'text-2xl  text-[var(--color-pib-text)]'}>
        {displayValue}
      </div>
      {sub && (
        <div className={surface === 'portal' ? 'mt-1 text-xs text-[var(--color-pib-text-muted)]' : 'mt-1 text-xs text-[var(--color-pib-text-muted)]'}>
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
      <h2 className={surface === 'portal' ? 'mb-2 text-sm font-medium text-[var(--color-pib-text-muted)]' : 'mb-2 text-sm font-medium text-[var(--color-pib-text-muted)]'}>
        {title}
      </h2>
      <div className={surface === 'portal' ? 'border-t border-[var(--color-card-border)] p-3' : 'rounded-[6px] bg-[var(--color-pib-surface-2)] p-4'}>
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
