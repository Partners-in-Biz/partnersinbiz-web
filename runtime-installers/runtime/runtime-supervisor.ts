import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

/**
 * The service has several independent pollers in one runtime process. A
 * process can therefore stay alive while an event-loop spin or stalled native
 * call prevents the heartbeat poller from running. Service managers only see
 * process exit, so they cannot recover that state by themselves.
 */
export const RUNTIME_HEARTBEAT_STALE_AFTER_MS = 120_000
export const RUNTIME_HEARTBEAT_STARTUP_GRACE_MS = 90_000
export const RUNTIME_SUPERVISOR_CHECK_INTERVAL_MS = 5_000
export const RUNTIME_SUPERVISOR_TERMINATE_GRACE_MS = 15_000

export type RuntimeServiceChild = {
  exitCode?: number | null
  kill(signal?: NodeJS.Signals | number): boolean
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
}

export type RuntimeServiceSpawner = (
  executable: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; stdio: 'inherit'; windowsHide: boolean },
) => RuntimeServiceChild

type Wait = (ms: number) => Promise<void>

export function runtimeHeartbeatLivenessFile(stateRoot: string): string {
  return path.join(stateRoot, 'runtime-heartbeat.liveness')
}

/** Write only local, non-secret progress evidence for the parent watchdog. */
export function touchRuntimeHeartbeatLiveness(filePath: string, nowMs = Date.now()) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
  fs.writeFileSync(filePath, `${nowMs}\n`, { encoding: 'utf8', mode: 0o600 })
}

export function runtimeHeartbeatLivenessMs(filePath: string): number {
  try { return fs.statSync(filePath).mtimeMs } catch { return 0 }
}

export function runtimeHeartbeatIsStale(input: {
  childStartedAtMs: number
  lastHeartbeatAttemptAtMs: number
  nowMs: number
  staleAfterMs?: number
  startupGraceMs?: number
}): boolean {
  const staleAfterMs = input.staleAfterMs ?? RUNTIME_HEARTBEAT_STALE_AFTER_MS
  const startupGraceMs = input.startupGraceMs ?? RUNTIME_HEARTBEAT_STARTUP_GRACE_MS
  if (input.lastHeartbeatAttemptAtMs > 0) {
    return input.nowMs - input.lastHeartbeatAttemptAtMs > staleAfterMs
  }
  return input.nowMs - input.childStartedAtMs > startupGraceMs
}

function defaultWait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function childExit(child: RuntimeServiceChild): Promise<void> {
  if (child.exitCode !== null && child.exitCode !== undefined) return Promise.resolve()
  return new Promise((resolve) => {
    child.once('exit', () => resolve())
  })
}

async function stopChild(
  child: RuntimeServiceChild,
  exited: Promise<void>,
  wait: Wait,
  terminateGraceMs: number,
) {
  if (child.exitCode !== null && child.exitCode !== undefined) return
  try { child.kill('SIGTERM') } catch { /* The worker may have exited between checks. */ }
  const stopped = await Promise.race([
    exited.then(() => true),
    wait(terminateGraceMs).then(() => false),
  ])
  if (stopped) return
  try { child.kill('SIGKILL') } catch { /* Windows maps unsupported signals to termination where possible. */ }
  await Promise.race([
    exited,
    wait(5_000),
  ])
}

export async function superviseRuntimeService(input: {
  stateRoot: string
  executable: string
  env?: NodeJS.ProcessEnv
  stop: () => boolean
  livenessFile?: string
  spawnService?: RuntimeServiceSpawner
  wait?: Wait
  nowMs?: () => number
  readLivenessMs?: (filePath: string) => number
  removeLiveness?: (filePath: string) => void
  log?: (message: string) => void
  staleAfterMs?: number
  startupGraceMs?: number
  checkIntervalMs?: number
  terminateGraceMs?: number
  restartDelayMs?: number
}): Promise<void> {
  const livenessFile = input.livenessFile ?? runtimeHeartbeatLivenessFile(input.stateRoot)
  const spawnService = input.spawnService ?? ((executable, args, options) => spawn(executable, args, options))
  const wait = input.wait ?? defaultWait
  const nowMs = input.nowMs ?? Date.now
  const readLivenessMs = input.readLivenessMs ?? runtimeHeartbeatLivenessMs
  const removeLiveness = input.removeLiveness ?? ((filePath: string) => fs.rmSync(filePath, { force: true }))
  const log = input.log ?? ((message: string) => process.stderr.write(`[pib-runtime] ${message}\n`))
  const checkIntervalMs = input.checkIntervalMs ?? RUNTIME_SUPERVISOR_CHECK_INTERVAL_MS
  const terminateGraceMs = input.terminateGraceMs ?? RUNTIME_SUPERVISOR_TERMINATE_GRACE_MS
  let restartDelayMs = input.restartDelayMs ?? 1_000

  while (!input.stop()) {
    let child: RuntimeServiceChild
    try {
      removeLiveness(livenessFile)
      child = spawnService(input.executable, ['service'], {
        env: { ...(input.env ?? process.env), PIB_RUNTIME_LIVENESS_FILE: livenessFile },
        stdio: 'inherit',
        windowsHide: true,
      })
    } catch (error) {
      log(`runtime worker could not start (${error instanceof Error ? error.name : 'unknown error'}); retrying`)
      await wait(restartDelayMs)
      restartDelayMs = Math.min(restartDelayMs * 2, 30_000)
      continue
    }

    const startedAtMs = nowMs()
    const exited = childExit(child)
    let sawHeartbeat = false
    let stale = false
    while (!input.stop()) {
      const outcome = await Promise.race([
        exited.then(() => 'exited' as const),
        wait(checkIntervalMs).then(() => 'check' as const),
      ])
      if (outcome === 'exited') break
      const heartbeatAtMs = readLivenessMs(livenessFile)
      if (heartbeatAtMs > 0) sawHeartbeat = true
      if (runtimeHeartbeatIsStale({
        childStartedAtMs: startedAtMs,
        lastHeartbeatAttemptAtMs: heartbeatAtMs,
        nowMs: nowMs(),
        staleAfterMs: input.staleAfterMs,
        startupGraceMs: input.startupGraceMs,
      })) {
        stale = true
        log('heartbeat liveness is stale; restarting only the linked runtime worker')
        await stopChild(child, exited, wait, terminateGraceMs)
        break
      }
    }

    if (input.stop()) {
      await stopChild(child, exited, wait, terminateGraceMs)
      return
    }
    if (!stale) log('runtime worker exited; restarting')
    await wait(sawHeartbeat ? 1_000 : restartDelayMs)
    restartDelayMs = sawHeartbeat ? 1_000 : Math.min(restartDelayMs * 2, 30_000)
  }
}
