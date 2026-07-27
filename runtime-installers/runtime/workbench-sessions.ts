import fs from 'node:fs'
import path from 'node:path'
import { MappingRegistry } from './bridge'
import { mappedRoot, normalizeRelativePath, resolveExisting, sanitizedShellEnv, workbenchPollDelay } from './workbench'

// -----------------------------------------------------------------------------
// Claim/operation types
//
// Reconciled against the finalized server contract in
// lib/messages/workbench/sessions.ts + session-store.ts (built in parallel by
// another agent): `WorkbenchSessionClaim`'s `kind: 'create'` variant flattens
// the server-resolved shell/cols/rows/cwd directly on the claim; `kind:
// 'control'` delivers one queued stdin/resize/kill control at a time for a
// session this device already owns. The runtime cannot `import` those types
// directly — runtime-installers/runtime/tsconfig.json sets rootDir "." and
// only includes this directory's own *.ts files, the same reason
// ALLOWLISTED_ARGV is hand-mirrored in ./workbench.ts — so the shapes below
// are a by-hand mirror. Keep them identical to lib/messages/workbench/
// sessions.ts and session-store.ts's WorkbenchSessionClaim/WorkbenchSessionControl.
// -----------------------------------------------------------------------------

export type WorkbenchSessionShell = 'bash' | 'zsh' | 'sh'
export type WorkbenchSessionStdinMode = 'line' | 'raw'

export type WorkbenchSessionControl =
  | { kind: 'stdin'; data: string; mode: WorkbenchSessionStdinMode }
  | { kind: 'resize'; cols: number; rows: number }
  | { kind: 'kill' }

export type WorkbenchSessionClaim =
  | {
    kind: 'create'
    sessionId: string
    shell: WorkbenchSessionShell
    cols: number
    rows: number
    /** Relative to the mapping root, jailed the same way as workbench shell.exec cwd. */
    cwd: string
    workspaceId: string
    mappingId: string
    relativeFolder: string
    attempt: number
    leaseToken: string
  }
  | {
    kind: 'control'
    sessionId: string
    control: WorkbenchSessionControl
    attempt: number
    leaseToken: string
  }

export type PostFn = (path: string, body: Record<string, unknown>) => Promise<Response>

const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/
const LEASE_TOKEN = /^[A-Za-z0-9_-]{16,128}$/
const SHELLS: readonly WorkbenchSessionShell[] = ['bash', 'zsh', 'sh']
// Matches lib/messages/workbench/sessions.ts: MAX_STDIN_BYTES, MIN/MAX_DIMENSION.
const MAX_STDIN_BYTES = 8_000
const MIN_DIMENSION = 1
const MAX_DIMENSION = 300
const DEFAULT_IDLE_TTL_MS = 10 * 60 * 1_000
const SESSIONS_MAX_POLL_DELAY_MS = 1_000

function isSafeDimension(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= MIN_DIMENSION && Number(value) <= MAX_DIMENSION
}

function assertValidControl(control: unknown): WorkbenchSessionControl {
  if (!control || typeof control !== 'object' || typeof (control as { kind?: unknown }).kind !== 'string') {
    throw new Error('invalid workbench session control')
  }
  const input = control as Record<string, unknown>
  switch (input.kind) {
    case 'stdin': {
      if (
        typeof input.data !== 'string' || input.data.length === 0
        || Buffer.byteLength(input.data, 'utf8') > MAX_STDIN_BYTES
        || input.data.includes('\u0000')
        || (input.mode !== undefined && input.mode !== 'line' && input.mode !== 'raw')
      ) {
        throw new Error('invalid workbench session stdin control')
      }
      return { kind: 'stdin', data: input.data, mode: input.mode === 'raw' ? 'raw' : 'line' }
    }
    case 'resize': {
      if (!isSafeDimension(input.cols) || !isSafeDimension(input.rows)) throw new Error('invalid workbench session resize control')
      return { kind: 'resize', cols: Number(input.cols), rows: Number(input.rows) }
    }
    case 'kill':
      return { kind: 'kill' }
    default:
      throw new Error('invalid workbench session control kind')
  }
}

function assertValidSessionClaim(claim: WorkbenchSessionClaim): void {
  if (
    !claim || typeof claim !== 'object'
    || !IDENTIFIER.test(claim.sessionId)
    || !Number.isSafeInteger(claim.attempt) || claim.attempt < 1
    || typeof claim.leaseToken !== 'string' || !LEASE_TOKEN.test(claim.leaseToken)
  ) {
    throw new Error('invalid workbench session claim')
  }
  if (claim.kind === 'create') {
    if (
      !SHELLS.includes(claim.shell)
      || !isSafeDimension(claim.cols) || !isSafeDimension(claim.rows)
      || typeof claim.cwd !== 'string'
      || !IDENTIFIER.test(claim.mappingId)
      || typeof claim.relativeFolder !== 'string'
      || typeof claim.workspaceId !== 'string' || claim.workspaceId.length === 0
    ) {
      throw new Error('invalid workbench session claim')
    }
    return
  }
  if (claim.kind === 'control') {
    assertValidControl(claim.control)
    return
  }
  throw new Error('invalid workbench session claim')
}

// -----------------------------------------------------------------------------
// node-pty is an optional native dependency. It is added to
// runtime-installers/runtime/package.json as an optionalDependency, but the
// standalone runtime binaries are produced with `bun build --compile`
// (see runtime-installers/build-runtime.sh), which does not currently know how
// to embed node-pty's per-platform prebuilt native addon into a single-file
// executable. Until that packaging is extended, node-pty must be installed
// alongside the runtime's install path (e.g. `npm i node-pty` in the runtime's
// working directory, or bundled by a future build step) for interactive
// sessions to work. Everything else in this file degrades gracefully when it
// is missing: session creation fails with a clear error and every other
// runtime poller (shell.exec jobs, sync, agent-host) keeps working.
// -----------------------------------------------------------------------------

export type PtyProcess = {
  pid: number
  onData: (callback: (data: string) => void) => void
  onExit: (callback: (event: { exitCode: number; signal?: number }) => void) => void
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  kill: (signal?: string) => void
}

type NodePtyModule = {
  spawn: (
    file: string,
    args: string[],
    options: { name?: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv },
  ) => PtyProcess
}

const NODE_PTY_MISSING_MESSAGE = 'interactive workbench sessions require the optional "node-pty" dependency, which is not installed in this runtime build. Install node-pty alongside the runtime (see runtime-installers/runtime/package.json optionalDependencies) and retry.'

let cachedNodePty: NodePtyModule | null | undefined

function loadNodePty(): NodePtyModule {
  if (cachedNodePty === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional native dependency, resolved lazily
      cachedNodePty = require('node-pty') as NodePtyModule
    } catch {
      cachedNodePty = null
    }
  }
  if (!cachedNodePty) throw new Error(NODE_PTY_MISSING_MESSAGE)
  return cachedNodePty
}

export function isNodePtyAvailable(): boolean {
  try {
    loadNodePty()
    return true
  } catch {
    return false
  }
}

/** Test-only hook to force the cached node-pty module/availability without touching node_modules. */
export function __setNodePtyForTests(module: NodePtyModule | null | undefined): void {
  cachedNodePty = module
}

/**
 * The server picks the shell *name* (`bash`/`zsh`/`sh`) since it does not know
 * this device's filesystem; the runtime resolves that name to an actual
 * binary path here. Prefers `process.env.SHELL` when its basename already
 * matches the requested shell (respects e.g. a Homebrew-installed zsh),
 * otherwise falls back to each platform's well-known path for that shell.
 */
function resolveShellPath(shellName: WorkbenchSessionShell, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  const configured = env.SHELL
  if (configured && path.basename(configured) === shellName) return configured
  if (shellName === 'zsh') return platform === 'darwin' ? '/bin/zsh' : '/usr/bin/zsh'
  if (shellName === 'sh') return '/bin/sh'
  return '/bin/bash'
}

function loginShellArgs(shellName: WorkbenchSessionShell): string[] {
  return shellName === 'bash' || shellName === 'zsh' ? ['-l'] : []
}

function sessionEnv(): NodeJS.ProcessEnv {
  const base = sanitizedShellEnv()
  return { ...base, TERM: base.TERM || 'xterm-256color' }
}

type SessionEntry = {
  pty: PtyProcess
  mappingId: string
  root: string
  post: PostFn
  attempt: number
  leaseToken: string
  cols: number
  rows: number
  seq: number
  lastActivityAtMs: number
  killRequested: boolean
}

const sessions = new Map<string, SessionEntry>()

function requireSession(sessionId: string): SessionEntry {
  if (!IDENTIFIER.test(sessionId)) throw new Error('invalid workbench session id')
  const entry = sessions.get(sessionId)
  if (!entry) throw new Error('workbench session not found')
  return entry
}

/** Exposed for tests; not part of the runtime's public control surface. */
export function activeWorkbenchSessionIds(): string[] {
  return [...sessions.keys()]
}

/** Test-only hook: force-clears the in-memory session table between test cases. */
export function __resetWorkbenchSessionsForTests(): void {
  sessions.clear()
}

/**
 * Spawns a jailed login shell for a claimed `kind: 'create'` session and wires
 * its stdout/stderr to the device progress endpoint, posting a completion
 * once the shell process exits (naturally, killed, or reaped by the idle
 * watchdog). Outcome/exitCode/error match `CompleteWorkbenchSessionInput` in
 * lib/messages/workbench/session-store.ts.
 */
export async function handleSessionCreate(
  claim: WorkbenchSessionClaim,
  registry: MappingRegistry,
  post: PostFn,
): Promise<{ sessionId: string; pid: number }> {
  assertValidSessionClaim(claim)
  if (claim.kind !== 'create') throw new Error('workbench session claim kind mismatch')
  if (sessions.has(claim.sessionId)) throw new Error('workbench session already active')

  const root = mappedRoot({ mappingId: claim.mappingId, relativeFolder: claim.relativeFolder }, registry)
  const relativeCwd = normalizeRelativePath(claim.cwd, true)
  const cwd = resolveExisting(root, relativeCwd)
  if (!fs.statSync(cwd).isDirectory()) throw new Error('workbench session cwd must be a directory')

  const nodePty = loadNodePty()
  const shellPath = resolveShellPath(claim.shell)
  let pty: PtyProcess
  try {
    pty = nodePty.spawn(shellPath, loginShellArgs(claim.shell), {
      name: 'xterm-256color',
      cols: claim.cols,
      rows: claim.rows,
      cwd,
      env: sessionEnv(),
    })
  } catch (spawnError) {
    throw new Error(`workbench session failed to start: ${spawnError instanceof Error ? spawnError.message : 'unknown error'}`)
  }

  const entry: SessionEntry = {
    pty,
    mappingId: claim.mappingId,
    root,
    post,
    attempt: claim.attempt,
    leaseToken: claim.leaseToken,
    cols: claim.cols,
    rows: claim.rows,
    seq: 0,
    lastActivityAtMs: Date.now(),
    killRequested: false,
  }
  sessions.set(claim.sessionId, entry)

  pty.onData((data) => {
    entry.lastActivityAtMs = Date.now()
    entry.seq += 1
    post(`/workbench/sessions/${claim.sessionId}/progress`, {
      attempt: entry.attempt,
      leaseToken: entry.leaseToken,
      chunk: { seq: entry.seq, stream: 'stdout', text: data, atMs: Date.now() },
    }).catch(() => undefined)
  })

  pty.onExit(({ exitCode, signal }) => {
    sessions.delete(claim.sessionId)
    const safeExitCode = Number.isSafeInteger(exitCode) ? Number(exitCode) : undefined
    const outcome: 'exited' | 'killed' | 'failed' = entry.killRequested
      ? 'killed'
      : safeExitCode !== undefined
        ? 'exited'
        : 'failed'
    post(`/workbench/sessions/${claim.sessionId}/complete`, {
      attempt: entry.attempt,
      leaseToken: entry.leaseToken,
      outcome,
      ...(safeExitCode !== undefined ? { exitCode: safeExitCode } : {}),
      ...(outcome === 'failed' ? { error: signal ? `workbench session pty terminated by signal ${signal}` : 'workbench session pty exited abnormally' } : {}),
    }).catch(() => undefined)
  })

  return { sessionId: claim.sessionId, pid: pty.pid }
}

/** Writes to a session's pty stdin; 'line' mode appends a newline if the caller omitted one. */
export function handleSessionStdin(sessionId: string, data: string, mode: WorkbenchSessionStdinMode = 'raw'): void {
  const entry = requireSession(sessionId)
  if (typeof data !== 'string') throw new Error('workbench session stdin data must be a string')
  if (Buffer.byteLength(data, 'utf8') > MAX_STDIN_BYTES) throw new Error('workbench session stdin exceeds size limit')
  entry.lastActivityAtMs = Date.now()
  entry.pty.write(mode === 'line' && !data.endsWith('\n') ? `${data}\n` : data)
}

/** Resizes a session's pty; out-of-range values are clamped to the session's current size instead of throwing. */
export function handleSessionResize(sessionId: string, cols: number, rows: number): void {
  const entry = requireSession(sessionId)
  const boundedCols = isSafeDimension(cols) ? cols : entry.cols
  const boundedRows = isSafeDimension(rows) ? rows : entry.rows
  entry.pty.resize(boundedCols, boundedRows)
  entry.cols = boundedCols
  entry.rows = boundedRows
  entry.lastActivityAtMs = Date.now()
}

/** Kills a session's pty. The completion post happens from the pty's own exit handler. */
export function handleSessionKill(sessionId: string): void {
  if (!IDENTIFIER.test(sessionId)) throw new Error('invalid workbench session id')
  const entry = sessions.get(sessionId)
  if (!entry) return
  entry.killRequested = true
  try {
    entry.pty.kill()
  } catch {
    // Process already exited; onExit (if it still fires) will report completion.
  }
}

/**
 * Kills any session whose pty has been idle (no data/stdin/resize activity)
 * for at least `idleTtlMs` (default 10 minutes). Intended to be called
 * periodically from the sessions poll loop rather than via a background
 * timer, so it stays simple to test and never keeps the process alive on its
 * own.
 */
export function sweepIdleWorkbenchSessions(now: number = Date.now(), idleTtlMs: number = DEFAULT_IDLE_TTL_MS): void {
  for (const entry of sessions.values()) {
    if (entry.killRequested) continue
    if (now - entry.lastActivityAtMs < idleTtlMs) continue
    entry.killRequested = true
    try {
      entry.pty.kill()
    } catch {
      // Already exited.
    }
  }
}

/** Dispatches a claimed session operation ('create' vs a queued 'control') to the right handler. */
export async function runWorkbenchSessionClaim(
  claim: WorkbenchSessionClaim,
  registry: MappingRegistry,
  post: PostFn,
): Promise<unknown> {
  assertValidSessionClaim(claim)
  if (claim.kind === 'create') return handleSessionCreate(claim, registry, post)
  switch (claim.control.kind) {
    case 'stdin':
      return handleSessionStdin(claim.sessionId, claim.control.data, claim.control.mode)
    case 'resize':
      return handleSessionResize(claim.sessionId, claim.control.cols, claim.control.rows)
    case 'kill':
      return handleSessionKill(claim.sessionId)
    default:
      throw new Error('unsupported workbench session control')
  }
}

export function linkedRuntimeWorkbenchSessionsClaimBody() {
  return { runtimeVersion: process.env.PIB_RUNTIME_VERSION || '1.1.10', workbenchSessionsProtocolVersion: 1 as const }
}

/** Same idle-backoff shape as pollWorkbenchForever/pollAgentHostForever; sweeps idle sessions each cycle. */
export async function pollWorkbenchSessionsForever(
  claim: () => Promise<WorkbenchSessionClaim | null>,
  run: (claim: WorkbenchSessionClaim) => Promise<unknown>,
  stop: () => boolean = () => false,
  wait: (milliseconds: number) => Promise<unknown> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<void> {
  let delay = 250
  while (!stop()) {
    sweepIdleWorkbenchSessions()
    const claimed = await claim().catch(() => null)
    if (claimed) {
      delay = 250
      await run(claimed).catch(() => undefined)
    } else {
      await wait(workbenchPollDelay(delay))
      delay = Math.min(delay * 2, SESSIONS_MAX_POLL_DELAY_MS)
    }
  }
}
