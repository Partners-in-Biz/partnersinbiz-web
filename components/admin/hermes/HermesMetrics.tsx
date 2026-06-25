'use client'

import { useCallback, useEffect, useState } from 'react'

interface AgentMetrics {
  agentId: string
  runVolume: number
  completed: number
  failed: number
  inProgressOrOther: number
  successRate: number | null
  avgResponseMs: number | null
  p95ResponseMs: number | null
  tokens: { input: number; output: number; total: number; runsWithUsage: number }
  cost: { usd: number | null; runsWithCost: number }
  lastRunAt: string | null
}

interface Payload {
  window: { days: number; sinceIso: string }
  summary: {
    runsConsidered: number
    runVolume: number
    completed: number
    failed: number
    successRate: number | null
    totalTokens: number
    totalCostUsd: number | null
    activeAgents: number
  }
  agents: AgentMetrics[]
  generatedAt: string
}

const DAY_OPTIONS = [7, 30, 90]

function unwrap<T>(body: unknown): T | null {
  if (body && typeof body === 'object' && 'data' in (body as Record<string, unknown>)) {
    return ((body as { data: T }).data) ?? null
  }
  return (body as T) ?? null
}

function fmtMs(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms} ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)} s`
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
}

function fmtPct(rate: number | null): string {
  return rate == null ? '—' : `${(rate * 100).toFixed(1)}%`
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-US')
}

function fmtCost(usd: number | null): string {
  return usd == null ? '—' : `$${usd.toFixed(2)}`
}

function relative(iso: string | null): string {
  if (!iso) return '—'
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return '—'
  const diff = Date.now() - ms
  const mins = Math.round(diff / 60000)
  const hrs = Math.round(diff / 3600000)
  const days = Math.round(diff / 86400000)
  if (days >= 1) return `${days}d ago`
  if (hrs >= 1) return `${hrs}h ago`
  if (mins >= 1) return `${mins}m ago`
  return 'just now'
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function HermesMetrics() {
  const [days, setDays] = useState(30)
  const [payload, setPayload] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  const load = useCallback(async (windowDays: number) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/admin/hermes/metrics?days=${windowDays}`, { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((body as { error?: string }).error ?? 'Failed to load Hermes metrics')
      setPayload(unwrap<Payload>(body))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Hermes metrics')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(days)
  }, [days, load])

  const exportCsv = useCallback(async () => {
    setExporting(true)
    try {
      const res = await fetch(`/api/v1/admin/hermes/metrics?days=${days}&format=csv`, { cache: 'no-store' })
      if (!res.ok) throw new Error('CSV export failed')
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = `hermes-agent-metrics-${days}d.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(objectUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CSV export failed')
    } finally {
      setExporting(false)
    }
  }, [days])

  const summary = payload?.summary

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="pib-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Hermes / Performance</p>
            <h1 className="pib-page-title mt-2">Agent performance metrics</h1>
            <p className="mt-3 max-w-3xl text-sm text-[var(--color-pib-text-muted)]">
              Per-agent response time (avg + p95), success rate, run volume, token usage, and cost across the Hermes
              run history. Export the full breakdown as CSV.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <div className="inline-flex overflow-hidden rounded-lg border border-[var(--color-pib-line)]">
              {DAY_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setDays(opt)}
                  className={`px-3 py-1.5 text-sm ${days === opt ? 'bg-[var(--color-pib-accent)] text-black' : 'text-on-surface-variant hover:text-on-surface'}`}
                >
                  {opt}d
                </button>
              ))}
            </div>
            <button type="button" onClick={() => void exportCsv()} disabled={exporting || loading} className="pib-btn-secondary disabled:opacity-60">
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
          </div>
        </div>
        {payload?.generatedAt ? (
          <p className="mt-3 text-xs text-on-surface-variant">
            {fmtNum(summary?.runsConsidered ?? 0)} runs in the last {payload.window.days} days · generated {relative(payload.generatedAt)}.
          </p>
        ) : null}
      </header>

      {loading ? (
        <div className="pib-card p-8 text-sm text-[var(--color-pib-text-muted)]">Loading Hermes metrics…</div>
      ) : error ? (
        <div className="pib-card border border-red-500/30 bg-red-500/5 p-5 text-sm text-red-400">{error}</div>
      ) : payload && summary ? (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Metric label="Run volume" value={fmtNum(summary.runVolume)} helper={`${summary.activeAgents} active agents`} />
            <Metric label="Success rate" value={fmtPct(summary.successRate)} helper={`${fmtNum(summary.completed)} ok · ${fmtNum(summary.failed)} failed`} tone={summary.successRate != null && summary.successRate < 0.9 ? 'warn' : 'default'} />
            <Metric label="Total tokens" value={fmtNum(summary.totalTokens)} helper="Across runs reporting usage" />
            <Metric label="Total cost" value={fmtCost(summary.totalCostUsd)} helper={summary.totalCostUsd == null ? 'Not reported by runtime' : 'Sum of run costs'} />
          </section>

          <section className="pib-card overflow-hidden">
            <div className="border-b border-[var(--color-pib-line)] px-5 py-4">
              <h2 className="text-lg font-semibold text-on-surface">Per-agent breakdown</h2>
              <p className="mt-1 text-sm text-on-surface-variant">Sorted by run volume. Response time covers finished runs with timestamps.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b border-[var(--color-pib-line)] text-left text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                    <th className="px-5 py-3">Agent</th>
                    <th className="px-5 py-3 text-right">Runs</th>
                    <th className="px-5 py-3 text-right">Success</th>
                    <th className="px-5 py-3 text-right">Avg time</th>
                    <th className="px-5 py-3 text-right">p95 time</th>
                    <th className="px-5 py-3 text-right">Tokens</th>
                    <th className="px-5 py-3 text-right">Cost</th>
                    <th className="px-5 py-3 text-right">Last run</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.agents.map((a) => (
                    <tr key={a.agentId} className="border-b border-[var(--color-pib-line)]/60 last:border-b-0">
                      <td className="px-5 py-3 text-sm font-medium text-on-surface">{titleCase(a.agentId)}</td>
                      <td className="px-5 py-3 text-right text-sm text-on-surface">{fmtNum(a.runVolume)}</td>
                      <td className={`px-5 py-3 text-right text-sm ${a.successRate != null && a.successRate < 0.9 ? 'text-amber-400' : 'text-on-surface'}`}>{fmtPct(a.successRate)}</td>
                      <td className="px-5 py-3 text-right text-sm text-on-surface">{fmtMs(a.avgResponseMs)}</td>
                      <td className="px-5 py-3 text-right text-sm text-on-surface">{fmtMs(a.p95ResponseMs)}</td>
                      <td className="px-5 py-3 text-right text-sm text-on-surface">{a.tokens.runsWithUsage > 0 ? fmtNum(a.tokens.total) : '—'}</td>
                      <td className="px-5 py-3 text-right text-sm text-on-surface">{fmtCost(a.cost.usd)}</td>
                      <td className="px-5 py-3 text-right text-sm text-on-surface-variant">{relative(a.lastRunAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}

function Metric({ label, value, helper, tone = 'default' }: { label: string; value: string; helper?: string; tone?: 'default' | 'warn' }) {
  return (
    <div className={`pib-card p-5 ${tone === 'warn' ? 'border border-amber-400/30 bg-amber-400/5' : ''}`}>
      <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{label}</p>
      <p className="mt-3 text-2xl font-semibold text-on-surface">{value}</p>
      {helper ? <p className="mt-2 text-xs text-on-surface-variant">{helper}</p> : null}
    </div>
  )
}

export default HermesMetrics
