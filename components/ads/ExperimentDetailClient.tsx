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

type ExperimentActionResponse = {
  error?: string
  data?: Partial<ExperimentDetailPlain> & {
    significance?: ExperimentDetailPlain['significance']
  }
}

const ACTION_SUCCESS_COPY: Record<string, string> = {
  start: 'Experiment started.',
  stop: 'Experiment paused.',
  compute: 'Experiment significance recomputed.',
  'declare-winner': 'Experiment winner declared.',
}

export function ExperimentDetailClient({ experiment: exp, results, orgSlug }: Props) {
  const [currentExperiment, setCurrentExperiment] = useState(exp)
  const [actioning, setActioning] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

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
    setActionMessage(null)
    setActionError(null)
    try {
      const response = await fetch(`/api/v1/ads/experiments/${currentExperiment.id}/${action}`, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      const json = (await response.json().catch(() => null)) as ExperimentActionResponse | null
      if (!response.ok) throw new Error(json?.error ?? 'Experiment action failed')

      setCurrentExperiment((current) => {
        const data = json?.data
        if (data && (data.status || data.significance || data.declaredWinnerVariantId || data.endedAt || data.startedAt)) {
          return { ...current, ...data }
        }
        if (action === 'start') {
          return {
            ...current,
            status: 'running',
            startedAt: current.startedAt ?? { seconds: Math.floor(Date.now() / 1000) },
          }
        }
        if (action === 'stop') return { ...current, status: 'paused' }
        if (action === 'compute') {
          return {
            ...current,
            significance: json?.data?.significance ?? current.significance,
          }
        }
        if (action === 'declare-winner') {
          return {
            ...current,
            status: 'winner_declared',
            declaredWinnerVariantId: json?.data?.declaredWinnerVariantId ?? current.significance?.winnerVariantId,
            endedAt: json?.data?.endedAt ?? current.endedAt ?? { seconds: Math.floor(Date.now() / 1000) },
          }
        }
        return current
      })
      setActionMessage(ACTION_SUCCESS_COPY[action] ?? 'Experiment updated.')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Experiment action failed')
    } finally {
      setActioning(null)
    }
  }

  async function declareWinner(variantId?: string) {
    await postAction('declare-winner', variantId ? { variantId } : {})
  }

  function requestArchive() {
    setActionMessage(null)
    setActionError(null)
    setConfirmArchive(true)
  }

  async function archiveExperiment() {
    setArchiving(true)
    setActionMessage(null)
    setActionError(null)
    try {
      const response = await fetch(`/api/v1/ads/experiments/${currentExperiment.id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('Experiment archive failed')
      setCurrentExperiment((current) => ({
        ...current,
        archivedAt: current.archivedAt ?? new Date().toISOString(),
      }))
      setConfirmArchive(false)
      setActionMessage(`Experiment ${currentExperiment.name} archived.`)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Experiment archive failed')
    } finally {
      setArchiving(false)
    }
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
          <h1 className="text-2xl font-semibold">{currentExperiment.name}</h1>
          <span className={`rounded px-2 py-0.5 text-xs uppercase tracking-wide ${STATUS_BADGE[currentExperiment.status]}`}>
            {currentExperiment.status.replace('_', ' ')}
          </span>
          <ExperimentSignificanceBadge significance={currentExperiment.significance} />
        </div>
        {currentExperiment.description && <p className="text-sm text-white/50">{currentExperiment.description}</p>}
      </header>

      {actionMessage && (
        <div role="status" className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {actionMessage}
        </div>
      )}

      {actionError && (
        <div role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {actionError}
        </div>
      )}

      {confirmArchive && (
        <div
          role="alertdialog"
          aria-modal="false"
          aria-labelledby="experiment-detail-archive-title"
          aria-describedby="experiment-detail-archive-description"
          className="rounded-lg border border-[#F5A623]/30 bg-[#F5A623]/10 p-4 shadow-sm"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <h2 id="experiment-detail-archive-title" className="text-sm font-semibold text-white">
                Archive experiment {currentExperiment.name} for {orgSlug}?
              </h2>
              <p id="experiment-detail-archive-description" className="text-sm text-white/65">
                This removes {currentExperiment.name} from active testing controls. Results, variants, and winner history stay in PiB.
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => setConfirmArchive(false)}
                disabled={archiving}
                className="rounded border border-white/10 px-3 py-1.5 text-xs text-white/60 hover:text-white disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={archiveExperiment}
                disabled={archiving}
                aria-label={`Confirm archive experiment ${currentExperiment.name} for ${orgSlug}`}
                className="rounded border border-red-400/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-200 hover:bg-red-500/20 disabled:opacity-40"
              >
                {archiving ? 'Archiving...' : 'Archive experiment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Info grid */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
        {[
          { label: 'Platform', value: currentExperiment.platform },
          { label: 'Level', value: currentExperiment.level },
          { label: 'Success metric', value: currentExperiment.successMetric },
          { label: 'Min days', value: String(currentExperiment.minDays) },
          { label: 'Significance threshold', value: String(currentExperiment.significanceThreshold) },
          { label: 'Auto-declare winner', value: currentExperiment.autoWinner ? 'Yes' : 'No' },
          { label: 'Started', value: fmtDate(currentExperiment.startedAt) },
          { label: 'Ended', value: fmtDate(currentExperiment.endedAt) },
        ].map(({ label, value }) => (
          <div key={label}>
            <dt className="text-white/40">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>

      {/* Action bar */}
      <div className="flex flex-wrap gap-2 text-sm">
        {currentExperiment.status === 'draft' && (
          <button
            onClick={() => postAction('start')}
            disabled={busy}
            aria-label={`Start experiment ${currentExperiment.name}`}
            className="rounded border border-green-500/30 px-3 py-1.5 text-green-400 hover:bg-green-500/10 disabled:opacity-40"
          >
            {actioning === 'start' ? 'Starting…' : 'Start experiment'}
          </button>
        )}

        {currentExperiment.status === 'running' && (
          <button
            onClick={() => postAction('stop')}
            disabled={busy}
            aria-label={`Stop experiment ${currentExperiment.name}`}
            className="rounded border border-white/10 px-3 py-1.5 text-white/60 hover:text-white disabled:opacity-40"
          >
            {actioning === 'stop' ? 'Stopping…' : 'Stop'}
          </button>
        )}

        {(currentExperiment.status === 'running' || currentExperiment.status === 'paused' || currentExperiment.status === 'completed') && (
          <button
            onClick={() => postAction('compute')}
            disabled={busy}
            aria-label={`Compute significance for experiment ${currentExperiment.name}`}
            className="rounded border border-white/10 px-3 py-1.5 text-white/60 hover:text-white disabled:opacity-40"
          >
            {actioning === 'compute' ? 'Computing…' : 'Compute significance'}
          </button>
        )}

        {currentExperiment.significance?.confident && currentExperiment.status !== 'winner_declared' && (
          <button
            onClick={() => declareWinner(currentExperiment.significance?.winnerVariantId)}
            disabled={busy}
            aria-label={`Declare winner for experiment ${currentExperiment.name}`}
            className="rounded border border-[#F5A623]/40 px-3 py-1.5 text-[#F5A623] hover:bg-[#F5A623]/10 disabled:opacity-40"
          >
            {actioning === 'declare-winner' ? 'Declaring…' : 'Declare winner'}
          </button>
        )}

        {!currentExperiment.archivedAt && (
          <button
            onClick={requestArchive}
            disabled={busy}
            aria-label={`Archive experiment ${currentExperiment.name} for ${orgSlug}`}
            className="rounded border border-white/10 px-3 py-1.5 text-white/40 hover:text-red-400 disabled:opacity-40"
          >
            Archive
          </button>
        )}

        {currentExperiment.status === 'draft' && (
          <Link
            href={`/admin/org/${orgSlug}/ads/experiments/${currentExperiment.id}/edit`}
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
              {currentExperiment.variants.map((v) => {
                const r = latestByVariant[v.id]
                const isWinner =
                  v.id === currentExperiment.declaredWinnerVariantId ||
                  v.id === currentExperiment.significance?.winnerVariantId

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
