import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import {
  decryptLinkedRunPayload,
  encryptLinkedRunPayload,
  linkedRunReceiptPayload,
  requireLinkedRunReceipt,
  transitionLinkedRun,
  type LinkedRunJob,
} from '@/lib/linked-computers/run-queue'

const now = Date.parse('2026-07-13T09:00:00.000Z')

function queued(overrides: Partial<LinkedRunJob> = {}): LinkedRunJob {
  return {
    jobId: 'job-1', requestId: 'request-1234567890', deviceId: 'device-a', runtimeTargetId: 'target-a',
    orgId: 'org-a', workspaceId: 'workspace-a', projectId: 'project-a', mappingId: 'mapping-a',
    relativeFolder: 'Projects/project-a', credentialVersion: 3, status: 'queued', attempt: 0,
    encryptedPayload: { ciphertext: 'cipher', iv: 'iv', tag: 'tag' },
    createdAtMs: now, updatedAtMs: now, expiresAtMs: now + 3_600_000,
    conversationId: 'conv-a', assistantMessageId: 'assistant-a', agentId: 'pip',
    ...overrides,
  }
}

describe('linked run queue security transitions', () => {
  beforeEach(() => { process.env.SOCIAL_TOKEN_MASTER_KEY = 'linked-queue-test-master-key' })

  it('encrypts prompts with per-device and per-job context', () => {
    const encrypted = encryptLinkedRunPayload({ prompt: 'private prompt', model: 'gpt-test' }, 'device-a', 'job-1')
    expect(JSON.stringify(encrypted)).not.toContain('private prompt')
    expect(decryptLinkedRunPayload(encrypted, 'device-a', 'job-1')).toEqual({ prompt: 'private prompt', model: 'gpt-test' })
    expect(() => decryptLinkedRunPayload(encrypted, 'device-b', 'job-1')).toThrow()
  })

  it('claims queued work and reclaims an expired lease without changing request identity', () => {
    const first = transitionLinkedRun(queued(), { type: 'claim', deviceId: 'device-a', credentialVersion: 3, nowMs: now, leaseMs: 30_000 })
    expect(first).toEqual(expect.objectContaining({ status: 'claimed', attempt: 1, leaseExpiresAtMs: now + 30_000, leaseToken: expect.any(String) }))
    expect(() => transitionLinkedRun(first, { type: 'claim', deviceId: 'device-a', credentialVersion: 3, nowMs: now + 1_000, leaseMs: 30_000 })).toThrow('lease active')
    const retried = transitionLinkedRun(first, { type: 'claim', deviceId: 'device-a', credentialVersion: 3, nowMs: now + 31_000, leaseMs: 30_000 })
    expect(retried).toEqual(expect.objectContaining({ requestId: first.requestId, attempt: 2 }))
    expect(retried.leaseToken).not.toBe(first.leaseToken)
  })

  it('denies cross-device, stale credential and out-of-order completion while making duplicate completion idempotent', () => {
    expect(() => transitionLinkedRun(queued(), { type: 'claim', deviceId: 'device-b', credentialVersion: 3, nowMs: now, leaseMs: 30_000 })).toThrow('device mismatch')
    expect(() => transitionLinkedRun(queued(), { type: 'claim', deviceId: 'device-a', credentialVersion: 2, nowMs: now, leaseMs: 30_000 })).toThrow('credential mismatch')
    expect(() => transitionLinkedRun(queued(), { type: 'complete', deviceId: 'device-a', credentialVersion: 3, nowMs: now, outcome: 'completed' })).toThrow('not claimed')
    const claimed = transitionLinkedRun(queued(), { type: 'claim', deviceId: 'device-a', credentialVersion: 3, nowMs: now, leaseMs: 30_000 })
    expect(() => transitionLinkedRun(claimed, { type: 'complete', deviceId: 'device-a', credentialVersion: 3, nowMs: now + 1, outcome: 'completed', attempt: 1, leaseToken: 'old' })).toThrow('lease mismatch')
    const done = transitionLinkedRun(claimed, { type: 'complete', deviceId: 'device-a', credentialVersion: 3, nowMs: now + 1, outcome: 'completed', attempt: 1, leaseToken: claimed.leaseToken! })
    expect(transitionLinkedRun(done, { type: 'complete', deviceId: 'device-a', credentialVersion: 3, nowMs: now + 2, outcome: 'completed', attempt: 1, leaseToken: claimed.leaseToken! })).toEqual(done)
  })

  it('requires an Ed25519 receipt bound to the exact job request mapping and credential', () => {
    const keys = generateKeyPairSync('ed25519')
    const output = 'done'
    const receipt = { jobId: 'job-1', requestId: 'request-1234567890', deviceId: 'device-a', mappingId: 'mapping-a', credentialVersion: 3, attempt: 1, leaseToken: 'lease-token-123456', event: 'completed' as const, outcome: 'completed' as const, timestamp: new Date(now).toISOString(), acceptedAt: new Date(now - 2).toISOString(), toolStartedAt: new Date(now - 1).toISOString(), runtimeVersion: '2.0.0', machineLabel: 'Office Mac', outputSha256: createHash('sha256').update(output).digest('hex'), outputBytes: Buffer.byteLength(output), errorSha256: createHash('sha256').update('').digest('hex'), errorBytes: 0, signature: '' }
    receipt.signature = sign(null, Buffer.from(linkedRunReceiptPayload(receipt)), keys.privateKey).toString('base64url')
    const job = queued({ attempt: 1, leaseToken: receipt.leaseToken })
    expect(requireLinkedRunReceipt(job, receipt, keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(), now, { output, error: '' })).toEqual(receipt)
    expect(() => requireLinkedRunReceipt(job, { ...receipt, outputBytes: 5 }, keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(), now, { output, error: '' })).toThrow('body mismatch')
  })
})
