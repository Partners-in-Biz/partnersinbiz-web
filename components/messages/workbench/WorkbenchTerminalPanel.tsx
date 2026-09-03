'use client'

import { type FormEvent, useEffect, useRef, useState } from 'react'
import { ALLOWLISTED_SHELL_COMMANDS } from '@/lib/messages/workbench/shell-allowlist'
import { WorkbenchXterm } from './WorkbenchXterm'
import { Icon } from '@/components/studio'
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

/** A session is alive enough to disallow Start / allow Kill from `awaiting_approval` (never yet claimed) through `running`. */
const SESSION_ACTIVE_STATUSES: ReadonlySet<WorkbenchSessionViewStatus> = new Set([
  'starting', 'awaiting_approval', 'queued', 'claimed', 'running',
])
/** Statuses that accept stdin - matches the server's `enqueueControl` check (`claimed` or `running`). */
const SESSION_INPUT_STATUSES: ReadonlySet<WorkbenchSessionViewStatus> = new Set(['claimed', 'running'])
/** Statuses where a pty exists (or existed), so the xterm surface owns the transcript. */
const SESSION_XTERM_STATUSES: ReadonlySet<WorkbenchSessionViewStatus> = new Set([
  'claimed', 'running', 'exited', 'failed', 'killed', 'expired',
])

const SESSION_STATUS_LABEL: Record<WorkbenchSessionViewStatus, string> = {
  idle: 'Not started',
  starting: 'Starting…',
  awaiting_approval: 'Awaiting approval',
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
  awaiting_approval: 'bg-[color-mix(in_srgb,var(--st-warning)_12%,transparent)] animate-pulse',
  queued: 'bg-[color-mix(in_srgb,var(--st-warning)_12%,transparent)] animate-pulse',
  claimed: 'bg-[color-mix(in_srgb,var(--st-warning)_12%,transparent)] animate-pulse',
  running: 'bg-primary animate-pulse',
  exited: 'bg-emerald-400',
  failed: 'bg-red-400',
  killed: 'bg-white/40',
  expired: 'bg-white/40',
  error: 'bg-red-400',
}

const TERMINAL_MODE_LABEL: Record<WorkbenchTerminalMode, string> = {
  jobs: 'Safe one-shots',
  session: 'Full shell (approval required)',
}

/**
 * The device-side pty host needs `node-pty`, an optional native module the
 * compiled runtime binary cannot embed yet, so it must be installed in the
 * runtime's own working directory. Hand the operator that fix instead of the
 * raw module-load failure.
 */
const NODE_PTY_HINT = 'The linked computer’s runtime is missing node-pty. On that machine, run '
  + '`npm install node-pty` in the runtime’s install directory (macOS also needs `xcode-select --install`), '
  + 'then restart the runtime agent and start the session again.'

function isNodePtyError(error: string | null | undefined): boolean {
  return typeof error === 'string' && error.toLowerCase().includes('node-pty')
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
  terminalSessions?: WorkbenchSessionViewState[]
  onSelectSession?: (sessionId: string) => void
  /** Starts a new session (server-chosen shell - no client-supplied command). Omit to disable the Start button. */
  onStartSession?: () => void
  /** Approves a session currently `awaiting_approval`. Omit to hide the Approve button. */
  onApproveSession?: () => void
  /** Sends one line of stdin to the running session. Omit to disable the fallback line input. */
  onSendSessionInput?: (line: string) => void
  /** Sends raw keystrokes (control bytes included) from the xterm surface. Must be written with stdin `mode: 'raw'`. */
  onSendSessionData?: (data: string) => void
  /** Reports the fitted xterm grid so the host can resize the remote pty. */
  onResizeSession?: (cols: number, rows: number) => void
  /** Kills the current session. Omit to disable the Kill button. */
  onKillSession?: () => void
}

function WorkbenchSessionView({
  session,
  onStart,
  onApprove,
  onSendInput,
  onSendData,
  onResize,
  onKill,
}: {
  session?: WorkbenchSessionViewState | null
  onStart?: () => void
  onApprove?: () => void
  onSendInput?: (line: string) => void
  onSendData?: (data: string) => void
  onResize?: (cols: number, rows: number) => void
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
  const approveVisible = status === 'awaiting_approval' && hasSession && Boolean(onApprove)
  /**
   * The emulator takes over once a pty has existed - including after exit, so
   * the final screen and its scrollback stay readable instead of collapsing
   * back to a plain text dump.
   */
  const showXterm = hasSession && SESSION_XTERM_STATUSES.has(status)

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
        <span aria-hidden="true" className={`h-2 w-2 shrink-0 ${SESSION_STATUS_DOT[status]}`} style={{ borderRadius: '50%' }} />
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
          {approveVisible && (
            <button
              type="button"
              data-testid="workbench-session-approve"
              aria-label="Approve full shell session"
              onClick={() => onApprove?.()}
              disabled={session?.busy}
              className="shrink-0 rounded-md border border-amber-400/35 bg-[color-mix(in_srgb,var(--st-warning)_10%,transparent)] px-2 py-1 text-[10px] font-medium text-[var(--st-warning)] hover:bg-[color-mix(in_srgb,var(--st-warning)_15%,transparent)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Approve
            </button>
          )}
          <button
            type="button"
            data-testid="workbench-session-kill"
            aria-label="Kill shell session"
            onClick={() => onKill?.()}
            disabled={killDisabled}
            className="shrink-0 rounded-md border border-red-400/35 bg-red-500/10 px-2 py-1 text-[10px] font-medium text-red-200 hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Kill
          </button>
        </div>
      </div>

      {approveVisible && (
        <p data-testid="workbench-session-approval-notice" className="shrink-0 border-b border-amber-400/20 bg-[color-mix(in_srgb,var(--st-warning)_10%,transparent)] px-2 py-1.5 text-[10px] text-[var(--st-warning)]">
          This opens an unrestricted shell on the linked computer. Approve to let it start.
        </p>
      )}

      {session?.error && (
        <div role="alert" className="shrink-0 space-y-1 border-b border-red-400/20 bg-red-500/10 px-2 py-1.5 text-[10px] text-red-200">
          <p>{session.error}</p>
          {isNodePtyError(session.error) && (
            <p data-testid="workbench-session-node-pty-hint" className="text-red-100/80">{NODE_PTY_HINT}</p>
          )}
        </div>
      )}

      {showXterm ? (
        <WorkbenchXterm
          output={session?.transcript ?? ''}
          onData={onSendData}
          onResize={onResize}
          disabled={!SESSION_INPUT_STATUSES.has(status) || !onSendData}
          className="min-h-0 flex-1 p-1.5"
        />
      ) : (
        <div
          ref={transcriptRef}
          data-testid="workbench-session-transcript"
          className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words bg-[#050505]/80 p-2 font-mono text-[11px] leading-relaxed text-[var(--color-pib-text-muted)] [overflow-wrap:anywhere]"
        >
          {session?.transcript || (
            <span className="text-[var(--color-pib-text-muted)]/60">
              {hasSession
                ? status === 'awaiting_approval'
                  ? 'Waiting for approval before the shell starts…'
                  : 'Waiting for output…'
                : 'Start a session to open an interactive shell on the linked computer.'}
            </span>
          )}
        </div>
      )}

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
  terminalSessions = [],
  onSelectSession,
  onStartSession,
  onApproveSession,
  onSendSessionInput,
  onSendSessionData,
  onResizeSession,
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
          title={TERMINAL_MODE_LABEL[tabMode]}
          onClick={() => changeMode(tabMode)}
          className={`flex items-baseline gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors ${
            mode === tabMode
              ? 'bg-primary/15 text-primary'
              : 'text-[var(--color-pib-text-muted)] hover:bg-white/[0.06] hover:text-[var(--color-pib-text)]'
          }`}
        >
          <span>{tabMode === 'jobs' ? 'Jobs' : 'Session'}</span>
          <span className="text-[9px] font-normal opacity-70">{TERMINAL_MODE_LABEL[tabMode]}</span>
        </button>
      ))}
    </div>
  )

  if (mode === 'session') {
    return (
      <div data-testid="workbench-terminal-panel" className="flex h-full min-h-0 flex-col">
        {modeTabs}
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-white/10 p-1.5" aria-label="Terminal sessions">
          {terminalSessions.map((item, index) => (
            <button key={item.sessionId ?? `new-${index}`} type="button" onClick={() => item.sessionId && onSelectSession?.(item.sessionId)} className={`rounded px-2 py-1 text-[10px] ${item.sessionId === session?.sessionId ? 'bg-primary/15 text-primary' : 'text-[var(--color-pib-text-muted)] hover:bg-white/[0.06]'}`}>
              Terminal {index + 1}
            </button>
          ))}
          <button type="button" onClick={onStartSession} disabled={!onStartSession} className="ml-auto rounded border border-white/10 px-2 py-1 text-[10px] text-[var(--color-pib-text-muted)] hover:bg-white/[0.06] disabled:opacity-40">New terminal</button>
        </div>
        <WorkbenchSessionView
          session={session}
          onStart={onStartSession}
          onApprove={onApproveSession}
          onSendInput={onSendSessionInput}
          onSendData={onSendSessionData}
          onResize={onResizeSession}
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
            className="rounded-md border border-white/10 px-2 py-1 font-mono text-[10px] text-[var(--color-pib-text-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
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
        Safe one-shot allowlisted jobs on the linked computer. Switch to Session for a full shell, which requires approval.
      </p>
    </div>
  )

  if (entries.length === 0) {
    return (
      <div className="flex h-full flex-col">
        {modeTabs}
        {commandBar}
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
          <Icon name="terminal" className="text-[28px] text-[var(--color-pib-text-muted)]" />
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
              <span aria-hidden="true" className={`h-2 w-2 shrink-0 ${STATUS_DOT[entry.status] ?? STATUS_DOT.info}`} style={{ borderRadius: '50%' }} />
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
