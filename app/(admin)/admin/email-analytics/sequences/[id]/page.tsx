'use client'

// app/(admin)/admin/email-analytics/sequences/[id]/page.tsx
//
// Per-sequence analytics — step funnel + enrollment status donut.

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BarChart, Donut } from '@/components/admin/email-analytics/charts'
import type { SequenceDetailedStats } from '@/lib/email-analytics/aggregate'

export default function SequenceAnalyticsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [id, setId] = useState<string | null>(null)
  const [data, setData] = useState<SequenceDetailedStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    params.then((p) => {
      setId(p.id)
      fetch(`/api/v1/email-analytics/sequences/${p.id}`)
        .then((r) => r.json())
        .then((b) => {
          if (b.success) setData(b.data)
          else setError(b.error ?? 'Failed to load')
        })
        .finally(() => setLoading(false))
    })
  }, [params])

  if (loading) return <div className="p-6 h-40 rounded-xl bg-surface-container animate-pulse" />
  if (error || !data) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Link href="/admin/email-analytics" className="text-amber-500 text-sm hover:underline">
          ← Back to email analytics
        </Link>
        <p className="mt-4 text-on-surface-variant">{error ?? 'Sequence not found.'}</p>
      </div>
    )
  }

  const { totalEnrollments, byStatus, stepFunnel, averageCompletionDays, sequence, insights } = data
  const sequenceName = sequence?.name || 'Sequence'
  const sequenceDescription = sequence?.description || `ID: ${id}`
  const statusData = Object.entries(byStatus)
    .filter(([, v]) => v > 0)
    .map(([label, value]) => ({ label, value }))

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <Link href="/admin/email-analytics" className="text-amber-500 text-sm hover:underline">
        ← Back to email analytics
      </Link>
      <header>
        <h1 className="text-2xl font-semibold text-on-surface">{sequenceName} performance</h1>
        <p className="mt-2 text-sm text-on-surface-variant">{sequenceDescription}</p>
        <p className="mt-2 text-xs text-on-surface-variant">
          {formatStatus(sequence?.status)} · {formatSteps(sequence?.stepsCount ?? stepFunnel.length)}
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Kpi label="Total enrolled" value={totalEnrollments} />
        <Kpi label="Active" value={byStatus.active ?? 0} />
        <Kpi label="Completed" value={byStatus.completed ?? 0} />
        <Kpi
          label="Avg completion"
          value={averageCompletionDays}
          sub={averageCompletionDays > 0 ? 'days' : '—'}
        />
        <Kpi label="Open rate" value={formatPercent(insights?.openRate ?? 0)} />
        <Kpi label="Click rate" value={formatPercent(insights?.clickRate ?? 0)} />
      </div>

      {insights?.nextActions?.length > 0 && (
        <Section title="Agent next moves">
          <ul className="space-y-2 text-sm text-on-surface">
            {insights.nextActions.map((action) => (
              <li key={action} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                <span>{action}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <Section title="Enrollment status">
          {statusData.length === 0 ? (
            <Empty>No enrollments yet.</Empty>
          ) : (
            <Donut data={statusData} />
          )}
        </Section>

        <Section title="Step funnel — emails sent">
          {stepFunnel.length === 0 ? (
            <Empty>No steps defined.</Empty>
          ) : (
            <BarChart
              data={stepFunnel.map((s) => ({
                label: `Step ${s.stepNumber}`,
                value: s.sent,
              }))}
            />
          )}
        </Section>
      </div>

      {stepFunnel.length > 0 && (
        <Section title="Step performance">
          <table className="w-full text-sm">
            <thead className="text-on-surface-variant text-left">
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
              {stepFunnel.map((s) => (
                <tr key={s.stepNumber} className="border-t border-outline-variant">
                  <td className="py-2 tabular-nums">{s.stepNumber}</td>
                  <td className="py-2 text-on-surface">{s.subject || <em className="text-on-surface-variant">(no subject)</em>}</td>
                  <td className="py-2 text-right tabular-nums">{s.sent}</td>
                  <td className="py-2 text-right tabular-nums">{s.opened}</td>
                  <td className="py-2 text-right tabular-nums">{s.clicked}</td>
                  <td className="py-2 text-right tabular-nums">{s.dropOffPercent.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </div>
  )
}

function Kpi({
  label,
  value,
  sub,
}: {
  label: string
  value: number | string
  sub?: string
}) {
  const displayValue = typeof value === 'number' ? value.toLocaleString() : value
  return (
    <div className="rounded-xl bg-surface-container p-4">
      <div className="text-xs text-on-surface-variant">{label}</div>
      <div className="text-2xl font-semibold text-on-surface">{displayValue}</div>
      {sub && <div className="text-xs text-on-surface-variant mt-1">{sub}</div>}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-medium text-on-surface-variant mb-2">{title}</h2>
      <div className="rounded-xl bg-surface-container p-4">{children}</div>
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-on-surface-variant text-sm">{children}</div>
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
