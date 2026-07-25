import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { probeLocalHermes } from './hermes'
import {
  ensureHermesProfile,
  startHermesGateway,
  stopHermesGateway,
  waitForAgentHealthy,
} from './hermes-profile-lifecycle'
import { applySkillPackArchive, removeAgentSkillTree } from './skill-pack-apply'

export type AgentHostRuntimeJob = {
  jobId: string
  kind: 'install' | 'sync-policy' | 'uninstall'
  status: string
  agentId: string
  policyVersion: string | null
  keepInSync: boolean
  runtimeSkills: string[]
  pibSkills: string[]
  vpsExternalDir: string | null
  preferredPort: number | null
  skillPack?: {
    packSha256: string
    policyVersion: string
    skillNames: string[]
    artifactPath: string
  } | null
  protocolVersion?: number
  leaseToken?: string
}

export type AgentHostSkillPackDownloader = (input: {
  artifactPath: string
  expectedContentSha256: string
}) => Promise<string>

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

function writePolicyStamp(
  agentId: string,
  policyVersion: string | null,
  extra: Record<string, unknown> = {},
  env: NodeJS.ProcessEnv = process.env,
) {
  const stamp = {
    agentId,
    policyVersion,
    appliedAt: new Date().toISOString(),
    source: 'pib-runtime-agent-host',
    ...extra,
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
    skillPackSha256: job.skillPack?.packSha256 ?? null,
    updatedAt: new Date().toISOString(),
  }
  writeFileSecure(
    path.join(profileDir(agentId, env), 'pib-desired-agent.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
}

export async function executeAgentHostJob(
  job: AgentHostRuntimeJob,
  options: {
    env?: NodeJS.ProcessEnv
    probe?: typeof probeLocalHermes
    downloadSkillPack?: AgentHostSkillPackDownloader
    startGateway?: boolean
  } = {},
): Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; error: string }> {
  const env = options.env ?? process.env
  const probe = options.probe ?? probeLocalHermes
  const startGateway = options.startGateway !== false

  try {
    if (!job.agentId || !/^[a-z][a-z0-9._-]{0,39}$/.test(job.agentId)) {
      return { ok: false, error: 'invalid agent id' }
    }

    if (job.kind === 'uninstall') {
      const stopped = stopHermesGateway({ agentId: job.agentId, env })
      const skills = removeAgentSkillTree({ agentId: job.agentId, env })
      const desiredPath = path.join(profileDir(job.agentId, env), 'pib-desired-agent.json')
      fs.rmSync(desiredPath, { force: true })
      const stillHealthy = await waitForAgentHealthy({
        agentId: job.agentId,
        probe: () => probe(env),
        timeoutMs: 2_000,
        intervalMs: 500,
      })
      if (stillHealthy) {
        return {
          ok: false,
          error: stopped.error || 'Agent still healthy on loopback after uninstall stop',
        }
      }
      return {
        ok: true,
        result: {
          uninstalled: true,
          gatewayStopped: stopped.stopped,
          skillsRemoved: skills.removed,
          healthy: false,
          note: 'Agent gateway stopped and skill tree removed from this computer.',
        },
      }
    }

    const profile = ensureHermesProfile({
      agentId: job.agentId,
      preferredPort: job.preferredPort,
      env,
    })
    writeDesiredManifest(job.agentId, job, env)

    let skillsApplied = false
    let skillsDigest: string | null = null
    let skillCount = 0
    let externalDir: string | null = null

    const shouldApplySkills = Boolean(
      job.skillPack
      && (job.kind === 'sync-policy' || job.keepInSync || job.kind === 'install'),
    )

    if (shouldApplySkills && job.skillPack) {
      if (!options.downloadSkillPack) {
        return { ok: false, error: 'skill pack downloader required for keep-in-sync jobs' }
      }
      const archivePath = await options.downloadSkillPack({
        artifactPath: job.skillPack.artifactPath,
        expectedContentSha256: job.skillPack.packSha256,
      })
      try {
        const applied = applySkillPackArchive({
          agentId: job.agentId,
          archivePath,
          expectedSha256: job.skillPack.packSha256,
          env,
        })
        skillsApplied = applied.skillsApplied
        skillsDigest = applied.skillsDigest
        skillCount = applied.skillCount
        externalDir = applied.externalDir
      } finally {
        fs.rmSync(archivePath, { force: true })
      }
    }

    let policyApplied = false
    if (job.kind === 'sync-policy' || job.keepInSync || skillsApplied) {
      writePolicyStamp(job.agentId, job.policyVersion, {
        skillsApplied,
        skillsDigest,
        skillCount,
        packSha256: job.skillPack?.packSha256 ?? null,
      }, env)
      // Managed keep-in-sync / sync-policy must apply skills when a pack is present.
      // Installs without a pack (custom agents) may stamp policy without skills.
      policyApplied = Boolean(job.policyVersion) && (
        job.skillPack ? skillsApplied : true
      )
    }

    let gatewayStarted = false
    let gatewayPid: number | null = null
    let gatewayError: string | undefined
    if (startGateway && (job.kind === 'install' || job.kind === 'sync-policy')) {
      const gateway = startHermesGateway({ agentId: job.agentId, env })
      gatewayStarted = gateway.started
      gatewayPid = gateway.pid
      gatewayError = gateway.error
    }

    const healthy = await waitForAgentHealthy({
      agentId: job.agentId,
      probe: () => probe(env),
      timeoutMs: startGateway ? 20_000 : 2_000,
      intervalMs: 1_000,
    })

    const installRequiresHealth = job.kind === 'install'
    const syncRequiresSkills = Boolean(job.skillPack) && (job.kind === 'sync-policy' || job.keepInSync)
    if (installRequiresHealth && !healthy) {
      return {
        ok: false,
        error: gatewayError
          || 'Agent profile prepared but Hermes did not become healthy on loopback',
      }
    }
    if (syncRequiresSkills && !skillsApplied) {
      return { ok: false, error: 'Skill pack was not applied' }
    }

    return {
      ok: true,
      result: {
        profileCreated: profile.created,
        port: profile.port,
        apiKeyPresent: profile.apiKeyPresent,
        hermesBin: profile.hermesBin,
        policyApplied,
        skillsApplied,
        skillsDigest,
        skillCount,
        externalDir,
        gatewayStarted,
        gatewayPid,
        healthy,
        hermesVersion: (await probe(env).catch(() => ({ hermesVersion: null }))).hermesVersion ?? null,
        note: healthy
          ? 'Agent is healthy on loopback with policy applied.'
          : 'Profile prepared. Skills applied; start Hermes if it is not already running.',
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
  return { runtimeVersion: process.env.PIB_RUNTIME_VERSION || '1.1.7', agentHostProtocolVersion: 2 as const }
}
