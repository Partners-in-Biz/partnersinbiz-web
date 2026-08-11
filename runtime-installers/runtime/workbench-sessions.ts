import { spawn as spawnChild, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
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
    /** Absolute host path for company-root sessions (mirrors workbench jobs). */
    workingDirectory?: string
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
// Keep in lockstep with workbench idle claim cap (nonce write cost).
const SESSIONS_MAX_POLL_DELAY_MS = 5_000

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

const NODE_PTY_MISSING_MESSAGE = 'interactive workbench sessions require Node.js + node-pty beside the runtime. Install Node 20+, then in the runtime install directory run `npm install node-pty`, ensure `pty-host.cjs` is present next to pib-runtime, and restart the runtime.'

type NodePtyModule = {
  spawn: (
    file: string,
    args: string[],
    options: { name?: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv },
  ) => PtyProcess
}

/** Test-only override for the PTY factory (used by unit tests). */
let testPtyFactory: NodePtyModule['spawn'] | null = null

function resolveNodeBinary(): string {
  const fromEnv = process.env.PIB_NODE_BIN?.trim()
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv
  for (const candidate of [
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node',
  ]) {
    if (fs.existsSync(candidate)) return candidate
  }
  return 'node'
}

function resolvePtyHostScript(): string {
  const fromEnv = process.env.PIB_PTY_HOST?.trim()
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv
  const candidates = [
    path.join(path.dirname(process.execPath), 'pty-host.cjs'),
    path.join(path.dirname(process.execPath), 'runtime', 'pty-host.cjs'),
    // Dev/source layout: .../runtime-installers/runtime/pty-host.cjs
    path.join(__dirname, 'pty-host.cjs'),
    path.join(process.cwd(), 'pty-host.cjs'),
    path.join(process.cwd(), 'runtime-installers', 'runtime', 'pty-host.cjs'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  throw new Error(NODE_PTY_MISSING_MESSAGE)
}

function nodePtyModulePresentBeside(scriptPath: string): boolean {
  const roots = [path.dirname(scriptPath), path.dirname(process.execPath), process.cwd()]
  return roots.some((root) => fs.existsSync(path.join(root, 'node_modules', 'node-pty')))
}

/**
 * Spawns an interactive PTY via the Node.js sidecar (`pty-host.cjs`).
 *
 * Bun-compiled `pib-runtime` cannot load node-pty's native addon (posix_spawnp
 * fails). The host script runs under system Node and owns the real PTY; we
 * bridge JSON-line control over stdio into the PtyProcess interface the rest
 * of this module already uses.
 */
function spawnPtyViaNodeHost(
  file: string,
  args: string[],
  options: { name?: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv },
): PtyProcess {
  if (testPtyFactory) return testPtyFactory(file, args, options)

  const hostScript = resolvePtyHostScript()
  if (!nodePtyModulePresentBeside(hostScript) && !nodePtyModulePresentBeside(path.dirname(process.execPath))) {
    throw new Error(NODE_PTY_MISSING_MESSAGE)
  }
  const nodeBin = resolveNodeBinary()
  const child: ChildProcessWithoutNullStreams = spawnChild(nodeBin, [hostScript], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // Ensure the host resolves node-pty from the runtime install dir.
      NODE_PATH: [
        path.join(path.dirname(process.execPath), 'node_modules'),
        path.join(path.dirname(hostScript), 'node_modules'),
        process.env.NODE_PATH || '',
      ].filter(Boolean).join(path.delimiter),
    },
  })

  const dataListeners: Array<(data: string) => void> = []
  const exitListeners: Array<(event: { exitCode: number; signal?: number }) => void> = []
  let pid = child.pid ?? 0
  let started = false
  let exited = false
  let startError: Error | null = null
  let resolveStart: (() => void) | null = null
  let rejectStart: ((error: Error) => void) | null = null
  const startGate = new Promise<void>((resolve, reject) => {
    resolveStart = resolve
    rejectStart = reject
  })

  const send = (message: Record<string, unknown>) => {
    if (!child.stdin.writable) return
    child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
  rl.on('line', (line) => {
    if (!line.trim()) return
    let message: Record<string, unknown>
    try {
      message = JSON.parse(line) as Record<string, unknown>
    } catch {
      return
    }
    switch (message.type) {
      case 'ready':
        pid = typeof message.pid === 'number' ? message.pid : pid
        started = true
        resolveStart?.()
        break
      case 'data':
        if (typeof message.data === 'string') {
          for (const listener of dataListeners) listener(message.data)
        }
        break
      case 'exit': {
        if (exited) break
        exited = true
        const exitCode = typeof message.exitCode === 'number' ? message.exitCode : 1
        const signal = typeof message.signal === 'number' ? message.signal : undefined
        for (const listener of exitListeners) listener({ exitCode, ...(signal !== undefined ? { signal } : {}) })
        break
      }
      case 'error': {
        const err = new Error(typeof message.message === 'string' ? message.message : 'pty host error')
        if (!started) {
          startError = err
          rejectStart?.(err)
        }
        break
      }
      default:
        break
    }
  })

  child.stderr.on('data', () => {
    // Host stderr is diagnostic only; surface via start error if start never completes.
  })
  child.on('error', (error) => {
    if (!started) {
      startError = error instanceof Error ? error : new Error(String(error))
      rejectStart?.(startError)
    }
  })
  child.on('exit', (code, signal) => {
    if (exited) return
    if (!started) {
      const err = startError ?? new Error(NODE_PTY_MISSING_MESSAGE)
      rejectStart?.(err)
      return
    }
    exited = true
    const exitCode = typeof code === 'number' ? code : 1
    const signalNumber = signal ? Number(signal) : undefined
    for (const listener of exitListeners) {
      listener({ exitCode, ...(signalNumber !== undefined && Number.isFinite(signalNumber) ? { signal: signalNumber } : {}) })
    }
  })

  send({
    type: 'start',
    file,
    args,
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd,
    env: options.env,
  })

  const readyWithTimeout = Promise.race([
    startGate,
    new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('pty host did not become ready within 8s')), 8_000)
    }),
  ])

  // The create handler is async and awaits `ready` before wiring progress posts.
  const processHandle: PtyProcess & { ready: Promise<void> } = {
    get pid() { return pid },
    ready: readyWithTimeout,
    onData(callback) { dataListeners.push(callback) },
    onExit(callback) { exitListeners.push(callback) },
    write(data) { send({ type: 'write', data }) },
    resize(cols, rows) { send({ type: 'resize', cols, rows }) },
    kill() { send({ type: 'kill' }); try { child.kill() } catch { /* ignore */ } },
  }
  return processHandle
}

export function isNodePtyAvailable(): boolean {
  try {
    resolvePtyHostScript()
    return nodePtyModulePresentBeside(path.dirname(process.execPath)) || nodePtyModulePresentBeside(process.cwd())
  } catch {
    return false
  }
}

/** Test-only hook to force the PTY factory without touching node_modules / the host. */
export function __setNodePtyForTests(module: NodePtyModule | null | undefined): void {
  testPtyFactory = module?.spawn ?? null
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

  const root = mappedRoot({
    mappingId: claim.mappingId,
    relativeFolder: claim.relativeFolder,
    ...(claim.workingDirectory ? { workingDirectory: claim.workingDirectory } : {}),
  }, registry)
  const relativeCwd = normalizeRelativePath(claim.cwd, true)
  const cwd = resolveExisting(root, relativeCwd)
  if (!fs.statSync(cwd).isDirectory()) throw new Error('workbench session cwd must be a directory')

  const shellPath = resolveShellPath(claim.shell)
  let pty: PtyProcess
  try {
    pty = spawnPtyViaNodeHost(shellPath, loginShellArgs(claim.shell), {
      name: 'xterm-256color',
      cols: claim.cols,
      rows: claim.rows,
      cwd,
      env: sessionEnv(),
    })
    // Wait for the Node host to confirm the PTY is up (or fail with a clear error).
    const ready = (pty as PtyProcess & { ready?: Promise<void> }).ready
    if (ready) await ready
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
  if (claim.kind === 'create') {
    try {
      return await handleSessionCreate(claim, registry, post)
    } catch (error) {
      // Without this, create failures (e.g. missing node-pty) leave the session
      // stuck in `claimed`/`queued` forever because the poller swallows errors.
      const message = error instanceof Error ? error.message : 'workbench session failed to start'
      await post(`/workbench/sessions/${claim.sessionId}/complete`, {
        attempt: claim.attempt,
        leaseToken: claim.leaseToken,
        outcome: 'failed',
        error: message,
      }).catch(() => undefined)
      throw error
    }
  }
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
  return { runtimeVersion: process.env.PIB_RUNTIME_VERSION || '1.1.27', workbenchSessionsProtocolVersion: 1 as const }
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
