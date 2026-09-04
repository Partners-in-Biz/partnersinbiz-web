import {
  bindingsNeedingInstall,
  bindingsNeedingPolicySync,
  bindingPolicySyncBusyBackedOff,
  bindingSkillsDigestDrifted,
  HEARTBEAT_BUSY_DEFER_BACKOFF_MS,
  mergeDesiredAgentBindings,
  parseDesiredAgentBindings,
} from '@/lib/linked-computers/agent-bindings'
import {
  preferredPortForAgent,
  transitionAgentHostJob,
  agentHostJobId,
  agentHostRequestFingerprint,
  parseAgentHostJobPayload,
  toPublicAgentHostJob,
} from '@/lib/linked-computers/agent-jobs'
import {
  allocatePreferredAgentPort,
  resolvePreferredAgentPort,
  listPullableAgentIds,
} from '@/lib/linked-computers/agent-host-ports'
import { buildSkillPackManifest } from '@/lib/agents/skill-pack-builder'
import { AGENT_SKILL_POLICY } from '@/lib/agents/skill-policy'

describe('desired agent bindings', () => {
  it('merges added keep-in-sync agents and reports removals', () => {
    const existing = parseDesiredAgentBindings([
      { agentId: 'pip', keepInSync: true, status: 'in_sync', desiredPolicyVersion: 'v1', appliedPolicyVersion: 'v1', updatedAtMs: 1 },
      { agentId: 'maya', keepInSync: false, status: 'installed', updatedAtMs: 1 },
    ])
    const result = mergeDesiredAgentBindings({
      existing,
      desired: [
        { agentId: 'pip', keepInSync: true },
        { agentId: 'theo', keepInSync: true },
      ],
      policyVersionByAgent: { pip: 'v2', theo: 'v2' },
      nowMs: 100,
    })
    expect(result.added).toEqual(['theo'])
    expect(result.removed).toEqual(['maya'])
    expect(result.bindings.map((row) => row.agentId)).toEqual(['pip', 'theo'])
    expect(result.bindings.find((row) => row.agentId === 'pip')?.status).toBe('drifted')
    expect(result.bindings.find((row) => row.agentId === 'theo')?.keepInSync).toBe(true)
  })

  it('selects missing installs and policy sync targets', () => {
    const bindings = parseDesiredAgentBindings([
      { agentId: 'pip', keepInSync: true, status: 'desired', desiredPolicyVersion: 'v1', appliedPolicyVersion: null, updatedAtMs: 1 },
      { agentId: 'theo', keepInSync: true, status: 'drifted', desiredPolicyVersion: 'v2', appliedPolicyVersion: 'v1', updatedAtMs: 1 },
      { agentId: 'maya', keepInSync: false, status: 'installed', desiredPolicyVersion: 'v1', appliedPolicyVersion: 'v1', updatedAtMs: 1 },
    ])
    expect(bindingsNeedingInstall({ bindings, availableAgentIds: ['theo'] }).map((row) => row.agentId).sort()).toEqual(['maya', 'pip'])
    expect(bindingsNeedingPolicySync({ bindings, availableAgentIds: ['theo', 'maya'] }).map((row) => row.agentId)).toEqual(['theo'])
  })

  it('marks keep-in-sync bindings as skill-digest drifted only when both digests exist and differ', () => {
    const binding = parseDesiredAgentBindings([{
      agentId: 'pip',
      keepInSync: true,
      status: 'in_sync',
      appliedSkillsDigest: 'aaa',
      updatedAtMs: 1,
    }])[0]
    expect(bindingSkillsDigestDrifted(binding, 'bbb')).toBe(true)
    expect(bindingSkillsDigestDrifted(binding, 'aaa')).toBe(false)
    expect(bindingSkillsDigestDrifted({ ...binding, keepInSync: false }, 'bbb')).toBe(false)
    expect(bindingSkillsDigestDrifted({ ...binding, appliedSkillsDigest: null }, 'bbb')).toBe(false)
  })

  it('backs off a keep-in-sync binding whose last sync failed because the profile was busy', () => {
    const nowMs = 1_000_000
    const busy = parseDesiredAgentBindings([{
      agentId: 'theo',
      keepInSync: true,
      status: 'error',
      desiredPolicyVersion: 'v2',
      appliedPolicyVersion: 'v1',
      lastError: 'Agent is still busy; gateway reload was deferred',
      updatedAtMs: nowMs - 60_000,
    }])[0]
    const drained = parseDesiredAgentBindings([{
      agentId: 'theo',
      keepInSync: true,
      status: 'error',
      desiredPolicyVersion: 'v2',
      appliedPolicyVersion: 'v1',
      lastError: 'Agent is still busy; gateway reload was deferred',
      updatedAtMs: nowMs - HEARTBEAT_BUSY_DEFER_BACKOFF_MS - 1,
    }])[0]
    const nonBusyError = parseDesiredAgentBindings([{
      agentId: 'theo',
      keepInSync: true,
      status: 'error',
      desiredPolicyVersion: 'v2',
      appliedPolicyVersion: 'v1',
      lastError: 'Skill pack download failed',
      updatedAtMs: nowMs - 60_000,
    }])[0]

    expect(bindingPolicySyncBusyBackedOff(busy, nowMs)).toBe(true)
    expect(bindingPolicySyncBusyBackedOff(drained, nowMs)).toBe(false)
    expect(bindingPolicySyncBusyBackedOff(nonBusyError, nowMs)).toBe(false)
  })
})

describe('agent host jobs', () => {
  it('uses stable managed ports and claim transitions', () => {
    expect(preferredPortForAgent('pip')).toBe(8755)
    expect(preferredPortForAgent('sales')).toBe(8773)
    expect(resolvePreferredAgentPort('pip')).toBe(8755)
    expect(resolvePreferredAgentPort('custom-bot')).toBeGreaterThanOrEqual(8800)
    expect(resolvePreferredAgentPort('custom-bot')).toBeLessThan(9800)
    expect(resolvePreferredAgentPort('custom-bot')).toBe(resolvePreferredAgentPort('custom-bot'))

    const id = agentHostJobId({
      deviceId: 'device-1',
      kind: 'install',
      agentId: 'pip',
      policyVersion: 'v1',
      idempotencyKey: 'install:device-1:pip:v1',
    })
    expect(id).toHaveLength(32)

    const claimed = transitionAgentHostJob({
      jobId: id,
      idempotencyKey: 'k',
      requestFingerprint: 'fp',
      deviceId: 'device-1',
      orgId: 'org-1',
      actorUserId: 'user-1',
      credentialVersion: 1,
      kind: 'install',
      status: 'queued',
      attempt: 0,
      payload: {
        agentId: 'pip',
        policyVersion: 'v1',
        keepInSync: true,
        runtimeSkills: [],
        pibSkills: [],
        vpsExternalDir: null,
        preferredPort: 8755,
      },
      createdAtMs: 1,
      updatedAtMs: 1,
      expiresAtMs: 1000,
    }, { type: 'claim', leaseToken: 'lease', leaseExpiresAtMs: 500, nowMs: 10 })
    expect(claimed.status).toBe('claimed')
    expect(claimed.leaseToken).toBe('lease')

    const completed = transitionAgentHostJob(claimed, {
      type: 'complete',
      result: { healthy: true },
      nowMs: 20,
    })
    expect(completed.status).toBe('completed')
    expect(completed.result).toEqual({ healthy: true })
  })

  it('reserves the next free custom port and keeps existing assignments stable', () => {
    const preferred = resolvePreferredAgentPort('custom-bot')
    expect(allocatePreferredAgentPort('custom-bot', { other: preferred })).toBe(
      preferred === 9799 ? 8800 : preferred + 1,
    )
    expect(allocatePreferredAgentPort('custom-bot', { 'custom-bot': 9456, other: preferred })).toBe(9456)
  })

  it('fingerprints skill packs and exposes them on public jobs', () => {
    const withPack = agentHostRequestFingerprint({
      deviceId: 'd1',
      kind: 'sync-policy',
      agentId: 'pip',
      policyVersion: 'v1',
      keepInSync: true,
      runtimeSkills: ['a'],
      pibSkills: ['b'],
      vpsExternalDir: null,
      preferredPort: 8755,
      packSha256: 'abc',
    })
    const withoutPack = agentHostRequestFingerprint({
      deviceId: 'd1',
      kind: 'sync-policy',
      agentId: 'pip',
      policyVersion: 'v1',
      keepInSync: true,
      runtimeSkills: ['a'],
      pibSkills: ['b'],
      vpsExternalDir: null,
      preferredPort: 8755,
    })
    expect(withPack).not.toBe(withoutPack)

    const payload = parseAgentHostJobPayload({
      agentId: 'pip',
      policyVersion: 'v1',
      keepInSync: true,
      runtimeSkills: [],
      pibSkills: [],
      vpsExternalDir: null,
      preferredPort: 8755,
      protocolVersion: 2,
      profileConfig: {
        name: 'Custom',
        role: 'Research',
        persona: 'Research carefully.',
        defaultModel: 'auto',
      },
      skillPack: {
        packSha256: 'a'.repeat(64),
        policyVersion: 'v1',
        skillNames: ['content-engine'],
        artifactPath: '/api/v1/linked-computers/d1/agents/skills/artifact?agentId=pip&packSha256=aaa',
      },
    })
    const publicJob = toPublicAgentHostJob({
      jobId: 'j1',
      idempotencyKey: 'k',
      requestFingerprint: 'fp',
      deviceId: 'd1',
      orgId: 'o1',
      actorUserId: 'u1',
      credentialVersion: 1,
      kind: 'sync-policy',
      status: 'claimed',
      attempt: 1,
      leaseToken: 'lease',
      payload,
      createdAtMs: 1,
      updatedAtMs: 2,
      expiresAtMs: 3,
    })
    expect(publicJob.skillPack?.packSha256).toHaveLength(64)
    expect(publicJob.protocolVersion).toBe(2)
    expect(publicJob.profileConfig).toEqual({
      name: 'Custom',
      role: 'Research',
      persona: 'Research carefully.',
      defaultModel: 'auto',
    })
  })

  it('rejects a managedProfile.profile that does not match managedProfileName', () => {
    expect(() => parseAgentHostJobPayload({
      agentId: 'partners--pip',
      catalogAgentId: 'pip',
      policyVersion: 'v1',
      keepInSync: true,
      runtimeSkills: [],
      pibSkills: [],
      vpsExternalDir: null,
      preferredPort: 8755,
      managedProfile: {
        orgId: 'org-1',
        orgSlug: 'partners',
        agentId: 'pip',
        profile: 'wrong--pip',
      },
    })).toThrow('managedProfile.profile mismatch')
  })

  it('parses managed profile fields and exposes orgId on the public job', () => {
    const payload = parseAgentHostJobPayload({
      agentId: 'partners--pip',
      catalogAgentId: 'pip',
      policyVersion: 'v1',
      keepInSync: true,
      runtimeSkills: [],
      pibSkills: [],
      vpsExternalDir: null,
      preferredPort: 8755,
      managedProfile: {
        orgId: 'org-1',
        orgSlug: 'partners',
        agentId: 'pip',
        profile: 'partners--pip',
      },
      modelDefault: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      apiServer: { enable: true },
      browserPolicy: { useRealProfile: true, realProfilePin: 'Profile 2', headed: true, autoclose: false },
    })
    expect(payload.managedProfile?.profile).toBe('partners--pip')
    expect(payload.catalogAgentId).toBe('pip')
    expect(payload.modelDefault).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6' })
    expect(payload.apiServer).toEqual({ enable: true })
    expect(payload.browserPolicy).toEqual({ useRealProfile: true, realProfilePin: 'Profile 2', headed: true, autoclose: false })

    const withManaged = agentHostRequestFingerprint({
      deviceId: 'd1',
      kind: 'install',
      agentId: 'partners--pip',
      policyVersion: 'v1',
      keepInSync: true,
      runtimeSkills: [],
      pibSkills: [],
      vpsExternalDir: null,
      preferredPort: 8755,
      managedProfile: payload.managedProfile,
    })
    const withoutManaged = agentHostRequestFingerprint({
      deviceId: 'd1',
      kind: 'install',
      agentId: 'partners--pip',
      policyVersion: 'v1',
      keepInSync: true,
      runtimeSkills: [],
      pibSkills: [],
      vpsExternalDir: null,
      preferredPort: 8755,
    })
    expect(withManaged).not.toBe(withoutManaged)

    expect(toPublicAgentHostJob({
      jobId: 'j1',
      idempotencyKey: 'k',
      requestFingerprint: 'fp',
      deviceId: 'd1',
      orgId: 'org-1',
      actorUserId: 'u1',
      credentialVersion: 1,
      kind: 'install',
      status: 'queued',
      attempt: 0,
      payload,
      createdAtMs: 1,
      updatedAtMs: 2,
      expiresAtMs: 3,
    })).toMatchObject({
      orgId: 'org-1',
      catalogAgentId: 'pip',
      managedProfile: payload.managedProfile,
      modelDefault: payload.modelDefault,
      apiServer: { enable: true },
      browserPolicy: payload.browserPolicy,
    })
  })

  it('parses optional botProjection, fingerprints it, and ignores extra keys on protocol 4', () => {
    const botProjection = {
      profileMeta: { title: 'Maya', description: 'Marketing', avatar: null, section: '', groups: ['growth-desk'] },
      rooms: [{ roomId: 'org-1_growth-desk', name: 'Growth desk', pictureUrl: null, memberHandles: ['@maya-device-a'] }],
      peers: [],
      projectionVersion: 1,
    }
    const payload = parseAgentHostJobPayload({
      agentId: 'partners--maya',
      catalogAgentId: 'maya',
      policyVersion: 'v1',
      keepInSync: true,
      runtimeSkills: [],
      pibSkills: [],
      vpsExternalDir: null,
      preferredPort: 8757,
      protocolVersion: 4,
      extraIgnored: 'old-runtime-safe',
      botProjection,
    })
    expect(payload.botProjection).toEqual(botProjection)
    expect(payload.protocolVersion).toBe(4)
    expect(payload).not.toHaveProperty('extraIgnored')

    const withProjection = agentHostRequestFingerprint({
      deviceId: 'd1',
      kind: 'sync-policy',
      agentId: 'partners--maya',
      policyVersion: 'v1',
      keepInSync: true,
      runtimeSkills: [],
      pibSkills: [],
      vpsExternalDir: null,
      preferredPort: 8757,
      botProjection,
    })
    const withoutProjection = agentHostRequestFingerprint({
      deviceId: 'd1',
      kind: 'sync-policy',
      agentId: 'partners--maya',
      policyVersion: 'v1',
      keepInSync: true,
      runtimeSkills: [],
      pibSkills: [],
      vpsExternalDir: null,
      preferredPort: 8757,
    })
    expect(withProjection).not.toBe(withoutProjection)
    expect(toPublicAgentHostJob({
      jobId: 'j1',
      idempotencyKey: 'k',
      requestFingerprint: 'fp',
      deviceId: 'd1',
      orgId: 'org-1',
      actorUserId: 'u1',
      credentialVersion: 1,
      kind: 'sync-policy',
      status: 'queued',
      attempt: 0,
      payload,
      createdAtMs: 1,
      updatedAtMs: 2,
      expiresAtMs: 3,
    }).botProjection).toEqual(botProjection)
  })
})

describe('pullable catalog + skill packs', () => {
  it('includes managed agents plus enabled custom team agents', async () => {
    const ids = await listPullableAgentIds(async () => [
      { agentId: 'pip', enabled: true },
      { agentId: 'custom-analyst', enabled: true },
      { agentId: 'disabled-bot', enabled: false },
      { agentId: 'BAD', enabled: true },
    ])
    expect(ids).toContain('pip')
    expect(ids).toContain('custom-analyst')
    expect(ids).not.toContain('disabled-bot')
    expect(ids).not.toContain('BAD')
  })

  it('builds a deterministic skill pack manifest for pip', () => {
    const first = buildSkillPackManifest('pip')
    const second = buildSkillPackManifest('pip')
    expect(first.packSha256).toBe(second.packSha256)
    expect(first.policyVersion).toBeTruthy()
    expect(first.skillNames.length).toBeGreaterThan(0)
    expect(first.files.length).toBeGreaterThan(0)
  })

  it('includes daily-workflow content in every managed client agent pack', () => {
    for (const agentId of Object.keys(AGENT_SKILL_POLICY.agents)) {
      const first = buildSkillPackManifest(agentId)
      const second = buildSkillPackManifest(agentId)
      const skillFile = first.files.find((file) => file.path === 'daily-workflow/SKILL.md')

      expect(first.skillNames).toContain('daily-workflow')
      expect(skillFile).toEqual(expect.objectContaining({
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        size: expect.any(Number),
      }))
      expect(skillFile?.size).toBeGreaterThan(0)
      expect(first.packSha256).toBe(second.packSha256)
    }
  })

  it('builds an empty but deterministic pack for custom agents without skill policy', () => {
    const first = buildSkillPackManifest('custom-analyst')
    const second = buildSkillPackManifest('custom-analyst')
    expect(first.skillNames).toEqual([])
    expect(first.files).toEqual([])
    expect(first.packSha256).toBe(second.packSha256)
    expect(first.packSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(first.policyVersion).toBeTruthy()
  })
})
