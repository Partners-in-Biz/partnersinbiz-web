'use client'

// Portal sequence analytics drilldown.

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BarChart, Donut } from '@/components/admin/email-analytics/charts'
import type { SequenceDetailedStats } from '@/lib/email-analytics/aggregate'

export default function PortalSequenceAnalyticsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [id, setId] = useState<string | null>(null)
  const [data, setData] = useState<SequenceDetailedStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    params.then((p) => {
      if (cancelled) return
      setId(p.id)
      fetch(`/api/v1/email-analytics/sequences/${p.id}`)
        .then((r) => r.json())
        .then((body) => {
          if (cancelled) return
          if (body.success) setData(body.data)
          else setError(body.error ?? 'Failed to load sequence analytics')
        })
        .catch((err: unknown) => {
          if (cancelled) return
          setError(err instanceof Error ? err.message : 'Failed to load sequence analytics')
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    })
    return () => {
      cancelled = true
    }
  }, [params])

  if (loading) return <div className="pib-skeleton h-40 rounded-xl" />

  if (error || !data) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <BackLink />
        <p className="text-sm text-[var(--color-pib-text-muted)]">
          {error ?? 'Sequence analytics not found.'}
        </p>
      </div>
    )
  }

  const { totalEnrollments, byStatus, stepFunnel, averageCompletionDays } = data
  const statusData = Object.entries(byStatus)
    .filter(([, value]) => value > 0)
    .map(([label, value]) => ({ label, value }))

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <BackLink />
      <header>
        <p className="eyebrow">Email nurture</p>
        <h1 className="pib-page-title mt-2">Sequence performance</h1>
        <p className="pib-page-sub mt-2">ID: {id}</p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Total enrolled" value={totalEnrollments} />
        <Kpi label="Active" value={byStatus.active ?? 0} />
        <Kpi label="Completed" value={byStatus.completed ?? 0} />
        <Kpi label="Avg completion" value={averageCompletionDays} sub={averageCompletionDays > 0 ? 'days' : '-'} />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Enrollment status">
          {statusData.length === 0 ? <Empty>No enrollments yet.</Empty> : <Donut data={statusData} />}
        </Section>
        <Section title="Step funnel">
          {stepFunnel.length === 0 ? (
            <Empty>No steps defined.</Empty>
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
        <Section title="Step performance">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="text-left text-[var(--color-pib-text-muted)]">
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
                  <tr key={step.stepNumber} className="border-t border-[var(--color-pib-line)]">
                    <td className="py-2 tabular-nums">{step.stepNumber}</td>
                    <td className="py-2 text-[var(--color-pib-text)]">
                      {step.subject || <em className="text-[var(--color-pib-text-muted)]">(no subject)</em>}
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

function BackLink() {
  return (
    <Link href="/portal/email-analytics" className="text-sm text-[var(--color-pib-accent)] hover:underline">
      Back to email analytics
    </Link>
  )
}

function Kpi({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-pib-line)] bg-white/[0.03] p-4">
      <div className="text-xs text-[var(--color-pib-text-muted)]">{label}</div>
      <div className="text-2xl font-semibold text-[var(--color-pib-text)]">{value.toLocaleString()}</div>
      {sub && <div className="mt-1 text-xs text-[var(--color-pib-text-muted)]">{sub}</div>}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-medium text-[var(--color-pib-text-muted)]">{title}</h2>
      <div className="rounded-xl border border-[var(--color-pib-line)] bg-white/[0.03] p-4">{children}</div>
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-[var(--color-pib-text-muted)]">{children}</div>
}
