'use client'

import type { WorkbenchTerminalEntry, WorkbenchTerminalStatus } from '@/lib/messages/workbench/types'

const STATUS_DOT: Record<WorkbenchTerminalStatus, string> = {
  failed: 'bg-red-400',
  running: 'bg-primary animate-pulse',
  done: 'bg-emerald-400',
  info: 'bg-white/40',
}

export function WorkbenchTerminalPanel({ entries }: { entries: WorkbenchTerminalEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
        <span aria-hidden="true" className="material-symbols-outlined text-[28px] text-[var(--color-pib-text-muted)]">terminal</span>
        <p className="text-xs font-medium text-[var(--color-pib-text)]">No terminal activity yet</p>
        <p className="text-[11px] leading-relaxed text-[var(--color-pib-text-muted)]">
          Commands and tool calls will stream here as the agent works.
        </p>
      </div>
    )
  }

  return (
    <div data-testid="workbench-terminal-panel" className="h-full space-y-1.5 overflow-y-auto p-2 font-mono text-[11px] leading-relaxed">
      {entries.map((entry) => (
        <div key={entry.id} className="overflow-hidden rounded-lg border border-white/10 bg-[#050505]/80">
          <div className="flex items-center gap-2 border-b border-white/5 px-2 py-1 text-[10px]">
            <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[entry.status] ?? STATUS_DOT.info}`} />
            <span className="min-w-0 flex-1 truncate text-primary">{entry.label}</span>
            <span className="shrink-0 text-[var(--color-pib-text-muted)]/70">{entry.meta}</span>
          </div>
          {entry.body && (
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words px-2 py-1.5 text-[11px] text-[var(--color-pib-text-muted)] [overflow-wrap:anywhere]">
              {entry.body}
            </pre>
          )}
        </div>
      ))}
    </div>
  )
}

export default WorkbenchTerminalPanel
