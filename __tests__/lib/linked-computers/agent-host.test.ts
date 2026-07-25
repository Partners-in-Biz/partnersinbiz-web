import {
  bindingsNeedingInstall,
  bindingsNeedingPolicySync,
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
import { resolvePreferredAgentPort, listPullableAgentIds } from '@/lib/linked-computers/agent-host-ports'
import { buildSkillPackManifest } from '@/lib/agents/skill-pack-builder'

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
})

describe('agent host jobs', () => {
  it('uses stable managed ports and claim transitions', () => {
    expect(preferredPortForAgent('pip')).toBe(8755)
    expect(preferredPortForAgent('sales')).toBe(8773)
    expect(resolvePreferredAgentPort('pip')).toBe(8755)
    expect(resolvePreferredAgentPort('custom-bot')).toBeGreaterThanOrEqual(8800)
    expect(resolvePreferredAgentPort('custom-bot')).toBeLessThan(8900)
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
