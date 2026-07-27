/** @jest-environment node */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash, generateKeyPairSync, verify } from 'node:crypto'
import { MappingRegistry } from '../../runtime-installers/runtime/bridge'
import { linkedRuntimeWorkbenchClaimBody } from '../../runtime-installers/runtime/cli'
import {
  WorkbenchConflictError,
  executeWorkbenchJob,
  executeWorkbenchOperation,
  pollWorkbenchForever,
  type WorkbenchRuntimeJob,
} from '../../runtime-installers/runtime/workbench'

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

function mappedWorkspace() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-workbench-'))
  const root = path.join(temporary, 'workspace')
  fs.mkdirSync(root)
  const registry = new MappingRegistry(path.join(temporary, 'mappings.json'))
  registry.map('mapping-a', root)
  return { temporary, root, registry }
}

function job(input: Record<string, unknown>): WorkbenchRuntimeJob {
  const { kind = 'fs.list', path: operationPath = '', content, expectedSha256, staged, argv, cwd, timeoutMs, query, entryType, limit } = input
  return {
    jobId: 'job-a',
    requestId: 'request-a',
    mappingId: 'mapping-a',
    relativeFolder: '',
    attempt: 1,
    leaseToken: 'lease-token-1234567890',
    kind,
    operation: {
      kind,
      ...(kind !== 'git.status' && kind !== 'shell.exec' ? { path: operationPath } : {}),
      ...(content !== undefined ? { content } : {}),
      ...(Object.prototype.hasOwnProperty.call(input, 'expectedSha256') ? { expectedSha256 } : {}),
      ...(staged !== undefined ? { staged } : {}),
      ...(argv !== undefined ? { argv } : {}),
      ...(cwd !== undefined ? { cwd } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(query !== undefined ? { query } : {}),
      ...(entryType !== undefined ? { entryType } : {}),
      ...(limit !== undefined ? { limit } : {}),
    },
    ...input,
    path: undefined,
    content: undefined,
    expectedSha256: undefined,
    staged: undefined,
    argv: undefined,
    cwd: undefined,
    timeoutMs: undefined,
    query: undefined,
    entryType: undefined,
    limit: undefined,
  } as unknown as WorkbenchRuntimeJob
}

describe('safe typed linked-computer workbench executor', () => {
  it('lists and reads bounded text files from the mapped root', async () => {
    const { root, registry } = mappedWorkspace()
    fs.mkdirSync(path.join(root, 'src'))
    fs.writeFileSync(path.join(root, 'src', 'index.ts'), 'export const ready = true\n')

    await expect(executeWorkbenchOperation(job({ kind: 'fs.list', path: 'src' }), registry)).resolves.toEqual({
      entries: [{ path: 'src/index.ts', type: 'file', size: 26 }],
    })
    await expect(executeWorkbenchOperation(job({ kind: 'fs.read', path: 'src/index.ts' }), registry)).resolves.toEqual({
      content: 'export const ready = true\n',
      sha256: sha256('export const ready = true\n'),
    })
  })

  it('searches files and folders recursively while skipping heavy generated trees', async () => {
    const { root, registry } = mappedWorkspace()
    fs.mkdirSync(path.join(root, 'apps', 'rmicdev'), { recursive: true })
    fs.writeFileSync(path.join(root, 'apps', 'rmicdev', 'config.ts'), 'ok')
    fs.mkdirSync(path.join(root, 'node_modules', 'rmicdev-hidden'), { recursive: true })

    await expect(executeWorkbenchOperation(job({
      kind: 'fs.search', query: 'rmicdev', entryType: 'directory', limit: 8,
    }), registry)).resolves.toEqual({
      entries: [{ path: 'apps/rmicdev', type: 'directory' }],
    })
    await expect(executeWorkbenchOperation(job({
      kind: 'fs.search', query: 'config', entryType: 'file', limit: 8,
    }), registry)).resolves.toEqual({
      entries: [{ path: 'apps/rmicdev/config.ts', type: 'file', size: 2 }],
    })
  })

  it('uses an authorised company sibling as the Workbench search root', async () => {
    const { temporary, root, registry } = mappedWorkspace()
    const company = path.join(temporary, 'Loyalty Plus')
    fs.mkdirSync(path.join(company, 'rmicdev'), { recursive: true })
    const companyJob = job({
      kind: 'fs.search',
      query: 'rmicdev',
      entryType: 'directory',
      workingDirectory: company,
    })
    await expect(executeWorkbenchOperation(companyJob, registry)).resolves.toEqual({
      entries: [{ path: 'rmicdev', type: 'directory' }],
    })
    expect(root).not.toBe(company)
  })

  it.each(['../outside', '/etc/passwd', 'C:\\Windows\\system.ini', 'C:relative', '\\\\server\\share', 'src\\index.ts'])(
    'rejects unsafe path %s before filesystem access',
    async (unsafePath) => {
      const { registry } = mappedWorkspace()
      await expect(executeWorkbenchOperation(job({ kind: 'fs.read', path: unsafePath }), registry)).rejects.toThrow(/unsafe workbench path/i)
    },
  )

  it('rejects malformed claim bindings before resolving a mapping or operation', async () => {
    const { registry } = mappedWorkspace()
    await expect(executeWorkbenchOperation(job({ kind: 'fs.list', path: '', leaseToken: 'short' }), registry)).rejects.toThrow(/invalid workbench claim/i)
    await expect(executeWorkbenchOperation(job({ kind: 'fs.list', path: '', attempt: 0 }), registry)).rejects.toThrow(/invalid workbench claim/i)
    await expect(executeWorkbenchOperation(job({ kind: 'fs.list', path: '', mappingId: '../mapping' }), registry)).rejects.toThrow(/invalid workbench claim/i)
  })

  it('rejects symlink escapes, binary reads, oversized reads, and excessive directory listings', async () => {
    const { temporary, root, registry } = mappedWorkspace()
    const outside = path.join(temporary, 'outside.txt')
    fs.writeFileSync(outside, 'private')
    fs.symlinkSync(outside, path.join(root, 'escape.txt'))
    fs.writeFileSync(path.join(root, 'binary.dat'), Buffer.from([0x61, 0x00, 0x62]))
    fs.writeFileSync(path.join(root, 'large.txt'), '12345')
    fs.mkdirSync(path.join(root, 'many'))
    fs.writeFileSync(path.join(root, 'many', 'a'), 'a')
    fs.writeFileSync(path.join(root, 'many', 'b'), 'b')

    await expect(executeWorkbenchOperation(job({ kind: 'fs.read', path: 'escape.txt' }), registry)).rejects.toThrow(/containment|symlink/i)
    await expect(executeWorkbenchOperation(job({ kind: 'fs.read', path: 'binary.dat' }), registry)).rejects.toThrow(/binary/i)
    await expect(executeWorkbenchOperation(job({ kind: 'fs.read', path: 'large.txt' }), registry, { maxFileBytes: 4 })).rejects.toThrow(/size limit/i)
    await expect(executeWorkbenchOperation(job({ kind: 'fs.list', path: 'many' }), registry, { maxListEntries: 1 })).rejects.toThrow(/entry limit/i)
  })

  it('atomically writes text only when the expected SHA-256 still matches', async () => {
    const { root, registry } = mappedWorkspace()
    const target = path.join(root, 'note.txt')
    fs.writeFileSync(target, 'before')
    const rename = jest.spyOn(fs, 'renameSync')

    await expect(executeWorkbenchOperation(job({
      kind: 'fs.write',
      path: 'note.txt',
      content: 'after',
      expectedSha256: sha256('before'),
    }), registry)).resolves.toEqual({
      bytesWritten: 5,
      sha256: sha256('after'),
    })
    expect(fs.readFileSync(target, 'utf8')).toBe('after')
    expect(rename).toHaveBeenCalledWith(expect.stringMatching(/\.tmp$/), fs.realpathSync(target))
    expect(fs.readdirSync(root)).toEqual(['note.txt'])
    rename.mockRestore()

    await expect(executeWorkbenchOperation(job({
      kind: 'fs.write',
      path: 'note.txt',
      content: 'clobber',
      expectedSha256: sha256('before'),
    }), registry)).rejects.toBeInstanceOf(WorkbenchConflictError)
    expect(fs.readFileSync(target, 'utf8')).toBe('after')
  })

  it('supports a null expected hash for atomic create and rejects binary or oversized write content', async () => {
    const { root, registry } = mappedWorkspace()
    await executeWorkbenchOperation(job({ kind: 'fs.write', path: 'new.txt', content: 'new', expectedSha256: null }), registry)
    expect(fs.readFileSync(path.join(root, 'new.txt'), 'utf8')).toBe('new')
    await expect(executeWorkbenchOperation(job({ kind: 'fs.write', path: 'missing.txt', content: 'x', expectedSha256: sha256('') }), registry)).rejects.toBeInstanceOf(WorkbenchConflictError)
    await expect(executeWorkbenchOperation(job({ kind: 'fs.write', path: 'nul.txt', content: 'a\0b', expectedSha256: null }), registry)).rejects.toThrow(/binary/i)
    await expect(executeWorkbenchOperation(job({ kind: 'fs.write', path: 'large.txt', content: '12345', expectedSha256: null }), registry, { maxFileBytes: 4 })).rejects.toThrow(/size limit/i)
  })

  it('parses staged, unstaged, untracked, deleted, and renamed git status and returns bounded diffs', async () => {
    const { root, registry } = mappedWorkspace()
    execFileSync('git', ['init', '--quiet'], { cwd: root })
    execFileSync('git', ['config', 'user.email', 'runtime@test.invalid'], { cwd: root })
    execFileSync('git', ['config', 'user.name', 'Runtime Test'], { cwd: root })
    for (const [name, content] of [['tracked.txt', 'base\n'], ['delete.txt', 'delete\n'], ['rename-old.txt', 'rename\n']]) {
      fs.writeFileSync(path.join(root, name), content)
    }
    execFileSync('git', ['add', '.'], { cwd: root })
    execFileSync('git', ['commit', '--quiet', '-m', 'base'], { cwd: root })
    fs.appendFileSync(path.join(root, 'tracked.txt'), 'unstaged\n')
    fs.rmSync(path.join(root, 'delete.txt'))
    execFileSync('git', ['mv', 'rename-old.txt', 'rename-new.txt'], { cwd: root })
    fs.writeFileSync(path.join(root, 'staged.txt'), 'staged\n')
    execFileSync('git', ['add', 'staged.txt'], { cwd: root })
    fs.writeFileSync(path.join(root, 'untracked.txt'), 'untracked\n')

    const status = await executeWorkbenchOperation(job({ kind: 'git.status' }), registry)
    expect(status).toEqual({
      changes: expect.arrayContaining([
        expect.objectContaining({ path: 'tracked.txt', status: 'modified', staged: false, unstaged: true }),
        expect.objectContaining({ path: 'delete.txt', status: 'deleted', staged: false, unstaged: true }),
        expect.objectContaining({ path: 'rename-new.txt', originalPath: 'rename-old.txt', status: 'renamed', staged: true, unstaged: false }),
        expect.objectContaining({ path: 'staged.txt', status: 'added', staged: true, unstaged: false }),
        expect.objectContaining({ path: 'untracked.txt', status: 'untracked', staged: false, unstaged: true }),
      ]),
    })

    const unstaged = await executeWorkbenchOperation(job({ kind: 'git.diff', path: 'tracked.txt', staged: false }), registry)
    expect(unstaged).toEqual(expect.objectContaining({ diff: expect.stringContaining('+unstaged') }))
    const staged = await executeWorkbenchOperation(job({ kind: 'git.diff', path: 'staged.txt', staged: true }), registry)
    expect(staged).toEqual(expect.objectContaining({ diff: expect.stringContaining('+staged') }))

    await expect(executeWorkbenchOperation(job({ kind: 'git.diff', path: '', staged: false }), registry, { maxGitOutputBytes: 8 })).rejects.toThrow(/output limit/i)
  })

  it('does not let git discover a repository or git directory outside the mapped root', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-workbench-git-boundary-'))
    execFileSync('git', ['init', '--quiet'], { cwd: temporary })
    const nested = path.join(temporary, 'nested')
    fs.mkdirSync(nested)
    const registry = new MappingRegistry(path.join(temporary, 'mappings.json'))
    registry.map('mapping-a', nested)
    await expect(executeWorkbenchOperation(job({ kind: 'git.status' }), registry)).rejects.toThrow(/repository boundary/i)

    const outsideGit = path.join(temporary, '.git')
    fs.symlinkSync(outsideGit, path.join(nested, '.git'))
    await expect(executeWorkbenchOperation(job({ kind: 'git.status' }), registry)).rejects.toThrow(/repository boundary|symlink/i)
  })

  it('uses the signed device completion protocol without a Hermes execution dependency', async () => {
    const { root, registry } = mappedWorkspace()
    fs.writeFileSync(path.join(root, 'readme.txt'), 'hello')
    const keys = generateKeyPairSync('ed25519')
    const posts: Array<[string, Record<string, unknown>]> = []
    const post = jest.fn(async (endpoint: string, body: Record<string, unknown>) => {
      posts.push([endpoint, body])
      return new Response('', { status: 200 })
    })
    const device = {
      deviceId: 'device-a',
      credentialVersion: 4,
      privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    }

    const result = await executeWorkbenchJob(job({ kind: 'fs.read', path: 'readme.txt', attempt: 2, leaseToken: 'lease-token-2345678901' }), device, registry, post)
    expect(result.status).toBe('completed')
    expect(post).toHaveBeenCalledTimes(1)
    expect(posts[0][0]).toBe('/workbench/jobs/job-a/complete')
    const body = posts[0][1] as any
    expect(body).toEqual(expect.objectContaining({
      attempt: 2, leaseToken: 'lease-token-2345678901', outcome: 'completed',
      result: expect.objectContaining({ content: 'hello' }),
    }))
    expect(body.receipt).toEqual(expect.objectContaining({
      jobId: 'job-a',
      requestId: 'request-a',
      deviceId: 'device-a',
      mappingId: 'mapping-a',
      credentialVersion: 4,
      attempt: 2,
      leaseToken: 'lease-token-2345678901',
      event: 'completed',
      outcome: 'completed',
      signature: expect.any(String),
    }))
    const receipt = body.receipt
    const payload = [
      receipt.jobId, receipt.requestId, receipt.deviceId, receipt.mappingId, String(receipt.credentialVersion),
      String(receipt.attempt), receipt.leaseToken, receipt.event, receipt.outcome, receipt.timestamp,
      receipt.acceptedAt, receipt.toolStartedAt, receipt.runtimeVersion, receipt.machineLabel,
      receipt.outputSha256, String(receipt.outputBytes), receipt.errorSha256, String(receipt.errorBytes),
    ].join('\n')
    expect(verify(null, Buffer.from(payload), keys.publicKey, Buffer.from(receipt.signature, 'base64url'))).toBe(true)
  })

  it('posts a bounded signed failure and retries completion delivery', async () => {
    const { root, registry } = mappedWorkspace()
    fs.writeFileSync(path.join(root, 'note.txt'), 'current')
    const keys = generateKeyPairSync('ed25519')
    let attempts = 0
    const post = jest.fn(async () => new Response('', { status: attempts++ === 0 ? 503 : 200 }))
    const result = await executeWorkbenchJob(job({
      kind: 'fs.write', path: 'note.txt', content: 'new', expectedSha256: sha256('stale'),
    }), {
      deviceId: 'device-a', credentialVersion: 1,
      privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    }, registry, post, { retryDelayMs: 0 })

    expect(result.status).toBe('failed')
    expect(result.error).toMatch(/stale/i)
    expect(result.error.length).toBeLessThanOrEqual(400)
    expect(post).toHaveBeenCalledTimes(2)
    expect(fs.readFileSync(path.join(root, 'note.txt'), 'utf8')).toBe('current')
  })

  it('polls typed jobs independently and advertises the exact Phase 2 claim protocol', async () => {
    expect(linkedRuntimeWorkbenchClaimBody()).toEqual({ runtimeVersion: expect.any(String), workbenchProtocolVersion: 1 })
    const claimed = job({ kind: 'fs.list', path: '' })
    const run = jest.fn(async () => undefined)
    let claims = 0
    await pollWorkbenchForever(async () => (++claims === 1 ? claimed : null), run, () => claims > 1, async () => undefined)
    expect(run).toHaveBeenCalledWith(claimed)
  })
})

describe('safe typed linked-computer workbench shell.exec executor', () => {
  it('runs an allowlisted command jailed to the mapped root and returns exit code 0', async () => {
    const { root, registry } = mappedWorkspace()
    fs.writeFileSync(path.join(root, 'marker.txt'), 'hi')
    const result = await executeWorkbenchOperation(job({ kind: 'shell.exec', argv: ['ls', '-la'] }), registry) as { exitCode: number; stdout: string; stderr: string }
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('marker.txt')
    expect(result.stderr).toBe('')
  })

  it('rejects a command whose argv is not on the exact-match allowlist', async () => {
    const { registry } = mappedWorkspace()
    await expect(executeWorkbenchOperation(job({ kind: 'shell.exec', argv: ['rm', '-rf', '/'] }), registry)).rejects.toThrow(/not allowlisted/i)
    await expect(executeWorkbenchOperation(job({ kind: 'shell.exec', argv: ['ls', '-la', '/etc'] }), registry)).rejects.toThrow(/not allowlisted/i)
    await expect(executeWorkbenchOperation(job({ kind: 'shell.exec', argv: [] }), registry)).rejects.toThrow(/non-empty/i)
  })

  it('rejects a shell.exec cwd that escapes the mapped root via traversal or symlink', async () => {
    const { temporary, root, registry } = mappedWorkspace()
    const outside = path.join(temporary, 'outside')
    fs.mkdirSync(outside)
    fs.symlinkSync(outside, path.join(root, 'escape-dir'))

    await expect(executeWorkbenchOperation(job({ kind: 'shell.exec', argv: ['ls', '-la'], cwd: '../outside' }), registry)).rejects.toThrow(/unsafe workbench path/i)
    await expect(executeWorkbenchOperation(job({ kind: 'shell.exec', argv: ['ls', '-la'], cwd: 'escape-dir' }), registry)).rejects.toThrow(/containment|symlink/i)
    await expect(executeWorkbenchOperation(job({ kind: 'shell.exec', argv: ['ls', '-la'], cwd: 'missing-dir' }), registry)).rejects.toThrow(/does not exist/i)
  })

  it('returns a non-zero exit code as a completed result instead of throwing', async () => {
    const { registry } = mappedWorkspace()
    const result = await executeWorkbenchOperation(job({ kind: 'shell.exec', argv: ['git', 'branch', '--show-current'] }), registry) as { exitCode: number; stdout: string; stderr: string }
    expect(result.exitCode).not.toBe(0)
    expect(Number.isSafeInteger(result.exitCode)).toBe(true)
    expect(result.stderr.toLowerCase()).toContain('not a git repository')
  })

  it('streams best-effort progress chunks and posts a completed receipt via executeWorkbenchJob', async () => {
    const { root, registry } = mappedWorkspace()
    fs.writeFileSync(path.join(root, 'marker.txt'), 'hi')
    const keys = generateKeyPairSync('ed25519')
    const posts: Array<[string, Record<string, unknown>]> = []
    const post = jest.fn(async (endpoint: string, body: Record<string, unknown>) => {
      posts.push([endpoint, body])
      return new Response('', { status: 200 })
    })
    const device = {
      deviceId: 'device-a',
      credentialVersion: 1,
      privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    }

    const result = await executeWorkbenchJob(job({ kind: 'shell.exec', argv: ['ls', '-la'] }), device, registry, post)
    expect(result.status).toBe('completed')
    expect(result.result).toEqual(expect.objectContaining({ exitCode: 0, stdout: expect.stringContaining('marker.txt') }))
    const completion = posts.find(([endpoint]) => endpoint.endsWith('/complete'))
    expect(completion).toBeDefined()
    const progress = posts.filter(([endpoint]) => endpoint.endsWith('/progress'))
    for (const [, body] of progress) {
      expect(body).toEqual(expect.objectContaining({
        attempt: 1,
        leaseToken: expect.any(String),
        chunk: expect.objectContaining({
          seq: expect.any(Number),
          stream: expect.stringMatching(/stdout|stderr/),
          text: expect.any(String),
          atMs: expect.any(Number),
        }),
      }))
    }
  })
})
