'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ExperimentSignificanceBadge } from './ExperimentSignificanceBadge'
import type { ExperimentStatus } from '@/lib/ads/experiments/types'

export interface ExperimentVariantPlain {
  id: string
  name: string
  trafficPercent: number
  entityId?: string
}

export interface ExperimentResultPlain {
  id: string
  variantId: string
  fromDate: string
  toDate: string
  impressions: number
  clicks: number
  conversions: number
  spendCents: number
  ctr: number
  cpc?: number
  cpa?: number
  convRate: number
  computedAt?: { seconds: number }
}

export interface ExperimentDetailPlain {
  id: string
  name: string
  description?: string
  status: ExperimentStatus
  platform: string
  level: string
  parentEntityId: string
  sourceEntityId: string
  successMetric: string
  minDays: number
  significanceThreshold: number
  autoWinner: boolean
  variants: ExperimentVariantPlain[]
  declaredWinnerVariantId?: string
  significance?: {
    pValue: number
    confident: boolean
    winnerVariantId?: string
    computedAt?: unknown
  }
  startedAt?: { seconds: number } | null
  endedAt?: { seconds: number } | null
  archivedAt?: unknown
}

const STATUS_BADGE: Record<ExperimentStatus, string> = {
  draft: 'bg-white/5 text-white/50',
  running: 'bg-green-500/15 text-green-400',
  paused: 'bg-yellow-500/15 text-yellow-400',
  completed: 'bg-sky-500/15 text-sky-300',
  winner_declared: 'bg-[#F5A623]/15 text-[#F5A623]',
}

function fmtDate(ts?: { seconds: number } | null) {
  if (!ts) return '—'
  return new Date(ts.seconds * 1000).toLocaleDateString()
}

function fmtPercent(n: number) {
  return `${(n * 100).toFixed(2)}%`
}

function fmtCents(cents?: number) {
  if (cents == null) return '—'
  return `$${(cents / 100).toFixed(2)}`
}

interface Props {
  experiment: ExperimentDetailPlain
  results: ExperimentResultPlain[]
  orgSlug: string
}

export function ExperimentDetailClient({ experiment: exp, results, orgSlug }: Props) {
  const [actioning, setActioning] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  // Latest results per variant
  const latestByVariant: Record<string, ExperimentResultPlain> = {}
  for (const r of results) {
    const existing = latestByVariant[r.variantId]
    if (!existing || (r.computedAt?.seconds ?? 0) > (existing.computedAt?.seconds ?? 0)) {
      latestByVariant[r.variantId] = r
    }
  }

  async function postAction(action: string, body?: object) {
    setActioning(action)
    try {
      await fetch(`/api/v1/ads/experiments/${exp.id}/${action}`, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      window.location.reload()
    } finally {
      setActioning(null)
    }
  }

  async function declareWinner(variantId?: string) {
    await postAction('declare-winner', variantId ? { variantId } : {})
  }

  async function archiveExperiment() {
    if (!confirm('Archive this experiment?')) return
    await fetch(`/api/v1/ads/experiments/${exp.id}`, { method: 'DELETE' })
    window.location.href = `/admin/org/${orgSlug}/ads/experiments`
  }

  const busy = actioning !== null

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="space-y-2">
        <Link
          href={`/admin/org/${orgSlug}/ads/experiments`}
          className="text-xs text-white/40 hover:text-white/60"
        >
          ← Experiments
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{exp.name}</h1>
          <span className={`rounded px-2 py-0.5 text-xs uppercase tracking-wide ${STATUS_BADGE[exp.status]}`}>
            {exp.status.replace('_', ' ')}
          </span>
          <ExperimentSignificanceBadge significance={exp.significance} />
        </div>
        {exp.description && <p className="text-sm text-white/50">{exp.description}</p>}
      </header>

      {/* Info grid */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
        {[
          { label: 'Platform', value: exp.platform },
          { label: 'Level', value: exp.level },
          { label: 'Success metric', value: exp.successMetric },
          { label: 'Min days', value: String(exp.minDays) },
          { label: 'Significance threshold', value: String(exp.significanceThreshold) },
          { label: 'Auto-declare winner', value: exp.autoWinner ? 'Yes' : 'No' },
          { label: 'Started', value: fmtDate(exp.startedAt) },
          { label: 'Ended', value: fmtDate(exp.endedAt) },
        ].map(({ label, value }) => (
          <div key={label}>
            <dt className="text-white/40">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>

      {/* Action bar */}
      <div className="flex flex-wrap gap-2 text-sm">
        {exp.status === 'draft' && (
          <button
            onClick={() => postAction('start')}
            disabled={busy}
            className="rounded border border-green-500/30 px-3 py-1.5 text-green-400 hover:bg-green-500/10 disabled:opacity-40"
          >
            {actioning === 'start' ? 'Starting…' : 'Start experiment'}
          </button>
        )}

        {exp.status === 'running' && (
          <button
            onClick={() => postAction('stop')}
            disabled={busy}
            className="rounded border border-white/10 px-3 py-1.5 text-white/60 hover:text-white disabled:opacity-40"
          >
            {actioning === 'stop' ? 'Stopping…' : 'Stop'}
          </button>
        )}

        {(exp.status === 'running' || exp.status === 'paused' || exp.status === 'completed') && (
          <button
            onClick={() => postAction('compute')}
            disabled={busy}
            className="rounded border border-white/10 px-3 py-1.5 text-white/60 hover:text-white disabled:opacity-40"
          >
            {actioning === 'compute' ? 'Computing…' : 'Compute significance'}
          </button>
        )}

        {exp.significance?.confident && exp.status !== 'winner_declared' && (
          <button
            onClick={() => declareWinner(exp.significance?.winnerVariantId)}
            disabled={busy}
            className="rounded border border-[#F5A623]/40 px-3 py-1.5 text-[#F5A623] hover:bg-[#F5A623]/10 disabled:opacity-40"
          >
            {actioning === 'declare-winner' ? 'Declaring…' : 'Declare winner'}
          </button>
        )}

        {!exp.archivedAt && (
          <button
            onClick={archiveExperiment}
            disabled={busy}
            className="rounded border border-white/10 px-3 py-1.5 text-white/40 hover:text-red-400 disabled:opacity-40"
          >
            Archive
          </button>
        )}

        {exp.status === 'draft' && (
          <Link
            href={`/admin/org/${orgSlug}/ads/experiments/${exp.id}/edit`}
            className="rounded border border-white/10 px-3 py-1.5 text-white/60 hover:text-white"
          >
            Edit
          </Link>
        )}
      </div>

      {/* Variants comparison table */}
      <section>
        <h2 className="mb-3 text-sm font-medium">Variants</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs text-white/40">
                <th className="pb-2 pr-4">Variant</th>
                <th className="pb-2 pr-4">Traffic %</th>
                <th className="pb-2 pr-4">Impressions</th>
                <th className="pb-2 pr-4">Clicks</th>
                <th className="pb-2 pr-4">Conv</th>
                <th className="pb-2 pr-4">Spend</th>
                <th className="pb-2 pr-4">CTR</th>
                <th className="pb-2 pr-4">CPC</th>
                <th className="pb-2 pr-4">CPA</th>
                <th className="pb-2">Conv rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {exp.variants.map((v) => {
                const r = latestByVariant[v.id]
                const isWinner =
                  v.id === exp.declaredWinnerVariantId ||
                  v.id === exp.significance?.winnerVariantId

                return (
                  <tr
                    key={v.id}
                    className={`${isWinner ? 'border-l-2 border-[#F5A623] bg-[#F5A623]/5' : ''}`}
                  >
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs uppercase text-[#F5A623]">{v.id}</span>
                        <span className="text-white/80">{v.name}</span>
                        {isWinner && (
                          <span className="rounded bg-[#F5A623]/20 px-1.5 py-0.5 text-[10px] text-[#F5A623]">
                            Winner
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 pr-4 text-white/60">{v.trafficPercent}%</td>
                    <td className="py-2 pr-4">{r?.impressions ?? '—'}</td>
                    <td className="py-2 pr-4">{r?.clicks ?? '—'}</td>
                    <td className="py-2 pr-4">{r?.conversions ?? '—'}</td>
                    <td className="py-2 pr-4">{r ? fmtCents(r.spendCents) : '—'}</td>
                    <td className="py-2 pr-4">{r ? fmtPercent(r.ctr) : '—'}</td>
                    <td className="py-2 pr-4">{r ? fmtCents(r.cpc) : '—'}</td>
                    <td className="py-2 pr-4">{r ? fmtCents(r.cpa) : '—'}</td>
                    <td className="py-2">{r ? fmtPercent(r.convRate) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Results history */}
      {results.length > 0 && (
        <section>
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="flex items-center gap-2 text-sm text-white/60 hover:text-white"
          >
            <span>{showHistory ? '▾' : '▸'}</span>
            Results history ({results.length} records)
          </button>

          {showHistory && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-left text-white/40">
                    <th className="pb-2 pr-3">Variant</th>
                    <th className="pb-2 pr-3">From</th>
                    <th className="pb-2 pr-3">To</th>
                    <th className="pb-2 pr-3">Impressions</th>
                    <th className="pb-2 pr-3">Clicks</th>
                    <th className="pb-2 pr-3">Conv</th>
                    <th className="pb-2">CTR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {results.map((r) => (
                    <tr key={r.id}>
                      <td className="py-1.5 pr-3 font-mono uppercase text-[#F5A623]">{r.variantId}</td>
                      <td className="py-1.5 pr-3 text-white/50">{r.fromDate}</td>
                      <td className="py-1.5 pr-3 text-white/50">{r.toDate}</td>
                      <td className="py-1.5 pr-3">{r.impressions}</td>
                      <td className="py-1.5 pr-3">{r.clicks}</td>
                      <td className="py-1.5 pr-3">{r.conversions}</td>
                      <td className="py-1.5">{fmtPercent(r.ctr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
