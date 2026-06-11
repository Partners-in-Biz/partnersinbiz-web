'use client'

import Link from 'next/link'
import { useState } from 'react'
import { HealthBadge } from './HealthBadge'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function SprintCard({ sprint }: { sprint: any }) {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ done: number; queued: number; blocked: number } | null>(null)
  const day = sprint.currentDay ?? 0
  const phase = sprint.currentPhase ?? 0
  const phaseLabels = ['Pre-launch', 'Foundation', 'Content engine', 'Authority', 'Compounding']

  async function runToday() {
    setRunning(true)
    try {
      const res = await fetch(`/api/v1/seo/sprints/${sprint.id}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      const json = await res.json()
      if (json.success) {
        setResult({
          done: json.data.done?.length ?? 0,
          queued: json.data.queued?.length ?? 0,
          blocked: json.data.blocked?.length ?? 0,
        })
      }
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="pib-card group space-y-4 transition-colors hover:border-[var(--color-pib-accent)] hover:bg-white/[0.03]">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-base leading-tight">
            <Link href={`/portal/seo/sprints/${sprint.id}`} className="hover:underline">
              {sprint.siteName}
            </Link>
          </h3>
          <p className="text-xs text-[var(--color-pib-text-muted)] truncate max-w-[280px]">{sprint.siteUrl}</p>
        </div>
        <HealthBadge score={sprint.health?.score} signalsCount={sprint.health?.signals?.length ?? 0} />
      </div>
      <div className="rounded-2xl border border-[var(--color-pib-line)] bg-white/[0.02] p-3 text-sm">
        <div className="font-medium">
          {phase === 4 ? `Phase 4 — Compounding · Day ${day}` : `Day ${day} of 90`}
        </div>
        <div className="text-xs text-[var(--color-pib-text-muted)]">{phaseLabels[phase]}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/portal/seo/sprints/${sprint.id}`}
          className="pib-btn-secondary !px-3 !py-1.5 text-xs"
        >
          <span className="material-symbols-outlined text-base">open_in_new</span>
          Open
        </Link>
        <button
          onClick={runToday}
          disabled={running}
          className="pib-btn-primary !px-3 !py-1.5 text-xs disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-base">{running ? 'autorenew' : 'play_arrow'}</span>
          {running ? 'Running…' : "Run today's SEO"}
        </button>
      </div>
      {result && (
        <p className="pib-pill">
          {result.done} done · {result.queued} queued · {result.blocked} blocked
        </p>
      )}
    </div>
  )
}
