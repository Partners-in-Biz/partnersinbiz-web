'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ExperimentSignificanceBadge } from './ExperimentSignificanceBadge'
import { PageTabs } from '@/components/ui/AppFoundation'
import type { ExperimentStatus } from '@/lib/ads/experiments/types'

export interface ExperimentRow {
  id: string
  name: string
  status: ExperimentStatus
  platform: string
  level: string
  variantCount: number
  startedAt?: { seconds: number } | null
  archivedAt?: unknown
  significance?: {
    pValue: number
    confident: boolean
    winnerVariantId?: string
    computedAt?: unknown
  }
}

type FilterKey = 'all' | ExperimentStatus | 'archived'

const FILTER_TABS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'running', label: 'Running' },
  { key: 'paused', label: 'Paused' },
  { key: 'completed', label: 'Completed' },
  { key: 'winner_declared', label: 'Winner Declared' },
  { key: 'archived', label: 'Archived' },
]

const STATUS_BADGE: Record<ExperimentStatus, string> = {
  draft: 'bg-white/5 text-white/50',
  running: 'bg-green-500/15 text-green-400',
  paused: 'bg-yellow-500/15 text-yellow-400',
  completed: 'bg-sky-500/15 text-sky-300',
  winner_declared: 'bg-[#F5A623]/15 text-[#F5A623]',
}

function daysRunning(startedAt?: { seconds: number } | null): number | null {
  if (!startedAt) return null
  const diff = Date.now() / 1000 - startedAt.seconds
  return Math.floor(diff / 86400)
}

interface Props {
  experiments: ExperimentRow[]
  orgSlug: string
}

type ExperimentActionResponse = {
  error?: string
  data?: Partial<ExperimentRow> & {
    significance?: ExperimentRow['significance']
  }
}

const ACTION_SUCCESS_COPY: Record<string, string> = {
  start: 'Experiment started.',
  stop: 'Experiment paused.',
  compute: 'Experiment results recomputed.',
}

export function ExperimentsListClient({ experiments, orgSlug }: Props) {
  const [visibleExperiments, setVisibleExperiments] = useState<ExperimentRow[]>(experiments)
  const [activeTab, setActiveTab] = useState<FilterKey>('all')
  const [actioning, setActioning] = useState<string | null>(null)
  const [confirmArchive, setConfirmArchive] = useState<ExperimentRow | null>(null)
  const [archiving, setArchiving] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const filtered = visibleExperiments.filter((e) => {
    if (activeTab === 'all') return !e.archivedAt
    if (activeTab === 'archived') return !!e.archivedAt
    return e.status === activeTab && !e.archivedAt
  })

  async function postAction(experimentId: string, action: string) {
    setActioning(experimentId)
    setActionMessage(null)
    setActionError(null)
    try {
      const response = await fetch(`/api/v1/ads/experiments/${experimentId}/${action}`, { method: 'POST' })
      const body = (await response.json().catch(() => null)) as ExperimentActionResponse | null
      if (!response.ok) throw new Error(body?.error ?? 'Experiment action failed')

      setVisibleExperiments((current) =>
        current.map((item) => {
          if (item.id !== experimentId) return item
          if (action === 'start') {
            return {
              ...item,
              ...body?.data,
              status: 'running',
              startedAt: body?.data?.startedAt ?? item.startedAt ?? { seconds: Math.floor(Date.now() / 1000) },
            }
          }
          if (action === 'stop') return { ...item, ...body?.data, status: 'paused' }
          if (action === 'compute') {
            return {
              ...item,
              significance: body?.data?.significance ?? item.significance,
            }
          }
          return { ...item, ...body?.data }
        }),
      )
      setActionMessage(ACTION_SUCCESS_COPY[action] ?? 'Experiment updated.')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Experiment action failed')
    } finally {
      setActioning(null)
    }
  }

  function requestArchive(experiment: ExperimentRow) {
    setActionMessage(null)
    setActionError(null)
    setConfirmArchive(experiment)
  }

  async function archiveExperiment(experiment: ExperimentRow) {
    setArchiving(experiment.id)
    setActionMessage(null)
    setActionError(null)
    try {
      const response = await fetch(`/api/v1/ads/experiments/${experiment.id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('Experiment archive failed')
      setVisibleExperiments((current) =>
        current.map((item) =>
          item.id === experiment.id
            ? { ...item, archivedAt: item.archivedAt ?? new Date().toISOString() }
            : item,
        ),
      )
      setConfirmArchive(null)
      setActionMessage(`Experiment ${experiment.name} archived.`)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Experiment archive failed')
    } finally {
      setArchiving(null)
    }
  }

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">A/B Experiments</h1>
        <Link
          href={`/admin/org/${orgSlug}/ads/experiments/new`}
          className="btn-pib-accent text-sm"
        >
          + New experiment
        </Link>
      </header>

      <PageTabs
        ariaLabel="Experiment filters"
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as FilterKey)}
        tabs={FILTER_TABS.map((tab) => ({ label: tab.label, value: tab.key }))}
      />

      {actionMessage && (
        <div
          role="status"
          className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
        >
          {actionMessage}
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          {actionError}
        </div>
      )}

      {confirmArchive && (
        <div
          role="alertdialog"
          aria-modal="false"
          aria-labelledby="experiment-archive-title"
          aria-describedby="experiment-archive-description"
          className="rounded-lg border border-[#F5A623]/30 bg-[#F5A623]/10 p-4 shadow-sm"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <h2 id="experiment-archive-title" className="text-sm font-semibold text-white">
                Archive experiment {confirmArchive.name} for {orgSlug}?
              </h2>
              <p id="experiment-archive-description" className="text-sm text-white/65">
                This removes {confirmArchive.name} from active testing views. Results, winner history, and audit context
                stay in PiB.
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => setConfirmArchive(null)}
                disabled={archiving === confirmArchive.id}
                className="rounded border border-white/10 px-3 py-1.5 text-xs text-white/60 hover:text-white disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => archiveExperiment(confirmArchive)}
                disabled={archiving === confirmArchive.id}
                aria-label={`Confirm archive experiment ${confirmArchive.name} for ${orgSlug}`}
                className="rounded border border-red-400/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-200 hover:bg-red-500/20 disabled:opacity-40"
              >
                {archiving === confirmArchive.id ? 'Archiving...' : 'Archive experiment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 p-8 text-center">
          <p className="text-white/60">No experiments found.</p>
          {activeTab === 'all' && (
            <Link
              href={`/admin/org/${orgSlug}/ads/experiments/new`}
              className="mt-3 inline-block text-sm text-[#F5A623] underline"
            >
              Create your first experiment →
            </Link>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-white/5 rounded-lg border border-white/10">
          {filtered.map((exp) => {
            const days = daysRunning(exp.startedAt)
            const busy = actioning === exp.id
            return (
              <li key={exp.id} aria-label={`Experiment ${exp.name}`} className="px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/admin/org/${orgSlug}/ads/experiments/${exp.id}`}
                        className="font-medium hover:text-[#F5A623]"
                      >
                        {exp.name}
                      </Link>
                      <span
                        className={`rounded px-2 py-0.5 text-xs uppercase tracking-wide ${STATUS_BADGE[exp.status]}`}
                      >
                        {exp.status.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-white/50">
                      <span className="rounded bg-violet-500/10 px-2 py-0.5 text-violet-300">
                        {exp.platform}
                      </span>
                      <span className="rounded bg-sky-500/10 px-2 py-0.5 text-sky-300">
                        {exp.level}
                      </span>
                      <span className="text-white/40">{exp.variantCount} variants</span>
                      {days !== null && (
                        <span className="text-white/40">
                          {days} day{days !== 1 ? 's' : ''} running
                        </span>
                      )}
                      <ExperimentSignificanceBadge significance={exp.significance} />
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
                    <Link
                      href={`/admin/org/${orgSlug}/ads/experiments/${exp.id}`}
                      className="rounded border border-white/10 px-2 py-1 text-white/60 hover:text-white"
                    >
                      View
                    </Link>

                    {exp.status === 'draft' && (
                      <button
                        aria-label="Start experiment"
                        onClick={() => postAction(exp.id, 'start')}
                        disabled={busy}
                        className="rounded border border-green-500/30 px-2 py-1 text-green-400 hover:bg-green-500/10 disabled:opacity-40"
                      >
                        {busy ? '…' : 'Start'}
                      </button>
                    )}

                    {exp.status === 'running' && (
                      <>
                        <button
                          onClick={() => postAction(exp.id, 'stop')}
                          disabled={busy}
                          className="rounded border border-white/10 px-2 py-1 text-white/60 hover:text-white disabled:opacity-40"
                        >
                          {busy ? '…' : 'Stop'}
                        </button>
                        <button
                          onClick={() => postAction(exp.id, 'compute')}
                          disabled={busy}
                          className="rounded border border-white/10 px-2 py-1 text-white/60 hover:text-white disabled:opacity-40"
                        >
                          {busy ? '…' : 'Compute'}
                        </button>
                      </>
                    )}

                    {!exp.archivedAt && (
                      <button
                        type="button"
                        onClick={() => requestArchive(exp)}
                        disabled={archiving === exp.id}
                        aria-label={`Archive experiment ${exp.name} for ${orgSlug}`}
                        className="rounded border border-white/10 px-2 py-1 text-white/40 hover:text-red-400 disabled:opacity-40"
                      >
                        Archive
                      </button>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
