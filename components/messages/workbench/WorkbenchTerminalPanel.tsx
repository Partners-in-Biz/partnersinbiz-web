'use client'

import { useState } from 'react'
import type { WorkbenchTerminalEntry, WorkbenchTerminalStatus } from '@/lib/messages/workbench/types'

const STATUS_DOT: Record<WorkbenchTerminalStatus, string> = {
  failed: 'bg-red-400',
  running: 'bg-primary animate-pulse',
  done: 'bg-emerald-400',
  info: 'bg-white/40',
}

/** Phase 2b allowlisted commands, mirroring `ALLOWLISTED_COMMANDS` in the terminal route. */
const QUICK_COMMANDS = ['git status', 'git diff', 'git diff --stat', 'ls', 'pwd']

export interface WorkbenchTerminalPanelProps {
  entries: WorkbenchTerminalEntry[]
  /** Runs an allowlisted command (chip or free-text) against the linked computer. Omit to hide the command bar. */
  onRunCommand?: (command: string) => void
  /** Disables the command bar while a command is in flight. */
  running?: boolean
}

export function WorkbenchTerminalPanel({ entries, onRunCommand, running = false }: WorkbenchTerminalPanelProps) {
  const [customCommand, setCustomCommand] = useState('')

  const submitCustomCommand = () => {
    const trimmed = customCommand.trim()
    if (!trimmed || !onRunCommand) return
    onRunCommand(trimmed)
    setCustomCommand('')
  }

  const commandBar = onRunCommand && (
    <div className="shrink-0 space-y-1.5 border-b border-white/10 p-2">
      <div className="flex flex-wrap gap-1.5">
        {QUICK_COMMANDS.map((command) => (
          <button
            key={command}
            type="button"
            data-testid={`workbench-terminal-quick-command-${command.replace(/\s+/g, '-')}`}
            disabled={running}
            onClick={() => onRunCommand(command)}
            className="rounded-full border border-white/10 px-2 py-1 font-mono text-[10px] text-[var(--color-pib-text-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {command}
          </button>
        ))}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submitCustomCommand()
        }}
        className="flex gap-1.5"
      >
        <input
          value={customCommand}
          onChange={(event) => setCustomCommand(event.target.value)}
          disabled={running}
          placeholder="Allowlisted command…"
          aria-label="Workbench terminal command"
          className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-2 py-1 font-mono text-[11px] text-[var(--color-pib-text)] outline-none focus:border-primary/60 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={running || !customCommand.trim()}
          className="shrink-0 rounded-md border border-white/10 px-2 py-1 text-[10px] font-medium text-[var(--color-pib-text-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Run
        </button>
      </form>
    </div>
  )

  if (entries.length === 0) {
    return (
      <div className="flex h-full flex-col">
        {commandBar}
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
          <span aria-hidden="true" className="material-symbols-outlined text-[28px] text-[var(--color-pib-text-muted)]">terminal</span>
          <p className="text-xs font-medium text-[var(--color-pib-text)]">No terminal activity yet</p>
          <p className="text-[11px] leading-relaxed text-[var(--color-pib-text-muted)]">
            {onRunCommand
              ? 'Run an allowlisted command above, or commands and tool calls will stream here as the agent works.'
              : 'Commands and tool calls will stream here as the agent works.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div data-testid="workbench-terminal-panel" className="flex h-full flex-col">
      {commandBar}
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2 font-mono text-[11px] leading-relaxed">
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
    </div>
  )
}

export default WorkbenchTerminalPanel
