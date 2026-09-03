'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import { formatZar, formatMonthLabel, formatDate } from '@/lib/billing/format'

interface TrialSignals {
  activityCount: number
  hasSocialPost: boolean
  hasInvoice: boolean
  teamSize: number
  recentlyActive: boolean
}

interface Trial {
  orgId: string
  orgName: string
  slug: string
  planKey: string
  interval: string
  priceZar: number
  mrrPotentialZar: number
  trialEndsAtMs: number | null
  daysRemaining: number | null
  activationScore: number
  signals: TrialSignals
}

interface Summary {
  total: number
  convertingSoon: number
  avgActivation: number
  mrrPotentialZar: number
}

interface TrendPoint {
  month: string
  started: number
  converted: number
}

interface Payload {
  trials: Trial[]
  summary: Summary
  conversionTrend: TrendPoint[]
}

type SortKey = 'days' | 'activation'

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function MetricCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string
  value: string
  hint?: string
  accent?: boolean
}) {
  return (
    <div className="st-panel p-4">
      <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">{label}</p>
      <p
        className="text-2xl font-headline font-medium mt-1"
        style={{ color: accent ? 'var(--sc-ink-soft)' : undefined }}
      >
        {value}
      </p>
      {hint && <p className="text-[11px] text-[var(--color-pib-text-muted)]/70 mt-0.5">{hint}</p>}
    </div>
  )
}

function ActivationBar({ score }: { score: number }) {
  const color =
    score >= 66 ? 'var(--sc-ink-soft)' : score >= 33 ? '#eab308' : '#9ca3af'
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-1.5 rounded bg-white/10 overflow-hidden">
        <div className="h-full rounded" style={{ width: `${score}%`, background: color }} />
      </div>
      <span className="text-xs font-mono text-[var(--color-pib-text-muted)] w-7 text-right">{score}</span>
    </div>
  )
}

function DaysBadge({ days }: { days: number | null }) {
  if (days == null) {
    return <span className="text-xs text-[var(--color-pib-text-muted)]">No end date</span>
  }
  const expired = days < 0
  const urgent = days <= 3
  const tone = expired || urgent ? 'st-status st-status--danger' : days <= 7 ? 'st-status st-status--warning' : ''
  const label = expired ? `${Math.abs(days)}d overdue` : `${days}d left`
  return (
    <span className={`st-status whitespace-nowrap ${tone}`}>
      {label}
    </span>
  )
}

export default function TrialsPage() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('days')
  const [sortAsc, setSortAsc] = useState(true)
  const [busyOrg, setBusyOrg] = useState<string | null>(null)

  // Per-row action form state.
  const [openAction, setOpenAction] = useState<{ orgId: string; kind: 'extend' | 'email' } | null>(null)
  const [extendDays, setExtendDays] = useState('7')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/admin/billing/trials')
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Failed to load trials')
      setData(body.data ?? body)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trials')
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function runAction(orgId: string, payload: Record<string, unknown>, successMsg: string) {
    setBusyOrg(orgId)
    setNotice(null)
    setError(null)
    try {
      const res = await fetch(`/api/v1/admin/billing/trials/${orgId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Action failed')
      setNotice(successMsg)
      setOpenAction(null)
      setEmailSubject('')
      setEmailBody('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusyOrg(null)
    }
  }

  const sortedTrials = useMemo(() => {
    const list = [...(data?.trials ?? [])]
    list.sort((a, b) => {
      let cmp: number
      if (sortKey === 'activation') {
        cmp = a.activationScore - b.activationScore
      } else {
        // null days sort last
        const ad = a.daysRemaining ?? Number.POSITIVE_INFINITY
        const bd = b.daysRemaining ?? Number.POSITIVE_INFINITY
        cmp = ad - bd
      }
      return sortAsc ? cmp : -cmp
    })
    return list
  }, [data?.trials, sortKey, sortAsc])

  const trendData = useMemo(
    () =>
      (data?.conversionTrend ?? []).map((t) => ({ ...t, label: formatMonthLabel(t.month) })),
    [data?.conversionTrend],
  )

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc((v) => !v)
    } else {
      setSortKey(key)
      setSortAsc(key === 'days') // days default asc, activation default desc
      if (key === 'activation') setSortAsc(false)
    }
  }

  const hasTrend = trendData.some((t) => t.started > 0 || t.converted > 0)

  return (
    <div className="space-y-4 max-w-6xl mx-auto" data-module-accent="cyan">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)] mb-1">
            Billing / Trials
          </p>
          <h1 className="text-2xl font-headline font-medium text-[var(--color-pib-text)]">Trial conversion</h1>
          <p className="text-sm text-[var(--color-pib-text-muted)] mt-0.5">
            Trialing accounts ranked by days remaining and activation. Extend, force-convert, or nudge by email.
          </p>
        </div>
        <button onClick={load} className="pib-btn-secondary text-sm font-label self-start md:self-auto">
          Refresh
        </button>
      </div>

      {error && (
        <div className="st-panel border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-[var(--st-danger)]">
          {error}
        </div>
      )}
      {notice && (
        <div className="st-panel border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm text-green-400">
          {notice}
        </div>
      )}

      {/* Summary cards */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-[6px]" />
          ))}
        </div>
      ) : data ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard label="Active trials" value={String(data.summary.total)} accent />
          <MetricCard
            label="Converting soon"
            value={String(data.summary.convertingSoon)}
            hint="≤ 3 days remaining"
          />
          <MetricCard label="Avg activation" value={`${data.summary.avgActivation}/100`} hint="Across all trials" />
          <MetricCard
            label="MRR potential"
            value={formatZar(data.summary.mrrPotentialZar)}
            hint="If all convert"
          />
        </div>
      ) : null}

      {/* Conversion trend */}
      <div className="st-panel p-5">
        <div className="mb-4">
          <h2 className="text-sm font-headline font-medium text-[var(--color-pib-text)]">Trials started vs converted</h2>
          <p className="text-[11px] text-[var(--color-pib-text-muted)]/70">Monthly, last 12 months</p>
        </div>
        {loading ? (
          <Skeleton className="h-64 rounded-[6px]" />
        ) : !hasTrend ? (
          <div className="h-64 flex items-center justify-center text-sm text-[var(--color-pib-text-muted)]">
            No subscription history yet.
          </div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trendData} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-pib-text-muted, #9ca3af)" strokeOpacity={0.1} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--color-pib-text-muted, #9ca3af)' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--color-pib-text-muted, #9ca3af)' }} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-surface, #1a1a1a)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: 'var(--color-pib-text, #fff)' }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="started" name="Started" fill="#6b7280" radius={[3, 3, 0, 0]} />
                <Bar dataKey="converted" name="Converted" fill="var(--sc-ink-soft)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Trials table */}
      <div className="st-panel p-0 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h2 className="text-sm font-headline font-medium text-[var(--color-pib-text)]">Trialing accounts</h2>
          <div className="flex gap-2">
            <button
              onClick={() => toggleSort('days')}
              className={`text-[11px] font-label px-2 py-1 rounded ${sortKey === 'days' ? 'text-[var(--color-pib-text)]' : 'text-[var(--color-pib-text-muted)]'}`}
              style={sortKey === 'days' ? { background: 'var(--color-pib-accent)20' } : undefined}
            >
              Days {sortKey === 'days' ? (sortAsc ? '↑' : '↓') : ''}
            </button>
            <button
              onClick={() => toggleSort('activation')}
              className={`text-[11px] font-label px-2 py-1 rounded ${sortKey === 'activation' ? 'text-[var(--color-pib-text)]' : 'text-[var(--color-pib-text-muted)]'}`}
              style={sortKey === 'activation' ? { background: 'var(--color-pib-accent)20' } : undefined}
            >
              Activation {sortKey === 'activation' ? (sortAsc ? '↑' : '↓') : ''}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-5 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : !sortedTrials.length ? (
          <div className="px-5 py-12 text-center text-sm text-[var(--color-pib-text-muted)]">
            No active trials right now.
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {sortedTrials.map((t) => {
              const isOpen = openAction?.orgId === t.orgId
              const busy = busyOrg === t.orgId
              return (
                <div key={t.orgId} className="px-5 py-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/admin/org/${t.slug}`}
                        className="text-sm font-medium text-[var(--color-pib-text)] hover:text-[var(--color-pib-accent)] transition-colors truncate block"
                      >
                        {t.orgName}
                      </Link>
                      <p className="text-[11px] text-[var(--color-pib-text-muted)]/70">
                        {t.planKey} · {formatZar(t.mrrPotentialZar)}/mo · ends {formatDate(t.trialEndsAtMs)}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 md:gap-6">
                      <ActivationBar score={t.activationScore} />
                      <DaysBadge days={t.daysRemaining} />
                      <div className="flex gap-1.5">
                        <button
                          disabled={busy}
                          onClick={() =>
                            setOpenAction(isOpen && openAction?.kind === 'extend' ? null : { orgId: t.orgId, kind: 'extend' })
                          }
                          className="pib-btn-secondary text-[11px] font-label px-2 py-1"
                        >
                          Extend
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => {
                            if (confirm(`Force-convert ${t.orgName} to an active subscription (+${formatZar(t.mrrPotentialZar)}/mo MRR)?`)) {
                              runAction(t.orgId, { action: 'convert' }, `${t.orgName} converted to active.`)
                            }
                          }}
                          className="st-btn st-btn--primary text-[11px] font-label px-2 py-1"
                        >
                          Convert
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            setOpenAction(isOpen && openAction?.kind === 'email' ? null : { orgId: t.orgId, kind: 'email' })
                          }
                          className="pib-btn-secondary text-[11px] font-label px-2 py-1"
                        >
                          Email
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Inline action panels */}
                  {isOpen && openAction?.kind === 'extend' && (
                    <div className="mt-3 flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2">
                      <label className="text-[11px] text-[var(--color-pib-text-muted)]">Extend by</label>
                      <input
                        type="number"
                        min={1}
                        max={365}
                        value={extendDays}
                        onChange={(e) => setExtendDays(e.target.value)}
                        className="w-16 rounded bg-black/30 px-2 py-1 text-sm text-[var(--color-pib-text)] border border-white/10"
                        aria-label="Extend trial by days"
                      />
                      <span className="text-[11px] text-[var(--color-pib-text-muted)]">days</span>
                      <button
                        disabled={busy}
                        onClick={() =>
                          runAction(
                            t.orgId,
                            { action: 'extend', days: Number(extendDays) },
                            `Trial extended for ${t.orgName}.`,
                          )
                        }
                        className="st-btn st-btn--primary text-[11px] font-label px-2 py-1 ml-auto"
                      >
                        {busy ? 'Saving…' : 'Apply'}
                      </button>
                    </div>
                  )}
                  {isOpen && openAction?.kind === 'email' && (
                    <div className="mt-3 space-y-2 rounded-lg bg-white/5 px-3 py-3">
                      <input
                        type="text"
                        placeholder="Subject"
                        value={emailSubject}
                        onChange={(e) => setEmailSubject(e.target.value)}
                        className="w-full rounded bg-black/30 px-2 py-1.5 text-sm text-[var(--color-pib-text)] border border-white/10"
                        aria-label="Email subject"
                      />
                      <textarea
                        placeholder="Message…"
                        rows={3}
                        value={emailBody}
                        onChange={(e) => setEmailBody(e.target.value)}
                        className="w-full rounded bg-black/30 px-2 py-1.5 text-sm text-[var(--color-pib-text)] border border-white/10"
                        aria-label="Email message"
                      />
                      <div className="flex justify-end">
                        <button
                          disabled={busy || !emailSubject.trim() || !emailBody.trim()}
                          onClick={() =>
                            runAction(
                              t.orgId,
                              { action: 'email', subject: emailSubject, body: emailBody },
                              `Email sent to ${t.orgName}.`,
                            )
                          }
                          className="st-btn st-btn--primary text-[11px] font-label px-3 py-1 disabled:opacity-50"
                        >
                          {busy ? 'Sending…' : 'Send email'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
