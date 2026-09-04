import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MappingRegistry } from '@/runtime-installers/runtime/bridge'
import {
  DurableSyncSpool,
  WorkspaceSyncMonitor,
  applyWorkspaceSyncTransfer,
  clearWin32ReadOnlyAttribute,
  executeWorkspaceSyncJob,
  fromWin32LongPath,
  isWindowsJunction,
  nativeFsPath,
  nativeWorkspaceSyncSupported,
  scanWorkspaceMapping,
  toWin32LongPath,
} from '@/runtime-installers/runtime/workspace-sync'
import { buildProjectContentManifest } from '@/lib/project-sync/model'

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const posixOnly = process.platform !== 'win32'

function workspace() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-workspace-sync-'))
  const mappingRoot = path.join(temp, 'mapping')
  const runtimeState = path.join(temp, 'runtime-state')
  const projectRoot = path.join(mappingRoot, 'projects', 'project-a')
  fs.mkdirSync(projectRoot, { recursive: true })
  const registry = new MappingRegistry(path.join(temp, 'mappings.json'))
  registry.map('mapping-a', mappingRoot)
  return { temp, mappingRoot, projectRoot, runtimeState, registry }
}

describe('native workspace.sync scanner', () => {
  it('builds a deterministic manifest inside MappingRegistry while excluding generated and secret paths', async () => {
    const { projectRoot, runtimeState, registry } = workspace()
    fs.mkdirSync(path.join(projectRoot, 'src'))
    fs.writeFileSync(path.join(projectRoot, 'src', 'index.ts'), 'export const ready = true\n')
    fs.mkdirSync(path.join(projectRoot, '.git'))
    fs.writeFileSync(path.join(projectRoot, '.git', 'config'), 'private')
    fs.mkdirSync(path.join(projectRoot, 'node_modules'))
    fs.writeFileSync(path.join(projectRoot, 'node_modules', 'package.js'), 'generated')
    fs.writeFileSync(path.join(projectRoot, '.env'), 'SECRET=value')

    const manifest = await scanWorkspaceMapping({
      registry,
      mappingId: 'mapping-a',
      relativePath: 'projects/project-a',
      projectId: 'project-a',
    })

    expect(manifest.entries).toEqual([
      { type: 'directory', path: 'src', size: 0 },
      { type: 'file', path: 'src/index.ts', size: 26, sha256: sha('export const ready = true\n') },
    ])
    expect(manifest.totalBytes).toBe(26)
  })

  it('rejects symlinks, special entries, containment escapes, and oversized files before inventory', async () => {
    const { projectRoot, runtimeState, registry } = workspace()
    fs.writeFileSync(path.join(projectRoot, 'large.bin'), '12345')
    await expect(scanWorkspaceMapping({
      registry,
      mappingId: 'mapping-a',
      relativePath: 'projects/project-a',
      projectId: 'project-a',
      limits: { maxFileBytes: 4 },
    })).rejects.toThrow('maximum file size')

    fs.rmSync(path.join(projectRoot, 'large.bin'))
    fs.symlinkSync(os.tmpdir(), path.join(projectRoot, 'escape'))
    await expect(scanWorkspaceMapping({
      registry,
      mappingId: 'mapping-a',
      relativePath: 'projects/project-a',
      projectId: 'project-a',
    })).rejects.toThrow('symlink')

    expect(() => registry.resolve('mapping-a', '../outside')).toThrow()
  })

  it('rejects an ancestor swapped to an outside symlink between realpath and descriptor open', async () => {
    const { projectRoot, registry } = workspace()
    const inside = path.join(projectRoot, 'sub')
    const displaced = path.join(projectRoot, 'sub-original')
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-sync-race-outside-'))
    fs.mkdirSync(inside)
    fs.writeFileSync(path.join(inside, 'file.txt'), 'inside')
    fs.writeFileSync(path.join(outside, 'file.txt'), 'outside')
    const realpath = fs.realpathSync.bind(fs)
    let swapped = false
    const spy = jest.spyOn(fs, 'realpathSync').mockImplementation((candidate) => {
      const resolved = realpath(candidate)
      if (!swapped && String(candidate).endsWith(`${path.sep}sub${path.sep}file.txt`)) {
        swapped = true
        fs.renameSync(inside, displaced)
        fs.symlinkSync(outside, inside)
      }
      return resolved
    })
    try {
      await expect(scanWorkspaceMapping({
        registry, mappingId: 'mapping-a', relativePath: 'projects/project-a', projectId: 'project-a',
      })).rejects.toThrow(/escaped its approved root|ELOOP/i)
    } finally {
      spy.mockRestore()
    }
  })

  it('preserves executable intent and rejects cross-platform path collisions', async () => {
    const { projectRoot, registry } = workspace()
    fs.writeFileSync(path.join(projectRoot, 'run.sh'), '#!/bin/sh\n')
    fs.chmodSync(path.join(projectRoot, 'run.sh'), 0o755)
    const manifest = await scanWorkspaceMapping({ registry, mappingId: 'mapping-a', relativePath: 'projects/project-a', projectId: 'project-a' })
    if (posixOnly) {
      expect(manifest.entries).toContainEqual(expect.objectContaining({ path: 'run.sh', executable: true }))
    } else {
      expect(manifest.entries).toContainEqual(expect.objectContaining({ path: 'run.sh', type: 'file' }))
    }
    expect(() => buildProjectContentManifest({ projectId: 'project-a', entries: [
      { type: 'file', path: 'Readme', size: 1, sha256: sha('a') },
      { type: 'file', path: 'README', size: 1, sha256: sha('b') },
    ] })).toThrow(/cross-platform path collision/i)
  })
})

describe('native workspace.sync staged target apply', () => {
  it('rechecks the target revision, verifies downloads, preserves files, and atomically backs up replacements', async () => {
    const { projectRoot, runtimeState, registry } = workspace()
    fs.writeFileSync(path.join(projectRoot, 'keep.txt'), 'keep')
    fs.writeFileSync(path.join(projectRoot, 'change.txt'), 'before')
    const before = await scanWorkspaceMapping({ registry, mappingId: 'mapping-a', relativePath: 'projects/project-a', projectId: 'project-a' })
    const desired = buildProjectContentManifest({ projectId: 'project-a', entries: [
      { type: 'file', path: 'keep.txt', size: 4, sha256: sha('keep') },
      { type: 'file', path: 'change.txt', size: 5, sha256: sha('after') },
      { type: 'file', path: 'new.txt', size: 3, sha256: sha('new') },
    ] })
    const objects = new Map([
      ['https://objects/change', Buffer.from('after')],
      ['https://objects/new', Buffer.from('new')],
    ])

    const result = await applyWorkspaceSyncTransfer({
      registry,
      mappingId: 'mapping-a',
      relativePath: 'projects/project-a',
      projectId: 'project-a',
      transferId: 'transfer-a',
      expectedTargetRevision: before.revision,
      manifest: desired,
      downloads: [
        { path: 'change.txt', sha256: sha('after'), size: 5, url: 'https://objects/change' },
        { path: 'new.txt', sha256: sha('new'), size: 3, url: 'https://objects/new' },
      ],
    }, {
      stateRoot: runtimeState,
      download: async (url) => objects.get(url)!,
    })

    expect(fs.readFileSync(path.join(projectRoot, 'keep.txt'), 'utf8')).toBe('keep')
    expect(fs.readFileSync(path.join(projectRoot, 'change.txt'), 'utf8')).toBe('after')
    expect(fs.readFileSync(path.join(projectRoot, 'new.txt'), 'utf8')).toBe('new')
    expect(fs.readFileSync(path.join(result.backupPath, 'change.txt'), 'utf8')).toBe('before')
    expect(result).toEqual(expect.objectContaining({ beforeRevision: before.revision, appliedRevision: desired.revision, verifiedManifestRevision: desired.revision }))
  })

  it('does not mutate the target when its revision drifted or applying would require a deletion', async () => {
    const { projectRoot, runtimeState, registry } = workspace()
    fs.writeFileSync(path.join(projectRoot, 'existing.txt'), 'existing')
    const before = await scanWorkspaceMapping({ registry, mappingId: 'mapping-a', relativePath: 'projects/project-a', projectId: 'project-a' })
    const empty = buildProjectContentManifest({ projectId: 'project-a', entries: [] })
    await expect(applyWorkspaceSyncTransfer({
      registry, mappingId: 'mapping-a', relativePath: 'projects/project-a', projectId: 'project-a',
      transferId: 'transfer-delete', expectedTargetRevision: before.revision, manifest: empty, downloads: [],
    }, { stateRoot: runtimeState })).rejects.toThrow('automatic deletion')
    expect(fs.readFileSync(path.join(projectRoot, 'existing.txt'), 'utf8')).toBe('existing')

    fs.writeFileSync(path.join(projectRoot, 'drift.txt'), 'drift')
    await expect(applyWorkspaceSyncTransfer({
      registry, mappingId: 'mapping-a', relativePath: 'projects/project-a', projectId: 'project-a',
      transferId: 'transfer-drift', expectedTargetRevision: before.revision, manifest: before, downloads: [],
    }, { stateRoot: runtimeState })).rejects.toThrow('target revision changed')
  })

  it('removes newly created empty directories when an atomic file swap fails', async () => {
    const { projectRoot, runtimeState, registry } = workspace()
    const before = await scanWorkspaceMapping({ registry, mappingId: 'mapping-a', relativePath: 'projects/project-a', projectId: 'project-a' })
    const desired = buildProjectContentManifest({ projectId: 'project-a', entries: [
      { type: 'directory', path: 'new-directory', size: 0 },
      { type: 'file', path: 'file.txt', size: 1, sha256: sha('x') },
    ] })
    const rename = fs.renameSync.bind(fs)
    const renameSpy = jest.spyOn(fs, 'renameSync').mockImplementation((source, target) => {
      if (path.basename(String(source)).startsWith('.pib-sync-stage-') && path.basename(String(target)) === 'file.txt') {
        throw new Error('simulated rename failure')
      }
      return rename(source, target)
    })

    await expect(applyWorkspaceSyncTransfer({
      registry, mappingId: 'mapping-a', relativePath: 'projects/project-a', projectId: 'project-a',
      transferId: 'transfer-failure', expectedTargetRevision: before.revision, manifest: desired,
      downloads: [{ path: 'file.txt', size: 1, sha256: sha('x'), url: 'https://objects/file' }],
    }, { stateRoot: runtimeState, download: async () => Buffer.from('x') })).rejects.toThrow('simulated rename failure')
    renameSpy.mockRestore()

    expect(fs.existsSync(path.join(projectRoot, 'new-directory'))).toBe(false)
    expect(fs.existsSync(path.join(projectRoot, 'file.txt'))).toBe(false)
  })

  it('never follows a project-controlled .pib-sync symlink for staging, backup, or cleanup', async () => {
    const { projectRoot, runtimeState, registry } = workspace()
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-sync-outside-'))
    fs.writeFileSync(path.join(outside, 'sentinel.txt'), 'do-not-touch')
    fs.symlinkSync(outside, path.join(projectRoot, '.pib-sync'))
    const before = await scanWorkspaceMapping({ registry, mappingId: 'mapping-a', relativePath: 'projects/project-a', projectId: 'project-a' })
    const desired = buildProjectContentManifest({ projectId: 'project-a', entries: [
      { type: 'file', path: 'file.txt', size: 1, sha256: sha('x') },
    ] })

    await applyWorkspaceSyncTransfer({
      registry, mappingId: 'mapping-a', relativePath: 'projects/project-a', projectId: 'project-a',
      transferId: 'transfer-safe-state', expectedTargetRevision: before.revision, manifest: desired,
      downloads: [{ path: 'file.txt', size: 1, sha256: sha('x'), url: 'https://objects/file' }],
    }, { stateRoot: runtimeState, download: async () => Buffer.from('x') })

    expect(fs.readdirSync(outside)).toEqual(['sentinel.txt'])
    expect(fs.readFileSync(path.join(projectRoot, 'file.txt'), 'utf8')).toBe('x')
  })

  it('bounds retained backups and completion records while keeping executable replacements', async () => {
    const { projectRoot, runtimeState, registry } = workspace()
    fs.writeFileSync(path.join(projectRoot, 'run.sh'), '0')
    let latestBackup = ''
    for (let index = 1; index <= 4; index += 1) {
      const before = await scanWorkspaceMapping({ registry, mappingId: 'mapping-a', relativePath: 'projects/project-a', projectId: 'project-a' })
      const value = String(index)
      const desired = buildProjectContentManifest({ projectId: 'project-a', entries: [
        { type: 'file', path: 'run.sh', size: 1, sha256: sha(value), executable: true },
      ] })
      const result = await applyWorkspaceSyncTransfer({
        registry, mappingId: 'mapping-a', relativePath: 'projects/project-a', projectId: 'project-a',
        transferId: `retention-${index}`, expectedTargetRevision: before.revision, manifest: desired,
        downloads: [{ path: 'run.sh', size: 1, sha256: sha(value), url: `https://objects/${index}` }],
      }, {
        stateRoot: runtimeState,
        download: async () => Buffer.from(value),
        retention: { maxBackupSets: 2, maxBackupBytes: 10, maxCompletionRecords: 3 },
      })
      latestBackup = result.backupPath
    }
    const internalRoot = path.dirname(path.dirname(latestBackup))
    const backupSets = fs.readdirSync(path.join(internalRoot, 'backups')).filter((name) => fs.existsSync(path.join(internalRoot, 'backups', name, 'run.sh')))
    expect(backupSets.length).toBeLessThanOrEqual(2)
    expect(fs.readdirSync(path.join(internalRoot, 'journals')).filter((name) => name.endsWith('.json')).length).toBeLessThanOrEqual(3)
    if (posixOnly) expect(fs.statSync(path.join(projectRoot, 'run.sh')).mode & 0o111).not.toBe(0)
  })

  it('round-trips an executable-only change through the same journaled apply path', async () => {
    const { projectRoot, runtimeState, registry } = workspace()
    const script = '#!/bin/sh\n'
    fs.writeFileSync(path.join(projectRoot, 'run.sh'), script, { mode: 0o600 })
    fs.chmodSync(path.join(projectRoot, 'run.sh'), 0o600)
    const before = await scanWorkspaceMapping({ registry, mappingId: 'mapping-a', relativePath: 'projects/project-a', projectId: 'project-a' })
    const desired = buildProjectContentManifest({ projectId: 'project-a', entries: [
      { type: 'file', path: 'run.sh', size: Buffer.byteLength(script), sha256: sha(script), executable: true },
    ] })

    const result = await applyWorkspaceSyncTransfer({
      registry, mappingId: 'mapping-a', relativePath: 'projects/project-a', projectId: 'project-a',
      transferId: 'transfer-mode-only', expectedTargetRevision: before.revision, manifest: desired,
      downloads: [{ path: 'run.sh', size: Buffer.byteLength(script), sha256: sha(script), url: 'https://objects/run' }],
    }, { stateRoot: runtimeState, download: async () => Buffer.from(script) })

    expect(result.appliedRevision).toBe(desired.revision)
    expect(fs.readFileSync(path.join(projectRoot, 'run.sh'), 'utf8')).toBe(script)
    if (posixOnly) expect(fs.statSync(path.join(projectRoot, 'run.sh')).mode & 0o111).not.toBe(0)
  })
})

describe('native workspace.sync durability', () => {
  it('persists offline receipts privately and retries them after restart', async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-sync-spool-'))
    const file = path.join(temp, 'state', 'sync-spool.json')
    const spool = new DurableSyncSpool(file)
    spool.enqueue('/sync/receipt', { requestId: 'request-a' })
    if (posixOnly) expect(fs.statSync(file).mode & 0o777).toBe(0o600)

    await new DurableSyncSpool(file).flush(async () => new Response('', { status: 503 }))
    expect(new DurableSyncSpool(file).size()).toBe(1)
    const post = jest.fn(async () => new Response('', { status: 200 }))
    await new DurableSyncSpool(file).flush(post)

    expect(post).toHaveBeenCalledWith('/sync/receipt', { requestId: 'request-a' })
    expect(new DurableSyncSpool(file).size()).toBe(0)
  })

  it('fails closed on a corrupt spool and never follows a predictable temporary-file symlink', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-sync-spool-safety-'))
    const file = path.join(temp, 'state', 'sync-spool.json')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '{broken-json')
    expect(() => new DurableSyncSpool(file).size()).toThrow('spool is corrupt')
    expect(() => new DurableSyncSpool(file).enqueue('/sync/receipt', { requestId: 'request-a' })).toThrow('spool is corrupt')

    fs.rmSync(file)
    const outside = path.join(temp, 'outside.txt')
    fs.writeFileSync(outside, 'sentinel')
    fs.symlinkSync(outside, `${file}.tmp`)
    new DurableSyncSpool(file).enqueue('/sync/receipt', { requestId: 'request-a' })
    expect(fs.readFileSync(outside, 'utf8')).toBe('sentinel')
  })

  it('recovers a stale lock and accepts new receipts while an offline flush is in flight', async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-sync-spool-concurrency-'))
    const file = path.join(temp, 'sync-spool.json')
    fs.mkdirSync(`${file}.lock`)
    const stale = new Date(Date.now() - 60_000)
    fs.utimesSync(`${file}.lock`, stale, stale)
    const spool = new DurableSyncSpool(file)
    spool.enqueue('/sync/receipt', { requestId: 'old' })

    let finish!: (response: Response) => void
    const flushing = spool.flush(async () => new Promise<Response>((resolve) => { finish = resolve }))
    await Promise.resolve()
    spool.enqueue('/sync/receipt', { requestId: 'new' })
    finish(new Response('', { status: 200 }))
    await flushing

    expect(spool.size()).toBe(1)
  })

  it('debounces recurring inventory and reports only the stable changed revision', async () => {
    const baseline = buildProjectContentManifest({ projectId: 'project-a', entries: [] })
    const changed = buildProjectContentManifest({ projectId: 'project-a', entries: [
      { type: 'file', path: 'file.txt', size: 1, sha256: sha('x') },
    ] })
    let current = baseline
    const report = jest.fn(async () => {})
    const monitor = new WorkspaceSyncMonitor({
      scan: async () => current,
      report,
      scanIntervalMs: 100,
      debounceMs: 500,
    })
    monitor.track({ key: 'request-a:replica-a', baselineRevision: baseline.revision, payload: { requestId: 'request-a' } })

    await monitor.tick(0)
    current = changed
    await monitor.tick(100)
    await monitor.tick(400)
    expect(report).not.toHaveBeenCalled()
    await monitor.tick(600)
    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith({ requestId: 'request-a' }, changed)
  })
})

describe('native workspace.sync job execution', () => {
  it('scans and submits exact-bound inventory jobs through the signed device client', async () => {
    const { registry } = workspace()
    const post = jest.fn(async () => new Response('', { status: 200 }))
    const binding = { capability: 'workspace.sync' as const, requestId: 'request-a', orgId: 'org-a', projectId: 'project-a', replicaId: 'replica-a', locationId: 'linked-device:device-a', mappingId: 'mapping-a' }
    const result = await executeWorkspaceSyncJob({
      jobId: 'job-a', kind: 'inventory', binding, relativePath: 'projects/project-a', recurring: false,
      baselineRevision: null, bootstrapMissingRoot: false,
    }, { registry, stateRoot: path.join(os.tmpdir(), `sync-state-${Date.now()}`), post })

    expect(post).toHaveBeenCalledWith('/sync/inventory', expect.objectContaining({
      jobId: 'job-a', binding, manifest: expect.objectContaining({ projectId: 'project-a' }),
    }))
    expect(result).toEqual(expect.objectContaining({ kind: 'inventory', manifest: expect.any(Object) }))
  })

  it('securely creates a missing pristine project root only for an explicit bootstrap inventory lease', async () => {
    const { mappingRoot, projectRoot, registry, runtimeState } = workspace()
    fs.rmSync(path.join(mappingRoot, 'projects'), { recursive: true, force: true })
    const post = jest.fn(async () => new Response('', { status: 200 }))
    const binding = { capability: 'workspace.sync' as const, requestId: 'request-a', orgId: 'org-a', projectId: 'project-a', replicaId: 'replica-a', locationId: 'linked-device:device-a', mappingId: 'mapping-a' }
    const result = await executeWorkspaceSyncJob({
      jobId: 'job-bootstrap', kind: 'inventory', binding, relativePath: 'projects/project-a',
      recurring: false, baselineRevision: null, bootstrapMissingRoot: true,
    }, { registry, stateRoot: runtimeState, post })

    expect(fs.statSync(projectRoot).isDirectory()).toBe(true)
    expect(post).toHaveBeenCalledWith('/sync/inventory', expect.objectContaining({
      jobId: 'job-bootstrap', pristineBootstrap: true,
      manifest: expect.objectContaining({ entries: [], entryCount: 0, totalBytes: 0 }),
    }))
    expect(result).toEqual(expect.objectContaining({ kind: 'inventory', pristineBootstrap: true }))
  })

  it('spools inventory when the sync service reports a retryable infrastructure failure', async () => {
    const { registry, runtimeState } = workspace()
    const post = jest.fn(async () => new Response('', { status: 503 }))
    const spool = new DurableSyncSpool(path.join(runtimeState, 'retry-spool.json'))
    const binding = { capability: 'workspace.sync' as const, requestId: 'request-a', orgId: 'org-a', projectId: 'project-a', replicaId: 'replica-a', locationId: 'linked-device:device-a', mappingId: 'mapping-a' }
    const result = await executeWorkspaceSyncJob({
      jobId: 'job-retry-service', kind: 'inventory', binding, relativePath: 'projects/project-a',
      recurring: false, baselineRevision: null, bootstrapMissingRoot: false,
    }, { registry, stateRoot: runtimeState, post, spool })

    expect(result.delivery).toBe('queued')
    expect(spool.size()).toBe(1)
  })

  it('never attests an existing physically nonempty target as pristine', async () => {
    const { projectRoot, registry, runtimeState } = workspace()
    fs.writeFileSync(path.join(projectRoot, '.env'), 'KEEP=1')
    const post = jest.fn(async () => new Response('', { status: 200 }))
    const binding = { capability: 'workspace.sync' as const, requestId: 'request-a', orgId: 'org-a', projectId: 'project-a', replicaId: 'replica-a', locationId: 'linked-device:device-a', mappingId: 'mapping-a' }
    await executeWorkspaceSyncJob({
      jobId: 'job-existing', kind: 'inventory', binding, relativePath: 'projects/project-a',
      recurring: false, baselineRevision: null, bootstrapMissingRoot: true,
    }, { registry, stateRoot: runtimeState, post })

    expect(fs.readFileSync(path.join(projectRoot, '.env'), 'utf8')).toBe('KEEP=1')
    expect(post).toHaveBeenCalledWith('/sync/inventory', expect.not.objectContaining({ pristineBootstrap: true }))
  })

  it('reports a persistently unreadable inventory path instead of wedging its lease', async () => {
    const { projectRoot, registry, runtimeState } = workspace()
    fs.writeFileSync(path.join(projectRoot, 'unreadable.txt'), 'private')
    const resolve = registry.resolve.bind(registry)
    const resolveSpy = jest.spyOn(registry, 'resolve').mockImplementation((mappingId, relativePath = '') => {
      if (relativePath === 'projects/project-a') {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
      }
      return resolve(mappingId, relativePath)
    })
    const post = jest.fn(async () => new Response('', { status: 200 }))
    const binding = { capability: 'workspace.sync' as const, requestId: 'request-a', orgId: 'org-a', projectId: 'project-a', replicaId: 'replica-a', locationId: 'linked-device:device-a', mappingId: 'mapping-a' }
    try {
      const result = await executeWorkspaceSyncJob({
        jobId: 'job-unreadable', kind: 'inventory', binding, relativePath: 'projects/project-a',
        recurring: false, baselineRevision: null, bootstrapMissingRoot: false,
      }, { registry, stateRoot: runtimeState, post })

      expect(result).toEqual(expect.objectContaining({ kind: 'inventory', status: 'conflict', reason: 'unsupported_path' }))
      expect(post).toHaveBeenCalledWith('/sync/failure', expect.objectContaining({
        jobId: 'job-unreadable', jobKind: 'inventory', reason: 'unsupported_path',
      }))
    } finally {
      resolveSpy.mockRestore()
    }
  })

  it('uploads only manifest-bound source bytes with signed headers before submitting verification', async () => {
    const { projectRoot, registry, runtimeState } = workspace()
    fs.writeFileSync(path.join(projectRoot, 'file.txt'), 'data')
    const manifest = await scanWorkspaceMapping({ registry, mappingId: 'mapping-a', relativePath: 'projects/project-a', projectId: 'project-a' })
    const file = manifest.entries.find((entry) => entry.type === 'file') as Extract<(typeof manifest.entries)[number], { type: 'file' }>
    const fetcher = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init).toEqual(expect.objectContaining({ method: 'PUT', headers: { 'content-length': '4' } }))
      return new Response('', { status: 200 })
    })
    const post = jest.fn(async () => new Response('', { status: 200 }))
    await executeWorkspaceSyncJob({
      jobId: 'job-upload', kind: 'upload',
      binding: { capability: 'workspace.sync', requestId: 'request-a', orgId: 'org-a', projectId: 'project-a', replicaId: 'replica-a', locationId: 'linked-device:device-a', mappingId: 'mapping-a' },
      relativePath: 'projects/project-a', manifest,
      objects: [{ path: 'file.txt', sha256: file.sha256, size: 4, url: 'https://storage.googleapis.com/upload', expiresAt: '2999-01-01T00:00:00.000Z', headers: { 'content-length': '4' } }],
    }, { registry, stateRoot: runtimeState, post, fetcher: fetcher as typeof fetch })

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith('/sync/upload-receipt', expect.objectContaining({
      jobId: 'job-upload', objects: [{ path: 'file.txt', sha256: file.sha256, size: 4 }],
    }))
  })

  it('classifies a source deleted after inventory as source drift and releases the upload workflow', async () => {
    const { projectRoot, registry, runtimeState } = workspace()
    fs.writeFileSync(path.join(projectRoot, 'file.txt'), 'data')
    const manifest = await scanWorkspaceMapping({ registry, mappingId: 'mapping-a', relativePath: 'projects/project-a', projectId: 'project-a' })
    const file = manifest.entries.find((entry) => entry.type === 'file') as Extract<(typeof manifest.entries)[number], { type: 'file' }>
    fs.rmSync(path.join(projectRoot, 'file.txt'))
    const post = jest.fn(async () => new Response('', { status: 200 }))
    const fetcher = jest.fn()
    const result = await executeWorkspaceSyncJob({
      jobId: 'job-source-drift', kind: 'upload',
      binding: { capability: 'workspace.sync', requestId: 'request-a', orgId: 'org-a', projectId: 'project-a', replicaId: 'replica-a', locationId: 'linked-device:device-a', mappingId: 'mapping-a' },
      relativePath: 'projects/project-a', manifest,
      objects: [{ path: 'file.txt', sha256: file.sha256, size: file.size, url: 'https://storage.googleapis.com/upload', expiresAt: '2999-01-01T00:00:00.000Z' }],
    }, { registry, stateRoot: runtimeState, post, fetcher: fetcher as unknown as typeof fetch })

    expect(result).toEqual(expect.objectContaining({ kind: 'upload', status: 'refreshing_inventory', reason: 'source_drift' }))
    expect(fetcher).not.toHaveBeenCalled()
    expect(post).toHaveBeenCalledWith('/sync/failure', expect.objectContaining({
      jobId: 'job-source-drift', jobKind: 'upload', reason: 'source_drift',
    }))
  })

  it('accepts create-only CAS retries and rejects unbound secret upload objects', async () => {
    const { projectRoot, registry, runtimeState } = workspace()
    fs.writeFileSync(path.join(projectRoot, 'file.txt'), 'data')
    fs.writeFileSync(path.join(projectRoot, '.env'), 'SECRET=value')
    const manifest = await scanWorkspaceMapping({ registry, mappingId: 'mapping-a', relativePath: 'projects/project-a', projectId: 'project-a' })
    const file = manifest.entries.find((entry) => entry.type === 'file') as Extract<(typeof manifest.entries)[number], { type: 'file' }>
    const binding = { capability: 'workspace.sync' as const, requestId: 'request-a', orgId: 'org-a', projectId: 'project-a', replicaId: 'replica-a', locationId: 'linked-device:device-a', mappingId: 'mapping-a' }
    const post = jest.fn(async () => new Response('', { status: 200 }))
    await expect(executeWorkspaceSyncJob({
      jobId: 'job-secret', kind: 'upload', binding, relativePath: 'projects/project-a', manifest,
      objects: [{ path: '.env', sha256: sha('SECRET=value'), size: 12, url: 'https://storage.googleapis.com/upload', expiresAt: '2999-01-01T00:00:00.000Z' }],
    }, { registry, stateRoot: runtimeState, post, fetcher: jest.fn() as unknown as typeof fetch }))
      .rejects.toThrow(/not uniquely bound/i)

    const fetcher = jest.fn(async () => new Response('', { status: 412 }))
    await executeWorkspaceSyncJob({
      jobId: 'job-retry', kind: 'upload', binding, relativePath: 'projects/project-a', manifest,
      objects: [{ path: 'file.txt', sha256: file.sha256, size: 4, url: 'https://storage.googleapis.com/upload', expiresAt: '2999-01-01T00:00:00.000Z' }],
    }, { registry, stateRoot: runtimeState, post, fetcher: fetcher as typeof fetch })
    expect(post).toHaveBeenCalledWith('/sync/upload-receipt', expect.objectContaining({ jobId: 'job-retry' }))
  })

  it('reports non-destructive apply conflicts instead of silently retrying forever', async () => {
    const { projectRoot, registry, runtimeState } = workspace()
    fs.writeFileSync(path.join(projectRoot, 'existing.txt'), 'keep')
    const before = await scanWorkspaceMapping({ registry, mappingId: 'mapping-a', relativePath: 'projects/project-a', projectId: 'project-a' })
    const desired = buildProjectContentManifest({ projectId: 'project-a', entries: [] })
    const binding = { capability: 'workspace.sync' as const, requestId: 'request-a', orgId: 'org-a', projectId: 'project-a', replicaId: 'replica-a', locationId: 'linked-device:device-a', mappingId: 'mapping-a' }
    const post = jest.fn(async () => new Response('', { status: 200 }))
    await expect(executeWorkspaceSyncJob({
      jobId: 'job-conflict', kind: 'apply', binding, relativePath: 'projects/project-a', transferId: 'transfer-conflict',
      expectedTargetRevision: before.revision, manifest: desired, objects: [],
    }, { registry, stateRoot: runtimeState, post })).resolves.toEqual(expect.objectContaining({
      kind: 'apply', status: 'conflict', reason: 'non_destructive_apply_required',
    }))
    expect(post).toHaveBeenCalledWith('/sync/failure', expect.objectContaining({
      jobId: 'job-conflict', transferId: 'transfer-conflict', reason: 'non_destructive_apply_required',
    }))
  })

  it('reports target drift, refreshes expired upload leases, and reports preflight scale failures', async () => {
    const { projectRoot, registry, runtimeState } = workspace()
    fs.writeFileSync(path.join(projectRoot, 'file.txt'), 'old')
    const before = await scanWorkspaceMapping({ registry, mappingId: 'mapping-a', relativePath: 'projects/project-a', projectId: 'project-a' })
    const binding = { capability: 'workspace.sync' as const, requestId: 'request-a', orgId: 'org-a', projectId: 'project-a', replicaId: 'replica-a', locationId: 'linked-device:device-a', mappingId: 'mapping-a' }
    const post = jest.fn(async () => new Response('', { status: 200 }))
    fs.writeFileSync(path.join(projectRoot, 'drift.txt'), 'drift')
    await executeWorkspaceSyncJob({
      jobId: 'job-drift', kind: 'apply', binding, relativePath: 'projects/project-a', transferId: 'transfer-drift',
      expectedTargetRevision: before.revision, manifest: before, objects: [],
    }, { registry, stateRoot: runtimeState, post })
    expect(post).toHaveBeenCalledWith('/sync/failure', expect.objectContaining({ reason: 'target_drift', observedRevision: expect.any(String) }))

    fs.rmSync(path.join(projectRoot, 'drift.txt'))
    const current = await scanWorkspaceMapping({ registry, mappingId: 'mapping-a', relativePath: 'projects/project-a', projectId: 'project-a' })
    const file = current.entries.find((entry) => entry.type === 'file') as Extract<(typeof current.entries)[number], { type: 'file' }>
    await executeWorkspaceSyncJob({
      jobId: 'job-expired', kind: 'upload', binding, relativePath: 'projects/project-a', manifest: current,
      objects: [{ path: 'file.txt', sha256: file.sha256, size: 3, url: 'https://storage.googleapis.com/upload', expiresAt: '2000-01-01T00:00:00.000Z' }],
    }, { registry, stateRoot: runtimeState, post })
    expect(post).toHaveBeenCalledWith('/sync/failure', expect.objectContaining({ jobId: 'job-expired', reason: 'retryable_transport' }))

    await executeWorkspaceSyncJob({
      jobId: 'job-scale', kind: 'failure', binding, relativePath: 'projects/project-a', transferId: 'transfer-scale', reason: 'unsupported_scale',
    }, { registry, stateRoot: runtimeState, post })
    expect(post).toHaveBeenCalledWith('/sync/failure', expect.objectContaining({ jobId: 'job-scale', reason: 'unsupported_scale' }))
  })
})

describe('native workspace.sync Windows portability', () => {
  it('attests workspace.sync on win32 and prefixes long paths with \\\\?\\', () => {
    expect(nativeWorkspaceSyncSupported('darwin')).toBe(true)
    expect(nativeWorkspaceSyncSupported('linux')).toBe(true)
    expect(nativeWorkspaceSyncSupported('win32')).toBe(true)
    expect(toWin32LongPath('C:\\Users\\peet\\project')).toBe('\\\\?\\C:\\Users\\peet\\project')
    expect(toWin32LongPath('C:/Users/peet/project')).toBe('\\\\?\\C:\\Users\\peet\\project')
    expect(toWin32LongPath('\\\\server\\share\\dir')).toBe('\\\\?\\UNC\\server\\share\\dir')
    expect(toWin32LongPath('\\\\?\\C:\\already\\prefixed')).toBe('\\\\?\\C:\\already\\prefixed')
    expect(toWin32LongPath('relative\\folder')).toBe('relative\\folder')
    const longLeaf = `deep\\${'n'.repeat(240)}.txt`
    expect(toWin32LongPath(`C:\\workspace\\${longLeaf}`)).toBe(`\\\\?\\C:\\workspace\\${longLeaf}`)
    expect(fromWin32LongPath('\\\\?\\C:\\Users\\peet\\project')).toBe('C:\\Users\\peet\\project')
    expect(fromWin32LongPath('\\\\?\\UNC\\server\\share\\dir')).toBe('\\\\server\\share\\dir')
    expect(nativeFsPath('C:\\Users\\peet\\project', 'win32')).toBe('\\\\?\\C:\\Users\\peet\\project')
    expect(nativeFsPath('/tmp/project', 'darwin')).toBe('/tmp/project')
  })

  it('treats Windows junctions as directories and still rejects file symlinks', () => {
    const reparse = { isSymbolicLink: () => true }
    expect(isWindowsJunction('C:\\junction', reparse, 'win32', () => ({ isDirectory: () => true }))).toBe(true)
    expect(isWindowsJunction('C:\\file-link', reparse, 'win32', () => ({ isDirectory: () => false }))).toBe(false)
    expect(isWindowsJunction('/tmp/link', reparse, 'darwin', () => ({ isDirectory: () => true }))).toBe(false)
    expect(isWindowsJunction('C:\\plain', { isSymbolicLink: () => false }, 'win32', () => ({ isDirectory: () => true }))).toBe(false)
  })

  it('hashes exact bytes so CRLF is not normalised, and scans a read-only file', async () => {
    const { projectRoot, registry } = workspace()
    const file = path.join(projectRoot, 'readonly.txt')
    fs.writeFileSync(file, 'hello\r\n')
    fs.chmodSync(file, 0o444)
    const crlf = await scanWorkspaceMapping({
      registry, mappingId: 'mapping-a', relativePath: 'projects/project-a', projectId: 'project-a',
    })
    expect(crlf.entries).toEqual([
      expect.objectContaining({ path: 'readonly.txt', size: 7, sha256: sha(Buffer.from('hello\r\n')) }),
    ])
    expect(crlf.entries[0]).toEqual(expect.objectContaining({ sha256: sha(Buffer.from('hello\r\n')) }))
    expect(sha(Buffer.from('hello\r\n'))).not.toBe(sha(Buffer.from('hello\n')))
    expect(clearWin32ReadOnlyAttribute(file, 'darwin')).toBe(false)
    if (posixOnly) expect(fs.statSync(file).mode & 0o222).toBe(0)
    expect(clearWin32ReadOnlyAttribute(file, 'win32')).toBe(true)
    if (posixOnly) expect(fs.statSync(file).mode & 0o200).not.toBe(0)
  })

  it('replaces a read-only target file during journaled apply', async () => {
    const { projectRoot, runtimeState, registry } = workspace()
    const file = path.join(projectRoot, 'readonly.txt')
    fs.writeFileSync(file, 'old')
    fs.chmodSync(file, 0o444)
    const before = await scanWorkspaceMapping({
      registry, mappingId: 'mapping-a', relativePath: 'projects/project-a', projectId: 'project-a',
    })
    const desired = buildProjectContentManifest({ projectId: 'project-a', entries: [
      { type: 'file', path: 'readonly.txt', size: 3, sha256: sha('new') },
    ] })
    await applyWorkspaceSyncTransfer({
      registry, mappingId: 'mapping-a', relativePath: 'projects/project-a', projectId: 'project-a',
      transferId: 'transfer-readonly', expectedTargetRevision: before.revision, manifest: desired,
      downloads: [{ path: 'readonly.txt', size: 3, sha256: sha('new'), url: 'https://objects/readonly' }],
    }, { stateRoot: runtimeState, download: async () => Buffer.from('new') })
    expect(fs.readFileSync(file, 'utf8')).toBe('new')
  })

  it('classifies a locked target file as a retryable apply failure instead of crashing', async () => {
    const { projectRoot, registry, runtimeState } = workspace()
    fs.writeFileSync(path.join(projectRoot, 'locked.txt'), 'before')
    const before = await scanWorkspaceMapping({
      registry, mappingId: 'mapping-a', relativePath: 'projects/project-a', projectId: 'project-a',
    })
    const desired = buildProjectContentManifest({ projectId: 'project-a', entries: [
      { type: 'file', path: 'locked.txt', size: 5, sha256: sha('after') },
    ] })
    const rename = fs.renameSync.bind(fs)
    const renameSpy = jest.spyOn(fs, 'renameSync').mockImplementation((source, target) => {
      if (path.basename(String(source)).startsWith('.pib-sync-stage-') && path.basename(String(target)) === 'locked.txt') {
        throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
      }
      return rename(source, target)
    })
    const post = jest.fn(async () => new Response('', { status: 200 }))
    const binding = {
      capability: 'workspace.sync' as const,
      requestId: 'request-a', orgId: 'org-a', projectId: 'project-a',
      replicaId: 'replica-a', locationId: 'linked-device:device-a', mappingId: 'mapping-a',
    }
    try {
      await expect(executeWorkspaceSyncJob({
        jobId: 'job-locked', kind: 'apply', binding, relativePath: 'projects/project-a',
        transferId: 'transfer-locked', expectedTargetRevision: before.revision, manifest: desired,
        objects: [{ path: 'locked.txt', size: 5, sha256: sha('after'), url: 'https://storage.googleapis.com/pib-sync-test/locked', expiresAt: '2999-01-01T00:00:00.000Z' }],
      }, { registry, stateRoot: runtimeState, post, download: async () => Buffer.from('after') })).resolves.toEqual(expect.objectContaining({
        kind: 'apply', status: 'retrying', reason: 'retryable_transport',
      }))
    } finally {
      renameSpy.mockRestore()
    }
    expect(post).toHaveBeenCalledWith('/sync/failure', expect.objectContaining({
      jobId: 'job-locked', reason: 'retryable_transport',
    }))
    expect(fs.readFileSync(path.join(projectRoot, 'locked.txt'), 'utf8')).toBe('before')
  })
})
