'use client'

import { type FormEvent, useEffect, useRef, useState } from 'react'
import { ALLOWLISTED_SHELL_COMMANDS } from '@/lib/messages/workbench/shell-allowlist'
import type {
  WorkbenchSessionViewState,
  WorkbenchSessionViewStatus,
  WorkbenchTerminalEntry,
  WorkbenchTerminalMode,
  WorkbenchTerminalStatus,
} from '@/lib/messages/workbench/types'

const STATUS_DOT: Record<WorkbenchTerminalStatus, string> = {
  failed: 'bg-red-400',
  running: 'bg-primary animate-pulse',
  done: 'bg-emerald-400',
  info: 'bg-white/40',
}

/** Typed Phase 2b commands plus Phase 3 allowlisted shell.exec templates. */
const QUICK_COMMANDS = [
  'git status',
  'git diff',
  'git diff --stat',
  'git branch --show-current',
  'git log --oneline -n 20',
  'ls',
  'ls -la',
  'pwd',
  'node --version',
  'npm --version',
  'npm test',
  'npm run lint',
  'pnpm --version',
  'pnpm test',
  ...ALLOWLISTED_SHELL_COMMANDS.filter((command) => ![
    'git log --oneline -n 20',
    'git branch --show-current',
    'ls -la',
    'node --version',
    'npm --version',
    'npm test',
    'npm run lint',
    'pnpm --version',
    'pnpm test',
  ].includes(command)),
]

/** A session is alive enough to disallow Start / allow Kill from `queued` (never yet claimed) through `running`. */
const SESSION_ACTIVE_STATUSES: ReadonlySet<WorkbenchSessionViewStatus> = new Set(['starting', 'queued', 'claimed', 'running'])
/** Statuses that accept stdin — matches the server's `enqueueControl` check (`claimed` or `running`). */
const SESSION_INPUT_STATUSES: ReadonlySet<WorkbenchSessionViewStatus> = new Set(['claimed', 'running'])

const SESSION_STATUS_LABEL: Record<WorkbenchSessionViewStatus, string> = {
  idle: 'Not started',
  starting: 'Starting…',
  queued: 'Queued',
  claimed: 'Starting…',
  running: 'Running',
  exited: 'Exited',
  failed: 'Failed',
  killed: 'Killed',
  expired: 'Expired',
  error: 'Error',
}

const SESSION_STATUS_DOT: Record<WorkbenchSessionViewStatus, string> = {
  idle: 'bg-white/30',
  starting: 'bg-primary animate-pulse',
  queued: 'bg-amber-300 animate-pulse',
  claimed: 'bg-amber-300 animate-pulse',
  running: 'bg-primary animate-pulse',
  exited: 'bg-emerald-400',
  failed: 'bg-red-400',
  killed: 'bg-white/40',
  expired: 'bg-white/40',
  error: 'bg-red-400',
}

export interface WorkbenchTerminalPanelProps {
  entries: WorkbenchTerminalEntry[]
  /** Runs an allowlisted command (chip or free-text) against the linked computer. Omit to hide the command bar. */
  onRunCommand?: (command: string) => void
  /** Clears local interactive terminal entries (observer SSE entries remain). */
  onClear?: () => void
  /** Disables the command bar while a command is in flight. */
  running?: boolean
  /** Jobs (allowlisted one-shot commands) or Session (interactive PTY, Phase 3b). Defaults to uncontrolled 'jobs'. */
  mode?: WorkbenchTerminalMode
  onModeChange?: (mode: WorkbenchTerminalMode) => void
  /** Current interactive session state, owned by the host component. Omit/null renders the "not started" state. */
  session?: WorkbenchSessionViewState | null
  /** Starts a new session (server-chosen shell — no client-supplied command). Omit to disable the Start button. */
  onStartSession?: () => void
  /** Sends one line of stdin to the running session. Omit to disable the input. */
  onSendSessionInput?: (line: string) => void
  /** Kills the current session. Omit to disable the Kill button. */
  onKillSession?: () => void
}

function WorkbenchSessionView({
  session,
  onStart,
  onSendInput,
  onKill,
}: {
  session?: WorkbenchSessionViewState | null
  onStart?: () => void
  onSendInput?: (line: string) => void
  onKill?: () => void
}) {
  const [stdinValue, setStdinValue] = useState('')
  const transcriptRef = useRef<HTMLDivElement>(null)

  const status: WorkbenchSessionViewStatus = session?.status ?? 'idle'
  const active = SESSION_ACTIVE_STATUSES.has(status)
  const hasSession = Boolean(session?.sessionId)
  const startDisabled = active || !onStart
  const killDisabled = !active || !hasSession || !onKill
  const inputEnabled = SESSION_INPUT_STATUSES.has(status) && hasSession && Boolean(onSendInput)

  useEffect(() => {
    const node = transcriptRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [session?.transcript])

  const submitStdin = (event: FormEvent) => {
    event.preventDefault()
    if (!inputEnabled || !stdinValue.trim()) return
    onSendInput?.(stdinValue)
    setStdinValue('')
  }

  return (
    <div data-testid="workbench-session-view" className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 p-2">
        <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${SESSION_STATUS_DOT[status]}`} />
        <span data-testid="workbench-session-status" className="text-[11px] font-medium text-[var(--color-pib-text)]">
          {SESSION_STATUS_LABEL[status]}
        </span>
        {session?.sessionId && (
          <span className="max-w-[9rem] truncate font-mono text-[10px] text-[var(--color-pib-text-muted)]" title={session.sessionId}>
            {session.sessionId}
          </span>
        )}
        {typeof session?.exitCode === 'number' && (
          <span className="text-[10px] text-[var(--color-pib-text-muted)]">exit {session.exitCode}</span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            data-testid="workbench-session-start"
            onClick={() => onStart?.()}
            disabled={startDisabled}
            className="shrink-0 rounded-md border border-primary/35 bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Start session
          </button>
          <button
            type="button"
            data-testid="workbench-session-kill"
            onClick={() => onKill?.()}
            disabled={killDisabled}
            className="shrink-0 rounded-md border border-red-400/35 bg-red-500/10 px-2 py-1 text-[10px] font-medium text-red-200 hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Kill
          </button>
        </div>
      </div>

      {session?.error && (
        <p role="alert" className="shrink-0 border-b border-red-400/20 bg-red-500/10 px-2 py-1.5 text-[10px] text-red-200">
          {session.error}
        </p>
      )}

      <div
        ref={transcriptRef}
        data-testid="workbench-session-transcript"
        className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words bg-[#050505]/80 p-2 font-mono text-[11px] leading-relaxed text-[var(--color-pib-text-muted)] [overflow-wrap:anywhere]"
      >
        {session?.transcript || (
          <span className="text-[var(--color-pib-text-muted)]/60">
            {hasSession ? 'Waiting for output…' : 'Start a session to open an interactive shell on the linked computer.'}
          </span>
        )}
      </div>

      <form onSubmit={submitStdin} className="flex shrink-0 gap-1.5 border-t border-white/10 p-2">
        <input
          value={stdinValue}
          onChange={(event) => setStdinValue(event.target.value)}
          disabled={!inputEnabled}
          placeholder={inputEnabled ? 'Send a line to the session…' : 'Start a session to send input…'}
          aria-label="Session stdin"
          className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-2 py-1 font-mono text-[11px] text-[var(--color-pib-text)] outline-none focus:border-primary/60 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!inputEnabled || !stdinValue.trim()}
          className="shrink-0 rounded-md border border-white/10 px-2 py-1 text-[10px] font-medium text-[var(--color-pib-text-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  )
}

export function WorkbenchTerminalPanel({
  entries,
  onRunCommand,
  onClear,
  running = false,
  mode: controlledMode,
  onModeChange,
  session,
  onStartSession,
  onSendSessionInput,
  onKillSession,
}: WorkbenchTerminalPanelProps) {
  const [customCommand, setCustomCommand] = useState('')
  const [localMode, setLocalMode] = useState<WorkbenchTerminalMode>('jobs')
  const mode = controlledMode ?? localMode

  const changeMode = (next: WorkbenchTerminalMode) => {
    setLocalMode(next)
    onModeChange?.(next)
  }

  const submitCustomCommand = () => {
    const trimmed = customCommand.trim()
    if (!trimmed || !onRunCommand) return
    onRunCommand(trimmed)
    setCustomCommand('')
  }

  const modeTabs = (
    <div role="tablist" aria-label="Terminal mode" className="flex shrink-0 gap-1 border-b border-white/10 p-1.5">
      {(['jobs', 'session'] as const).map((tabMode) => (
        <button
          key={tabMode}
          type="button"
          role="tab"
          aria-selected={mode === tabMode}
          data-testid={`workbench-terminal-mode-${tabMode}`}
          onClick={() => changeMode(tabMode)}
          className={`rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors ${
            mode === tabMode
              ? 'bg-primary/15 text-primary'
              : 'text-[var(--color-pib-text-muted)] hover:bg-white/[0.06] hover:text-[var(--color-pib-text)]'
          }`}
        >
          {tabMode === 'jobs' ? 'Jobs' : 'Session'}
        </button>
      ))}
    </div>
  )

  if (mode === 'session') {
    return (
      <div data-testid="workbench-terminal-panel" className="flex h-full min-h-0 flex-col">
        {modeTabs}
        <WorkbenchSessionView
          session={session}
          onStart={onStartSession}
          onSendInput={onSendSessionInput}
          onKill={onKillSession}
        />
      </div>
    )
  }

  const commandBar = onRunCommand && (
    <div className="shrink-0 space-y-1.5 border-b border-white/10 p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">
          Allowlisted shell
        </p>
        {onClear && (
          <button
            type="button"
            data-testid="workbench-terminal-clear"
            disabled={running || entries.length === 0}
            onClick={onClear}
            className="rounded-md border border-white/10 px-2 py-0.5 text-[10px] text-[var(--color-pib-text-muted)] hover:bg-white/[0.06] hover:text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Clear
          </button>
        )}
      </div>
      <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
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
      <p className="text-[10px] leading-relaxed text-[var(--color-pib-text-muted)]/80">
        One-shot allowlisted jobs on the linked computer (Phase 3). Switch to Session for an interactive shell.
      </p>
    </div>
  )

  if (entries.length === 0) {
    return (
      <div className="flex h-full flex-col">
        {modeTabs}
        {commandBar}
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
          <span aria-hidden="true" className="material-symbols-outlined text-[28px] text-[var(--color-pib-text-muted)]">terminal</span>
          <p className="text-xs font-medium text-[var(--color-pib-text)]">No terminal activity yet</p>
          <p className="text-[11px] leading-relaxed text-[var(--color-pib-text-muted)]">
            Run an allowlisted command, or watch agent tool calls stream here.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div data-testid="workbench-terminal-panel" className="flex h-full min-h-0 flex-col">
      {modeTabs}
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
