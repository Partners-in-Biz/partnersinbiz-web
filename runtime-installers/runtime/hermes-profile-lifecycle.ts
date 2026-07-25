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
}): { created: boolean; port: number | null; apiKeyPresent: boolean; hermesBin: string | null } {
  const env = input.env ?? process.env
  const hermesBin = resolveHermesBinary(env)
  const dir = profileDirectory(input.agentId, env)
  const envFile = path.join(dir, '.env')
  let created = false

  if (!fs.existsSync(dir) && hermesBin) {
    const result = spawnSync(hermesBin, ['profile', 'create', input.agentId], {
      encoding: 'utf8',
      env: { ...env, HERMES_HOME: hermesHome(env) },
    })
    if (result.status === 0) created = true
  }

  ensureDir(dir)
  if (!fs.existsSync(envFile)) {
    const sharedKey = readEnvValue(path.join(hermesHome(env), '.env'), 'API_SERVER_KEY')
      || crypto.randomBytes(24).toString('hex')
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
  } else if (input.preferredPort && input.preferredPort > 0) {
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

export function startHermesGateway(input: {
  agentId: string
  env?: HermesLifecycleEnv
}): { started: boolean; pid: number | null; hermesBin: string | null; error?: string } {
  const env = input.env ?? process.env
  const hermesBin = resolveHermesBinary(env)
  if (!hermesBin) return { started: false, pid: null, hermesBin: null, error: 'hermes binary not found' }

  try {
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
  let stoppedViaCli = false
  if (hermesBin) {
    const result = spawnSync(
      hermesBin,
      ['-p', input.agentId, 'gateway', 'stop', '--quiet'],
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
