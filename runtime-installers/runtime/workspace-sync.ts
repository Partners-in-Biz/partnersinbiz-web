import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { lockSync } from 'proper-lockfile'
import { buildProjectContentManifest, type ProjectContentManifest, type ProjectManifestEntry } from './sync-model'
import { MappingRegistry } from './bridge'

const DEFAULT_MAX_ENTRIES = 1_000
const DEFAULT_MAX_FILE_BYTES = 100 * 1024 * 1024
const DEFAULT_MAX_MANIFEST_BYTES = 100 * 1024 * 1024
const EXCLUDED_SEGMENTS = new Set(['.git', 'node_modules', '.pib-sync', '.partnersinbiz'])
const EXCLUDED_NAMES = new Set(['.env', 'id_rsa', 'id_ed25519', 'credentials.json', 'service-account.json'])
const SAFE_TRANSFER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const DARWIN_O_NOFOLLOW_ANY = 0x20000000
const SYNC_FETCH_TIMEOUT_MS = 15 * 60_000

export interface WorkspaceSyncLimits {
  maxEntries?: number
  maxFileBytes?: number
  maxManifestBytes?: number
}

function contained(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`)
}

function runtimeErrorMessage(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : ''
}

function runtimeErrorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : ''
}

function excluded(relativePath: string): boolean {
  const lower = relativePath.split('/').map((segment) => segment.toLowerCase())
  const name = lower.at(-1) ?? ''
  return lower.some((segment) => EXCLUDED_SEGMENTS.has(segment))
    || EXCLUDED_NAMES.has(name)
    || name.startsWith('.pib-sync-stage-')
    || name.startsWith('.pib-sync-backup-')
    || name.startsWith('.env.')
    || /\.(?:pem|key|p12|pfx)$/.test(name)
}

function descriptorPath(descriptor: number): string {
  if (process.platform === 'linux') return fs.realpathSync(`/proc/self/fd/${descriptor}`)
  if (process.platform === 'darwin') {
    const helper = process.env.PIB_CREDENTIAL_HELPER
      || path.join(path.dirname(process.execPath), 'pib-credential-helper')
    if (fs.existsSync(helper)) {
      const native = spawnSync(helper, ['resolved-path'], { stdio: [descriptor, 'pipe', 'pipe'], encoding: 'utf8' })
      const resolved = native.stdout.trim()
      if (native.status === 0 && resolved) return resolved
      throw new Error('workspace sync cannot attest opened file containment')
    }
    const result = spawnSync('/usr/sbin/lsof', ['-a', '-p', String(process.pid), '-d', String(descriptor), '-Fn'], { encoding: 'utf8' })
    const value = result.stdout.split('\n').find((line) => line.startsWith('n'))?.slice(1)
    if (result.status !== 0 || !value) throw new Error('workspace sync cannot attest opened file containment')
    return value
  }
  if (process.platform === 'win32') {
    const helper = process.env.PIB_CREDENTIAL_HELPER
      || path.join(path.dirname(process.execPath), 'pib-credential-helper.exe')
    const result = spawnSync(helper, ['resolved-path'], { stdio: [descriptor, 'pipe', 'pipe'], encoding: 'utf8' })
    const value = result.stdout.trim().replace(/^\\\\\?\\/, '')
    if (result.status !== 0 || !value) throw new Error('workspace sync cannot attest opened file containment')
    return value
  }
  throw new Error('workspace sync secure file containment is unsupported on this platform')
}

function assertDescriptorContained(descriptor: number, root: string): void {
  // XNU's O_NOFOLLOW_ANY rejects symlinks in every path component atomically.
  if (process.platform === 'darwin') return
  const actual = path.resolve(descriptorPath(descriptor))
  if (!contained(root, actual)) throw new Error('workspace sync opened file escaped its approved root')
}

function hashFile(file: string, maximumBytes: number, approvedRoot?: string): Promise<{ sha256: string; size: number }> {
  const noFollow = process.platform === 'darwin'
    ? DARWIN_O_NOFOLLOW_ANY
    : typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | noFollow)
  const stat = fs.fstatSync(descriptor)
  if (!stat.isFile()) {
    fs.closeSync(descriptor)
    throw new Error('workspace sync rejects special file')
  }
  if (stat.size > maximumBytes) {
    fs.closeSync(descriptor)
    throw new Error('project sync maximum file size exceeded')
  }
  if (approvedRoot) {
    try { assertDescriptorContained(descriptor, approvedRoot) } catch (error) { fs.closeSync(descriptor); throw error }
  }
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    let size = 0
    const stream = fs.createReadStream(file, { fd: descriptor, autoClose: false })
    stream.on('data', (chunk: string | Buffer) => {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      size += bytes.byteLength
      if (size > maximumBytes) stream.destroy(new Error('project sync maximum file size exceeded'))
      else hash.update(bytes)
    })
    stream.on('error', (error) => {
      fs.closeSync(descriptor)
      reject(error)
    })
    stream.on('end', () => {
      const after = fs.fstatSync(descriptor)
      fs.closeSync(descriptor)
      if (after.size !== stat.size || size !== stat.size || after.dev !== stat.dev || after.ino !== stat.ino
        || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) {
        reject(new Error('workspace sync file changed during inventory'))
        return
      }
      resolve({ sha256: hash.digest('hex'), size })
    })
  })
}

export async function scanWorkspaceMapping(input: {
  registry: MappingRegistry
  mappingId: string
  relativePath: string
  projectId: string
  limits?: WorkspaceSyncLimits
}): Promise<ProjectContentManifest> {
  const root = input.registry.resolve(input.mappingId, input.relativePath)
  const rootStat = fs.lstatSync(root)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('workspace sync root must be a real directory')
  const rootReal = fs.realpathSync(root)
  const maxEntries = input.limits?.maxEntries ?? DEFAULT_MAX_ENTRIES
  const maxFileBytes = input.limits?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
  const maxManifestBytes = input.limits?.maxManifestBytes ?? DEFAULT_MAX_MANIFEST_BYTES
  const entries: ProjectManifestEntry[] = []
  let totalBytes = 0

  async function walk(directory: string, relativeDirectory: string): Promise<void> {
    const children = fs.readdirSync(directory).sort((left, right) => left.localeCompare(right))
    for (const name of children) {
      const relative = relativeDirectory ? `${relativeDirectory}/${name}` : name
      if (excluded(relative)) continue
      const absolute = path.join(directory, name)
      const stat = fs.lstatSync(absolute)
      if (stat.isSymbolicLink()) throw new Error(`workspace sync rejects symlink: ${relative}`)
      if (!stat.isDirectory() && !stat.isFile()) throw new Error(`workspace sync rejects special file: ${relative}`)
      const real = fs.realpathSync(absolute)
      if (!contained(rootReal, real)) throw new Error(`workspace sync containment violation: ${relative}`)
      if (entries.length >= maxEntries) throw new Error(`project sync manifest exceeds ${maxEntries} entries`)
      if (stat.isDirectory()) {
        entries.push({ type: 'directory', path: relative, size: 0 })
        await walk(absolute, relative)
        continue
      }
      const hashed = await hashFile(absolute, maxFileBytes, rootReal)
      totalBytes += hashed.size
      if (totalBytes > maxManifestBytes) throw new Error('project sync manifest exceeds its maximum total size')
      entries.push({
        type: 'file', path: relative, size: hashed.size, sha256: hashed.sha256,
        ...(stat.mode & 0o111 ? { executable: true as const } : {}),
      })
    }
  }

  await walk(rootReal, '')
  return buildProjectContentManifest({ projectId: input.projectId, entries })
}

function assertManifest(manifest: ProjectContentManifest, projectId: string): ProjectContentManifest {
  const rebuilt = buildProjectContentManifest({ projectId: manifest.projectId, entries: manifest.entries })
  if (rebuilt.projectId !== projectId || rebuilt.revision !== manifest.revision
    || rebuilt.entryCount !== manifest.entryCount || rebuilt.totalBytes !== manifest.totalBytes) {
    throw new Error('workspace sync manifest integrity check failed')
  }
  return rebuilt
}

function entryMap(manifest: ProjectContentManifest): Map<string, ProjectManifestEntry> {
  return new Map(manifest.entries.map((entry) => [entry.path, entry]))
}

function safeChild(root: string, relativePath: string): string {
  const candidate = path.resolve(root, ...relativePath.split('/'))
  if (!contained(root, candidate)) throw new Error('workspace sync containment violation')
  return candidate
}

export interface WorkspaceSyncDownload {
  path: string
  sha256: string
  size: number
  url: string
  headers?: Record<string, string>
}

interface ApplyJournalEntry {
  relativePath: string
  target: string
  temporary: string
  adjacentBackup: string
  durableBackup: string
  hadTarget: boolean
  desiredSha256: string
  originalSha256: string | null
  originalSize: number | null
}

interface ApplyJournal {
  root: string
  transferId: string
  projectId: string
  beforeRevision: string
  appliedRevision: string
  backupPath: string
  committedAt?: string
  phase: 'applying' | 'committed'
  entries: ApplyJournalEntry[]
  createdDirectories: string[]
}

function treeBytes(root: string): number {
  if (!fs.existsSync(root)) return 0
  const stat = fs.lstatSync(root)
  if (stat.isSymbolicLink()) throw new Error('workspace sync retention rejects symlink')
  if (stat.isFile()) return stat.size
  if (!stat.isDirectory()) return 0
  return fs.readdirSync(root).reduce((total, name) => total + treeBytes(path.join(root, name)), 0)
}

function gcWorkspaceSyncState(internalRoot: string, options: {
  maxBackupSets: number
  maxBackupBytes: number
  maxCompletionRecords: number
}): void {
  const journalsRoot = path.join(internalRoot, 'journals')
  if (!fs.existsSync(journalsRoot)) return
  const records = fs.readdirSync(journalsRoot).filter((name) => name.endsWith('.json')).flatMap((name) => {
    const journalPath = path.join(journalsRoot, name)
    try {
      const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as ApplyJournal
      if (journal.phase !== 'committed' || !journal.committedAt || !contained(internalRoot, journal.backupPath)) return []
      return [{ journalPath, journal, bytes: treeBytes(journal.backupPath) }]
    } catch { return [] }
  }).sort((left, right) => Date.parse(left.journal.committedAt!) - Date.parse(right.journal.committedAt!))
  let backupBytes = records.reduce((total, record) => total + record.bytes, 0)
  let backupSets = records.filter((record) => record.bytes > 0 || fs.existsSync(record.journal.backupPath)).length
  for (const record of records) {
    if (backupSets <= options.maxBackupSets && backupBytes <= options.maxBackupBytes) break
    if (!fs.existsSync(record.journal.backupPath)) continue
    fs.rmSync(record.journal.backupPath, { recursive: true, force: true })
    backupSets -= 1
    backupBytes -= record.bytes
  }
  for (const record of records.slice(0, Math.max(0, records.length - options.maxCompletionRecords))) {
    if (fs.existsSync(record.journal.backupPath)) fs.rmSync(record.journal.backupPath, { recursive: true, force: true })
    fs.rmSync(record.journalPath, { force: true })
  }
  fsyncDirectory(journalsRoot)
}

function fsyncDirectory(directory: string): void {
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY)
  try { fs.fsyncSync(descriptor) } finally { fs.closeSync(descriptor) }
}

function fsyncFile(file: string): void {
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY)
  try { fs.fsyncSync(descriptor) } finally { fs.closeSync(descriptor) }
}

function directoryIdentity(directory: string): { dev: number; ino: number } {
  const stat = fs.lstatSync(directory)
  if (stat.isSymbolicLink() || !stat.isDirectory() || fs.realpathSync(directory) !== directory) {
    throw new Error('workspace sync target parent is not a stable real directory')
  }
  return { dev: stat.dev, ino: stat.ino }
}

function assertDirectoryIdentity(directory: string, expected: { dev: number; ino: number }): void {
  const current = directoryIdentity(directory)
  if (current.dev !== expected.dev || current.ino !== expected.ino) {
    throw new Error('workspace sync target parent changed during apply')
  }
}

function fileHelperPath(): string {
  if (process.env.PIB_FILE_HELPER) return process.env.PIB_FILE_HELPER
  return path.join(path.dirname(process.execPath), process.platform === 'win32'
    ? 'pib-file-helper.exe'
    : process.platform === 'darwin' ? 'pib-credential-helper' : 'pib-file-helper')
}

function validateRelativeName(name: string): string {
  if (!name || name === '.' || name === '..' || name.length > 255 || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    throw new Error('workspace sync descriptor-relative name is invalid')
  }
  return name
}

function withParentDescriptor(parent: string, operation: (descriptor: number) => void): void {
  const noFollow = process.platform === 'darwin'
    ? DARWIN_O_NOFOLLOW_ANY
    : typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0
  const directoryFlag = typeof fs.constants.O_DIRECTORY === 'number' ? fs.constants.O_DIRECTORY : 0
  const descriptor = fs.openSync(parent, fs.constants.O_RDONLY | noFollow | directoryFlag)
  try {
    assertDescriptorContained(descriptor, parent)
    operation(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
}

function descriptorOperation(parent: string, command: 'rename-excl' | 'unlink' | 'mkdir' | 'rmdir', ...names: string[]): void {
  names.forEach(validateRelativeName)
  withParentDescriptor(parent, (descriptor) => {
    const helper = fileHelperPath()
    if (process.env.NODE_ENV === 'test' && !fs.existsSync(helper)) {
      if (command === 'rename-excl') {
        const source = path.join(parent, names[0])
        const destination = path.join(parent, names[1])
        if (fs.existsSync(destination)) throw new Error('workspace sync descriptor-relative destination exists')
        fs.renameSync(source, destination)
      } else if (command === 'unlink') {
        fs.rmSync(path.join(parent, names[0]), { force: false })
      } else if (command === 'mkdir') {
        fs.mkdirSync(path.join(parent, names[0]), { mode: 0o700 })
      } else {
        fs.rmdirSync(path.join(parent, names[0]))
      }
      return
    }
    const result = spawnSync(helper, [command, ...names], { stdio: [descriptor, 'pipe', 'pipe'], encoding: 'utf8' })
    if (result.status !== 0) throw new Error(`workspace sync descriptor-relative ${command} failed`)
  })
}

function anchoredRenameExclusive(parent: string, source: string, destination: string): void {
  descriptorOperation(parent, 'rename-excl', path.basename(source), path.basename(destination))
}

function anchoredUnlink(file: string): void {
  descriptorOperation(path.dirname(file), 'unlink', path.basename(file))
}

function anchoredMkdir(directory: string): void {
  descriptorOperation(path.dirname(directory), 'mkdir', path.basename(directory))
}

function bootstrapRelativeSegments(relativePath: string): string[] {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.startsWith('~')
    || relativePath.includes('\\') || /[\u0000-\u001f]/.test(relativePath)) {
    throw new Error('workspace sync bootstrap path is invalid')
  }
  const segments = relativePath.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.length > 255)) {
    throw new Error('workspace sync bootstrap path is invalid')
  }
  return segments
}

function attestPristineBootstrapRoot(registry: MappingRegistry, mappingId: string, relativePath: string): {
  root: string
  pristine: boolean
} {
  const mappingRoot = registry.resolve(mappingId)
  const rootIdentity = directoryIdentity(mappingRoot)
  let parent = mappingRoot
  for (const segment of bootstrapRelativeSegments(relativePath)) {
    const child = path.join(parent, segment)
    const parentIdentity = directoryIdentity(parent)
    let stat: fs.Stats
    try {
      stat = fs.lstatSync(child)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      assertDirectoryIdentity(parent, parentIdentity)
      anchoredMkdir(child)
      assertDirectoryIdentity(parent, parentIdentity)
      stat = fs.lstatSync(child)
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('workspace sync bootstrap root must contain only real directories')
    }
    const real = fs.realpathSync(child)
    if (!contained(mappingRoot, real)) throw new Error('workspace sync bootstrap containment violation')
    parent = real
  }
  assertDirectoryIdentity(mappingRoot, rootIdentity)
  directoryIdentity(parent)
  return { root: parent, pristine: fs.readdirSync(parent).length === 0 }
}

function anchoredRmdir(directory: string): void {
  descriptorOperation(path.dirname(directory), 'rmdir', path.basename(directory))
}

function anchoredUnlinkBestEffort(file: string): boolean {
  try { anchoredUnlink(file); return true } catch { return !fs.existsSync(file) }
}

async function copyDurableBackup(source: string, destination: string, sha256: string, size: number): Promise<void> {
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 })
  if (fs.existsSync(destination)) {
    const stat = fs.lstatSync(destination)
    if (!stat.isSymbolicLink() && stat.isFile() && stat.size === size && await fileMatches(destination, sha256)) return
    throw new Error('workspace sync durable backup collision')
  }
  const temporary = `${destination}.${randomUUID()}.tmp`
  try {
    fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL)
    fs.chmodSync(temporary, 0o600)
    fsyncFile(temporary)
    const copied = fs.lstatSync(temporary)
    if (copied.isSymbolicLink() || !copied.isFile() || copied.size !== size || !await fileMatches(temporary, sha256)) {
      throw new Error('workspace sync durable backup verification failed')
    }
    fs.renameSync(temporary, destination)
    fsyncDirectory(path.dirname(destination))
  } catch (error) {
    fs.rmSync(temporary, { force: true })
    throw error
  }
}

function secureStateRoot(stateRoot: string): string {
  fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 })
  const stat = fs.lstatSync(stateRoot)
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('workspace sync state root must be a real directory')
  fs.chmodSync(stateRoot, 0o700)
  return fs.realpathSync(stateRoot)
}

function removeTreeBestEffort(target: string): boolean {
  try {
    fs.rmSync(target, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

function writePrivateJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${randomUUID()}.tmp`
  const descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600)
  try {
    fs.writeFileSync(descriptor, JSON.stringify(value))
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
  fs.renameSync(temporary, file)
  fsyncDirectory(path.dirname(file))
}

async function fileMatches(file: string, sha256: string): Promise<boolean> {
  if (!fs.existsSync(file)) return false
  try {
    return (await hashFile(file, DEFAULT_MAX_FILE_BYTES)).sha256 === sha256
  } catch {
    return false
  }
}

async function rollbackApplyJournal(journal: ApplyJournal, expectedRoot: string): Promise<void> {
  if (journal.root !== expectedRoot) throw new Error('workspace sync recovery journal root mismatch')
  const root = expectedRoot
  for (const entry of journal.entries) {
    if (!contained(root, entry.target) || path.dirname(entry.temporary) !== path.dirname(entry.target)
      || path.dirname(entry.adjacentBackup) !== path.dirname(entry.target)
      || !path.basename(entry.temporary).startsWith('.pib-sync-stage-')
      || !path.basename(entry.adjacentBackup).startsWith('.pib-sync-backup-')) {
      throw new Error('workspace sync recovery journal containment violation')
    }
  }
  if (journal.phase === 'committed') {
    for (const entry of journal.entries) {
      if (fs.existsSync(entry.temporary)) anchoredUnlinkBestEffort(entry.temporary)
      if (fs.existsSync(entry.adjacentBackup)) anchoredUnlinkBestEffort(entry.adjacentBackup)
    }
    return
  }
  for (const entry of [...journal.entries].reverse()) {
    if (fs.existsSync(entry.adjacentBackup)) {
      const quarantine = `${entry.adjacentBackup}.recover-${randomUUID()}`
      anchoredRenameExclusive(path.dirname(entry.adjacentBackup), entry.adjacentBackup, quarantine)
      try {
        const backupStat = fs.lstatSync(quarantine)
        if (!entry.hadTarget || !entry.originalSha256 || entry.originalSize == null
          || backupStat.isSymbolicLink() || !backupStat.isFile() || backupStat.size !== entry.originalSize
          || !await fileMatches(quarantine, entry.originalSha256)) {
          throw new Error('workspace sync recovery backup verification failed')
        }
      } catch (error) {
        if (!fs.existsSync(entry.adjacentBackup) && fs.existsSync(quarantine)) {
          anchoredRenameExclusive(path.dirname(quarantine), quarantine, entry.adjacentBackup)
        }
        throw error
      }
      if (fs.existsSync(entry.target)) {
        if (!await fileMatches(entry.target, entry.desiredSha256)) {
          anchoredRenameExclusive(path.dirname(quarantine), quarantine, entry.adjacentBackup)
          throw new Error('workspace sync recovery found concurrent target changes')
        }
        anchoredUnlink(entry.target)
      }
      anchoredRenameExclusive(path.dirname(quarantine), quarantine, entry.target)
      fsyncDirectory(path.dirname(entry.target))
    } else if (!entry.hadTarget && await fileMatches(entry.target, entry.desiredSha256)) {
      anchoredUnlink(entry.target)
    }
    if (fs.existsSync(entry.temporary)) anchoredUnlinkBestEffort(entry.temporary)
  }
  for (const directory of [...journal.createdDirectories].reverse()) {
    try {
      if (contained(root, directory) && fs.existsSync(directory) && fs.readdirSync(directory).length === 0) anchoredRmdir(directory)
    } catch {
      continue
    }
  }
}

function acquirePidFileLock(lockPath: string, busyMessage: string): () => void {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 })
  try {
    return lockSync(lockPath, {
      realpath: false,
      lockfilePath: lockPath,
      stale: 30_000,
      update: 10_000,
      retries: 0,
    })
  } catch (error) {
    if (['ELOCKED', 'EEXIST'].includes(String((error as NodeJS.ErrnoException).code))) throw new Error(busyMessage)
    throw error
  }
}

function acquireApplyLock(lockPath: string): () => void {
  return acquirePidFileLock(lockPath, 'workspace sync apply is already running')
}

function storageDownloadUrl(value: string): URL {
  const url = new URL(value)
  const allowedHost = url.hostname === 'storage.googleapis.com'
    || url.hostname === 'firebasestorage.googleapis.com'
    || url.hostname.endsWith('.storage.googleapis.com')
  if (url.protocol !== 'https:' || !allowedHost || url.username || url.password) {
    throw new Error('workspace sync object URL is not an approved storage origin')
  }
  return url
}

async function boundedFetch(fetcher: typeof fetch, input: string | URL, init: RequestInit & { duplex?: 'half' }): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('workspace sync transport timeout')), SYNC_FETCH_TIMEOUT_MS)
  try { return await fetcher(input, { ...init, signal: controller.signal }) } finally { clearTimeout(timeout) }
}

async function stageDownload(
  item: WorkspaceSyncDownload,
  destination: string,
  injected?: (url: string) => Promise<Buffer>,
): Promise<void> {
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 })
  const descriptor = fs.openSync(destination, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600)
  const hash = createHash('sha256')
  let size = 0
  try {
    if (injected) {
      const bytes = await injected(item.url)
      size = bytes.byteLength
      if (size > item.size) throw new Error('workspace sync object size verification failed')
      fs.writeFileSync(descriptor, bytes)
      hash.update(bytes)
    } else {
      const url = storageDownloadUrl(item.url)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(new Error('workspace sync transport timeout')), SYNC_FETCH_TIMEOUT_MS)
      try {
        const response = await fetch(url, { method: 'GET', redirect: 'error', signal: controller.signal })
        if (!response.ok || !response.body) throw new Error(`workspace sync object download failed (${response.status})`)
        const reader = response.body.getReader()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const bytes = Buffer.from(value)
          size += bytes.byteLength
          if (size > item.size) throw new Error('workspace sync object size verification failed')
          fs.writeSync(descriptor, bytes)
          hash.update(bytes)
        }
      } finally {
        clearTimeout(timeout)
      }
    }
    fs.fsyncSync(descriptor)
  } catch (error) {
    fs.closeSync(descriptor)
    fs.rmSync(destination, { force: true })
    throw error
  }
  fs.closeSync(descriptor)
  if (size !== item.size) {
    fs.rmSync(destination, { force: true })
    throw new Error('workspace sync object size verification failed')
  }
  if (hash.digest('hex') !== item.sha256) {
    fs.rmSync(destination, { force: true })
    throw new Error('workspace sync object hash verification failed')
  }
}

export async function applyWorkspaceSyncTransfer(input: {
  registry: MappingRegistry
  mappingId: string
  relativePath: string
  projectId: string
  transferId: string
  expectedTargetRevision: string | null
  manifest: ProjectContentManifest
  downloads: WorkspaceSyncDownload[]
}, options: {
  stateRoot: string
  download?: (url: string) => Promise<Buffer>
  retention?: { maxBackupSets?: number; maxBackupBytes?: number; maxCompletionRecords?: number }
}): Promise<{
  beforeRevision: string
  appliedRevision: string
  verifiedManifestRevision: string
  backupPath: string
}> {
  if (!SAFE_TRANSFER_ID.test(input.transferId)) throw new Error('workspace sync transfer id is invalid')
  const desired = assertManifest(input.manifest, input.projectId)
  const projectRoot = input.registry.resolve(input.mappingId, input.relativePath)
  const rootReal = fs.realpathSync(projectRoot)
  const stateReal = secureStateRoot(options.stateRoot)
  const stateKey = createHash('sha256').update(rootReal).digest('hex')
  const internalRoot = path.join(stateReal, 'workspace-sync', stateKey)
  const stageRoot = path.join(internalRoot, 'staging', input.transferId)
  const backupRoot = path.join(internalRoot, 'backups', input.transferId)
  const journalPath = path.join(internalRoot, 'journals', `${input.transferId}.json`)
  const journalsRoot = path.dirname(journalPath)
  const lockPath = path.join(internalRoot, 'apply.lock')
  fs.mkdirSync(internalRoot, { recursive: true, mode: 0o700 })
  const releaseLock = acquireApplyLock(lockPath)
  let before: ProjectContentManifest
  try {
    fs.mkdirSync(journalsRoot, { recursive: true, mode: 0o700 })
    for (const journalName of fs.readdirSync(journalsRoot).filter((name) => name.endsWith('.json')).sort()) {
      const pendingPath = path.join(journalsRoot, journalName)
      const pending = JSON.parse(fs.readFileSync(pendingPath, 'utf8')) as ApplyJournal
      if (!SAFE_TRANSFER_ID.test(pending.transferId) || pending.projectId !== input.projectId) {
        throw new Error('workspace sync recovery journal identity mismatch')
      }
      await rollbackApplyJournal(pending, rootReal)
      if (pending.phase === 'applying') {
        fs.rmSync(pendingPath, { force: true })
        fsyncDirectory(journalsRoot)
        continue
      }
      if (pending.transferId === input.transferId) {
        const current = await scanWorkspaceMapping({
          registry: input.registry,
          mappingId: input.mappingId,
          relativePath: input.relativePath,
          projectId: input.projectId,
        })
        if (pending.appliedRevision !== desired.revision || current.revision !== desired.revision) {
          throw new Error('workspace sync committed transfer state changed')
        }
        releaseLock()
        return {
          beforeRevision: pending.beforeRevision,
          appliedRevision: pending.appliedRevision,
          verifiedManifestRevision: pending.appliedRevision,
          backupPath: pending.backupPath,
        }
      }
    }
    before = await scanWorkspaceMapping({
      registry: input.registry,
      mappingId: input.mappingId,
      relativePath: input.relativePath,
      projectId: input.projectId,
    })
    if (before.revision !== input.expectedTargetRevision) throw new Error('workspace sync target revision changed')
    fs.rmSync(stageRoot, { recursive: true, force: true })
    fs.mkdirSync(stageRoot, { recursive: true, mode: 0o700 })
    fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 })
  } catch (error) {
    releaseLock()
    throw error
  }
  const beforeByPath = entryMap(before)
  const desiredByPath = entryMap(desired)
  const deletions = before.entries.filter((entry) => !desiredByPath.has(entry.path))
  const typeChanges = before.entries.filter((entry) => {
    const target = desiredByPath.get(entry.path)
    return target && target.type !== entry.type
  })
  if (deletions.length || typeChanges.length) {
    releaseLock()
    throw new Error('workspace sync refuses automatic deletion')
  }

  const downloadByPath = new Map<string, WorkspaceSyncDownload>()
  for (const item of input.downloads) {
    if (downloadByPath.has(item.path)) {
      releaseLock()
      throw new Error('workspace sync contains a duplicate download')
    }
    const desiredEntry = desiredByPath.get(item.path)
    if (!desiredEntry || desiredEntry.type !== 'file' || desiredEntry.sha256 !== item.sha256 || desiredEntry.size !== item.size) {
      releaseLock()
      throw new Error('workspace sync download is not bound to the desired manifest')
    }
    downloadByPath.set(item.path, item)
  }
  const changed = desired.entries.filter((entry): entry is Extract<ProjectManifestEntry, { type: 'file' }> => {
    if (entry.type !== 'file') return false
    const current = beforeByPath.get(entry.path)
    return !current || current.type !== 'file' || current.sha256 !== entry.sha256 || current.size !== entry.size
      || Boolean(current.executable) !== Boolean(entry.executable)
  })
  for (const entry of changed) {
    if (!downloadByPath.has(entry.path)) {
      releaseLock()
      throw new Error(`workspace sync missing download for ${entry.path}`)
    }
  }
  const createdTargetDirectories: string[] = []
  const journal: ApplyJournal = {
    root: rootReal,
    transferId: input.transferId,
    projectId: input.projectId,
    beforeRevision: before.revision,
    appliedRevision: desired.revision,
    backupPath: backupRoot,
    phase: 'applying',
    entries: [],
    createdDirectories: createdTargetDirectories,
  }
  const ensureTargetDirectory = (directory: string): void => {
    const missing: string[] = []
    let cursor = directory
    while (cursor !== rootReal && !fs.existsSync(cursor)) {
      if (!contained(rootReal, cursor)) throw new Error('workspace sync containment violation')
      missing.push(cursor)
      cursor = path.dirname(cursor)
    }
    if (fs.existsSync(cursor) && !fs.lstatSync(cursor).isDirectory()) {
      throw new Error('workspace sync target parent is not a directory')
    }
    for (const candidate of missing.reverse()) {
      createdTargetDirectories.push(candidate)
      writePrivateJson(journalPath, journal)
      anchoredMkdir(candidate)
      fsyncDirectory(path.dirname(candidate))
    }
  }
  writePrivateJson(journalPath, journal)
  try {
    for (const entry of changed) {
      const item = downloadByPath.get(entry.path)!
      const staged = safeChild(stageRoot, entry.path)
      await stageDownload(item, staged, options.download)
    }

    const rechecked = await scanWorkspaceMapping({
      registry: input.registry,
      mappingId: input.mappingId,
      relativePath: input.relativePath,
      projectId: input.projectId,
    })
    if (rechecked.revision !== before.revision) throw new Error('workspace sync target revision changed')

    for (const directory of desired.entries.filter((entry) => entry.type === 'directory')) {
      const target = safeChild(rootReal, directory.path)
      ensureTargetDirectory(target)
    }
    try {
      for (const entry of changed) {
        const lexicalTarget = safeChild(rootReal, entry.path)
        const staged = safeChild(stageRoot, entry.path)
        ensureTargetDirectory(path.dirname(lexicalTarget))
        const parentReal = fs.realpathSync(path.dirname(lexicalTarget))
        if (!contained(rootReal, parentReal)) throw new Error('workspace sync target parent containment violation')
        const parentIdentity = directoryIdentity(parentReal)
        const target = path.join(parentReal, path.basename(lexicalTarget))
        const token = createHash('sha256').update(`${input.transferId}\0${entry.path}`).digest('hex').slice(0, 32)
        const temporary = path.join(parentReal, `.pib-sync-stage-${token}`)
        const adjacentBackup = path.join(parentReal, `.pib-sync-backup-${token}`)
        const durableBackup = safeChild(backupRoot, entry.path)
        if (fs.existsSync(temporary) || fs.existsSync(adjacentBackup)) throw new Error('workspace sync target staging collision')
        const hadTarget = fs.existsSync(target)
        const original = beforeByPath.get(entry.path)
        if (hadTarget && (!original || original.type !== 'file')) throw new Error(`workspace sync unsafe original target: ${entry.path}`)
        journal.entries.push({
          relativePath: entry.path,
          target,
          temporary,
          adjacentBackup,
          durableBackup,
          hadTarget,
          desiredSha256: entry.sha256,
          originalSha256: original?.type === 'file' ? original.sha256 : null,
          originalSize: original?.type === 'file' ? original.size : null,
        })
        writePrivateJson(journalPath, journal)
        fs.copyFileSync(staged, temporary, fs.constants.COPYFILE_EXCL)
        fs.chmodSync(temporary, entry.executable ? 0o700 : 0o600)
        fsyncFile(temporary)
        assertDirectoryIdentity(parentReal, parentIdentity)
        if (hadTarget) {
          const stat = fs.lstatSync(target)
          if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`workspace sync unsafe target: ${entry.path}`)
          anchoredRenameExclusive(parentReal, target, adjacentBackup)
          fsyncDirectory(parentReal)
        }
        try {
          assertDirectoryIdentity(parentReal, parentIdentity)
          anchoredRenameExclusive(parentReal, temporary, target)
          fsyncDirectory(parentReal)
        } catch (error) {
          if (fs.existsSync(adjacentBackup)) {
            anchoredRenameExclusive(parentReal, adjacentBackup, target)
            fsyncDirectory(parentReal)
          }
          throw error
        }
      }
      const verified = await scanWorkspaceMapping({
        registry: input.registry,
        mappingId: input.mappingId,
        relativePath: input.relativePath,
        projectId: input.projectId,
      })
      if (verified.revision !== desired.revision) throw new Error('workspace sync applied manifest verification failed')
      for (const item of journal.entries) {
        if (!fs.existsSync(item.adjacentBackup)) continue
        if (!item.originalSha256 || item.originalSize == null) throw new Error('workspace sync backup journal is incomplete')
        await copyDurableBackup(item.adjacentBackup, item.durableBackup, item.originalSha256, item.originalSize)
      }
      journal.phase = 'committed'
      journal.committedAt = new Date().toISOString()
      writePrivateJson(journalPath, journal)
      for (const item of journal.entries) {
        if (anchoredUnlinkBestEffort(item.adjacentBackup)) fsyncDirectory(path.dirname(item.adjacentBackup))
      }
      gcWorkspaceSyncState(internalRoot, {
        maxBackupSets: options.retention?.maxBackupSets ?? 3,
        maxBackupBytes: options.retention?.maxBackupBytes ?? 300 * 1024 * 1024,
        maxCompletionRecords: options.retention?.maxCompletionRecords ?? 50,
      })
    } catch (error) {
      await rollbackApplyJournal(journal, rootReal)
      fs.rmSync(journalPath, { force: true })
      throw error
    }
  } catch (error) {
    removeTreeBestEffort(stageRoot)
    for (const directory of createdTargetDirectories.reverse()) {
      try {
        if (fs.existsSync(directory) && fs.readdirSync(directory).length === 0) anchoredRmdir(directory)
      } catch {
        continue
      }
    }
    releaseLock()
    throw error
  }
  removeTreeBestEffort(stageRoot)
  releaseLock()
  return {
    beforeRevision: before.revision,
    appliedRevision: desired.revision,
    verifiedManifestRevision: desired.revision,
    backupPath: backupRoot,
  }
}

interface SpoolEntry {
  id: string
  path: string
  body: unknown
  createdAt: string
}

export class DurableSyncSpool {
  constructor(private readonly file: string) {}

  private read(): SpoolEntry[] {
    if (!fs.existsSync(this.file)) return []
    try {
      const rows = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== 'object'
        || typeof row.id !== 'string' || typeof row.path !== 'string' || !row.path.startsWith('/sync/')
        || typeof row.createdAt !== 'string')) {
        throw new Error('invalid rows')
      }
      return rows as SpoolEntry[]
    } catch {
      throw new Error('workspace sync spool is corrupt')
    }
  }

  private save(rows: SpoolEntry[]): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 })
    fs.chmodSync(path.dirname(this.file), 0o700)
    writePrivateJson(this.file, rows)
  }

  private acquireLock(): () => void {
    return acquirePidFileLock(`${this.file}.lock`, 'workspace sync spool is busy')
  }

  enqueue(endpoint: string, body: unknown): void {
    if (!endpoint.startsWith('/sync/')) throw new Error('workspace sync spool endpoint is not allowed')
    const release = this.acquireLock()
    try {
      const rows = this.read()
      if (rows.length >= 1000) throw new Error('workspace sync spool is full')
      rows.push({ id: randomUUID(), path: endpoint, body, createdAt: new Date().toISOString() })
      this.save(rows)
    } finally {
      release()
    }
  }

  size(): number {
    return this.read().length
  }

  async flush(send: (endpoint: string, body: unknown) => Promise<Response>): Promise<{ delivered: number; remaining: number }> {
    const snapshotRelease = this.acquireLock()
    let rows: SpoolEntry[]
    try {
      rows = this.read()
    } finally {
      snapshotRelease()
    }
    const terminal = new Set<string>()
    let delivered = 0
    for (const row of rows) {
      try {
        const response = await send(row.path, row.body)
        const terminalRejection = [400, 401, 403, 404, 409, 410].includes(response.status)
        if (response.ok || terminalRejection) {
          delivered += 1
          terminal.add(row.id)
        }
      } catch {
        continue
      }
    }
    const mergeRelease = this.acquireLock()
    try {
      const pending = this.read().filter((row) => !terminal.has(row.id))
      this.save(pending)
      return { delivered, remaining: pending.length }
    } finally {
      mergeRelease()
    }
  }
}

interface MonitorEntry<TPayload> {
  key: string
  baselineRevision: string
  candidateRevision: string | null
  dirtySince: number | null
  nextScanAt: number
  payload: TPayload
}

export class WorkspaceSyncMonitor<TPayload = Record<string, unknown>> {
  private readonly entries = new Map<string, MonitorEntry<TPayload>>()
  private running = false

  constructor(private readonly options: {
    scan: (payload: TPayload) => Promise<ProjectContentManifest>
    report: (payload: TPayload, manifest: ProjectContentManifest) => Promise<void>
    scanIntervalMs?: number
    debounceMs?: number
  }) {}

  track(input: { key: string; baselineRevision: string; payload: TPayload }): void {
    this.entries.set(input.key, {
      ...input,
      candidateRevision: null,
      dirtySince: null,
      nextScanAt: 0,
    })
  }

  untrack(key: string): void {
    this.entries.delete(key)
  }

  async tick(now = Date.now()): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      for (const entry of this.entries.values()) {
        if (now < entry.nextScanAt) continue
        entry.nextScanAt = now + (this.options.scanIntervalMs ?? 5_000)
        const manifest = await this.options.scan(entry.payload)
        if (manifest.revision === entry.baselineRevision) {
          entry.candidateRevision = null
          entry.dirtySince = null
          continue
        }
        if (entry.candidateRevision !== manifest.revision) {
          entry.candidateRevision = manifest.revision
          entry.dirtySince = now
          continue
        }
        if (entry.dirtySince == null || now - entry.dirtySince < (this.options.debounceMs ?? 1_500)) continue
        await this.options.report(entry.payload, manifest)
        entry.baselineRevision = manifest.revision
        entry.candidateRevision = null
        entry.dirtySince = null
      }
    } finally {
      this.running = false
    }
  }
}

export interface WorkspaceSyncRuntimeBinding {
  capability: 'workspace.sync'
  requestId: string
  orgId: string
  projectId: string
  replicaId: string
  locationId: string
  mappingId: string
}

interface SignedRuntimeObject extends WorkspaceSyncDownload {
  expiresAt: string
}

export type WorkspaceSyncRuntimeJob =
  | {
      jobId: string
      kind: 'inventory'
      binding: WorkspaceSyncRuntimeBinding
      relativePath: string
      recurring: boolean
      baselineRevision: string | null
      bootstrapMissingRoot: boolean
    }
  | {
      jobId: string
      kind: 'failure'
      binding: WorkspaceSyncRuntimeBinding
      relativePath: string
      transferId: string
      reason: 'unsupported_scale'
    }
  | {
      jobId: string
      kind: 'upload'
      binding: WorkspaceSyncRuntimeBinding
      relativePath: string
      manifest: ProjectContentManifest
      objects: SignedRuntimeObject[]
    }
  | {
      jobId: string
      kind: 'apply'
      binding: WorkspaceSyncRuntimeBinding
      relativePath: string
      transferId: string
      expectedTargetRevision: string | null
      manifest: ProjectContentManifest
      objects: SignedRuntimeObject[]
    }

async function postSyncReceipt(
  endpoint: string,
  body: unknown,
  post: (endpoint: string, body: unknown) => Promise<Response>,
  spool: DurableSyncSpool,
): Promise<'delivered' | 'queued'> {
  try {
    const response = await post(endpoint, body)
    if (response.ok) return 'delivered'
    if (response.status >= 500 || response.status === 408 || response.status === 425 || response.status === 429) {
      spool.enqueue(endpoint, body)
      return 'queued'
    }
    throw new Error(`workspace sync receipt rejected (${response.status})`)
  } catch (error) {
    if (error instanceof Error && /rejected/.test(error.message)) throw error
    spool.enqueue(endpoint, body)
    return 'queued'
  }
}

function snapshotUploadFile(input: {
  source: string
  approvedRoot: string
  snapshotRoot: string
  sha256: string
  size: number
}): string {
  const noFollow = process.platform === 'darwin'
    ? DARWIN_O_NOFOLLOW_ANY
    : typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0
  fs.mkdirSync(input.snapshotRoot, { recursive: true, mode: 0o700 })
  fs.chmodSync(input.snapshotRoot, 0o700)
  const sourceDescriptor = fs.openSync(input.source, fs.constants.O_RDONLY | noFollow)
  const before = fs.fstatSync(sourceDescriptor)
  const snapshot = path.join(input.snapshotRoot, `${randomUUID()}.upload`)
  let snapshotDescriptor: number | null = null
  try {
    if (!before.isFile() || before.size !== input.size) throw new Error('workspace sync upload source verification failed')
    assertDescriptorContained(sourceDescriptor, input.approvedRoot)
    snapshotDescriptor = fs.openSync(snapshot, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600)
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    let size = 0
    while (true) {
      const count = fs.readSync(sourceDescriptor, buffer, 0, buffer.length, null)
      if (count === 0) break
      size += count
      if (size > input.size) throw new Error('workspace sync upload source verification failed')
      const bytes = buffer.subarray(0, count)
      hash.update(bytes)
      fs.writeSync(snapshotDescriptor, bytes)
    }
    const after = fs.fstatSync(sourceDescriptor)
    if (size !== input.size || hash.digest('hex') !== input.sha256 || after.size !== before.size
      || after.dev !== before.dev || after.ino !== before.ino || after.mtimeMs !== before.mtimeMs
      || after.ctimeMs !== before.ctimeMs) {
      throw new Error('workspace sync upload source changed during verified snapshot')
    }
    fs.fsyncSync(snapshotDescriptor)
    fs.closeSync(snapshotDescriptor)
    snapshotDescriptor = null
    fsyncDirectory(input.snapshotRoot)
    return snapshot
  } catch (error) {
    if (snapshotDescriptor != null) fs.closeSync(snapshotDescriptor)
    fs.rmSync(snapshot, { force: true })
    throw error
  } finally {
    fs.closeSync(sourceDescriptor)
  }
}

export async function executeWorkspaceSyncJob(
  job: WorkspaceSyncRuntimeJob,
  options: {
    registry: MappingRegistry
    stateRoot: string
    post: (endpoint: string, body: unknown) => Promise<Response>
    fetcher?: typeof fetch
    spool?: DurableSyncSpool
  },
): Promise<Record<string, unknown>> {
  const spool = options.spool ?? new DurableSyncSpool(path.join(options.stateRoot, 'workspace-sync-receipts.json'))
  if (job.kind === 'inventory') {
    let manifest: ProjectContentManifest
    let pristineBootstrap = false
    try {
      const bootstrap = job.bootstrapMissingRoot
        ? attestPristineBootstrapRoot(options.registry, job.binding.mappingId, job.relativePath)
        : null
      manifest = await scanWorkspaceMapping({
        registry: options.registry,
        mappingId: job.binding.mappingId,
        relativePath: job.relativePath,
        projectId: job.binding.projectId,
      })
      pristineBootstrap = Boolean(bootstrap?.pristine
        && manifest.entryCount === 0
        && manifest.totalBytes === 0
        && fs.readdirSync(bootstrap.root).length === 0)
    } catch (error) {
      const sourceCode = runtimeErrorCode(error)
      const message = runtimeErrorMessage(error)
      const reason = ['ENOENT', 'ENOTDIR', 'EISDIR', 'EACCES', 'EPERM', 'ELOOP', 'ESTALE'].includes(String(sourceCode))
        || /\b(?:ENOENT|ENOTDIR|EISDIR|EACCES|EPERM|ELOOP|ESTALE)\b|permission denied|not portable|path collision|path is not eligible|rejects symlink|containment violation/i.test(message)
        ? 'unsupported_path'
        : /maximum|exceeds \d+ entries|total size/.test(message) ? 'unsupported_scale' : null
      if (!reason) throw error
      const delivery = await postSyncReceipt('/sync/failure', {
        jobId: job.jobId,
        jobKind: job.kind,
        binding: job.binding,
        reason,
        failedAt: new Date().toISOString(),
      }, options.post, spool)
      return { kind: 'inventory', status: 'conflict', reason, delivery }
    }
    const receipt = {
      jobId: job.jobId,
      binding: job.binding,
      manifest,
      ...(pristineBootstrap ? { pristineBootstrap: true } : {}),
      observedAt: new Date().toISOString(),
    }
    const delivery = await postSyncReceipt('/sync/inventory', receipt, options.post, spool)
    return { kind: 'inventory', manifest, pristineBootstrap, delivery }
  }
  if (job.kind === 'failure') {
    const delivery = await postSyncReceipt('/sync/failure', {
      jobId: job.jobId,
      jobKind: job.kind,
      binding: job.binding,
      transferId: job.transferId,
      reason: job.reason,
      failedAt: new Date().toISOString(),
    }, options.post, spool)
    return { kind: job.kind, status: 'conflict', reason: job.reason, delivery }
  }
  if (job.kind === 'upload') {
    const manifest = assertManifest(job.manifest, job.binding.projectId)
    const manifestEntries = entryMap(manifest)
    const seenPaths = new Set<string>()
    const seenContent = new Set<string>()
    for (const object of job.objects) {
      const expected = manifestEntries.get(object.path)
      const contentKey = `${object.sha256}:${object.size}`
      if (seenPaths.has(object.path) || seenContent.has(contentKey) || excluded(object.path)
        || !expected || expected.type !== 'file' || expected.sha256 !== object.sha256 || expected.size !== object.size) {
        throw new Error('workspace sync upload object is not uniquely bound to the manifest')
      }
      seenPaths.add(object.path)
      seenContent.add(contentKey)
    }
    const fetcher = options.fetcher ?? fetch
    const snapshotRoot = path.join(secureStateRoot(options.stateRoot), 'workspace-sync', 'upload-snapshots')
    try {
      const projectRoot = options.registry.resolve(job.binding.mappingId, job.relativePath)
      for (const object of job.objects) {
        const expiresAt = Date.parse(object.expiresAt)
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('workspace sync upload URL expired')
        storageDownloadUrl(object.url)
        const source = safeChild(projectRoot, object.path)
        const snapshot = snapshotUploadFile({ source, approvedRoot: projectRoot, snapshotRoot, sha256: object.sha256, size: object.size })
        const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0
        const snapshotDescriptor = fs.openSync(snapshot, fs.constants.O_RDONLY | noFollow)
        const body = fs.createReadStream(snapshot, { fd: snapshotDescriptor, autoClose: true })
        try {
          const request: RequestInit & { duplex: 'half' } = {
            method: 'PUT',
            headers: object.headers,
            body: body as unknown as BodyInit,
            redirect: 'error',
            duplex: 'half',
          }
          const response = await boundedFetch(fetcher, object.url, request)
          if (!response.ok && response.status !== 412) throw new Error(`workspace sync object upload failed (${response.status})`)
        } finally {
          if (!body.closed) {
            const closed = new Promise<void>((resolve) => body.once('close', resolve))
            body.destroy()
            await closed
          }
          fs.rmSync(snapshot, { force: true })
        }
      }
    } catch (error) {
      const sourceCode = runtimeErrorCode(error)
      const message = runtimeErrorMessage(error)
      const reason = ['ENOENT', 'ENOTDIR', 'EISDIR', 'EACCES', 'EPERM', 'ELOOP', 'ESTALE'].includes(String(sourceCode))
        || /\b(?:ENOENT|ENOTDIR|EISDIR|EACCES|EPERM|ELOOP|ESTALE)\b|permission denied|upload source|source (?:verification failed|changed)|opened file escaped/i.test(message)
        ? 'source_drift'
        : /URL expired|upload failed|transport timeout|aborted/i.test(message) ? 'retryable_transport' : null
      if (!reason) throw error
      const delivery = await postSyncReceipt('/sync/failure', {
        jobId: job.jobId,
        jobKind: job.kind,
        binding: job.binding,
        reason,
        failedAt: new Date().toISOString(),
      }, options.post, spool)
      return { kind: 'upload', status: reason === 'source_drift' ? 'refreshing_inventory' : 'retrying', reason, delivery }
    }
    const objects = job.objects.map(({ path: objectPath, sha256, size }) => ({ path: objectPath, sha256, size }))
    const delivery = await postSyncReceipt('/sync/upload-receipt', {
      jobId: job.jobId,
      binding: job.binding,
      objects,
    }, options.post, spool)
    return { kind: 'upload', objects, delivery }
  }
  let applied: Awaited<ReturnType<typeof applyWorkspaceSyncTransfer>>
  try {
    applied = await applyWorkspaceSyncTransfer({
      registry: options.registry,
      mappingId: job.binding.mappingId,
      relativePath: job.relativePath,
      projectId: job.binding.projectId,
      transferId: job.transferId,
      expectedTargetRevision: job.expectedTargetRevision,
      manifest: job.manifest,
      downloads: job.objects,
    }, { stateRoot: options.stateRoot })
  } catch (error) {
    if (!(error instanceof Error)) throw error
    const reason = /refuses automatic deletion/.test(error.message)
      ? 'non_destructive_apply_required'
      : /target revision changed/.test(error.message) ? 'target_drift'
        : /download failed|object URL|transport timeout|aborted/i.test(error.message) ? 'retryable_transport'
          : /verification failed|hash verification|size verification|unsafe target|containment/i.test(error.message) ? 'integrity_failure' : null
    if (!reason) throw error
    let observedRevision: string | undefined
    if (reason === 'target_drift') {
      observedRevision = (await scanWorkspaceMapping({
        registry: options.registry,
        mappingId: job.binding.mappingId,
        relativePath: job.relativePath,
        projectId: job.binding.projectId,
      }).catch(() => null))?.revision
    }
    const delivery = await postSyncReceipt('/sync/failure', {
      jobId: job.jobId,
      jobKind: job.kind,
      binding: job.binding,
      transferId: job.transferId,
      reason,
      observedRevision,
      failedAt: new Date().toISOString(),
    }, options.post, spool)
    return { kind: 'apply', status: reason === 'retryable_transport' ? 'retrying' : 'conflict', reason, delivery }
  }
  const delivery = await postSyncReceipt('/sync/receipt', {
    jobId: job.jobId,
    binding: job.binding,
    transferId: job.transferId,
    beforeRevision: applied.beforeRevision,
    appliedRevision: applied.appliedRevision,
    verifiedManifestRevision: applied.verifiedManifestRevision,
    verifiedAt: new Date().toISOString(),
  }, options.post, spool)
  return { kind: 'apply', ...applied, delivery }
}

export async function pollWorkspaceSyncForever(
  claim: () => Promise<WorkspaceSyncRuntimeJob | null>,
  run: (job: WorkspaceSyncRuntimeJob) => Promise<unknown>,
  flush: () => Promise<unknown>,
  tick: () => Promise<unknown>,
  stop: () => boolean = () => false,
): Promise<void> {
  let delay = 500
  while (!stop()) {
    await flush().catch(() => undefined)
    await tick().catch(() => undefined)
    const job = await claim().catch(() => null)
    if (job) {
      delay = 500
      await run(job).catch(() => undefined)
      continue
    }
    await new Promise((resolve) => setTimeout(resolve, delay + Math.floor(Math.random() * delay)))
    delay = Math.min(delay * 2, 15_000)
  }
}
