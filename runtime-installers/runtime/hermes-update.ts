import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DeviceApiClient } from './client'
import { localHermesAgentHasActiveWork, localHermesRoutes } from './hermes'
import {
  reloadHermesGateway,
  resolveHermesBinary,
  startHermesGateway,
  stopHermesGateway,
  waitForAgentHealthy,
} from './hermes-profile-lifecycle'

export const HERMES_UPDATE_TIMEOUT_MS = 15 * 60_000
export const HERMES_UPDATE_RETRY_MS = 6 * 60 * 60_000
export const HERMES_UPDATE_STATE_NAME = 'hermes-update-state.json'

export type HermesUpdateResult = 'skipped' | 'updated' | 'failed'

export type HermesChannelPin = {
  targetVersion: string
  minVersion: string
  targetTag: string
}

export type RuntimeConfig = {
  channel: 'internal' | 'stable'
  hermes: HermesChannelPin
  runtimeMinVersion: string
  serverTime?: string
}

export type HermesContract = {
  pinnedTag: string
  versionCommand: { argv: string[]; versionRegex: string }
  updateCommand: {
    argv: string[]
    installerUrl: string
    updateStrategy: string
    cliLatestArgv?: string[]
    installerEnvVar?: string | null
  }
  updatePausesGateways: boolean
}

export type HermesSpawnResult = {
  status: number | null
  stdout?: string
  stderr?: string
  error?: { message?: string }
}

export type HermesSpawn = (
  command: string,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv; timeout?: number; input?: string },
) => HermesSpawnResult | Promise<HermesSpawnResult>

export type HermesUpdateState = {
  lastUpdateAttemptAt?: string
  lastResult?: HermesUpdateResult
}

export type HermesUpdateLog = (message: string) => void

export type MaybeUpdateHermesInput = {
  config: RuntimeConfig
  env?: NodeJS.ProcessEnv
  isIdle: () => Promise<boolean>
  log?: HermesUpdateLog
  spawn?: HermesSpawn
  statePath?: string
  now?: () => number
  fetchInstaller?: (url: string) => Promise<string>
  stopGateways?: (agentIds: string[]) => Promise<void> | void
  startGateways?: (agentIds: string[]) => Promise<void> | void
  reloadGateways?: (agentIds: string[]) => Promise<void> | void
  waitHealthy?: (agentIds: string[]) => Promise<boolean>
  managedAgentIds?: string[]
}

type RuntimeEnv = NodeJS.ProcessEnv

function logLine(log: HermesUpdateLog | undefined, message: string) {
  try { log?.(message) } catch { /* logging must never break an update */ }
}

function hermesHome(env: RuntimeEnv): string {
  return env.PIB_HERMES_HOME || env.HERMES_HOME || path.join(os.homedir(), '.hermes')
}

function stateRoot(env: RuntimeEnv): string {
  return env.PIB_RUNTIME_STATE_DIR || path.join(os.homedir(), '.partnersinbiz')
}

export function defaultHermesUpdateStatePath(env: RuntimeEnv = process.env): string {
  return path.join(stateRoot(env), HERMES_UPDATE_STATE_NAME)
}

export function contractPath(env: RuntimeEnv = process.env): string {
  if (env.PIB_HERMES_CONTRACT_PATH) return env.PIB_HERMES_CONTRACT_PATH
  const nextToModule = path.join(__dirname, 'hermes-contract.json')
  if (fs.existsSync(nextToModule)) return nextToModule
  return path.join(__dirname, '..', 'hermes-contract.json')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function requiredStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    throw new Error(`hermes contract ${label} is invalid`)
  }
  return value.map((entry) => String(entry))
}

export function parseHermesContract(value: unknown): HermesContract {
  const row = asRecord(value)
  if (!row) throw new Error('hermes contract is not an object')
  const versionCommand = asRecord(row.versionCommand)
  const updateCommand = asRecord(row.updateCommand)
  if (!versionCommand || !updateCommand) throw new Error('hermes contract is missing version/update commands')
  const versionRegex = typeof versionCommand.versionRegex === 'string' ? versionCommand.versionRegex : ''
  const installerUrl = typeof updateCommand.installerUrl === 'string' ? updateCommand.installerUrl : ''
  const updateStrategy = typeof updateCommand.updateStrategy === 'string' ? updateCommand.updateStrategy : ''
  if (!versionRegex || !installerUrl || !updateStrategy) throw new Error('hermes contract is incomplete')
  return {
    pinnedTag: typeof row.pinnedTag === 'string' ? row.pinnedTag : '',
    versionCommand: {
      argv: requiredStringArray(versionCommand.argv, 'versionCommand.argv'),
      versionRegex,
    },
    updateCommand: {
      argv: requiredStringArray(updateCommand.argv, 'updateCommand.argv'),
      installerUrl,
      updateStrategy,
      ...(Array.isArray(updateCommand.cliLatestArgv) ? { cliLatestArgv: requiredStringArray(updateCommand.cliLatestArgv, 'cliLatestArgv') } : {}),
      installerEnvVar: typeof updateCommand.installerEnvVar === 'string' ? updateCommand.installerEnvVar : null,
    },
    updatePausesGateways: row.updatePausesGateways === true,
  }
}

export function readHermesContract(env: RuntimeEnv = process.env): HermesContract {
  return parseHermesContract(JSON.parse(fs.readFileSync(contractPath(env), 'utf8')))
}

export function hermesVersionBelowMin(version: string | null | undefined, minVersion: string): boolean {
  const current = typeof version === 'string' ? version.trim() : ''
  const min = minVersion.trim()
  if (!/^\d+\.\d+\.\d+$/.test(current) || !/^\d+\.\d+\.\d+$/.test(min)) return false
  return compareSemver(current, min) < 0
}

export function compareSemver(left: string, right: string): number {
  const a = left.split('.').map((part) => Number(part))
  const b = right.split('.').map((part) => Number(part))
  for (let i = 0; i < 3; i += 1) {
    const av = Number.isFinite(a[i]) ? a[i] : 0
    const bv = Number.isFinite(b[i]) ? b[i] : 0
    if (av > bv) return 1
    if (av < bv) return -1
  }
  return 0
}

function defaultSpawn(command: string, args: string[], options?: { env?: NodeJS.ProcessEnv; timeout?: number; input?: string }): HermesSpawnResult {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: options?.env,
    timeout: options?.timeout,
    input: options?.input,
  })
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    ...(result.error ? { error: result.error } : {}),
  }
}

function versionArgv(env: RuntimeEnv, contract: HermesContract): { command: string; args: string[] } {
  const argv = contract.versionCommand.argv
  const fallback = argv[0] || 'hermes'
  const resolved = resolveHermesBinary(env) || fallback
  return { command: resolved, args: argv.slice(1) }
}

function parseVersionOutput(raw: string, versionRegex: string): string | null {
  const match = raw.match(new RegExp(versionRegex))
  const version = match?.[1]?.trim() || ''
  return /^\d+\.\d+\.\d+$/.test(version) ? version : null
}

export function probeHermesVersion(
  env: RuntimeEnv = process.env,
  spawn: HermesSpawn = defaultSpawn,
): { version: string | null; raw: string } {
  const contract = readHermesContract(env)
  const { command, args } = versionArgv(env, contract)
  const result = spawn(command, args, {
    env: { ...env, HERMES_HOME: hermesHome(env) },
    timeout: 15_000,
  })
  if (result && typeof (result as Promise<HermesSpawnResult>).then === 'function') {
    throw new Error('probeHermesVersion requires a synchronous spawn')
  }
  const sync = result as HermesSpawnResult
  const raw = `${sync.stdout || ''}${sync.stderr || ''}`.trim()
  return { version: parseVersionOutput(raw, contract.versionCommand.versionRegex), raw }
}

async function probeHermesVersionAsync(
  env: RuntimeEnv,
  spawn: HermesSpawn,
  contract: HermesContract,
): Promise<{ version: string | null; raw: string }> {
  const { command, args } = versionArgv(env, contract)
  const result = await spawn(command, args, {
    env: { ...env, HERMES_HOME: hermesHome(env) },
    timeout: 15_000,
  })
  const raw = `${result.stdout || ''}${result.stderr || ''}`.trim()
  return { version: parseVersionOutput(raw, contract.versionCommand.versionRegex), raw }
}

export function parseRuntimeConfigPayload(value: unknown): RuntimeConfig {
  const row = asRecord(value)
  const data = asRecord(row?.data) || row
  if (!data) throw new Error('runtime-config payload is invalid')
  const hermes = asRecord(data.hermes)
  const channel = data.channel === 'internal' || data.channel === 'stable' ? data.channel : null
  const targetVersion = typeof hermes?.targetVersion === 'string' ? hermes.targetVersion.trim() : ''
  const minVersion = typeof hermes?.minVersion === 'string' ? hermes.minVersion.trim() : ''
  const targetTag = typeof hermes?.targetTag === 'string' ? hermes.targetTag.trim() : ''
  const runtimeMinVersion = typeof data.runtimeMinVersion === 'string' ? data.runtimeMinVersion.trim() : ''
  if (!channel || !/^\d+\.\d+\.\d+$/.test(targetVersion) || !/^\d+\.\d+\.\d+$/.test(minVersion) || !/^v\d{4}\.\d{1,2}\.\d{1,2}$/.test(targetTag) || !/^\d+\.\d+\.\d+$/.test(runtimeMinVersion)) {
    throw new Error('runtime-config hermes pin is invalid')
  }
  return {
    channel,
    hermes: { targetVersion, minVersion, targetTag },
    runtimeMinVersion,
    ...(typeof data.serverTime === 'string' ? { serverTime: data.serverTime } : {}),
  }
}

export async function fetchRuntimeConfig(client: DeviceApiClient): Promise<RuntimeConfig> {
  const response = await client.get(`/api/v1/linked-computers/${client.deviceId}/runtime-config`)
  if (!response.ok) throw new Error(`runtime-config request rejected (${response.status})`)
  return parseRuntimeConfigPayload(await response.json())
}

export function readHermesUpdateState(statePath: string): HermesUpdateState {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8')) as HermesUpdateState
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function writeHermesUpdateState(statePath: string, state: HermesUpdateState): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 })
  fs.writeFileSync(statePath, `${JSON.stringify(state)}\n`, { encoding: 'utf8', mode: 0o600 })
}

export function readHermesUpdateHealthReason(
  env: RuntimeEnv = process.env,
  statePath = defaultHermesUpdateStatePath(env),
): 'hermes_update_failed' | undefined {
  return readHermesUpdateState(statePath).lastResult === 'failed' ? 'hermes_update_failed' : undefined
}

export function updateCommandArgv(contract: HermesContract, tag: string): { command: string; args: string[] } {
  const argv = contract.updateCommand.argv.map((part) => (part === '{tag}' ? tag : part))
  return { command: argv[0] || 'bash', args: argv.slice(1) }
}

function managedAgentIdsFromEnv(env: RuntimeEnv): string[] {
  try {
    const ids = localHermesRoutes(env).map((route) => route.agentId)
    if (ids.length) return ids
  } catch { /* fall through */ }
  return ['pip']
}

async function defaultFetchInstaller(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`Hermes installer download failed (${response.status})`)
  return response.text()
}

function defaultStopGateways(agentIds: string[], env: RuntimeEnv): void {
  for (const agentId of agentIds) stopHermesGateway({ agentId, env })
}

function defaultStartGateways(agentIds: string[], env: RuntimeEnv): void {
  for (const agentId of agentIds) startHermesGateway({ agentId, env })
}

async function defaultReloadGateways(agentIds: string[], env: RuntimeEnv): Promise<void> {
  for (const agentId of agentIds) await reloadHermesGateway({ agentId, env })
}

async function defaultWaitHealthy(agentIds: string[], env: RuntimeEnv): Promise<boolean> {
  for (const agentId of agentIds) {
    const ok = await waitForAgentHealthy({
      agentId,
      probe: async () => {
        const { probeLocalHermes } = await import('./hermes')
        return probeLocalHermes(env)
      },
    })
    if (!ok) return false
  }
  return true
}

export async function isRuntimeIdleForHermesUpdate(
  capacity: { hasActiveReservations(): boolean },
  env: RuntimeEnv = process.env,
  hasActiveWork: (agentId: string, env?: RuntimeEnv) => Promise<boolean> = localHermesAgentHasActiveWork,
): Promise<boolean> {
  if (capacity.hasActiveReservations()) return false
  let routes
  try {
    routes = localHermesRoutes(env)
  } catch {
    return false
  }
  for (const route of routes) {
    if (await hasActiveWork(route.agentId, env)) return false
  }
  return true
}

function persistAttempt(
  statePath: string,
  now: () => number,
  lastResult?: HermesUpdateResult,
): void {
  writeHermesUpdateState(statePath, {
    lastUpdateAttemptAt: new Date(now()).toISOString(),
    ...(lastResult ? { lastResult } : {}),
  })
}

export async function maybeUpdateHermes(input: MaybeUpdateHermesInput): Promise<HermesUpdateResult> {
  const env = input.env ?? process.env
  const log = input.log
  const now = input.now ?? Date.now
  const statePath = input.statePath || defaultHermesUpdateStatePath(env)
  const spawn = input.spawn ?? defaultSpawn
  const contract = readHermesContract(env)
  const target = input.config.hermes.targetVersion
  const tag = input.config.hermes.targetTag

  const probed = await probeHermesVersionAsync(env, spawn, contract)
  if (probed.version && compareSemver(probed.version, target) >= 0) {
    const current = readHermesUpdateState(statePath)
    if (current.lastResult === 'failed') writeHermesUpdateState(statePath, { ...current, lastResult: undefined })
    logLine(log, `Hermes ${probed.version} already meets ${target}`)
    return 'skipped'
  }

  if (!(await input.isIdle())) {
    logLine(log, 'Hermes update skipped: runtime is busy')
    return 'skipped'
  }

  const previous = readHermesUpdateState(statePath)
  if (previous.lastUpdateAttemptAt) {
    const last = Date.parse(previous.lastUpdateAttemptAt)
    if (Number.isFinite(last) && now() - last < HERMES_UPDATE_RETRY_MS) {
      logLine(log, 'Hermes update skipped: last attempt was within 6 hours')
      return 'skipped'
    }
  }

  persistAttempt(statePath, now)
  const agentIds = input.managedAgentIds ?? managedAgentIdsFromEnv(env)
  const stop = input.stopGateways ?? ((ids: string[]) => defaultStopGateways(ids, env))
  const start = input.startGateways ?? ((ids: string[]) => defaultStartGateways(ids, env))
  const reload = input.reloadGateways ?? ((ids: string[]) => defaultReloadGateways(ids, env))
  const waitHealthy = input.waitHealthy ?? ((ids: string[]) => defaultWaitHealthy(ids, env))
  const mustPause = contract.updatePausesGateways === false
  let stopped = false

  const fail = (message: string): HermesUpdateResult => {
    writeHermesUpdateState(statePath, {
      lastUpdateAttemptAt: new Date(now()).toISOString(),
      lastResult: 'failed',
    })
    logLine(log, message)
    return 'failed'
  }

  try {
    if (mustPause) {
      await stop(agentIds)
      stopped = true
    }

    const { command, args } = updateCommandArgv(contract, tag)
    const spawnEnv = { ...env, HERMES_HOME: hermesHome(env) }
    let inputScript: string | undefined
    if (!input.spawn && contract.updateCommand.updateStrategy === 'installer') {
      const fetchInstaller = input.fetchInstaller ?? defaultFetchInstaller
      inputScript = await fetchInstaller(contract.updateCommand.installerUrl)
    }

    const result = await spawn(command, args, {
      env: spawnEnv,
      timeout: HERMES_UPDATE_TIMEOUT_MS,
      ...(inputScript !== undefined ? { input: inputScript } : {}),
    })
    if (result.status !== 0) {
      return fail(`Hermes update command failed (status ${result.status ?? 'null'})`)
    }

    await reload(agentIds)
    await waitHealthy(agentIds)

    const after = await probeHermesVersionAsync(env, spawn, contract)
    if (!after.version || compareSemver(after.version, target) < 0) {
      return fail(`Hermes still behind ${target} after update (have ${after.version || 'unknown'})`)
    }

    writeHermesUpdateState(statePath, {
      lastUpdateAttemptAt: new Date(now()).toISOString(),
      lastResult: 'updated',
    })
    logLine(log, `Hermes updated to ${after.version}`)
    return 'updated'
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Hermes update failed')
  } finally {
    if (stopped) {
      try { await start(agentIds) } catch { /* start is best-effort after a pinned update */ }
    }
  }
}

let hermesUpdateInFlight: Promise<HermesUpdateResult> | null = null

export function scheduleHermesUpdateAfterHeartbeat(input: {
  client: DeviceApiClient
  env?: RuntimeEnv
  isIdle: () => Promise<boolean>
  log?: HermesUpdateLog
  spawn?: HermesSpawn
  statePath?: string
  probedVersion?: string | null
  setAcceptingClaims?: (accepting: boolean) => void
}): Promise<HermesUpdateResult> | null {
  if (hermesUpdateInFlight) return hermesUpdateInFlight
  hermesUpdateInFlight = (async () => {
    try {
      const config = await fetchRuntimeConfig(input.client)
      input.setAcceptingClaims?.(!hermesVersionBelowMin(input.probedVersion, config.hermes.minVersion))
      return await maybeUpdateHermes({
        config,
        env: input.env ?? process.env,
        isIdle: input.isIdle,
        log: input.log,
        spawn: input.spawn,
        statePath: input.statePath,
      })
    } catch (error) {
      logLine(input.log, error instanceof Error ? error.message : 'Hermes update schedule failed')
      return 'failed'
    } finally {
      hermesUpdateInFlight = null
    }
  })()
  return hermesUpdateInFlight
}
