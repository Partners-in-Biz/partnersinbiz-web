import { agentHostJobToStored } from '@/lib/linked-computers/agent-job-store'
import type { AgentHostJob } from '@/lib/linked-computers/agent-jobs'

describe('agentHostJobToStored', () => {
  it('omits unset lease fields so a new Firestore document can be created', () => {
    const stored = agentHostJobToStored({
      jobId: 'job-1',
      idempotencyKey: 'delivery-1',
      requestFingerprint: 'fingerprint',
      deviceId: 'device-1',
      orgId: 'org-1',
      actorUserId: 'user-1',
      credentialVersion: 1,
      kind: 'sync-credential',
      status: 'queued',
      attempt: 0,
      payload: {
        agentId: 'theo',
        policyVersion: null,
        keepInSync: false,
        runtimeSkills: [],
        pibSkills: [],
        vpsExternalDir: null,
        preferredPort: 8642,
        protocolVersion: 3,
      },
      createdAtMs: 1,
      updatedAtMs: 1,
      expiresAtMs: 2,
    } satisfies AgentHostJob)

    expect(stored).not.toHaveProperty('leaseToken')
    expect(stored).not.toHaveProperty('leaseExpiresAt')
    expect(stored).not.toHaveProperty('claimedAt')
    expect(stored).not.toHaveProperty('completedAt')
  })
})
