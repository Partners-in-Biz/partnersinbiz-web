'use client'

import { useEffect, useState } from 'react'
import type { WorkbenchChangeFile, WorkbenchChangeStatus } from '@/lib/messages/workbench/types'

const STATUS_META: Record<WorkbenchChangeStatus, { label: string; className: string }> = {
  added: { label: 'A', className: 'text-emerald-300 border-emerald-400/30 bg-emerald-500/10' },
  modified: { label: 'M', className: 'text-amber-300 border-amber-400/30 bg-amber-500/10' },
  deleted: { label: 'D', className: 'text-red-300 border-red-400/30 bg-red-500/10' },
  renamed: { label: 'R', className: 'text-sky-300 border-sky-400/30 bg-sky-500/10' },
  unknown: { label: '?', className: 'text-[var(--color-pib-text-muted)] border-[var(--color-card-border)] bg-white/[0.04]' },
}

export function WorkbenchChangesPanel({ changes }: { changes: WorkbenchChangeFile[] }) {
  const [selectedPath, setSelectedPath] = useState<string | null>(changes[0]?.path ?? null)

  useEffect(() => {
    if (!changes.some((change) => change.path === selectedPath)) {
      setSelectedPath(changes[0]?.path ?? null)
    }
    // Only re-sync selection when the available changes actually change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changes])

  if (changes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
        <span aria-hidden="true" className="material-symbols-outlined text-[28px] text-[var(--color-pib-text-muted)]">difference</span>
        <p className="text-xs font-medium text-[var(--color-pib-text)]">No changes yet</p>
        <p className="text-[11px] leading-relaxed text-[var(--color-pib-text-muted)]">
          Files written, edited or patched by the agent will show up here with their diffs.
        </p>
      </div>
    )
  }

  const selected = changes.find((change) => change.path === selectedPath) ?? changes[0]

  return (
    <div data-testid="workbench-changes-panel" className="flex h-full min-h-0 flex-col">
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
                active ? 'bg-primary/10 text-[var(--color-pib-text)]' : 'text-[var(--color-pib-text-muted)] hover:bg-white/[0.04]'
              }`}
            >
              <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[9px] font-bold ${meta.className}`}>
                {meta.label}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono">{change.path}</span>
            </button>
          )
        })}
      </div>
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
