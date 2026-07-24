import {
  parseWorkbenchOperation,
  publicWorkbenchJob,
  sanitizeWorkbenchRelativePath,
  transitionWorkbenchJob,
  type WorkbenchJob,
} from '@/lib/messages/workbench/jobs'

function queuedJob(overrides: Partial<WorkbenchJob> = {}): WorkbenchJob {
  return {
    jobId: 'job-a',
    idempotencyKey: 'idem-12345678',
    requestFingerprint: 'fingerprint-a',
    conversationId: 'conversation-a',
    orgId: 'org-a',
    actorUserId: 'user-a',
    actorRole: 'client',
    deviceId: 'device-a',
    runtimeTargetId: 'runtime-a',
    credentialVersion: 3,
    workspaceId: 'workspace-a',
    mappingId: 'mapping-a',
    relativeFolder: 'projects/project-a',
    kind: 'fs.list',
    status: 'queued',
    attempt: 0,
    encryptedOperation: { ciphertext: 'cipher', iv: 'iv', tag: 'tag' },
    encryptedResult: null,
    createdAtMs: 1_000,
    updatedAtMs: 1_000,
    expiresAtMs: 100_000,
    ...overrides,
  }
}

describe('workbench operation validation', () => {
  it.each([
    [{ kind: 'fs.list', path: '.' }, { kind: 'fs.list', path: '.' }],
    [{ kind: 'fs.read', path: 'src/index.ts' }, { kind: 'fs.read', path: 'src/index.ts' }],
    [{ kind: 'fs.write', path: 'src/index.ts', content: 'next' }, { kind: 'fs.write', path: 'src/index.ts', content: 'next' }],
    [{ kind: 'git.status' }, { kind: 'git.status' }],
    [{ kind: 'git.diff', path: 'src/index.ts', staged: true }, { kind: 'git.diff', path: 'src/index.ts', staged: true }],
  ])('accepts typed operation %j', (input, expected) => {
    expect(parseWorkbenchOperation(input)).toEqual(expected)
  })

  it.each([
    { kind: 'shell', command: 'git status' },
    { kind: 'fs.read', path: '/etc/passwd' },
    { kind: 'fs.write', path: '../secret', content: 'x' },
    { kind: 'fs.write', path: 'safe.txt' },
    { kind: 'git.diff', path: 'C:\\Windows\\secret' },
    { kind: 'git.status', command: 'git status' },
  ])('rejects unsafe or untyped operation %j', (input) => {
    expect(() => parseWorkbenchOperation(input)).toThrow('workbench: invalid operation')
  })

  it('accepts root only for directory listing and normalizes safe paths', () => {
    expect(sanitizeWorkbenchRelativePath('.', { allowRoot: true })).toBe('.')
    expect(sanitizeWorkbenchRelativePath('.', { allowRoot: false })).toBeNull()
    expect(sanitizeWorkbenchRelativePath('src//lib/jobs.ts')).toBe('src/lib/jobs.ts')
  })
})

describe('workbench queue transitions', () => {
  it('requires explicit approval before a write can enter the claimable queue', () => {
    const awaiting = queuedJob({ kind: 'fs.write', status: 'awaiting_approval' })
    expect(() => transitionWorkbenchJob(awaiting, {
      type: 'claim', deviceId: 'device-a', credentialVersion: 3, nowMs: 2_000, leaseMs: 30_000,
    })).toThrow('workbench: approval required')

    const approved = transitionWorkbenchJob(awaiting, {
      type: 'approve', approverUserId: 'user-a', nowMs: 2_000,
    })
    expect(approved).toMatchObject({
      status: 'queued', approvedByUserId: 'user-a', approvedAtMs: 2_000,
    })
  })

  it('leases jobs and rejects completion with a stale lease', () => {
    const claimed = transitionWorkbenchJob(queuedJob(), {
      type: 'claim', deviceId: 'device-a', credentialVersion: 3, nowMs: 2_000, leaseMs: 30_000,
    })
    expect(claimed.status).toBe('claimed')
    expect(claimed.attempt).toBe(1)
    expect(claimed.leaseToken).toEqual(expect.any(String))

    expect(() => transitionWorkbenchJob(claimed, {
      type: 'complete', deviceId: 'device-a', credentialVersion: 3, attempt: 1,
      leaseToken: 'stale-lease', outcome: 'completed', nowMs: 3_000,
    })).toThrow('workbench: lease mismatch')
  })

  it('never exposes encrypted payloads, credentials, or physical paths to the browser', () => {
    const view = publicWorkbenchJob(queuedJob({
      result: { entries: [] },
      approvedByUserId: 'user-a',
      approvedAtMs: 2_000,
    }))
    expect(view).toMatchObject({ jobId: 'job-a', kind: 'fs.list', status: 'queued' })
    expect(JSON.stringify(view)).not.toMatch(/encrypted|credential|relativeFolder|Users\//i)
  })
})
