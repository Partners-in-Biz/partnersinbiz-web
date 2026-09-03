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
  it('stores a claimed account on the exact profile and requires a live provider canary', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-agent-host-credential-'))
    const env = {
      ...process.env,
      PIB_HERMES_HOME: home,
      HERMES_HOME: home,
      PIB_RUNTIME_STATE_DIR: path.join(home, 'state'),
    }
    const outcome = await executeAgentHostJob({
      jobId: 'credential-1',
      kind: 'sync-credential',
      status: 'claimed',
      agentId: 'sales',
      policyVersion: null,
      keepInSync: false,
      runtimeSkills: [],
      pibSkills: [],
      vpsExternalDir: null,
      preferredPort: 8773,
      protocolVersion: 3,
      credentialDelivery: {
        bindingId: 'binding-1',
        connectionId: 'user:u1:xai',
        credentialVersion: 4,
        provider: 'xai',
        hermesProvider: 'xai',
        envVar: 'XAI_API_KEY',
        canaryModel: 'grok-build-0.1',
        credentials: { apiKey: 'xai-private-secret' },
      },
    }, {
      env,
      startGateway: false,
      waitForAgentIdle: async () => true,
      probe: async () => ({ availableAgentIds: ['sales'] }),
      providerCanary: async () => ({ ok: true, modelIds: ['grok-build-0.1'] }),
    })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.result.liveAuthVerified).toBe(true)
    expect(fs.readFileSync(path.join(home, 'profiles', 'sales', '.env'), 'utf8'))
      .toContain('XAI_API_KEY=xai-private-secret')
    const stamp = fs.readFileSync(path.join(home, 'profiles', 'sales', 'pib-llm-binding.json'), 'utf8')
    expect(stamp).toContain('"bindingId": "binding-1"')
    expect(stamp).not.toContain('xai-private-secret')
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('does not report credential readiness when the provider canary fails', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-agent-host-canary-fail-'))
    const outcome = await executeAgentHostJob({
      jobId: 'credential-2',
      kind: 'sync-credential',
      status: 'claimed',
      agentId: 'sales',
      policyVersion: null,
      keepInSync: false,
      runtimeSkills: [],
      pibSkills: [],
      vpsExternalDir: null,
      preferredPort: 8773,
      protocolVersion: 3,
      credentialDelivery: {
        bindingId: 'binding-2',
        connectionId: 'user:u1:xai',
        credentialVersion: 1,
        provider: 'xai',
        hermesProvider: 'xai',
        envVar: 'XAI_API_KEY',
        canaryModel: 'grok-build-0.1',
        credentials: { apiKey: 'xai-private-secret' },
      },
    }, {
      env: {
        ...process.env,
        PIB_HERMES_HOME: home,
        HERMES_HOME: home,
        PIB_RUNTIME_STATE_DIR: path.join(home, 'state'),
      },
      startGateway: false,
      waitForAgentIdle: async () => true,
      probe: async () => ({ availableAgentIds: ['sales'] }),
      providerCanary: async () => ({ ok: false, modelIds: [], error: 'authentication rejected' }),
    })
    expect(outcome).toEqual({ ok: false, error: 'authentication rejected' })
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('writes centrally refreshed xAI OAuth access tokens without a refresh token', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-agent-host-xai-oauth-'))
    const outcome = await executeAgentHostJob({
      jobId: 'credential-xai-oauth',
      kind: 'sync-credential',
      status: 'claimed',
      agentId: 'theo',
      policyVersion: null,
      keepInSync: false,
      runtimeSkills: [],
      pibSkills: [],
      vpsExternalDir: null,
      preferredPort: 8756,
      protocolVersion: 3,
      credentialDelivery: {
        bindingId: 'binding-xai-oauth',
        connectionId: 'user:u1:xai-oauth',
        credentialVersion: 7,
        provider: 'xai-oauth',
        hermesProvider: 'xai-oauth',
        envVar: null,
        canaryModel: 'grok-4.20',
        credentials: {
          access_token: 'xai-access-token',
        },
      },
    }, {
      env: {
        ...process.env,
        PIB_HERMES_HOME: home,
        HERMES_HOME: home,
        PIB_RUNTIME_STATE_DIR: path.join(home, 'state'),
      },
      startGateway: false,
      waitForAgentIdle: async () => true,
      probe: async () => ({ availableAgentIds: ['theo'] }),
      providerCanary: async () => ({ ok: true, modelIds: ['grok-4.20'] }),
    })

    expect(outcome.ok).toBe(true)
    const auth = JSON.parse(fs.readFileSync(path.join(home, 'profiles', 'theo', 'auth.json'), 'utf8'))
    expect(auth.providers['xai-oauth'].tokens).toMatchObject({
      access_token: 'xai-access-token',
    })
    expect(auth.providers['xai-oauth'].tokens.refresh_token).toBeUndefined()
    expect(auth.credential_pool['xai-oauth'][0]).toMatchObject({
      access_token: 'xai-access-token',
      source: 'device_code',
    })
    expect(auth.credential_pool['xai-oauth'][0].refresh_token).toBeUndefined()
    expect(auth.credential_pool.xai).toBeUndefined()
    fs.rmSync(home, { recursive: true, force: true })
  })

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
    const dailySkill = path.join(home, 'agent-skills', 'pip', 'partnersinbiz', 'daily-workflow', 'SKILL.md')
    expect(fs.existsSync(dailySkill)).toBe(true)
    expect(fs.readFileSync(dailySkill, 'utf8')).toContain('version: 1.2.0')
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(archivePath, { force: true })
  })

  it('writes pib-managed.json on install only when managedProfile is present', async () => {
    const managedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-agent-host-managed-'))
    const legacyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-agent-host-legacy-'))
    const managed = { orgId: 'org-1', orgSlug: 'partners', agentId: 'pip', profile: 'partners--pip' }
    const managedOutcome = await executeAgentHostJob({
      jobId: 'job-managed',
      kind: 'install',
      status: 'claimed',
      agentId: 'partners--pip',
      policyVersion: 'v1',
      keepInSync: false,
      runtimeSkills: [],
      pibSkills: [],
      vpsExternalDir: null,
      preferredPort: 8760,
      managedProfile: managed,
    }, {
      env: {
        ...process.env,
        PIB_HERMES_HOME: managedHome,
        HERMES_HOME: managedHome,
        PIB_RUNTIME_STATE_DIR: path.join(managedHome, 'state'),
      },
      startGateway: false,
      probe: async () => ({ availableAgentIds: ['partners--pip'] }),
    })
    expect(managedOutcome.ok).toBe(true)
    const marker = JSON.parse(fs.readFileSync(path.join(managedHome, 'profiles', 'partners--pip', 'pib-managed.json'), 'utf8'))
    expect(marker).toMatchObject(managed)
    expect(typeof marker.createdAt).toBe('string')

    const legacyOutcome = await executeAgentHostJob({
      jobId: 'job-legacy',
      kind: 'install',
      status: 'claimed',
      agentId: 'pip',
      policyVersion: 'v1',
      keepInSync: false,
      runtimeSkills: [],
      pibSkills: [],
      vpsExternalDir: null,
      preferredPort: 8755,
    }, {
      env: {
        ...process.env,
        PIB_HERMES_HOME: legacyHome,
        HERMES_HOME: legacyHome,
        PIB_RUNTIME_STATE_DIR: path.join(legacyHome, 'state'),
      },
      startGateway: false,
      probe: async () => ({ availableAgentIds: ['pip'] }),
    })
    expect(legacyOutcome.ok).toBe(true)
    expect(fs.existsSync(path.join(legacyHome, 'profiles', 'pip', 'pib-managed.json'))).toBe(false)
    fs.rmSync(managedHome, { recursive: true, force: true })
    fs.rmSync(legacyHome, { recursive: true, force: true })
  })

  it('writes Hermes config keys and uses --no-skills when creating a managed profile', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-agent-host-yaml-'))
    const hermesBin = path.join(home, 'hermes')
    fs.writeFileSync(hermesBin, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    const spawn = jest.fn(() => ({ status: 0, stdout: '', stderr: '' })) as unknown as typeof spawnSync
    const outcome = await executeAgentHostJob({
      jobId: 'job-yaml',
      kind: 'install',
      status: 'claimed',
      agentId: 'partners--pip',
      orgId: 'org-1',
      catalogAgentId: 'pip',
      policyVersion: 'v1',
      keepInSync: false,
      runtimeSkills: [],
      pibSkills: [],
      vpsExternalDir: null,
      preferredPort: 8755,
      managedProfile: { orgId: 'org-1', orgSlug: 'partners', agentId: 'pip', profile: 'partners--pip' },
      modelDefault: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      apiServer: { enable: true },
    }, {
      env: {
        ...process.env,
        PIB_HERMES_HOME: home,
        HERMES_HOME: home,
        PIB_HERMES_BIN: hermesBin,
        PIB_RUNTIME_STATE_DIR: path.join(home, 'state'),
      },
      startGateway: false,
      probe: async () => ({ availableAgentIds: ['partners--pip'] }),
      spawnSync: spawn,
    })
    expect(outcome.ok).toBe(true)
    expect(spawn).toHaveBeenCalledWith(
      hermesBin,
      expect.arrayContaining(['profile', 'create', 'partners--pip', '--no-skills']),
      expect.any(Object),
    )
    const yaml = fs.readFileSync(path.join(home, 'profiles', 'partners--pip', 'config.yaml'), 'utf8')
    expect(yaml).toMatch(/default: claude-sonnet-4-6/)
    expect(yaml).toMatch(/provider: anthropic/)
    expect(yaml).toMatch(/api_server:/)
    expect(fs.readFileSync(path.join(home, 'profiles', 'partners--pip', '.env'), 'utf8')).toMatch(/API_SERVER_KEY=[0-9a-f]{64}/)
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('refuses skill and credential work when the managed marker org does not match the job', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-agent-host-org-'))
    const profileDir = path.join(home, 'profiles', 'partners--pip')
    fs.mkdirSync(profileDir, { recursive: true })
    fs.writeFileSync(path.join(profileDir, 'pib-managed.json'), JSON.stringify({
      orgId: 'org-a', orgSlug: 'partners', agentId: 'pip', profile: 'partners--pip',
    }))
    const outcome = await executeAgentHostJob({
      jobId: 'job-mismatch',
      kind: 'sync-policy',
      status: 'claimed',
      agentId: 'partners--pip',
      orgId: 'org-b',
      policyVersion: 'v1',
      keepInSync: true,
      runtimeSkills: [],
      pibSkills: [],
      vpsExternalDir: null,
      preferredPort: 8755,
    }, {
      env: {
        ...process.env,
        PIB_HERMES_HOME: home,
        HERMES_HOME: home,
        PIB_RUNTIME_STATE_DIR: path.join(home, 'state'),
      },
      startGateway: false,
      probe: async () => ({ availableAgentIds: ['partners--pip'] }),
    })
    expect(outcome).toEqual({ ok: false, error: 'org_mismatch' })
    const grantBlocked = await executeAgentHostJob({
      jobId: 'job-grant',
      kind: 'sync-credential',
      status: 'claimed',
      agentId: 'partners--pip',
      orgId: 'org-a',
      grantStatus: 'paused',
      policyVersion: null,
      keepInSync: false,
      runtimeSkills: [],
      pibSkills: [],
      vpsExternalDir: null,
      preferredPort: 8755,
      protocolVersion: 4,
      credentialDelivery: {
        bindingId: 'binding-1',
        connectionId: 'org:org-a:xai',
        credentialVersion: 1,
        provider: 'xai',
        hermesProvider: 'xai',
        envVar: 'XAI_API_KEY',
        canaryModel: 'grok-build-0.1',
      },
    }, {
      env: {
        ...process.env,
        PIB_HERMES_HOME: home,
        HERMES_HOME: home,
        PIB_RUNTIME_STATE_DIR: path.join(home, 'state'),
      },
      startGateway: false,
      probe: async () => ({ availableAgentIds: ['partners--pip'] }),
    })
    expect(grantBlocked).toEqual({ ok: false, error: 'grant_not_active' })
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('writes real-profile keys into only the target profile and deletes the shared snapshot on disable', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-browser-policy-'))
    const target = path.join(home, 'profiles', 'partners--pip')
    const other = path.join(home, 'profiles', 'gundemy--pip')
    fs.mkdirSync(target, { recursive: true })
    fs.mkdirSync(other, { recursive: true })
    fs.writeFileSync(path.join(other, 'config.yaml'), 'model:\n  default: keep-me\n')
    fs.mkdirSync(path.join(home, 'browser-profile', 'chrome'), { recursive: true })
    fs.writeFileSync(path.join(home, 'browser-profile', 'chrome', 'Cookies'), 'session')
    const outcome = await executeAgentHostJob({
      jobId: 'job-browser',
      kind: 'sync-policy',
      status: 'claimed',
      agentId: 'partners--pip',
      orgId: 'org-1',
      policyVersion: 'v1',
      keepInSync: false,
      runtimeSkills: [],
      pibSkills: [],
      vpsExternalDir: null,
      preferredPort: 8755,
      browserPolicy: { useRealProfile: true, realProfilePin: 'Profile 2', headed: true, autoclose: false },
    }, {
      env: { ...process.env, PIB_HERMES_HOME: home, HERMES_HOME: home, PIB_RUNTIME_STATE_DIR: path.join(home, 'state') },
      startGateway: false,
      probe: async () => ({ availableAgentIds: ['partners--pip'] }),
    })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.result.browserPolicyApplied).toBe(true)
    const written = fs.readFileSync(path.join(home, 'profiles', 'partners--pip', 'config.yaml'), 'utf8')
    expect(written).toMatch(/use_real_profile: true/)
    expect(fs.readFileSync(path.join(other, 'config.yaml'), 'utf8')).toContain('keep-me')
    const disabled = await executeAgentHostJob({
      jobId: 'job-browser-off',
      kind: 'sync-policy',
      status: 'claimed',
      agentId: 'partners--pip',
      orgId: 'org-1',
      policyVersion: 'v1',
      keepInSync: false,
      runtimeSkills: [],
      pibSkills: [],
      vpsExternalDir: null,
      preferredPort: 8755,
      browserPolicy: { useRealProfile: false, realProfilePin: 'Profile 2', headed: true, autoclose: false },
    }, {
      env: { ...process.env, PIB_HERMES_HOME: home, HERMES_HOME: home, PIB_RUNTIME_STATE_DIR: path.join(home, 'state') },
      startGateway: false,
      probe: async () => ({ availableAgentIds: ['partners--pip'] }),
    })
    expect(disabled.ok).toBe(true)
    expect(fs.existsSync(path.join(home, 'browser-profile'))).toBe(false)
    fs.writeFileSync(path.join(other, 'config.yaml'), 'browser:\n  use_real_profile: true\n')
    fs.mkdirSync(path.join(home, 'browser-profile', 'chrome'), { recursive: true })
    const kept = await executeAgentHostJob({
      jobId: 'job-browser-keep',
      kind: 'sync-policy',
      status: 'claimed',
      agentId: 'partners--pip',
      orgId: 'org-1',
      policyVersion: 'v1',
      keepInSync: false,
      runtimeSkills: [],
      pibSkills: [],
      vpsExternalDir: null,
      preferredPort: 8755,
      browserPolicy: { useRealProfile: false, realProfilePin: null, headed: false, autoclose: false },
    }, {
      env: { ...process.env, PIB_HERMES_HOME: home, HERMES_HOME: home, PIB_RUNTIME_STATE_DIR: path.join(home, 'state') },
      startGateway: false,
      probe: async () => ({ availableAgentIds: ['partners--pip'] }),
    })
    expect(kept.ok).toBe(true)
    expect(fs.existsSync(path.join(home, 'browser-profile', 'chrome'))).toBe(true)
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('creates a missing managed profile with --no-skills and writes model/api config', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-agent-host-no-skills-'))
    const hermesBin = path.join(home, 'fake-hermes')
    fs.writeFileSync(hermesBin, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    const spawned: string[][] = []
    const spawnSync = ((command: string, args?: readonly string[]) => {
      spawned.push([String(command), ...(args ?? []).map(String)])
      return { status: 0, stdout: '', stderr: '', pid: 1, output: [], signal: null }
    }) as typeof import('node:child_process').spawnSync
    const managed = { orgId: 'org-1', orgSlug: 'partners', agentId: 'pip', profile: 'partners--pip' }
    const outcome = await executeAgentHostJob({
      jobId: 'job-no-skills',
      kind: 'install',
      status: 'claimed',
      agentId: 'partners--pip',
      catalogAgentId: 'pip',
      policyVersion: 'v1',
      keepInSync: false,
      runtimeSkills: [],
      pibSkills: [],
      vpsExternalDir: null,
      preferredPort: 8755,
      managedProfile: managed,
      modelDefault: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      apiServer: { enable: true },
    }, {
      env: {
        ...process.env,
        PIB_HERMES_HOME: home,
        HERMES_HOME: home,
        PIB_RUNTIME_STATE_DIR: path.join(home, 'state'),
        PIB_HERMES_BIN: hermesBin,
      },
      startGateway: false,
      probe: async () => ({ availableAgentIds: ['partners--pip'] }),
      spawnSync,
    })
    expect(outcome.ok).toBe(true)
    expect(spawned.some((argv) => argv.includes('profile') && argv.includes('create') && argv.includes('--no-skills'))).toBe(true)
    const profileDir = path.join(home, 'profiles', 'partners--pip')
    expect(JSON.parse(fs.readFileSync(path.join(profileDir, 'pib-managed.json'), 'utf8'))).toMatchObject(managed)
    expect(fs.readFileSync(path.join(profileDir, '.env'), 'utf8')).toMatch(/API_SERVER_KEY=[0-9a-f]{64}/)
    const config = fs.readFileSync(path.join(profileDir, 'config.yaml'), 'utf8')
    expect(config).toMatch(/default:\s*claude-sonnet-4-6/)
    expect(config).toMatch(/provider:\s*anthropic/)
    expect(config).toMatch(/api_server:[\s\S]*enable:\s*true/)
    fs.rmSync(home, { recursive: true, force: true })
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
    expect(applied.skillsDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(fs.readFileSync(path.join(home, 'profiles', 'pip', 'pib-skills-digest.txt'), 'utf8').trim()).toBe(applied.skillsDigest)
    expect(fs.existsSync(path.join(home, 'pib-skills', 'partnersinbiz', 'demo-skill', 'SKILL.md'))).toBe(true)
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(staging, { recursive: true, force: true })
  })
})
