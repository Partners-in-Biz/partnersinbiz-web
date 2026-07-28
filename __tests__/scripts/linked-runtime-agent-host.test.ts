/**
 * @jest-environment node
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { executeAgentHostJob } from '@/runtime-installers/runtime/agent-host'
import { applySkillPackArchive } from '@/runtime-installers/runtime/skill-pack-apply'
import { materializeSkillPackTarGz } from '@/lib/agents/skill-pack-builder'

describe('executeAgentHostJob', () => {
  it('creates a Hermes profile skeleton and policy stamp', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-agent-host-'))
    const env = {
      ...process.env,
      PIB_HERMES_HOME: home,
      HERMES_HOME: home,
      PIB_RUNTIME_STATE_DIR: path.join(home, 'state'),
    }
    const outcome = await executeAgentHostJob({
      jobId: 'job-1',
      kind: 'install',
      status: 'claimed',
      agentId: 'theo',
      policyVersion: '2026-07-24.test',
      keepInSync: true,
      runtimeSkills: ['software-development/plan'],
      pibSkills: [],
      vpsExternalDir: '/var/lib/hermes/agent-skills/theo',
      preferredPort: 8756,
      leaseToken: 'lease',
    }, {
      env,
      startGateway: false,
      probe: async () => ({ availableAgentIds: ['theo'], hermesVersion: 'test' }),
    })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.result.profileCreated).toBe(true)
    expect(outcome.result.policyApplied).toBe(true)
    expect(outcome.result.healthy).toBe(true)
    expect(fs.existsSync(path.join(home, 'profiles', 'theo', '.env'))).toBe(true)
    expect(fs.readFileSync(path.join(home, 'profiles', 'theo', '.env'), 'utf8')).toContain('API_SERVER_PORT=8756')
    expect(fs.existsSync(path.join(home, 'profiles', 'theo', 'pib-desired-agent.json'))).toBe(true)
    expect(fs.existsSync(path.join(home, 'profiles', 'theo', 'pib-skill-policy.json'))).toBe(true)
    const managedSoul = path.join(home, 'profiles', 'theo', 'SOUL.md')
    if (fs.existsSync(managedSoul)) {
      expect(fs.readFileSync(managedSoul, 'utf8')).not.toContain('Preferred model:')
    }
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('persists linked custom profile identity and persona into the Hermes profile', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-agent-host-persona-'))
    const outcome = await executeAgentHostJob({
      jobId: 'job-custom',
      kind: 'install',
      status: 'claimed',
      agentId: 'member-research',
      policyVersion: 'v1',
      keepInSync: false,
      runtimeSkills: [],
      pibSkills: [],
      vpsExternalDir: null,
      preferredPort: 8842,
      profileConfig: {
        name: 'Member Research',
        role: 'Research specialist',
        persona: 'Use evidence, cite sources, and keep this member data private.',
        defaultModel: 'auto',
      },
    }, {
      env: {
        ...process.env,
        PIB_HERMES_HOME: home,
        HERMES_HOME: home,
        PIB_RUNTIME_STATE_DIR: path.join(home, 'state'),
      },
      startGateway: false,
      probe: async () => ({ availableAgentIds: ['member-research'], hermesVersion: 'test' }),
    })
    expect(outcome.ok).toBe(true)
    const soul = fs.readFileSync(path.join(home, 'profiles', 'member-research', 'SOUL.md'), 'utf8')
    expect(soul).toContain('# Member Research')
    expect(soul).toContain('Use evidence, cite sources')
    const identity = JSON.parse(fs.readFileSync(path.join(home, 'profiles', 'member-research', 'pib-agent.json'), 'utf8'))
    expect(identity).toMatchObject({ agentId: 'member-research', role: 'Research specialist' })
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('removes a custom profile and its credentials on uninstall', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-agent-host-uninstall-'))
    const profile = path.join(home, 'profiles', 'member-research')
    fs.mkdirSync(profile, { recursive: true })
    fs.writeFileSync(path.join(profile, 'SOUL.md'), '# Member Research\n')
    fs.writeFileSync(path.join(profile, '.env'), 'OPENAI_API_KEY=secret\n')
    const outcome = await executeAgentHostJob({
      jobId: 'job-custom-uninstall',
      kind: 'uninstall',
      status: 'claimed',
      agentId: 'member-research',
      policyVersion: 'v1',
      keepInSync: false,
      runtimeSkills: [],
      pibSkills: [],
      vpsExternalDir: null,
      preferredPort: 8842,
      profileConfig: {
        name: 'Member Research',
        role: 'Research specialist',
        persona: 'Research carefully.',
        defaultModel: 'auto',
      },
    }, {
      env: {
        ...process.env,
        PIB_HERMES_HOME: home,
        HERMES_HOME: home,
        PIB_RUNTIME_STATE_DIR: path.join(home, 'state'),
      },
      probe: async () => ({ availableAgentIds: [] }),
    })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.result.profileRemoved).toBe(true)
    expect(fs.existsSync(profile)).toBe(false)
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('applies a verified skill pack during keep-in-sync install', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-agent-host-skills-'))
    const env = {
      ...process.env,
      PIB_HERMES_HOME: home,
      HERMES_HOME: home,
      PIB_RUNTIME_STATE_DIR: path.join(home, 'state'),
    }
    const { archivePath, manifest } = materializeSkillPackTarGz('pip')
    const outcome = await executeAgentHostJob({
      jobId: 'job-2',
      kind: 'install',
      status: 'claimed',
      agentId: 'pip',
      policyVersion: manifest.policyVersion,
      keepInSync: true,
      runtimeSkills: manifest.skillNames,
      pibSkills: [],
      vpsExternalDir: null,
      preferredPort: 8755,
      skillPack: {
        packSha256: manifest.packSha256,
        policyVersion: manifest.policyVersion,
        skillNames: manifest.skillNames,
        artifactPath: '/api/v1/linked-computers/d1/agents/skills/artifact?agentId=pip',
      },
    }, {
      env,
      startGateway: false,
      probe: async () => ({ availableAgentIds: ['pip'], hermesVersion: 'test' }),
      downloadSkillPack: async () => {
        const copy = path.join(home, 'downloaded.tgz')
        fs.copyFileSync(archivePath, copy)
        return copy
      },
    })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.result.skillsApplied).toBe(true)
    expect(outcome.result.skillCount).toBeGreaterThan(0)
    expect(fs.existsSync(path.join(home, 'agent-skills', 'pip'))).toBe(true)
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(archivePath, { force: true })
  })

  it('fails install when Hermes never becomes healthy', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-agent-host-unhealthy-'))
    const outcome = await executeAgentHostJob({
      jobId: 'job-3',
      kind: 'install',
      status: 'claimed',
      agentId: 'maya',
      policyVersion: 'v1',
      keepInSync: false,
      runtimeSkills: [],
      pibSkills: [],
      vpsExternalDir: null,
      preferredPort: 8757,
    }, {
      env: {
        ...process.env,
        PIB_HERMES_HOME: home,
        HERMES_HOME: home,
        PIB_RUNTIME_STATE_DIR: path.join(home, 'state'),
      },
      startGateway: false,
      probe: async () => ({ availableAgentIds: [] }),
    })
    expect(outcome.ok).toBe(false)
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('applies skill archives into shared + per-agent skill dirs', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-skill-ok-'))
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-skill-stage-'))
    fs.mkdirSync(path.join(staging, 'partnersinbiz', 'demo-skill'), { recursive: true })
    fs.writeFileSync(path.join(staging, 'partnersinbiz', 'demo-skill', 'SKILL.md'), '# demo\n')
    const archivePath = path.join(home, 'pack.tgz')
    expect(spawnSync('tar', ['-czf', archivePath, '-C', staging, '.'], { encoding: 'utf8' }).status).toBe(0)
    const applied = applySkillPackArchive({
      agentId: 'pip',
      archivePath,
      expectedSha256: 'abc',
      env: { PIB_HERMES_HOME: home, HERMES_HOME: home },
    })
    expect(applied.skillsApplied).toBe(true)
    expect(applied.skillCount).toBe(1)
    expect(fs.existsSync(path.join(home, 'pib-skills', 'partnersinbiz', 'demo-skill', 'SKILL.md'))).toBe(true)
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(staging, { recursive: true, force: true })
  })
})
