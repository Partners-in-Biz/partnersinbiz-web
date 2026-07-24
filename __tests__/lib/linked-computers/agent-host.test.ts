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
} from '@/lib/linked-computers/agent-jobs'

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
})
