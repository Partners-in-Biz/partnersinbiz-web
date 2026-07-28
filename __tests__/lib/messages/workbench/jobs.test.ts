import {
  appendWorkbenchProgressChunk,
  canonicalWorkbenchWorkspaceRelativePath,
  parseWorkbenchOperation,
  parseWorkbenchProgressChunk,
  parseWorkbenchResult,
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
    [
      { kind: 'fs.search', query: 'rmicdev', entryType: 'directory', limit: 8 },
      { kind: 'fs.search', query: 'rmicdev', entryType: 'directory', limit: 8 },
    ],
    [{ kind: 'fs.read', path: 'src/index.ts' }, { kind: 'fs.read', path: 'src/index.ts' }],
    [{ kind: 'fs.write', path: 'src/index.ts', content: 'next' }, { kind: 'fs.write', path: 'src/index.ts', content: 'next' }],
    [{ kind: 'git.status' }, { kind: 'git.status' }],
    [{ kind: 'git.diff', path: 'src/index.ts', staged: true }, { kind: 'git.diff', path: 'src/index.ts', staged: true }],
    [{ kind: 'shell.exec', argv: ['node', '--version'] }, { kind: 'shell.exec', argv: ['node', '--version'], timeoutMs: 30_000 }],
    [
      { kind: 'shell.exec', argv: ['git', 'log', '--oneline', '-n', '20'], cwd: 'src', timeoutMs: 5_000 },
      { kind: 'shell.exec', argv: ['git', 'log', '--oneline', '-n', '20'], cwd: 'src', timeoutMs: 5_000 },
    ],
  ])('accepts typed operation %j', (input, expected) => {
    expect(parseWorkbenchOperation(input)).toEqual(expected)
  })

  it('clamps shell.exec timeoutMs into the 1000..60000 range', () => {
    expect(parseWorkbenchOperation({ kind: 'shell.exec', argv: ['node', '--version'], timeoutMs: 1 }))
      .toMatchObject({ timeoutMs: 1_000 })
    expect(parseWorkbenchOperation({ kind: 'shell.exec', argv: ['node', '--version'], timeoutMs: 999_999 }))
      .toMatchObject({ timeoutMs: 60_000 })
  })

  it('accepts a signed safe custom allowlist and rejects unsafe policy payloads', () => {
    expect(parseWorkbenchOperation({
      kind: 'shell.exec',
      argv: ['npm', 'run', 'typecheck'],
      allowedShellArgv: [['npm', 'run', 'typecheck']],
    })).toMatchObject({
      argv: ['npm', 'run', 'typecheck'],
      allowedShellArgv: [['npm', 'run', 'typecheck']],
    })
    expect(() => parseWorkbenchOperation({
      kind: 'shell.exec',
      argv: ['sh', '-c', 'whoami'],
      allowedShellArgv: [['sh', '-c', 'whoami']],
    })).toThrow('workbench: invalid operation')
  })

  it.each([
    { kind: 'shell', command: 'git status' },
    { kind: 'fs.read', path: '/etc/passwd' },
    { kind: 'fs.write', path: '../secret', content: 'x' },
    { kind: 'fs.write', path: 'safe.txt' },
    { kind: 'git.diff', path: 'C:\\Windows\\secret' },
    { kind: 'git.status', command: 'git status' },
    { kind: 'shell.exec', argv: ['rm', '-rf', '/'] },
    { kind: 'shell.exec', argv: ['sh', '-c', 'echo hi'] },
    { kind: 'shell.exec', argv: ['node', '--version'], cwd: '../escape' },
    { kind: 'shell.exec', argv: ['node', '--version'], extra: true },
    { kind: 'shell.exec', argv: [] },
    { kind: 'fs.search', query: '', entryType: 'file' },
    { kind: 'fs.search', query: 'src', entryType: 'symlink' },
    { kind: 'fs.search', query: 'src', entryType: 'directory', limit: 21 },
  ])('rejects unsafe or untyped operation %j', (input) => {
    expect(() => parseWorkbenchOperation(input)).toThrow('workbench: invalid operation')
  })

  it('accepts root only for directory listing and normalizes safe paths', () => {
    expect(sanitizeWorkbenchRelativePath('.', { allowRoot: true })).toBe('.')
    expect(sanitizeWorkbenchRelativePath('.', { allowRoot: false })).toBeNull()
    expect(sanitizeWorkbenchRelativePath('src//lib/jobs.ts')).toBe('src/lib/jobs.ts')
  })

  it('canonicalizes legacy empty workspace roots to the Workbench root', () => {
    expect(canonicalWorkbenchWorkspaceRelativePath('')).toBe('.')
    expect(canonicalWorkbenchWorkspaceRelativePath('   ')).toBe('.')
    expect(canonicalWorkbenchWorkspaceRelativePath(undefined)).toBe('.')
    expect(canonicalWorkbenchWorkspaceRelativePath('clients/acme')).toBe('clients/acme')
  })
})

describe('workbench result validation', () => {
  it('accepts a shell.exec result with stdout/stderr/exitCode', () => {
    expect(parseWorkbenchResult('shell.exec', { stdout: 'v20.0.0\n', stderr: '', exitCode: 0 }))
      .toEqual({ stdout: 'v20.0.0\n', stderr: '', exitCode: 0 })
  })

  it('preserves optional truncated/durationMs fields on a shell.exec result', () => {
    expect(parseWorkbenchResult('shell.exec', {
      stdout: 'a'.repeat(10), stderr: '', exitCode: 1, truncated: true, durationMs: 42,
    })).toEqual({ stdout: 'a'.repeat(10), stderr: '', exitCode: 1, truncated: true, durationMs: 42 })
  })

  it.each([
    { stdout: 1, stderr: '', exitCode: 0 },
    { stdout: '', stderr: 1, exitCode: 0 },
    { stdout: '', stderr: '', exitCode: 'zero' },
    { stdout: '', stderr: '', exitCode: 0, durationMs: -1 },
  ])('rejects malformed shell.exec results %j', (result) => {
    expect(() => parseWorkbenchResult('shell.exec', result)).toThrow('workbench: invalid result')
  })
})

describe('workbench progress chunks', () => {
  it('validates and truncates an oversized chunk to 2KB', () => {
    const chunk = parseWorkbenchProgressChunk({ seq: 0, stream: 'stdout', text: 'x'.repeat(5_000), atMs: 1_000 })
    expect(chunk.seq).toBe(0)
    expect(chunk.stream).toBe('stdout')
    expect(Buffer.byteLength(chunk.text, 'utf8')).toBe(2_000)
    expect(chunk.atMs).toBe(1_000)
  })

  it.each([
    { seq: -1, stream: 'stdout', text: 'x', atMs: 1 },
    { seq: 0, stream: 'weird', text: 'x', atMs: 1 },
    { seq: 0, stream: 'stdout', text: 1, atMs: 1 },
    { seq: 0, stream: 'stdout', text: 'x', atMs: -1 },
  ])('rejects malformed progress chunks %j', (chunk) => {
    expect(() => parseWorkbenchProgressChunk(chunk)).toThrow('workbench: invalid progress chunk')
  })

  it('caps the ring buffer at 64 chunks, dropping the oldest first', () => {
    let chunks: ReturnType<typeof appendWorkbenchProgressChunk> | undefined
    for (let seq = 0; seq < 70; seq += 1) {
      chunks = appendWorkbenchProgressChunk(chunks, { seq, stream: 'stdout', text: `line-${seq}`, atMs: seq })
    }
    expect(chunks).toHaveLength(64)
    expect(chunks![0].seq).toBe(6)
    expect(chunks![63].seq).toBe(69)
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

  it('renews the lease on progress without changing status or attempt', () => {
    const claimed = transitionWorkbenchJob(queuedJob({ kind: 'shell.exec' }), {
      type: 'claim', deviceId: 'device-a', credentialVersion: 3, nowMs: 2_000, leaseMs: 30_000,
    })
    const progressed = transitionWorkbenchJob(claimed, {
      type: 'progress', deviceId: 'device-a', credentialVersion: 3,
      attempt: claimed.attempt, leaseToken: claimed.leaseToken!, nowMs: 5_000, leaseMs: 30_000,
    })
    expect(progressed.status).toBe('claimed')
    expect(progressed.attempt).toBe(claimed.attempt)
    expect(progressed.leaseToken).toBe(claimed.leaseToken)
    expect(progressed.leaseExpiresAtMs).toBe(35_000)
  })

  it('rejects progress with a stale lease or on an unclaimed job', () => {
    const claimed = transitionWorkbenchJob(queuedJob({ kind: 'shell.exec' }), {
      type: 'claim', deviceId: 'device-a', credentialVersion: 3, nowMs: 2_000, leaseMs: 30_000,
    })
    expect(() => transitionWorkbenchJob(claimed, {
      type: 'progress', deviceId: 'device-a', credentialVersion: 3,
      attempt: claimed.attempt, leaseToken: 'stale-lease', nowMs: 5_000, leaseMs: 30_000,
    })).toThrow('workbench: lease mismatch')

    expect(() => transitionWorkbenchJob(queuedJob({ kind: 'shell.exec' }), {
      type: 'progress', deviceId: 'device-a', credentialVersion: 3,
      attempt: 0, leaseToken: 'none', nowMs: 5_000, leaseMs: 30_000,
    })).toThrow('workbench: job not claimed')
  })

  it('exposes queued progress chunks (but nothing else new) on the public job view', () => {
    const view = publicWorkbenchJob(queuedJob({
      kind: 'shell.exec',
      operation: { kind: 'shell.exec', argv: ['node', '--version'], timeoutMs: 30_000 },
      progressChunks: [{ seq: 0, stream: 'stdout', text: 'v20.0.0\n', atMs: 1_000 }],
    }))
    expect(view.progress).toEqual([{ seq: 0, stream: 'stdout', text: 'v20.0.0\n', atMs: 1_000 }])
    expect(JSON.stringify(view)).not.toMatch(/encrypted|credential/i)
  })
})
