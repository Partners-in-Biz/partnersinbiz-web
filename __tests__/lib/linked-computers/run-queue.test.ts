import { generateKeyPairSync, sign } from 'node:crypto'
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
    expect(first).toEqual(expect.objectContaining({ status: 'claimed', attempt: 1, leaseExpiresAtMs: now + 30_000 }))
    expect(() => transitionLinkedRun(first, { type: 'claim', deviceId: 'device-a', credentialVersion: 3, nowMs: now + 1_000, leaseMs: 30_000 })).toThrow('lease active')
    const retried = transitionLinkedRun(first, { type: 'claim', deviceId: 'device-a', credentialVersion: 3, nowMs: now + 31_000, leaseMs: 30_000 })
    expect(retried).toEqual(expect.objectContaining({ requestId: first.requestId, attempt: 2 }))
  })

  it('denies cross-device, stale credential and out-of-order completion while making duplicate completion idempotent', () => {
    expect(() => transitionLinkedRun(queued(), { type: 'claim', deviceId: 'device-b', credentialVersion: 3, nowMs: now, leaseMs: 30_000 })).toThrow('device mismatch')
    expect(() => transitionLinkedRun(queued(), { type: 'claim', deviceId: 'device-a', credentialVersion: 2, nowMs: now, leaseMs: 30_000 })).toThrow('credential mismatch')
    expect(() => transitionLinkedRun(queued(), { type: 'complete', deviceId: 'device-a', credentialVersion: 3, nowMs: now, outcome: 'completed' })).toThrow('not claimed')
    const done = transitionLinkedRun(transitionLinkedRun(queued(), { type: 'claim', deviceId: 'device-a', credentialVersion: 3, nowMs: now, leaseMs: 30_000 }), { type: 'complete', deviceId: 'device-a', credentialVersion: 3, nowMs: now + 1, outcome: 'completed' })
    expect(transitionLinkedRun(done, { type: 'complete', deviceId: 'device-a', credentialVersion: 3, nowMs: now + 2, outcome: 'completed' })).toEqual(done)
  })

  it('requires an Ed25519 receipt bound to the exact job request mapping and credential', () => {
    const keys = generateKeyPairSync('ed25519')
    const receipt = { jobId: 'job-1', requestId: 'request-1234567890', deviceId: 'device-a', mappingId: 'mapping-a', credentialVersion: 3, attempt: 1, event: 'accepted' as const, timestamp: new Date(now).toISOString(), signature: '' }
    receipt.signature = sign(null, Buffer.from(linkedRunReceiptPayload(receipt)), keys.privateKey).toString('base64url')
    expect(requireLinkedRunReceipt(queued(), receipt, keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(), now)).toEqual(receipt)
    expect(() => requireLinkedRunReceipt(queued(), { ...receipt, mappingId: 'other' }, keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(), now)).toThrow('receipt mismatch')
  })
})
