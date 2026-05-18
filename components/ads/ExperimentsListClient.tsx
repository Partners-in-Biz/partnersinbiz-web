'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ExperimentSignificanceBadge } from './ExperimentSignificanceBadge'
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

export function ExperimentsListClient({ experiments, orgSlug }: Props) {
  const [activeTab, setActiveTab] = useState<FilterKey>('all')
  const [actioning, setActioning] = useState<string | null>(null)

  const filtered = experiments.filter((e) => {
    if (activeTab === 'all') return !e.archivedAt
    if (activeTab === 'archived') return !!e.archivedAt
    return e.status === activeTab && !e.archivedAt
  })

  async function postAction(experimentId: string, action: string) {
    setActioning(experimentId)
    try {
      await fetch(`/api/v1/ads/experiments/${experimentId}/${action}`, { method: 'POST' })
      window.location.reload()
    } finally {
      setActioning(null)
    }
  }

  async function archiveExperiment(experimentId: string) {
    if (!confirm('Archive this experiment?')) return
    await fetch(`/api/v1/ads/experiments/${experimentId}`, { method: 'DELETE' })
    window.location.reload()
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

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-1 border-b border-white/10" role="tablist">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeTab === tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm transition-colors ${
              activeTab === tab.key
                ? 'border-b-2 border-[#F5A623] text-white'
                : 'text-white/50 hover:text-white/80'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

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
              <li key={exp.id} className="px-5 py-4">
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
                        onClick={() => archiveExperiment(exp.id)}
                        className="rounded border border-white/10 px-2 py-1 text-white/40 hover:text-red-400"
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
