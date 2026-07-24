import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { probeLocalHermes } from './hermes'

export type AgentHostRuntimeJob = {
  jobId: string
  kind: 'install' | 'sync-policy'
  status: string
  agentId: string
  policyVersion: string | null
  keepInSync: boolean
  runtimeSkills: string[]
  pibSkills: string[]
  vpsExternalDir: string | null
  preferredPort: number | null
  leaseToken?: string
}

function hermesHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.PIB_HERMES_HOME || env.HERMES_HOME || path.join(os.homedir(), '.hermes')
}

function profileDir(agentId: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(hermesHome(env), 'profiles', agentId)
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
}

function writeFileSecure(filePath: string, contents: string) {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, contents, { encoding: 'utf8', mode: 0o600 })
}

function readEnvPort(filePath: string): number | null {
  try {
    const line = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).find((row) => row.startsWith('API_SERVER_PORT='))
    if (!line) return null
    const port = Number(line.slice('API_SERVER_PORT='.length).trim())
    return Number.isInteger(port) && port > 0 ? port : null
  } catch {
    return null
  }
}

function ensureProfileEnv(agentId: string, preferredPort: number | null, env: NodeJS.ProcessEnv = process.env): { created: boolean; port: number | null; apiKeyPresent: boolean } {
  const dir = profileDir(agentId, env)
  const envFile = path.join(dir, '.env')
  ensureDir(dir)
  if (fs.existsSync(envFile)) {
    return {
      created: false,
      port: readEnvPort(envFile),
      apiKeyPresent: fs.readFileSync(envFile, 'utf8').includes('API_SERVER_KEY='),
    }
  }

  const sharedKey = (() => {
    try {
      const shared = fs.readFileSync(path.join(hermesHome(env), '.env'), 'utf8')
      const line = shared.split(/\r?\n/).find((row) => row.startsWith('API_SERVER_KEY='))
      return line ? line.slice('API_SERVER_KEY='.length).trim() : ''
    } catch {
      return ''
    }
  })()
  const apiKey = sharedKey || crypto.randomBytes(24).toString('hex')
  const port = preferredPort && preferredPort > 0 ? preferredPort : null
  const lines = [
    'API_SERVER_ENABLED=true',
    'API_SERVER_HOST=127.0.0.1',
    ...(port ? [`API_SERVER_PORT=${port}`] : []),
    `API_SERVER_MODEL_NAME=${agentId}`,
    `API_SERVER_KEY=${apiKey}`,
    '',
  ]
  writeFileSecure(envFile, lines.join('\n'))
  return { created: true, port, apiKeyPresent: true }
}

function writePolicyStamp(agentId: string, policyVersion: string | null, env: NodeJS.ProcessEnv = process.env) {
  const stamp = {
    agentId,
    policyVersion,
    appliedAt: new Date().toISOString(),
    source: 'pib-runtime-agent-host',
  }
  writeFileSecure(
    path.join(profileDir(agentId, env), 'pib-skill-policy.json'),
    `${JSON.stringify(stamp, null, 2)}\n`,
  )
}

function writeDesiredManifest(
  agentId: string,
  job: AgentHostRuntimeJob,
  env: NodeJS.ProcessEnv = process.env,
) {
  const manifest = {
    agentId,
    keepInSync: job.keepInSync,
    policyVersion: job.policyVersion,
    runtimeSkills: job.runtimeSkills,
    pibSkills: job.pibSkills,
    vpsExternalDir: job.vpsExternalDir,
    updatedAt: new Date().toISOString(),
  }
  writeFileSecure(
    path.join(profileDir(agentId, env), 'pib-desired-agent.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
}

export async function executeAgentHostJob(
  job: AgentHostRuntimeJob,
  env: NodeJS.ProcessEnv = process.env,
  probe: typeof probeLocalHermes = probeLocalHermes,
): Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    if (!job.agentId || !/^[a-z][a-z0-9-]{0,63}$/.test(job.agentId)) {
      return { ok: false, error: 'invalid agent id' }
    }

    const profile = ensureProfileEnv(job.agentId, job.preferredPort, env)
    writeDesiredManifest(job.agentId, job, env)

    let policyApplied = false
    if (job.kind === 'sync-policy' || job.keepInSync) {
      writePolicyStamp(job.agentId, job.policyVersion, env)
      policyApplied = Boolean(job.policyVersion)
    }

    const probeResult = await probe(env)
    const healthy = probeResult.availableAgentIds.includes(job.agentId)

    return {
      ok: true,
      result: {
        profileCreated: profile.created,
        port: profile.port,
        apiKeyPresent: profile.apiKeyPresent,
        policyApplied,
        healthy,
        hermesVersion: probeResult.hermesVersion ?? null,
        note: healthy
          ? 'Agent profile is healthy on loopback.'
          : 'Profile prepared. Start or restart the local Hermes profile so heartbeat can advertise it.',
      },
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'agent host job failed',
    }
  }
}

export async function pollAgentHostForever(
  claim: () => Promise<AgentHostRuntimeJob | null>,
  run: (job: AgentHostRuntimeJob) => Promise<void>,
  stop: () => boolean,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  let delay = 1_000
  while (!stop()) {
    const claimed = await claim().catch(() => null)
    if (claimed) {
      delay = 1_000
      await run(claimed).catch(() => undefined)
      continue
    }
    await wait(delay)
    delay = Math.min(delay * 2, 15_000)
  }
}

export function linkedRuntimeAgentHostClaimBody() {
  return { runtimeVersion: process.env.PIB_RUNTIME_VERSION || '1.1.6', agentHostProtocolVersion: 1 as const }
}
