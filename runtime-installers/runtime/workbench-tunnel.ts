import net from 'node:net'
import { spawn } from 'node:child_process'
import { MappingRegistry } from './bridge'
import { sanitizedShellEnv, workbenchPollDelay } from './workbench'

// -----------------------------------------------------------------------------
// Claim/control types
//
// Reconciled against the server contract in lib/messages/workbench/
// tunnel-sessions.ts + tunnel-session-store.ts: `WorkbenchTunnelClaim`'s
// `kind: 'create'` variant flattens the server-resolved port/bindHost/
// provider directly on the claim; `kind: 'control'` delivers the queued
// `kill` control for a tunnel this device already owns. The runtime cannot
// `import` those types directly — runtime-installers/runtime/tsconfig.json
// sets rootDir "." and only includes this directory's own *.ts files, the
// same reason ALLOWLISTED_ARGV is hand-mirrored in ./workbench.ts — so the
// shapes below are a by-hand mirror. Keep them identical to
// lib/messages/workbench/tunnel-sessions.ts and tunnel-session-store.ts's
// WorkbenchTunnelClaim/WorkbenchTunnelControl.
// -----------------------------------------------------------------------------

export type WorkbenchTunnelProvider = 'cloudflared'

export type WorkbenchTunnelControl = { kind: 'kill' }

export type WorkbenchTunnelClaim =
  | {
    kind: 'create'
    sessionId: string
    port: number
    bindHost: '127.0.0.1'
    provider: WorkbenchTunnelProvider
    workspaceId: string
    mappingId: string
    relativeFolder: string
    attempt: number
    leaseToken: string
  }
  | {
    kind: 'control'
    sessionId: string
    control: WorkbenchTunnelControl
    attempt: number
    leaseToken: string
  }

export type PostFn = (path: string, body: Record<string, unknown>) => Promise<Response>

const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/
const LEASE_TOKEN = /^[A-Za-z0-9_-]{16,128}$/
const PROVIDERS: readonly WorkbenchTunnelProvider[] = ['cloudflared']
// Matches lib/messages/workbench/tunnel-sessions.ts: MIN/MAX_TUNNEL_PORT.
const MIN_TUNNEL_PORT = 1024
const MAX_TUNNEL_PORT = 65535
// Sends a heartbeat status chunk well before the server's 90s lease
// (lib/messages/workbench/tunnel-sessions.ts: WORKBENCH_TUNNEL_LEASE_MS)
// would otherwise expire during long silent stretches once the tunnel is
// already up and just forwarding traffic.
const HEARTBEAT_INTERVAL_MS = 30_000
// Matches lib/messages/workbench/tunnel-sessions.ts: WORKBENCH_TUNNEL_TTL_MS. Local
// defense-in-depth so a tunnel process is never left running indefinitely even if
// this device somehow never hears back from the server about the session's fate.
const TUNNEL_TTL_MS = 30 * 60 * 1000
// Keep in lockstep with workbench idle claim cap (nonce write cost).
const TUNNEL_MAX_POLL_DELAY_MS = 5_000
const CLOUDFLARE_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i
const TCP_PROBE_TIMEOUT_MS = 1_000

function isSafePort(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= MIN_TUNNEL_PORT && Number(value) <= MAX_TUNNEL_PORT
}

function assertValidControl(control: unknown): WorkbenchTunnelControl {
  if (!control || typeof control !== 'object' || (control as { kind?: unknown }).kind !== 'kill') {
    throw new Error('invalid workbench tunnel control')
  }
  return { kind: 'kill' }
}

function assertValidTunnelClaim(claim: WorkbenchTunnelClaim): void {
  if (
    !claim || typeof claim !== 'object'
    || !IDENTIFIER.test(claim.sessionId)
    || !Number.isSafeInteger(claim.attempt) || claim.attempt < 1
    || typeof claim.leaseToken !== 'string' || !LEASE_TOKEN.test(claim.leaseToken)
  ) {
    throw new Error('invalid workbench tunnel claim')
  }
  if (claim.kind === 'create') {
    if (
      !isSafePort(claim.port)
      || claim.bindHost !== '127.0.0.1'
      || !PROVIDERS.includes(claim.provider)
      || !IDENTIFIER.test(claim.mappingId)
      || typeof claim.relativeFolder !== 'string'
      || typeof claim.workspaceId !== 'string' || claim.workspaceId.length === 0
    ) {
      throw new Error('invalid workbench tunnel claim')
    }
    return
  }
  if (claim.kind === 'control') {
    assertValidControl(claim.control)
    return
  }
  throw new Error('invalid workbench tunnel claim')
}

/**
 * Best-effort check that something is already listening on the requested
 * localhost port before spawning the tunnel process. Purely informational —
 * a false negative (e.g. the target starts a moment later) must never block
 * the tunnel from being created, since cloudflared itself will simply retry
 * connecting once traffic arrives.
 */
export function probeLocalPortListening(port: number, host = '127.0.0.1', timeoutMs = TCP_PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: timeoutMs })
    const settle = (result: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(result)
    }
    socket.once('connect', () => settle(true))
    socket.once('timeout', () => settle(false))
    socket.once('error', () => settle(false))
  })
}

export type CloudflaredChildProcess = {
  pid?: number
  stdout: { on: (event: 'data', listener: (chunk: Buffer | string) => void) => void } | null
  stderr: { on: (event: 'data', listener: (chunk: Buffer | string) => void) => void } | null
  once: (event: 'error' | 'exit', listener: (...args: unknown[]) => void) => void
  kill: (signal?: string) => void
}

export type SpawnCloudflared = (port: number) => CloudflaredChildProcess

/** Default spawner: `cloudflared tunnel --url http://127.0.0.1:$PORT --no-autoupdate`. */
function defaultSpawnCloudflared(port: number): CloudflaredChildProcess {
  return spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'], {
    env: sanitizedShellEnv(),
    windowsHide: true,
  }) as unknown as CloudflaredChildProcess
}

let spawnCloudflared: SpawnCloudflared = defaultSpawnCloudflared

/** Test-only hook to replace the cloudflared spawner without touching the real binary. */
export function __setSpawnCloudflaredForTests(fn: SpawnCloudflared | undefined): void {
  spawnCloudflared = fn ?? defaultSpawnCloudflared
}

const CLOUDFLARED_MISSING_MESSAGE = 'outbound tunnels require the "cloudflared" binary, which was not found on this computer. Install it (e.g. `brew install cloudflared` on macOS, or see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) and retry.'

type TunnelEntry = {
  child: CloudflaredChildProcess
  post: PostFn
  attempt: number
  leaseToken: string
  seq: number
  buffer: string
  publicUrlPosted: boolean
  killRequested: boolean
  startedAtMs: number
  heartbeatTimer: ReturnType<typeof setInterval> | null
}

const tunnels = new Map<string, TunnelEntry>()

/** Exposed for tests; not part of the runtime's public control surface. */
export function activeWorkbenchTunnelIds(): string[] {
  return [...tunnels.keys()]
}

/** Test-only hook: force-clears the in-memory tunnel table between test cases. */
export function __resetWorkbenchTunnelsForTests(): void {
  for (const entry of tunnels.values()) {
    if (entry.heartbeatTimer) clearInterval(entry.heartbeatTimer)
  }
  tunnels.clear()
}

function postProgress(sessionId: string, entry: TunnelEntry, chunk: Record<string, unknown>): void {
  entry.seq += 1
  entry.post(`/workbench/tunnel/sessions/${sessionId}/progress`, {
    attempt: entry.attempt,
    leaseToken: entry.leaseToken,
    chunk: { seq: entry.seq, atMs: Date.now(), ...chunk },
  }).catch(() => undefined)
}

function postCompletion(sessionId: string, entry: TunnelEntry, outcome: 'exited' | 'killed' | 'failed', extra: Record<string, unknown> = {}): void {
  entry.post(`/workbench/tunnel/sessions/${sessionId}/complete`, {
    attempt: entry.attempt,
    leaseToken: entry.leaseToken,
    outcome,
    ...extra,
  }).catch(() => undefined)
}

function teardown(sessionId: string, entry: TunnelEntry): void {
  if (entry.heartbeatTimer) clearInterval(entry.heartbeatTimer)
  tunnels.delete(sessionId)
}

/**
 * Scans the accumulated stdout/stderr text for a resolved
 * `https://*.trycloudflare.com` URL, posting it (once) as a `tunnel`
 * progress chunk the moment it appears. cloudflared may split a single log
 * line across multiple data events, so this scans a rolling buffer (capped
 * to avoid unbounded growth) rather than each chunk in isolation.
 */
function scanForPublicUrl(sessionId: string, entry: TunnelEntry, port: number): void {
  if (entry.publicUrlPosted) return
  const match = entry.buffer.match(CLOUDFLARE_URL_PATTERN)
  if (!match) return
  entry.publicUrlPosted = true
  postProgress(sessionId, entry, {
    stream: 'tunnel', publicUrl: match[0], localUrl: `http://127.0.0.1:${port}`, provider: 'cloudflared',
  })
}

const MAX_BUFFER_CHARS = 8_000

/**
 * Spawns a cloudflared quick tunnel for a claimed `kind: 'create'` tunnel
 * and wires its stdout/stderr to the device progress endpoint, posting a
 * completion once the process exits (naturally, killed, or reaped by the
 * TTL sweep). Outcome/exitCode/error match `CompleteWorkbenchTunnelInput` in
 * lib/messages/workbench/tunnel-session-store.ts.
 */
export async function handleTunnelCreate(
  claim: WorkbenchTunnelClaim,
  _registry: MappingRegistry,
  post: PostFn,
): Promise<{ sessionId: string; pid?: number }> {
  assertValidTunnelClaim(claim)
  if (claim.kind !== 'create') throw new Error('workbench tunnel claim kind mismatch')
  if (tunnels.has(claim.sessionId)) throw new Error('workbench tunnel already active')

  const listening = await probeLocalPortListening(claim.port).catch(() => false)

  let child: CloudflaredChildProcess
  try {
    child = spawnCloudflared(claim.port)
  } catch (spawnError) {
    const message = spawnError instanceof Error && /ENOENT/.test(spawnError.message)
      ? CLOUDFLARED_MISSING_MESSAGE
      : `workbench tunnel failed to start: ${spawnError instanceof Error ? spawnError.message : 'unknown error'}`
    throw new Error(message)
  }

  const entry: TunnelEntry = {
    child,
    post,
    attempt: claim.attempt,
    leaseToken: claim.leaseToken,
    seq: 0,
    buffer: '',
    publicUrlPosted: false,
    killRequested: false,
    startedAtMs: Date.now(),
    heartbeatTimer: null,
  }
  tunnels.set(claim.sessionId, entry)

  if (!listening) {
    postProgress(claim.sessionId, entry, {
      stream: 'status', text: `Waiting for something to listen on 127.0.0.1:${claim.port}…`,
    })
  }

  entry.heartbeatTimer = setInterval(() => {
    postProgress(claim.sessionId, entry, { stream: 'status', text: 'tunnel active' })
  }, HEARTBEAT_INTERVAL_MS)

  // cloudflared logs almost everything (including its resolved quick-tunnel
  // URL) to stderr, not stdout — both streams are scanned for the URL, but
  // raw passthrough is tagged 'status' (stdout) vs 'stderr' (stderr) so the
  // UI can tell provider chatter apart from the one structured 'tunnel'
  // chunk that carries the actual publicUrl/localUrl.
  const onOutput = (rawStream: 'status' | 'stderr') => (chunk: Buffer | string) => {
    const text = chunk.toString()
    entry.buffer = (entry.buffer + text).slice(-MAX_BUFFER_CHARS)
    postProgress(claim.sessionId, entry, { stream: rawStream, text })
    scanForPublicUrl(claim.sessionId, entry, claim.port)
  }
  child.stdout?.on('data', onOutput('status'))
  child.stderr?.on('data', onOutput('stderr'))

  child.once('error', (spawnError) => {
    teardown(claim.sessionId, entry)
    const message = spawnError instanceof Error && /ENOENT/.test(spawnError.message)
      ? CLOUDFLARED_MISSING_MESSAGE
      : spawnError instanceof Error ? spawnError.message : 'workbench tunnel process error'
    postCompletion(claim.sessionId, entry, 'failed', { error: message })
  })

  child.once('exit', (...args: unknown[]) => {
    teardown(claim.sessionId, entry)
    const [code, signal] = args as [number | null, string | null]
    const outcome: 'exited' | 'killed' | 'failed' = entry.killRequested
      ? 'killed'
      : Number.isSafeInteger(code)
        ? 'exited'
        : 'failed'
    const safeExitCode = Number.isSafeInteger(code) ? Number(code) : undefined
    postCompletion(claim.sessionId, entry, outcome, {
      ...(safeExitCode !== undefined ? { exitCode: safeExitCode } : {}),
      ...(outcome === 'failed' ? { error: signal ? `workbench tunnel process terminated by signal ${signal}` : 'workbench tunnel process exited abnormally' } : {}),
    })
  })

  return { sessionId: claim.sessionId, ...(typeof child.pid === 'number' ? { pid: child.pid } : {}) }
}

/** Kills a tunnel's cloudflared process. The completion post happens from the process's own exit handler. */
export function handleTunnelKill(sessionId: string): void {
  if (!IDENTIFIER.test(sessionId)) throw new Error('invalid workbench tunnel session id')
  const entry = tunnels.get(sessionId)
  if (!entry) return
  entry.killRequested = true
  try {
    entry.child.kill('SIGTERM')
  } catch {
    // Process already exited; its own exit handler (if it still fires) reports completion.
  }
}

/**
 * Force-kills any tunnel whose process has run past `ttlMs` (default 30
 * minutes), mirroring the server's absolute TTL in
 * lib/messages/workbench/tunnel-sessions.ts. Intended to be called
 * periodically from the tunnels poll loop, same shape as
 * `sweepIdleWorkbenchSessions`.
 */
export function sweepExpiredWorkbenchTunnels(now: number = Date.now(), ttlMs: number = TUNNEL_TTL_MS): void {
  for (const [sessionId, entry] of tunnels.entries()) {
    if (entry.killRequested) continue
    if (now - entry.startedAtMs < ttlMs) continue
    handleTunnelKill(sessionId)
  }
}

/** Dispatches a claimed tunnel operation ('create' vs the queued 'kill' control) to the right handler. */
export async function runWorkbenchTunnelClaim(
  claim: WorkbenchTunnelClaim,
  registry: MappingRegistry,
  post: PostFn,
): Promise<unknown> {
  assertValidTunnelClaim(claim)
  if (claim.kind === 'create') return handleTunnelCreate(claim, registry, post)
  handleTunnelKill(claim.sessionId)
  return undefined
}

export function linkedRuntimeWorkbenchTunnelsClaimBody() {
  return { runtimeVersion: process.env.PIB_RUNTIME_VERSION || '1.1.27', workbenchTunnelsProtocolVersion: 1 as const }
}

/** Same idle-backoff shape as pollWorkbenchSessionsForever; sweeps TTL-expired tunnels each cycle. */
export async function pollWorkbenchTunnelsForever(
  claim: () => Promise<WorkbenchTunnelClaim | null>,
  run: (claim: WorkbenchTunnelClaim) => Promise<unknown>,
  stop: () => boolean = () => false,
  wait: (milliseconds: number) => Promise<unknown> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<void> {
  let delay = 250
  while (!stop()) {
    sweepExpiredWorkbenchTunnels()
    const claimed = await claim().catch(() => null)
    if (claimed) {
      delay = 250
      await run(claimed).catch(() => undefined)
    } else {
      await wait(workbenchPollDelay(delay))
      delay = Math.min(delay * 2, TUNNEL_MAX_POLL_DELAY_MS)
    }
  }
}
