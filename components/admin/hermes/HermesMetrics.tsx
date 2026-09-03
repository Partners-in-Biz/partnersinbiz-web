'use client'

import { useCallback, useEffect, useState } from 'react'
import { PageHeader, Surface } from '@/components/ui/AppFoundation'
import { Notice, Table, THead, TR, TH, TD, Button, Toolbar, Choice } from '@/components/studio'
import { StatCard } from '@/components/ui/StatCard'

interface AgentMetrics {
  agentId: string
  runVolume: number
  completed: number
  failed: number
  inProgressOrOther: number
  successRate: number | null
  avgResponseMs: number | null
  p95ResponseMs: number | null
  tokens: { input: number; output: number; total: number; runsWithUsage: number; source?: 'upstream' | 'unavailable' }
  cost: { usd: number | null; runsWithCost: number; runsMissingCost?: number; source?: 'upstream' | 'mixed' | 'unavailable'; unavailableReason?: string | null }
  providerModels?: Array<{ provider: string | null; model: string | null; runs: number }>
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
    costSource?: 'upstream' | 'mixed' | 'unavailable'
    costUnavailableReason?: string | null
    runsWithCost?: number
    runsMissingCost?: number
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
  if (ms == null) return '-'
  if (ms < 1000) return `${ms} ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)} s`
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
}

function fmtPct(rate: number | null): string {
  return rate == null ? '-' : `${(rate * 100).toFixed(1)}%`
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-US')
}

function fmtCost(usd: number | null): string {
  return usd == null ? '-' : `$${usd.toFixed(2)}`
}

function telemetryReason(reason?: string | null): string {
  switch (reason) {
    case 'cost_usd_unavailable_from_hermes':
      return 'Cost unavailable from Hermes; token usage is present.'
    case 'usage_unavailable_from_hermes':
      return 'Usage unavailable from Hermes.'
    case 'partial_cost_unavailable_from_hermes':
      return 'Some runs lack Hermes cost.'
    default:
      return 'Cost unavailable.'
  }
}

function modelSummary(agent: AgentMetrics): string {
  const first = agent.providerModels?.[0]
  if (!first) return 'Provider/model unknown'
  const label = [first.provider, first.model].filter(Boolean).join(' / ')
  const more = (agent.providerModels?.length ?? 0) > 1 ? ` +${(agent.providerModels?.length ?? 1) - 1} more` : ''
  return `${label || 'Provider/model unknown'}${more}`
}

function relative(iso: string | null): string {
  if (!iso) return '-'
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return '-'
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
    <div className="mx-auto max-w-7xl space-y-4" data-module-accent="cyan">
      <PageHeader
        accent="cyan"
        eyebrow="Hermes / Performance"
        title="Agent performance metrics"
        description="Per-agent response time (avg + p95), success rate, run volume, token usage, and cost across the Hermes run history. Export the full breakdown as CSV."
        meta={payload?.generatedAt ? (
          <span>
            {fmtNum(summary?.runsConsidered ?? 0)} runs in the last {payload.window.days} days · generated {relative(payload.generatedAt)}.
          </span>
        ) : null}
        actions={(
          <>
            <div className="inline-flex overflow-hidden rounded-md border border-[var(--color-pib-line)]">
              {DAY_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setDays(opt)}
                  className={`btn-pib-sm px-2.5 py-1 text-xs font-label ${days === opt ? 'bg-cyan-500/15 text-cyan-200' : 'text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]'}`}
                >
                  {opt}d
                </button>
              ))}
            </div>
            <button type="button" onClick={() => void exportCsv()} disabled={exporting || loading} className="btn-pib-secondary btn-pib-sm font-label disabled:opacity-60">
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
          </>
        )}
      />

      {loading ? (
        <Surface className="p-4 text-sm text-[var(--color-pib-text-muted)]">Loading Hermes metrics…</Surface>
      ) : error ? (
        <Notice tone="danger">{error}</Notice>
      ) : payload && summary ? (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StatCard accent="cyan" icon="monitoring" label="Run volume" value={fmtNum(summary.runVolume)} detail={`${summary.activeAgents} active agents`} />
            <StatCard accent="cyan" icon="check_circle" label="Success rate" value={fmtPct(summary.successRate)} detail={`${fmtNum(summary.completed)} ok · ${fmtNum(summary.failed)} failed`} />
            <StatCard accent="cyan" icon="token" label="Total tokens" value={fmtNum(summary.totalTokens)} detail="Across runs reporting usage" />
            <StatCard
              accent="cyan"
              icon="payments"
              label="Total cost"
              value={fmtCost(summary.totalCostUsd)}
              detail={summary.totalCostUsd == null
                ? telemetryReason(summary.costUnavailableReason)
                : `${summary.costSource === 'mixed' ? 'Partial' : 'Upstream'} Hermes cost · ${fmtNum(summary.runsWithCost ?? 0)} costed runs`}
            />
          </section>

          <Surface className="overflow-hidden p-0">
            <div className="border-b border-[var(--color-pib-line)] px-4 py-3">
              <h2 className="sc-tiny text-[var(--color-pib-text)]">Per-agent breakdown</h2>
              <p className="mt-0.5 text-xs text-[var(--color-pib-text-muted)]">Sorted by run volume. Response time covers finished runs with timestamps.</p>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr className="border-b border-[var(--color-pib-line)] text-left text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
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
                      <td className="px-5 py-3 text-sm font-medium text-[var(--color-pib-text)]">
                        <div>{titleCase(a.agentId)}</div>
                        <div className="mt-1 text-xs font-normal text-[var(--color-pib-text-muted)]">{modelSummary(a)}</div>
                      </td>
                      <td className="px-5 py-3 st-num text-right text-sm text-[var(--color-pib-text)]">{fmtNum(a.runVolume)}</td>
                      <td className={`px-5 py-3 text-right text-sm ${a.successRate != null && a.successRate < 0.9 ? 'text-[var(--sc-ink-soft)]' : 'text-[var(--color-pib-text)]'}`}>{fmtPct(a.successRate)}</td>
                      <td className="px-5 py-3 st-num text-right text-sm text-[var(--color-pib-text)]">{fmtMs(a.avgResponseMs)}</td>
                      <td className="px-5 py-3 st-num text-right text-sm text-[var(--color-pib-text)]">{fmtMs(a.p95ResponseMs)}</td>
                      <td className="px-5 py-3 st-num text-right text-sm text-[var(--color-pib-text)]">{a.tokens.runsWithUsage > 0 ? fmtNum(a.tokens.total) : '-'}</td>
                      <td className="px-5 py-3 st-num text-right text-sm text-[var(--color-pib-text)]">
                        <div>{fmtCost(a.cost.usd)}</div>
                        {a.cost.usd == null || a.cost.source === 'mixed' ? (
                          <div className="mt-1 text-xs text-[var(--sc-ink-soft)]">{telemetryReason(a.cost.unavailableReason)}</div>
                        ) : (
                          <div className="mt-1 text-xs text-[var(--color-pib-text-muted)]">Upstream · {fmtNum(a.cost.runsWithCost)} runs</div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right text-sm text-[var(--color-pib-text-muted)]">{relative(a.lastRunAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </Surface>
        </>
      ) : null}
    </div>
  )
}

export default HermesMetrics
