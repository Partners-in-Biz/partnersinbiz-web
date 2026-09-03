'use client'

import { useEffect, useState } from 'react'
import type { WorkbenchChangeFile, WorkbenchChangeStatus } from '@/lib/messages/workbench/types'
import { Icon } from '@/components/studio'

const STATUS_META: Record<WorkbenchChangeStatus, { label: string; className: string }> = {
  added: { label: 'A', className: 'text-emerald-300 border-emerald-400/30 bg-emerald-500/10' },
  modified: { label: 'M', className: 'text-[var(--st-warning)] border-amber-400/30 bg-[color-mix(in_srgb,var(--st-warning)_10%,transparent)]' },
  deleted: { label: 'D', className: 'text-red-300 border-red-400/30 bg-red-500/10' },
  renamed: { label: 'R', className: 'text-sky-300 border-sky-400/30 bg-sky-500/10' },
  unknown: { label: '?', className: 'text-[var(--color-pib-text-muted)] border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)]' },
}

export interface WorkbenchChangesPanelProps {
  changes: WorkbenchChangeFile[]
  onOpenInFiles?: (path: string) => void
  /** Phase 2b status note (e.g. approval/failure feedback from the last `git.status` run). */
  message?: string | null
  /** Where `changes` came from - shows a small "Live" banner when a `git.status` job has completed. */
  source?: 'live' | 'events' | 'none'
  loading?: boolean
}

export function WorkbenchChangesPanel({ changes, onOpenInFiles, message, source = 'none', loading = false }: WorkbenchChangesPanelProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(changes[0]?.path ?? null)

  useEffect(() => {
    if (!changes.some((change) => change.path === selectedPath)) {
      setSelectedPath(changes[0]?.path ?? null)
    }
    // Only re-sync selection when the available changes actually change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changes])

  const liveBanner = source === 'live' && (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--color-card-border)] bg-emerald-500/[0.06] px-2.5 py-1 text-[10px] font-medium text-emerald-300">
      <span aria-hidden="true" className={`h-1.5 w-1.5 bg-emerald-400 ${loading ? 'animate-pulse' : ''}`} style={{ borderRadius: '50%' }} />
      Live from linked computer (git status)
    </div>
  )

  const statusNote = message && (
    <p className="shrink-0 border-b border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)] px-2.5 py-1.5 text-[10px] leading-relaxed text-[var(--color-pib-text-muted)]">
      {message}
    </p>
  )

  if (changes.length === 0) {
    return (
      <div className="flex h-full flex-col">
        {liveBanner}
        {statusNote}
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
          <Icon name="difference" className="text-[28px] text-[var(--color-pib-text-muted)]" />
          <p className="text-xs font-medium text-[var(--color-pib-text)]">No changes yet</p>
          <p className="text-[11px] leading-relaxed text-[var(--color-pib-text-muted)]">
            Files written, edited or patched by the agent will show up here with their diffs.
          </p>
        </div>
      </div>
    )
  }

  const selected = changes.find((change) => change.path === selectedPath) ?? changes[0]

  return (
    <div data-testid="workbench-changes-panel" className="flex h-full min-h-0 flex-col">
      {liveBanner}
      {statusNote}
      <div className="max-h-[40%] shrink-0 overflow-y-auto border-b border-[var(--color-card-border)]">
        {changes.map((change) => {
          const meta = STATUS_META[change.status] ?? STATUS_META.unknown
          const active = change.path === selected?.path
          return (
            <button
              key={change.path}
              type="button"
              aria-pressed={active}
              onClick={() => setSelectedPath(change.path)}
              className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] ${
                active ? 'bg-primary/10 text-[var(--color-pib-text)]' : 'text-[var(--color-pib-text-muted)] hover:bg-[var(--color-pib-surface-muted)]'
              }`}
            >
              <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[9px] font-medium ${meta.className}`}>
                {meta.label}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono">{change.path}</span>
            </button>
          )
        })}
      </div>
      {selected && onOpenInFiles && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--color-card-border)] px-2.5 py-1.5">
          <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--color-pib-text-muted)]">{selected.path}</span>
          <button
            type="button"
            onClick={() => onOpenInFiles(selected.path)}
            className="shrink-0 rounded-md border border-[var(--color-card-border)] px-2 py-1 text-[10px] font-medium text-[var(--color-pib-text-muted)] hover:bg-[var(--color-pib-surface-muted)] hover:text-[var(--color-pib-text)]"
          >
            Open in Files
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {selected?.patch ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[var(--color-pib-text-muted)] [overflow-wrap:anywhere]">
            {selected.patch}
          </pre>
        ) : selected?.preview ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[var(--color-pib-text-muted)] [overflow-wrap:anywhere]">
            {selected.preview}
          </pre>
        ) : (
          <p className="text-[11px] text-[var(--color-pib-text-muted)]">No diff preview captured for this file yet.</p>
        )}
      </div>
    </div>
  )
}

export default WorkbenchChangesPanel
