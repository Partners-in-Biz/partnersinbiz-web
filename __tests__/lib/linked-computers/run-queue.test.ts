import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import {
  decryptLinkedRunPayload,
  encryptLinkedRunPayload,
  linkedRunReceiptPayload,
  publicClaimedLinkedRun,
  requireLinkedRunReceipt,
  transitionLinkedRun,
  sanitizeLinkedResult,
  type LinkedRunJob,
} from '@/lib/linked-computers/run-queue'

const now = Date.parse('2026-07-13T09:00:00.000Z')

function queued(overrides: Partial<LinkedRunJob> = {}): LinkedRunJob {
  return {
    jobId: 'job-1', requestId: 'request-1234567890', deviceId: 'device-a', runtimeTargetId: 'target-a',
    orgId: 'org-a', actorUserId: 'user-a', workspaceId: 'workspace-a', projectId: 'project-a', mappingId: 'mapping-a',
    relativeFolder: 'Projects/project-a', credentialVersion: 3, status: 'queued', attempt: 0,
    encryptedPayload: { ciphertext: 'cipher', iv: 'iv', tag: 'tag' },
    createdAtMs: now, updatedAtMs: now, queueExpiresAtMs: now + 2_700_000, expiresAtMs: now + 3_600_000,
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
    const running = { ...first, status: 'running' as const }
    expect(transitionLinkedRun(running, { type: 'claim', deviceId: 'device-a', credentialVersion: 3, nowMs: now + 31_000, leaseMs: 30_000 })).toEqual(expect.objectContaining({ attempt: 2, status: 'claimed' }))
  })

  it('delivers the selected agent identity to the linked computer', () => {
    const job = transitionLinkedRun(queued({ agentId: 'theo' }), { type: 'claim', deviceId: 'device-a', credentialVersion: 3, nowMs: now, leaseMs: 30_000 })
    expect(publicClaimedLinkedRun(job, { prompt: 'Run on Theo' })).toEqual(expect.objectContaining({
      agentId: 'theo',
      prompt: 'Run on Theo',
      actorUserId: 'user-a',
      orgId: 'org-a',
    }))
  })

  it('renews only the current worker lease and redacts secrets inline without wiping the reply', () => {
    const claimed = transitionLinkedRun(queued(), { type: 'claim', deviceId: 'device-a', credentialVersion: 3, nowMs: now, leaseMs: 30_000 })
    const progress = transitionLinkedRun(claimed, { type: 'progress', deviceId: 'device-a', credentialVersion: 3, nowMs: now + 20_000, attempt: 1, leaseToken: claimed.leaseToken!, leaseMs: 30_000 })
    expect(progress.leaseExpiresAtMs).toBe(now + 50_000)
    expect(() => transitionLinkedRun(progress, { type: 'progress', deviceId: 'device-a', credentialVersion: 3, nowMs: now + 21_000, attempt: 1, leaseToken: 'stale-worker', leaseMs: 30_000 })).toThrow('lease mismatch')
    const unsafe = 'Authorization: Bearer abc apiKey=xyz /etc/passwd C:\\Users\\Peet\\secret \\\\server\\share\\file PRIVATE KEY----- {"nested":{"token":"nested secret with \\\"escaped\\\" suffix"}}'
    const scrubbed = sanitizeLinkedResult(unsafe)
    expect(scrubbed).not.toMatch(/\babc\b|xyz|nested secret|PRIVATE KEY/i)
    expect(scrubbed).toContain('/etc/passwd')
    expect(scrubbed).toContain('Peet')
    expect(scrubbed).not.toBe('[redacted output]')
    expect(sanitizeLinkedResult('{"nested":{"password":"value with spaces and \\\"escapes\\\" trailing"}}')).not.toMatch(/value with|escapes|trailing/)
    expect(sanitizeLinkedResult(`safe prefix -----BEGIN PRIVATE KEY-----\n${'A'.repeat(200)}`)).not.toContain('AAAA')
    expect(sanitizeLinkedResult(`unlabelled ${'z9K_'.repeat(20)} tail`)).not.toContain('z9K_')
    const connections = 'DB_PASS="space secret" DATABASE_URL=postgres://user:p%40ss@db.internal:5432/app mysql://root:pw@host/db AUTH_TOKEN=abc123 CREDENTIAL_KEY="quoted escaped \\\"value\\\""'
    expect(sanitizeLinkedResult(connections)).not.toMatch(/space secret|postgres|user:|p%40ss|mysql|root:pw|abc123|quoted escaped|value/)
  })

  it('keeps scrubbed replies readable instead of wiping the whole message', () => {
    expect(sanitizeLinkedResult('Mailbox created. Password: Abc123! Send this to the client.'))
      .toBe('Mailbox created. Password: [redacted] Send this to the client.')
    expect(sanitizeLinkedResult('Authorization: Bearer abc123 done with setup'))
      .toBe('Authorization: [redacted] done with setup')
    expect(sanitizeLinkedResult('token: leftover-secret still present'))
      .toBe('token: [redacted] still present')
    // Residual odd values must never wipe the whole agent reply.
    const residual = sanitizeLinkedResult('broken password: ,,,, keep quiet')
    expect(residual).not.toBe('[redacted output]')
    expect(residual).toContain('keep quiet')
    // Ordinary prose about gates must stay fully readable.
    const prose = sanitizeLinkedResult(
      'Production credentials, production deployment, secret/config changes, and destructive actions remain gated.',
    )
    expect(prose).toContain('Production credentials')
    expect(prose).toContain('secret/config changes')
    expect(prose).not.toBe('[redacted output]')
  })

  it('keeps links and hosts readable; only credentialed or signed URLs are masked', () => {
    expect(sanitizeLinkedResult('Preview ready: https://partnersinbiz.online/portal/messages'))
      .toBe('Preview ready: https://partnersinbiz.online/portal/messages')
    expect(sanitizeLinkedResult('Deployed to https://example.com/docs/guide'))
      .toBe('Deployed to https://example.com/docs/guide')
    // Local/private hosts stay readable so operators can work from chat.
    expect(sanitizeLinkedResult('Local http://127.0.0.1:3000/admin ready'))
      .toBe('Local http://127.0.0.1:3000/admin ready')
    // Signed / credentialed URLs still hide by default (click-to-reveal).
    const signed = sanitizeLinkedResult('Signed https://storage.example.com/o/x?alt=media&token=abc123 keep going')
    expect(signed).toMatch(/^Signed \[\[pib-reveal:url\|[A-Za-z0-9_-]+\]\] keep going$/)
    expect(signed).not.toContain('token=abc123')
    const credentialed = sanitizeLinkedResult('Cred https://user:pass@evil.example/x done')
    expect(credentialed).toMatch(/\[\[pib-reveal:url\|/)
    expect(credentialed).not.toContain('user:pass')
    // Long path segments inside kept URLs must not be eaten by the token scrubber.
    const longPublic = `https://example.com/${'segment-'.repeat(8)}page`
    expect(sanitizeLinkedResult(`Open ${longPublic}`)).toBe(`Open ${longPublic}`)
  })

  it('keeps API endpoint paths and filesystem paths fully readable', () => {
    expect(sanitizeLinkedResult('GET /api/v1/countries listCountries'))
      .toBe('GET /api/v1/countries listCountries')
    expect(sanitizeLinkedResult('SystemService.listCountries() -> /api/land/countries'))
      .toBe('SystemService.listCountries() -> /api/land/countries')
    expect(sanitizeLinkedResult('{apiBaseUrl}/api/v1/ffqv/countries/dropdown'))
      .toBe('{apiBaseUrl}/api/v1/ffqv/countries/dropdown')
    expect(sanitizeLinkedResult('open /Users/peet/Cowork/foo/bar'))
      .toBe('open /Users/peet/Cowork/foo/bar')
    expect(sanitizeLinkedResult('file C:\\Users\\Peet\\secret\\file.txt'))
      .toBe('file C:\\Users\\Peet\\secret\\file.txt')
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

  it('verifies both legacy 1.1.19 receipts and signed 1.1.20 queued/run-id extensions', () => {
    const keys = generateKeyPairSync('ed25519')
    const empty = createHash('sha256').update('').digest('hex')
    const base = {
      jobId: 'job-1', requestId: 'request-1234567890', deviceId: 'device-a', mappingId: 'mapping-a',
      credentialVersion: 3, attempt: 1, leaseToken: 'lease-token-123456',
      timestamp: new Date(now).toISOString(), acceptedAt: new Date(now - 2).toISOString(),
      toolStartedAt: new Date(now - 1).toISOString(), runtimeVersion: '1.1.19', machineLabel: 'Office Mac',
      outputSha256: empty, outputBytes: 0, errorSha256: empty, errorBytes: 0,
    }
    const legacy = { ...base, event: 'accepted' as const, outcome: 'accepted' as const, signature: '' }
    legacy.signature = sign(null, Buffer.from(linkedRunReceiptPayload(legacy)), keys.privateKey).toString('base64url')
    const job = queued({ attempt: 1, leaseToken: base.leaseToken })
    expect(requireLinkedRunReceipt(job, legacy, keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(), now)).toEqual(legacy)

    const queuedReceipt = {
      ...base,
      runtimeVersion: '1.1.20',
      event: 'queued' as const,
      outcome: 'queued' as const,
      queueReason: 'gateway_draining' as const,
      signature: '',
    }
    queuedReceipt.signature = sign(null, Buffer.from(linkedRunReceiptPayload(queuedReceipt)), keys.privateKey).toString('base64url')
    expect(requireLinkedRunReceipt(job, queuedReceipt, keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(), now)).toEqual(queuedReceipt)

    const startingReceipt = {
      ...base,
      runtimeVersion: '1.1.23',
      event: 'queued' as const,
      outcome: 'queued' as const,
      signature: '',
    }
    startingReceipt.signature = sign(null, Buffer.from(linkedRunReceiptPayload(startingReceipt)), keys.privateKey).toString('base64url')
    expect(requireLinkedRunReceipt(job, startingReceipt, keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(), now)).toEqual(startingReceipt)

    const accepted = {
      ...base,
      runtimeVersion: '1.1.20',
      event: 'accepted' as const,
      outcome: 'accepted' as const,
      localHermesRunId: 'hermes-run-123',
      signature: '',
    }
    accepted.signature = sign(null, Buffer.from(linkedRunReceiptPayload(accepted)), keys.privateKey).toString('base64url')
    expect(requireLinkedRunReceipt(job, accepted, keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(), now)).toEqual(accepted)
  })
})
