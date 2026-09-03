import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

export type HermesLifecycleEnv = NodeJS.ProcessEnv

function hermesHome(env: HermesLifecycleEnv = process.env): string {
  return env.PIB_HERMES_HOME || env.HERMES_HOME || path.join(os.homedir(), '.hermes')
}

function stateRoot(env: HermesLifecycleEnv = process.env): string {
  return env.PIB_RUNTIME_STATE_DIR || path.join(os.homedir(), '.partnersinbiz')
}

export function resolveHermesBinary(env: HermesLifecycleEnv = process.env): string | null {
  const configured = env.PIB_HERMES_BIN?.trim()
  if (configured && fs.existsSync(configured)) return configured
  const candidates = [
    path.join(hermesHome(env), 'hermes-agent', 'venv', 'bin', 'hermes'),
    path.join(hermesHome(env), 'venv', 'bin', 'hermes'),
    '/usr/local/bin/hermes',
    path.join(os.homedir(), '.local', 'bin', 'hermes'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  try {
    const which = spawnSync('which', ['hermes'], { encoding: 'utf8' })
    const found = which.stdout.trim().split(/\n/)[0]
    if (found && fs.existsSync(found)) return found
  } catch {
    // ignore
  }
  return null
}

export function profileDirectory(agentId: string, env: HermesLifecycleEnv = process.env): string {
  return path.join(hermesHome(env), 'profiles', agentId)
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
}

function writeSecure(filePath: string, contents: string) {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, contents, { encoding: 'utf8', mode: 0o600 })
}

function readEnvValue(filePath: string, key: string): string | undefined {
  try {
    const line = fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .find((row) => row.startsWith(`${key}=`))
    if (!line) return undefined
    return line.slice(key.length + 1).trim() || undefined
  } catch {
    return undefined
  }
}

export function ensureHermesProfile(input: {
  agentId: string
  preferredPort: number | null
  env?: HermesLifecycleEnv
  createArgs?: string[]
  spawnSync?: typeof spawnSync
}): { created: boolean; port: number | null; apiKeyPresent: boolean; hermesBin: string | null } {
  const env = input.env ?? process.env
  const hermesBin = resolveHermesBinary(env)
  const dir = profileDirectory(input.agentId, env)
  const envFile = path.join(dir, '.env')
  let created = false
  const run = input.spawnSync ?? spawnSync

  if (!fs.existsSync(dir) && hermesBin) {
    const result = run(hermesBin, ['profile', 'create', input.agentId, ...(input.createArgs ?? [])], {
      encoding: 'utf8',
      env: { ...env, HERMES_HOME: hermesHome(env) },
    })
    if (result.status === 0) created = true
  }

  ensureDir(dir)
  if (!fs.existsSync(envFile)) {
    const sharedKey = readEnvValue(path.join(hermesHome(env), '.env'), 'API_SERVER_KEY')
      || crypto.randomBytes(32).toString('hex')
    const port = input.preferredPort && input.preferredPort > 0 ? input.preferredPort : null
    writeSecure(envFile, [
      'API_SERVER_ENABLED=true',
      'API_SERVER_HOST=127.0.0.1',
      ...(port ? [`API_SERVER_PORT=${port}`] : []),
      `API_SERVER_MODEL_NAME=${input.agentId}`,
      `API_SERVER_KEY=${sharedKey}`,
      '',
    ].join('\n'))
    created = true
  } else {
    if (!readEnvValue(envFile, 'API_SERVER_KEY')) {
      const key = crypto.randomBytes(32).toString('hex')
      const raw = fs.readFileSync(envFile, 'utf8')
      writeSecure(envFile, `${raw.replace(/\n*$/, '\n')}API_SERVER_KEY=${key}\n`)
    }
    if (input.preferredPort && input.preferredPort > 0) {
      const currentPort = Number(readEnvValue(envFile, 'API_SERVER_PORT'))
      if (!Number.isInteger(currentPort) || currentPort <= 0) {
        const raw = fs.readFileSync(envFile, 'utf8')
        const withoutPort = raw
          .split(/\r?\n/)
          .filter((line) => !line.startsWith('API_SERVER_PORT='))
          .join('\n')
          .replace(/\n*$/, '\n')
        writeSecure(envFile, `${withoutPort}API_SERVER_PORT=${input.preferredPort}\n`)
      }
    }
  }

  return {
    created,
    port: Number(readEnvValue(envFile, 'API_SERVER_PORT')) || input.preferredPort,
    apiKeyPresent: Boolean(readEnvValue(envFile, 'API_SERVER_KEY')),
    hermesBin,
  }
}

export function writeAgentExternalDirsConfig(input: {
  agentId: string
  externalDir: string
  env?: HermesLifecycleEnv
}): void {
  const env = input.env ?? process.env
  const configPath = path.join(profileDirectory(input.agentId, env), 'config.yaml')
  const existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : ''
  if (/skills:\s*\n\s*external_dirs:/m.test(existing)) {
    const next = existing.replace(
      /external_dirs:\s*\n(?:\s*-\s*.+\n)*/m,
      `external_dirs:\n  - ${input.externalDir}\n`,
    )
    writeSecure(configPath, next)
    return
  }
  const block = `skills:\n  external_dirs:\n    - ${input.externalDir}\n`
  writeSecure(configPath, existing ? `${existing.replace(/\n*$/, '\n')}\n${block}` : block)
}

function pidFile(agentId: string, env: HermesLifecycleEnv = process.env): string {
  return path.join(stateRoot(env), 'agent-host', `${agentId}.json`)
}

function manageSystemdHermesProfile(
  agentId: string,
  env: HermesLifecycleEnv,
  action: 'restart' | 'stop',
): { managed: boolean; ok: boolean; error?: string } {
  if (process.platform !== 'linux'
    || typeof process.getuid !== 'function'
    || process.getuid() !== 0
    || !fs.existsSync('/run/systemd/system')) {
    return { managed: false, ok: false }
  }
  const unit = `hermes@${agentId}.service`
  const loaded = spawnSync('systemctl', ['show', unit, '--property=LoadState', '--value'], {
    encoding: 'utf8',
    env,
  })
  if (loaded.status !== 0 || loaded.stdout.trim() !== 'loaded') {
    return { managed: false, ok: false }
  }
  const result = spawnSync('systemctl', [action, unit], { encoding: 'utf8', env })
  return result.status === 0
    ? { managed: true, ok: true }
    : {
        managed: true,
        ok: false,
        error: result.stderr.trim() || `Could not ${action} ${unit}`,
      }
}

type ManagedLaunchdFleet = {
  label: string
  plist: string
  service: string
  domain: string
}

type FleetProfileAction = 'restart' | 'disable' | 'enable'

type FleetProfileControlRequest = {
  action: FleetProfileAction
  requestId: string
}

const DEFAULT_MANAGED_MAC_FLEET_AGENT_IDS = [
  'pip', 'theo', 'maya', 'sage', 'nora', 'ads',
  'qa-release', 'support', 'data', 'docs', 'seo', 'sales',
]

function managedMacFleetAgentIds(env: HermesLifecycleEnv): Set<string> {
  const configured = env.PIB_HERMES_FLEET_AGENT_IDS?.trim()
  return new Set((configured ? configured.split(',') : DEFAULT_MANAGED_MAC_FLEET_AGENT_IDS)
    .map((agentId) => agentId.trim())
    .filter(Boolean))
}

export function isManagedLaunchdHermesProfile(input: {
  agentId: string
  env?: HermesLifecycleEnv
}): boolean {
  const env = input.env ?? process.env
  return managedMacFleetAgentIds(env).has(input.agentId)
    && managedLaunchdFleet(input.agentId, env) !== null
}

function managedLaunchdFleet(agentId: string, env: HermesLifecycleEnv): ManagedLaunchdFleet | null {
  const platform = env.PIB_RUNTIME_PLATFORM || process.platform
  if (platform !== 'darwin' || typeof process.getuid !== 'function') {
    return null
  }
  if (!managedMacFleetAgentIds(env).has(agentId)) return null
  const label = env.PIB_HERMES_FLEET_LAUNCHD_LABEL?.trim() || 'ai.hermes.local-runtime'
  const plist = env.PIB_HERMES_FLEET_LAUNCHD_PLIST?.trim()
    || path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`)
  if (!fs.existsSync(plist)) return null

  return {
    label,
    plist,
    service: `gui/${process.getuid()}/${label}`,
    domain: `gui/${process.getuid()}`,
  }
}

function fleetControlRoot(env: HermesLifecycleEnv): string {
  return env.PIB_HERMES_FLEET_CONTROL_DIR?.trim()
    || path.join(hermesHome(env), 'runtime-fleet-control')
}

function writeFleetControlRequest(
  agentId: string,
  action: FleetProfileAction,
  env: HermesLifecycleEnv,
): FleetProfileControlRequest {
  const requestId = crypto.randomUUID()
  // One atomic command per profile means a newer disable/enable/restart
  // replaces an older intent instead of leaving cross-directory stale work.
  const requestPath = path.join(fleetControlRoot(env), 'requests', `${agentId}.json`)
  const request = {
    version: 1,
    action,
    agentId,
    requestId,
    requestedAt: new Date().toISOString(),
  }
  const temporaryPath = `${requestPath}.${process.pid}.${requestId}.tmp`
  writeSecure(temporaryPath, `${JSON.stringify(request)}\n`)
  fs.renameSync(temporaryPath, requestPath)
  return { action, requestId }
}

function readFleetControlAck(
  agentId: string,
  action: FleetProfileAction,
  requestId: string,
  env: HermesLifecycleEnv,
): { completed: boolean; error?: string } {
  const ackPath = path.join(fleetControlRoot(env), 'acks', `${agentId}.${requestId}.json`)
  try {
    const ack = JSON.parse(fs.readFileSync(ackPath, 'utf8')) as {
      action?: unknown
      requestId?: unknown
      status?: unknown
      error?: unknown
    }
    if (ack.action !== action || ack.requestId !== requestId) return { completed: false }
    if (
      (action === 'restart' && ack.status === 'restarted')
      || (action === 'disable' && ack.status === 'disabled')
      || (action === 'enable' && ack.status === 'enabled')
    ) {
      return { completed: true }
    }
    // Fleet defers mid-run restarts instead of SIGTERM'ing active /v1/runs.
    // Treat deferred like failed so credential/policy jobs wait and retry —
    // never fall through to a hard per-profile stop fallback.
    if (ack.status === 'failed' || ack.status === 'deferred') {
      return {
        completed: true,
        error: typeof ack.error === 'string'
          ? ack.error
          : ack.status === 'deferred'
            ? `Hermes profile ${agentId} still has active work; ${action} deferred`
            : `Hermes profile ${agentId} could not ${action}`,
      }
    }
  } catch {
    // The fleet writes the acknowledgement atomically after it has replaced
    // the target gateway. A missing or incomplete file simply means wait.
  }
  return { completed: false }
}

async function waitForFleetControlAck(input: {
  agentId: string
  action: FleetProfileAction
  requestId: string
  env: HermesLifecycleEnv
  timeoutMs?: number
  intervalMs?: number
}): Promise<{ ok: boolean; timedOut?: boolean; error?: string }> {
  // The fleet checks for a target request every five seconds. If this is an
  // older supervisor that predates the marker protocol, fall back promptly to
  // its existing per-profile exit recovery instead of waiting through a long
  // credential-sync timeout.
  const timeoutMs = input.timeoutMs ?? 8_000
  const intervalMs = input.intervalMs ?? 500
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const ack = readFleetControlAck(input.agentId, input.action, input.requestId, input.env)
    if (ack.completed) return ack.error ? { ok: false, error: ack.error } : { ok: true }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return {
    ok: false,
    timedOut: true,
    error: `Timed out waiting for the local Hermes fleet to ${input.action} ${input.agentId}`,
  }
}

function restartManagedProfileViaHermesCli(input: {
  agentId: string
  hermesBin: string | null
  env: HermesLifecycleEnv
}): { ok: boolean; error?: string } {
  if (!input.hermesBin) {
    return { ok: false, error: 'Hermes binary not found for the managed profile recovery fallback' }
  }
  const result = spawnSync(
    input.hermesBin,
    ['-p', input.agentId, 'gateway', 'stop'],
    {
      encoding: 'utf8',
      env: { ...input.env, HERMES_HOME: hermesHome(input.env) },
    },
  )
  return result.status === 0
    ? { ok: true }
    : { ok: false, error: result.stderr.trim() || `Could not restart managed Hermes profile ${input.agentId}` }
}

function ensureLaunchdHermesFleet(
  agentId: string,
  env: HermesLifecycleEnv,
): { managed: boolean; ok: boolean; error?: string } {
  const fleet = managedLaunchdFleet(agentId, env)
  if (!fleet) return { managed: false, ok: false }

  const readState = () => spawnSync('launchctl', ['print', fleet.service], {
    encoding: 'utf8',
    env,
  })
  let state = readState()
  if (state.status !== 0) {
    const bootstrap = spawnSync('launchctl', ['bootstrap', fleet.domain, fleet.plist], { encoding: 'utf8', env })
    state = readState()
    if (bootstrap.status !== 0 && state.status !== 0) {
      return {
        managed: true,
        ok: false,
        error: bootstrap.stderr.trim() || `Could not bootstrap launchd fleet ${fleet.label}`,
      }
    }
  }

  // `kickstart -k` kills the running supervisor. The supervisor owns every
  // local profile, so using it for a single profile's refresh creates a fleet
  // outage. A loaded running service needs no action; a loaded but inactive
  // service can be asked to start without terminating an existing process.
  if (/\bstate = running\b/.test(state.stdout)) return { managed: true, ok: true }
  const kickstart = spawnSync('launchctl', ['kickstart', fleet.service], { encoding: 'utf8', env })
  return kickstart.status === 0
    ? { managed: true, ok: true }
    : {
        managed: true,
        ok: false,
        error: kickstart.stderr.trim() || `Could not start launchd fleet ${fleet.label}`,
      }
}

export function startHermesGateway(input: {
  agentId: string
  env?: HermesLifecycleEnv
}): { started: boolean; pid: number | null; hermesBin: string | null; error?: string } {
  const env = input.env ?? process.env
  const hermesBin = resolveHermesBinary(env)
  const launchd = ensureLaunchdHermesFleet(input.agentId, env)
  if (launchd.managed) {
    return launchd.ok
      ? { started: true, pid: null, hermesBin }
      : { started: false, pid: null, hermesBin, error: launchd.error }
  }
  if (!hermesBin) {
    return {
      started: false,
      pid: null,
      hermesBin: null,
      error: 'hermes binary not found — install Hermes (Linked Computers bootstrap) or set PIB_HERMES_BIN',
    }
  }

  try {
    const systemd = manageSystemdHermesProfile(input.agentId, env, 'restart')
    if (systemd.managed) {
      return systemd.ok
        ? { started: true, pid: null, hermesBin }
        : { started: false, pid: null, hermesBin, error: systemd.error }
    }
    const child = spawn(
      hermesBin,
      ['-p', input.agentId, 'gateway', 'run', '--replace', '--force', '--quiet'],
      {
        detached: true,
        stdio: 'ignore',
        env: { ...env, HERMES_HOME: hermesHome(env) },
      },
    )
    child.unref()
    const meta = {
      agentId: input.agentId,
      pid: child.pid ?? null,
      startedAt: new Date().toISOString(),
      hermesBin,
    }
    writeSecure(pidFile(input.agentId, env), `${JSON.stringify(meta, null, 2)}\n`)
    return { started: true, pid: child.pid ?? null, hermesBin }
  } catch (error) {
    return {
      started: false,
      pid: null,
      hermesBin,
      error: error instanceof Error ? error.message : 'failed to start hermes gateway',
    }
  }
}

export async function reloadHermesGateway(input: {
  agentId: string
  env?: HermesLifecycleEnv
  timeoutMs?: number
}): Promise<{ started: boolean; pid: number | null; hermesBin: string | null; error?: string }> {
  const env = input.env ?? process.env
  const hermesBin = resolveHermesBinary(env)
  const launchd = ensureLaunchdHermesFleet(input.agentId, env)
  if (launchd.managed) {
    if (!launchd.ok) return { started: false, pid: null, hermesBin, error: launchd.error }
    const request = writeFleetControlRequest(input.agentId, 'restart', env)
    const acknowledged = await waitForFleetControlAck({
      agentId: input.agentId,
      action: request.action,
      requestId: request.requestId,
      env,
      timeoutMs: input.timeoutMs,
    })
    if (acknowledged.ok) return { started: true, pid: null, hermesBin }
    if (!acknowledged.timedOut) {
      return { started: false, pid: null, hermesBin, error: acknowledged.error }
    }
    // The existing fleet supervisor already treats a single child exit as a
    // target-only recovery. This maintains safe recovery while an older
    // supervisor process is still running the pre-marker script.
    const fallback = restartManagedProfileViaHermesCli({
      agentId: input.agentId,
      hermesBin,
      env,
    })
    return fallback.ok
      ? { started: true, pid: null, hermesBin }
      : {
          started: false,
          pid: null,
          hermesBin,
          error: fallback.error || acknowledged.error,
        }
  }

  const stopped = stopHermesGateway({ agentId: input.agentId, env })
  if (!stopped.stopped) {
    return {
      started: false,
      pid: null,
      hermesBin,
      error: stopped.error || 'Hermes gateway reload could not stop the profile',
    }
  }
  return startHermesGateway({ agentId: input.agentId, env })
}

export async function disableManagedHermesProfile(input: {
  agentId: string
  env?: HermesLifecycleEnv
  timeoutMs?: number
}): Promise<{ disabled: boolean; error?: string }> {
  const env = input.env ?? process.env
  const launchd = ensureLaunchdHermesFleet(input.agentId, env)
  if (!launchd.managed) {
    return { disabled: false, error: 'This Hermes profile is not managed by the macOS fleet supervisor.' }
  }
  if (!launchd.ok) return { disabled: false, error: launchd.error }
  const request = writeFleetControlRequest(input.agentId, 'disable', env)
  const acknowledged = await waitForFleetControlAck({
    agentId: input.agentId,
    action: request.action,
    requestId: request.requestId,
    env,
    timeoutMs: input.timeoutMs,
  })
  return acknowledged.ok
    ? { disabled: true }
    : { disabled: false, error: acknowledged.error }
}

export async function enableManagedHermesProfile(input: {
  agentId: string
  env?: HermesLifecycleEnv
  timeoutMs?: number
}): Promise<{ started: boolean; error?: string }> {
  const env = input.env ?? process.env
  const launchd = ensureLaunchdHermesFleet(input.agentId, env)
  if (!launchd.managed) {
    return { started: false, error: 'This Hermes profile is not managed by the macOS fleet supervisor.' }
  }
  if (!launchd.ok) return { started: false, error: launchd.error }
  const request = writeFleetControlRequest(input.agentId, 'enable', env)
  const acknowledged = await waitForFleetControlAck({
    agentId: input.agentId,
    action: request.action,
    requestId: request.requestId,
    env,
    timeoutMs: input.timeoutMs,
  })
  return acknowledged.ok
    ? { started: true }
    : { started: false, error: acknowledged.error }
}

export async function waitForAgentHealthy(input: {
  agentId: string
  probe: () => Promise<{ availableAgentIds: string[] }>
  timeoutMs?: number
  intervalMs?: number
}): Promise<boolean> {
  const timeoutMs = input.timeoutMs ?? 20_000
  const intervalMs = input.intervalMs ?? 1_000
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const probe = await input.probe().catch(() => ({ availableAgentIds: [] as string[] }))
    if (probe.availableAgentIds.includes(input.agentId)) return true
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return false
}

export function stopHermesGateway(input: {
  agentId: string
  env?: HermesLifecycleEnv
}): { stopped: boolean; hermesBin: string | null; error?: string } {
  const env = input.env ?? process.env
  const hermesBin = resolveHermesBinary(env)
  const systemd = manageSystemdHermesProfile(input.agentId, env, 'stop')
  if (systemd.managed) {
    return systemd.ok
      ? { stopped: true, hermesBin }
      : { stopped: false, hermesBin, error: systemd.error }
  }
  if (isManagedLaunchdHermesProfile({ agentId: input.agentId, env })) {
    return {
      stopped: false,
      hermesBin,
      error: 'The managed macOS fleet cannot stop one profile directly; use reloadHermesGateway instead.',
    }
  }
  let stoppedViaCli = false
  if (hermesBin) {
    const result = spawnSync(
      hermesBin,
      ['-p', input.agentId, 'gateway', 'stop'],
      {
        encoding: 'utf8',
        env: { ...env, HERMES_HOME: hermesHome(env) },
      },
    )
    stoppedViaCli = result.status === 0
  }

  const metaPath = pidFile(input.agentId, env)
  let killedPid = false
  try {
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as { pid?: number }
      if (Number.isInteger(meta.pid) && (meta.pid ?? 0) > 1) {
        try {
          process.kill(meta.pid!, 'SIGTERM')
          killedPid = true
        } catch {
          // already dead
        }
      }
      fs.rmSync(metaPath, { force: true })
    }
  } catch (error) {
    return {
      stopped: stoppedViaCli || killedPid,
      hermesBin,
      error: error instanceof Error ? error.message : 'failed to stop hermes gateway',
    }
  }

  return {
    stopped: stoppedViaCli || killedPid || !hermesBin,
    hermesBin,
    ...(!stoppedViaCli && !killedPid && hermesBin ? { error: 'gateway stop did not confirm' } : {}),
  }
}
