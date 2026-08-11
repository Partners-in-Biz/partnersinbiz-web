import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFile, spawn } from 'node:child_process'
import { createHash, createPrivateKey, randomUUID, sign } from 'node:crypto'
import { TextDecoder } from 'node:util'
import { MappingRegistry } from './bridge'

const DEFAULT_MAX_FILE_BYTES = 1024 * 1024
const DEFAULT_MAX_LIST_ENTRIES = 1_000
const DEFAULT_MAX_GIT_OUTPUT_BYTES = 2 * 1024 * 1024
const DEFAULT_GIT_TIMEOUT_MS = 5_000
const MAX_ERROR_BYTES = 400
// Shared with linked-run worker: idle claim cadence is a Firestore cost lever
// (signed request → nonce write → TTL delete). 5s idle is still snappy for humans.
// Secondary workbench claims are less latency-sensitive than linked-run
// execution. Cap idle polls at 15s to cut nonce write/TTL-delete spend.
const MAX_IDLE_CLAIM_BASE_DELAY_MS = 15_000
const DEFAULT_SHELL_TIMEOUT_MS = 30_000
const MAX_SHELL_TIMEOUT_MS = 60_000
const MAX_SHELL_OUTPUT_BYTES = 2 * 1024 * 1024
const MAX_SHELL_ARGV_LENGTH = 16
const MAX_SHELL_ARG_BYTES = 256

// This block (constants + ALLOWLISTED_ARGV + isAllowlistedArgv) is a runtime-local
// mirror of lib/messages/workbench/shell-allowlist.ts. The runtime is a standalone
// commonjs bundle (see runtime-installers/runtime/tsconfig.json: rootDir "." forbids
// importing files from outside this directory), so it cannot import the server copy
// directly — keep these two allowlists identical by hand. The server already
// validates/normalizes argv via parseWorkbenchOperation before a job is ever queued,
// so this check is defense-in-depth: it must never be stricter than the server list
// or legitimately queued jobs would be rejected here.
const ALLOWLISTED_ARGV: readonly (readonly string[])[] = [
  ['node', '--version'],
  ['npm', '--version'],
  ['npm', 'test'],
  ['npm', 'run', 'lint'],
  ['pnpm', '--version'],
  ['pnpm', 'test'],
  ['pnpm', 'lint'],
  ['yarn', '--version'],
  ['python3', '--version'],
  ['python', '--version'],
  ['uname', '-a'],
  ['which', 'node'],
  ['ls', '-la'],
  ['git', 'log', '--oneline', '-n', '20'],
  ['git', 'branch', '--show-current'],
]

function isSafePolicyArgv(argv: readonly string[]): boolean {
  const executable = String(argv[0] ?? '').toLowerCase().split('/').pop()
  const destructive = new Set([
    'sh', 'bash', 'zsh', 'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh',
    'rm', 'rmdir', 'dd', 'diskutil', 'shutdown', 'reboot', 'halt', 'poweroff',
    'kill', 'pkill', 'killall', 'chmod', 'chown', 'sudo', 'su', 'curl', 'wget',
  ])
  return argv.length > 0 && argv.length <= MAX_SHELL_ARGV_LENGTH
    && !destructive.has(executable ?? '')
    && !(executable?.startsWith('mkfs'))
    && !(executable === 'git' && ['clean', 'reset'].includes(String(argv[1] ?? '').toLowerCase()))
    && argv.every((part) => typeof part === 'string'
      && part.length > 0
      && part.length <= MAX_SHELL_ARG_BYTES
      && !/[|;$<>`&(){}[\]*?~\u0000-\u001f]/.test(part))
}

function isAllowlistedArgv(argv: readonly string[], policy?: readonly (readonly string[])[]): boolean {
  const allowlist = policy?.length && policy.length <= 40 && policy.every(isSafePolicyArgv)
    ? policy
    : ALLOWLISTED_ARGV
  return allowlist.some((allowed) => allowed.length === argv.length && allowed.every((value, index) => value === argv[index]))
}

const SAFE_SHELL_ENV_KEYS = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'TERM', 'USER', 'SHELL'] as const

export function sanitizedShellEnv(): NodeJS.ProcessEnv {
  const env: Record<string, string> = {}
  for (const key of SAFE_SHELL_ENV_KEYS) {
    const value = process.env[key]
    if (typeof value === 'string') env[key] = value
  }
  return env as NodeJS.ProcessEnv
}

export type WorkbenchRuntimeOperation =
  | { kind: 'fs.list'; path: string }
  | { kind: 'fs.search'; query: string; entryType: 'file' | 'directory'; limit?: number }
  | { kind: 'fs.read'; path: string }
  | { kind: 'fs.write'; path: string; content: string; expectedSha256?: string | null }
  | { kind: 'git.status' }
  | { kind: 'git.diff'; path?: string; staged?: boolean }
  | { kind: 'shell.exec'; argv: string[]; cwd?: string; timeoutMs?: number; allowedShellArgv?: string[][] }

export type WorkbenchRuntimeJob = {
  jobId: string
  requestId?: string
  mappingId: string
  relativeFolder?: string
  workingDirectory?: string
  attempt: number
  leaseToken: string
  kind: WorkbenchRuntimeOperation['kind']
  operation: WorkbenchRuntimeOperation
  workspaceId?: string
}

export type WorkbenchGitChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'

export type WorkbenchGitChange = {
  path: string
  originalPath?: string
  status: WorkbenchGitChangeStatus
  staged: boolean
  unstaged: boolean
}

export type WorkbenchOperationResult =
  | { entries: Array<{ path: string; type: 'file' | 'directory'; size?: number }> }
  | { content: string; sha256: string }
  | { bytesWritten: number; sha256: string }
  | { changes: WorkbenchGitChange[] }
  | { diff: string }
  | { exitCode: number; stdout: string; stderr: string; truncated?: boolean; durationMs?: number }

export type WorkbenchExecutorOptions = {
  maxFileBytes?: number
  maxListEntries?: number
  maxGitOutputBytes?: number
  gitTimeoutMs?: number
  retryDelayMs?: number
  maxShellOutputBytes?: number
  shellTimeoutMs?: number
  /** Best-effort progress sink for shell.exec streaming; failures never abort the job. */
  onShellProgress?: (chunk: { stream: 'stdout' | 'stderr'; text: string; seq: number }) => void
}

export type WorkbenchDevice = {
  deviceId: string
  credentialVersion: number
  privateKey: string
}

export class WorkbenchConflictError extends Error {
  readonly code = 'stale_hash'

  constructor(message = 'stale expectedSha256 conflict') {
    super(message)
    this.name = 'WorkbenchConflictError'
  }
}

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const isContained = (root: string, candidate: string) => candidate === root || candidate.startsWith(`${root}${path.sep}`)

function positiveLimit(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback
}

function assertValidClaim(job: WorkbenchRuntimeJob): void {
  const identifier = /^[A-Za-z0-9_-]{1,128}$/
  if (!job || typeof job !== 'object'
    || !identifier.test(job.jobId)
    || !identifier.test(job.mappingId)
    || (job.requestId !== undefined && !identifier.test(job.requestId))
    || !Number.isSafeInteger(job.attempt) || job.attempt < 1
    || typeof job.leaseToken !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(job.leaseToken)
    || !job.operation || typeof job.operation !== 'object'
    || !['fs.list', 'fs.search', 'fs.read', 'fs.write', 'git.status', 'git.diff', 'shell.exec'].includes(job.kind)
    || job.kind !== job.operation.kind) {
    throw new Error('invalid workbench claim')
  }
}

export function normalizeRelativePath(value: unknown, allowRoot: boolean): string {
  if (typeof value !== 'string') throw new Error('unsafe workbench path')
  if (allowRoot && (value === '' || value === '.')) return ''
  if (
    !value ||
    value !== value.trim() ||
    value.length > 512 ||
    value.includes('\\') ||
    value.startsWith('/') ||
    value.startsWith('~') ||
    /^[A-Za-z]:/.test(value) ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error('unsafe workbench path')
  }
  const segments = value.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('unsafe workbench path')
  }
  return segments.join('/')
}

export function mappedRoot(job: Pick<WorkbenchRuntimeJob, 'mappingId' | 'relativeFolder' | 'workingDirectory'>, registry: MappingRegistry): string {
  const relativeFolder = normalizeRelativePath(job.relativeFolder ?? '', true)
  const resolved = registry.resolve(job.mappingId, relativeFolder, job.workingDirectory)
  const root = fs.realpathSync(resolved)
  if (!fs.statSync(root).isDirectory()) throw new Error('workbench mapping must resolve to a directory')
  return root
}

export function resolveExisting(root: string, relativePath: string): string {
  const candidate = path.join(root, relativePath)
  let real: string
  try {
    real = fs.realpathSync(candidate)
  } catch {
    throw new Error('workbench path does not exist')
  }
  if (!isContained(root, real)) throw new Error('workbench symlink containment violation')
  return real
}

function decodeText(bytes: Buffer, label: string): string {
  if (bytes.includes(0)) throw new Error(`${label} is binary`)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error(`${label} is binary`)
  }
}

function ensureTextContent(content: unknown, maxBytes: number): Buffer {
  if (typeof content !== 'string' || content.includes('\0')) throw new Error('workbench write content is binary')
  const bytes = Buffer.from(content, 'utf8')
  if (bytes.byteLength > maxBytes) throw new Error('workbench file size limit exceeded')
  return bytes
}

function fileSnapshot(file: string): { dev: number; ino: number; size: number; mtimeMs: number } {
  const stat = fs.lstatSync(file)
  if (stat.isSymbolicLink()) throw new Error('workbench write through symlink is forbidden')
  if (!stat.isFile()) throw new Error('workbench write target must be a regular file')
  return { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs }
}

function sameSnapshot(left: ReturnType<typeof fileSnapshot>, right: ReturnType<typeof fileSnapshot>): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs
}

function fsyncDirectory(directory: string): void {
  let descriptor: number | undefined
  try {
    descriptor = fs.openSync(directory, fs.constants.O_RDONLY)
    fs.fsyncSync(descriptor)
  } catch {
    // Some supported filesystems/platforms do not permit fsync on directories.
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
}

async function listFiles(operation: Extract<WorkbenchRuntimeOperation, { kind: 'fs.list' }>, root: string, options: WorkbenchExecutorOptions): Promise<WorkbenchOperationResult> {
  const relativePath = normalizeRelativePath(operation.path, true)
  const directory = resolveExisting(root, relativePath)
  if (!fs.statSync(directory).isDirectory()) throw new Error('workbench list target must be a directory')
  const entries = fs.readdirSync(directory, { withFileTypes: true })
  const maxEntries = positiveLimit(options.maxListEntries, DEFAULT_MAX_LIST_ENTRIES)
  if (entries.length > maxEntries) throw new Error('workbench directory entry limit exceeded')
  const result = entries.flatMap((entry) => {
    const entryPath = relativePath ? `${relativePath}/${entry.name}` : entry.name
    const absolute = path.join(directory, entry.name)
    const stat = fs.lstatSync(absolute)
    if (!entry.isFile() && !entry.isDirectory()) return []
    const type = entry.isFile() ? 'file' as const : 'directory' as const
    return [{
      path: entryPath,
      type,
      ...(type === 'file' ? { size: stat.size } : {}),
    }]
  }).sort((left, right) => left.path.localeCompare(right.path))
  return { entries: result }
}

const SEARCH_IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'coverage', '.cache'])

async function searchFiles(
  operation: Extract<WorkbenchRuntimeOperation, { kind: 'fs.search' }>,
  root: string,
): Promise<WorkbenchOperationResult> {
  const query = operation.query.trim().toLocaleLowerCase()
  const limit = Math.min(Math.max(operation.limit ?? 8, 1), 20)
  if (!query || query.length > 120 || !['file', 'directory'].includes(operation.entryType)) {
    throw new Error('invalid workbench search')
  }
  const matches: Array<{ path: string; type: 'file' | 'directory'; size?: number }> = []
  const pending: Array<{ absolute: string; relative: string; depth: number }> = [{ absolute: root, relative: '', depth: 0 }]
  let visited = 0
  while (pending.length && matches.length < limit && visited < 10_000) {
    const current = pending.shift()!
    for (const entry of fs.readdirSync(current.absolute, { withFileTypes: true })) {
      visited += 1
      if (visited > 10_000) break
      if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) continue
      const relative = current.relative ? `${current.relative}/${entry.name}` : entry.name
      const type = entry.isDirectory() ? 'directory' as const : 'file' as const
      if (type === operation.entryType && relative.toLocaleLowerCase().includes(query)) {
        const stat = fs.lstatSync(path.join(current.absolute, entry.name))
        matches.push({ path: relative, type, ...(type === 'file' ? { size: stat.size } : {}) })
        if (matches.length >= limit) break
      }
      if (entry.isDirectory() && current.depth < 8 && !SEARCH_IGNORED_DIRECTORIES.has(entry.name)) {
        pending.push({ absolute: path.join(current.absolute, entry.name), relative, depth: current.depth + 1 })
      }
    }
  }
  return { entries: matches.sort((left, right) => left.path.localeCompare(right.path)) }
}

async function readFile(operation: Extract<WorkbenchRuntimeOperation, { kind: 'fs.read' }>, root: string, options: WorkbenchExecutorOptions): Promise<WorkbenchOperationResult> {
  const relativePath = normalizeRelativePath(operation.path, false)
  const file = resolveExisting(root, relativePath)
  const stat = fs.statSync(file)
  if (!stat.isFile()) throw new Error('workbench read target must be a regular file')
  const maxBytes = positiveLimit(options.maxFileBytes, DEFAULT_MAX_FILE_BYTES)
  if (stat.size > maxBytes) throw new Error('workbench file size limit exceeded')
  const bytes = fs.readFileSync(file)
  if (bytes.byteLength > maxBytes) throw new Error('workbench file size limit exceeded')
  return { content: decodeText(bytes, 'workbench file'), sha256: digest(bytes) }
}

async function writeFile(operation: Extract<WorkbenchRuntimeOperation, { kind: 'fs.write' }>, root: string, options: WorkbenchExecutorOptions): Promise<WorkbenchOperationResult> {
  const relativePath = normalizeRelativePath(operation.path, false)
  if (operation.expectedSha256 !== undefined && operation.expectedSha256 !== null
    && (typeof operation.expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(operation.expectedSha256))) {
    throw new Error('fs.write requires expectedSha256 or null')
  }
  const bytes = ensureTextContent(operation.content, positiveLimit(options.maxFileBytes, DEFAULT_MAX_FILE_BYTES))
  const requested = path.join(root, relativePath)
  const parent = resolveExisting(root, path.dirname(relativePath))
  if (!fs.statSync(parent).isDirectory()) throw new Error('workbench write parent must be a directory')
  const target = path.join(parent, path.basename(requested))
  if (!isContained(root, target)) throw new Error('workbench symlink containment violation')

  const existed = fs.existsSync(target)
  const before = existed ? fileSnapshot(target) : null
  if (before && before.size > positiveLimit(options.maxFileBytes, DEFAULT_MAX_FILE_BYTES)) {
    throw new Error('workbench file size limit exceeded')
  }
  const previousSha256 = before ? digest(fs.readFileSync(target)) : null
  const expected = operation.expectedSha256?.toLowerCase() ?? null
  if (previousSha256 !== expected) throw new WorkbenchConflictError()

  const temporary = `${target}.${randomUUID()}.tmp`
  let descriptor: number | undefined
  try {
    descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, before ? fs.lstatSync(target).mode & 0o777 : 0o600)
    fs.writeFileSync(descriptor, bytes)
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = undefined

    if (before) {
      if (!fs.existsSync(target) || !sameSnapshot(before, fileSnapshot(target))) throw new WorkbenchConflictError()
    } else if (fs.existsSync(target)) {
      throw new WorkbenchConflictError()
    }
    fs.renameSync(temporary, target)
    fsyncDirectory(parent)
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
    fs.rmSync(temporary, { force: true })
  }

  return {
    bytesWritten: bytes.byteLength,
    sha256: digest(bytes),
  }
}

function gitError(error: { code?: string | number | null; killed?: boolean; signal?: string | null; message: string }): Error {
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || /maxbuffer/i.test(error.message)) {
    return new Error('git output limit exceeded')
  }
  if (error.killed || error.signal || /timed out|timeout/i.test(error.message)) {
    return new Error('git command timed out')
  }
  return new Error('git command failed')
}

function boundGitArguments(root: string, args: string[]): string[] {
  const gitDirectory = path.join(root, '.git')
  let stat: fs.Stats
  try {
    stat = fs.lstatSync(gitDirectory)
  } catch {
    throw new Error('git repository boundary unavailable')
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('git repository boundary is unsafe')
  const realGitDirectory = fs.realpathSync(gitDirectory)
  if (!isContained(root, realGitDirectory)) throw new Error('git repository boundary is unsafe')
  return [
    `--git-dir=${realGitDirectory}`,
    `--work-tree=${root}`,
    '-c', 'core.fsmonitor=false',
    '-c', 'core.untrackedCache=false',
    ...args,
  ]
}

function runGit(root: string, args: string[], options: WorkbenchExecutorOptions): Promise<Buffer> {
  const maxBuffer = positiveLimit(options.maxGitOutputBytes, DEFAULT_MAX_GIT_OUTPUT_BYTES)
  const timeout = positiveLimit(options.gitTimeoutMs, DEFAULT_GIT_TIMEOUT_MS)
  const boundedArguments = boundGitArguments(root, args)
  return new Promise((resolve, reject) => {
    execFile('git', boundedArguments, {
      cwd: root,
      encoding: 'buffer',
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' },
      maxBuffer,
      timeout,
      windowsHide: true,
      shell: false,
    }, (error, stdout) => {
      if (error) return reject(gitError(error))
      const output = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
      if (output.byteLength > maxBuffer) return reject(new Error('git output limit exceeded'))
      resolve(output)
    })
  })
}

function changeStatus(index: string, worktree: string): WorkbenchGitChangeStatus {
  if (index === '?' && worktree === '?') return 'untracked'
  if (index === 'R' || index === 'C' || worktree === 'R' || worktree === 'C') return 'renamed'
  if (index === 'D' || worktree === 'D') return 'deleted'
  if (index === 'A' || worktree === 'A') return 'added'
  return 'modified'
}

export function parseGitStatusPorcelain(output: Buffer | string): WorkbenchGitChange[] {
  const text = Buffer.isBuffer(output) ? new TextDecoder('utf-8', { fatal: true }).decode(output) : output
  const records = text.split('\0')
  const changes: WorkbenchGitChange[] = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (!record) continue
    if (record.length < 4 || record[2] !== ' ') throw new Error('invalid git status output')
    const stagedCode = record[0]
    const unstagedCode = record[1]
    const status = changeStatus(stagedCode, unstagedCode)
    const renamed = status === 'renamed'
    const originalPath = renamed ? records[++index] : undefined
    if (renamed && !originalPath) throw new Error('invalid git rename output')
    changes.push({
      path: record.slice(3),
      ...(originalPath ? { originalPath } : {}),
      status,
      staged: stagedCode !== ' ' && stagedCode !== '?',
      unstaged: unstagedCode !== ' ' || stagedCode === '?',
    })
  }
  return changes.sort((left, right) => left.path.localeCompare(right.path))
}

async function gitStatus(_operation: Extract<WorkbenchRuntimeOperation, { kind: 'git.status' }>, root: string, options: WorkbenchExecutorOptions): Promise<WorkbenchOperationResult> {
  const args = ['status', '--porcelain=v1', '-z', '--untracked-files=all']
  const output = await runGit(root, args, options)
  return { changes: parseGitStatusPorcelain(output) }
}

async function gitDiff(operation: Extract<WorkbenchRuntimeOperation, { kind: 'git.diff' }>, root: string, options: WorkbenchExecutorOptions): Promise<WorkbenchOperationResult> {
  const relativePath = normalizeRelativePath(operation.path ?? '', true)
  const staged = operation.staged === true
  const args = ['diff', '--no-ext-diff', '--no-textconv', '--no-color']
  if (staged) args.push('--cached')
  args.push('--')
  if (relativePath) args.push(relativePath)
  const output = await runGit(root, args, options)
  return { diff: decodeText(output, 'git diff output') }
}

function prepareShellExec(
  operation: Extract<WorkbenchRuntimeOperation, { kind: 'shell.exec' }>,
  root: string,
  options: WorkbenchExecutorOptions,
): { argv: string[]; cwd: string; timeoutMs: number } {
  if (
    !Array.isArray(operation.argv) ||
    operation.argv.length === 0 ||
    operation.argv.length > MAX_SHELL_ARGV_LENGTH ||
    !operation.argv.every((value) => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= MAX_SHELL_ARG_BYTES)
  ) {
    throw new Error('workbench shell.exec requires a non-empty, bounded argv')
  }
  if (!isAllowlistedArgv(operation.argv, operation.allowedShellArgv)) throw new Error('workbench shell.exec command is not allowlisted')
  if (operation.timeoutMs !== undefined && (!Number.isSafeInteger(operation.timeoutMs) || operation.timeoutMs <= 0)) {
    throw new Error('workbench shell.exec timeoutMs must be a positive integer')
  }
  const relativeCwd = normalizeRelativePath(operation.cwd ?? '', true)
  const cwd = resolveExisting(root, relativeCwd)
  if (!fs.statSync(cwd).isDirectory()) throw new Error('workbench shell.exec cwd must be a directory')
  const requestedTimeout = positiveLimit(operation.timeoutMs, positiveLimit(options.shellTimeoutMs, DEFAULT_SHELL_TIMEOUT_MS))
  const timeoutMs = Math.min(requestedTimeout, MAX_SHELL_TIMEOUT_MS)
  return { argv: operation.argv, cwd, timeoutMs }
}

function truncateShellOutput(buffer: Buffer, maxBytes: number): { text: string; truncated: boolean } {
  const truncated = buffer.byteLength > maxBytes
  const bounded = truncated ? buffer.subarray(0, maxBytes) : buffer
  return { text: bounded.toString('utf8'), truncated }
}

function asBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value
  return Buffer.from(typeof value === 'string' ? value : '')
}

async function shellExec(
  operation: Extract<WorkbenchRuntimeOperation, { kind: 'shell.exec' }>,
  root: string,
  options: WorkbenchExecutorOptions,
): Promise<WorkbenchOperationResult> {
  const { argv, cwd, timeoutMs } = prepareShellExec(operation, root, options)
  const displayLimit = positiveLimit(options.maxShellOutputBytes, MAX_SHELL_OUTPUT_BYTES)
  // execFile's own maxBuffer is intentionally set well above the display limit so a
  // legitimate (allowlisted) command always runs to natural completion and yields a
  // real numeric exit code — the server's WorkbenchResult schema requires exitCode to
  // be a safe integer, never null. We then truncate the captured buffers ourselves to
  // displayLimit and flag truncated:true, rather than relying on Node's own
  // maxBuffer-triggered kill (which loses the exit code entirely).
  const execFileMaxBuffer = displayLimit * 8
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    execFile(argv[0], argv.slice(1), {
      cwd,
      shell: false,
      timeout: timeoutMs,
      maxBuffer: execFileMaxBuffer,
      env: sanitizedShellEnv(),
      encoding: 'buffer',
      windowsHide: true,
    }, (error, stdoutRaw, stderrRaw) => {
      // Node passes captured buffers via the stdout/stderr callback params even on
      // failure (non-zero exit); error.stdout/error.stderr are NOT populated when
      // execFile is called with encoding: 'buffer'.
      const stdout = truncateShellOutput(asBuffer(stdoutRaw), displayLimit)
      const stderr = truncateShellOutput(asBuffer(stderrRaw), displayLimit)
      const durationMs = Date.now() - startedAt
      if (error) {
        const caught = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string | null }
        if (caught.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || /maxbuffer/i.test(caught.message)) {
          reject(new Error('workbench shell command output exceeded limit'))
          return
        }
        if (caught.killed || caught.signal || /timed out|timeout/i.test(caught.message)) {
          reject(new Error('workbench shell command timed out'))
          return
        }
        if (typeof caught.code === 'number') {
          resolve({
            exitCode: caught.code,
            stdout: stdout.text,
            stderr: stderr.text,
            durationMs,
            ...(stdout.truncated || stderr.truncated ? { truncated: true } : {}),
          })
          return
        }
        reject(new Error('workbench shell command failed to start'))
        return
      }
      resolve({
        exitCode: 0,
        stdout: stdout.text,
        stderr: stderr.text,
        durationMs,
        ...(stdout.truncated || stderr.truncated ? { truncated: true } : {}),
      })
    })
  })
}

/**
 * Streaming variant used from executeWorkbenchJob when a signed `post` helper is
 * available: streams stdout/stderr chunks to the device progress endpoint (best
 * effort — posting failures never fail the job) while buffering the full output
 * for the final completion result, matching the shape of the execFile-based
 * shellExec above.
 */
async function shellExecWithProgress(
  job: WorkbenchRuntimeJob,
  root: string,
  options: WorkbenchExecutorOptions,
  post: (path: string, body: Record<string, unknown>) => Promise<Response>,
): Promise<WorkbenchOperationResult> {
  const operation = job.operation as Extract<WorkbenchRuntimeOperation, { kind: 'shell.exec' }>
  const { argv, cwd, timeoutMs } = prepareShellExec(operation, root, options)
  const maxBuffer = positiveLimit(options.maxShellOutputBytes, MAX_SHELL_OUTPUT_BYTES)
  const startedAt = Date.now()
  let seq = 0
  // Body shape matches lib/messages/workbench/jobs.ts parseWorkbenchProgressChunk:
  // { seq, stream, text, atMs }, wrapped as { attempt, leaseToken, chunk }.
  const postProgress = (stream: 'stdout' | 'stderr', text: string) => {
    seq += 1
    options.onShellProgress?.({ stream, text, seq })
    post(`/workbench/jobs/${job.jobId}/progress`, {
      attempt: job.attempt,
      leaseToken: job.leaseToken,
      chunk: { seq, stream, text, atMs: Date.now() },
    }).catch(() => undefined)
  }

  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(argv[0], argv.slice(1), { cwd, shell: false, env: sanitizedShellEnv(), windowsHide: true })
    } catch {
      reject(new Error('workbench shell command failed to start'))
      return
    }

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let truncated = false
    let timedOut = false
    let settled = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)

    const onChunk = (stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
      const chunks = stream === 'stdout' ? stdoutChunks : stderrChunks
      const used = stream === 'stdout' ? stdoutBytes : stderrBytes
      if (used >= maxBuffer) {
        truncated = true
        return
      }
      const remaining = maxBuffer - used
      const bounded = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk
      if (bounded.byteLength > 0) {
        chunks.push(bounded)
        if (stream === 'stdout') stdoutBytes += bounded.byteLength
        else stderrBytes += bounded.byteLength
        postProgress(stream, bounded.toString('utf8'))
      }
      if (bounded.byteLength < chunk.byteLength) truncated = true
    }

    child.stdout?.on('data', onChunk('stdout'))
    child.stderr?.on('data', onChunk('stderr'))
    child.once('error', (spawnError) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(spawnError instanceof Error ? spawnError : new Error('workbench shell command failed'))
    })
    child.once('close', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (signal) {
        reject(new Error(timedOut ? 'workbench shell command timed out' : `workbench shell command terminated by signal ${signal}`))
        return
      }
      resolve({
        exitCode: code ?? 0,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        durationMs: Date.now() - startedAt,
        ...(truncated ? { truncated: true } : {}),
      })
    })
  })
}

export async function executeWorkbenchOperation(
  job: WorkbenchRuntimeJob,
  registry: MappingRegistry,
  options: WorkbenchExecutorOptions = {},
): Promise<WorkbenchOperationResult> {
  assertValidClaim(job)
  const root = mappedRoot(job, registry)
  switch (job.operation.kind) {
    case 'fs.list': return listFiles(job.operation, root, options)
    case 'fs.search': return searchFiles(job.operation, root)
    case 'fs.read': return readFile(job.operation, root, options)
    case 'fs.write': return writeFile(job.operation, root, options)
    case 'git.status': return gitStatus(job.operation, root, options)
    case 'git.diff': return gitDiff(job.operation, root, options)
    case 'shell.exec': return shellExec(job.operation, root, options)
    default: throw new Error('unsupported workbench operation')
  }
}

function boundedError(error: unknown): string {
  const message = error instanceof Error ? error.message.replace(/\s+/g, ' ').trim() : ''
  if (!message) return 'Workbench operation failed'
  return Buffer.byteLength(message) <= MAX_ERROR_BYTES ? message : `${Buffer.from(message).subarray(0, MAX_ERROR_BYTES - 3).toString('utf8')}...`
}

function completionReceipt(
  job: WorkbenchRuntimeJob,
  device: WorkbenchDevice,
  outcome: 'completed' | 'failed',
  acceptedAt: string,
  toolStartedAt: string,
  output: string,
  error: string,
) {
  const requestId = job.requestId || job.jobId
  const body = {
    jobId: job.jobId,
    requestId,
    deviceId: device.deviceId,
    mappingId: job.mappingId,
    credentialVersion: device.credentialVersion,
    attempt: job.attempt,
    leaseToken: job.leaseToken,
    event: outcome,
    outcome,
    timestamp: new Date().toISOString(),
    acceptedAt,
    toolStartedAt,
    runtimeVersion: process.env.PIB_RUNTIME_VERSION || '1.1.30',
    machineLabel: os.hostname(),
    outputSha256: digest(output),
    outputBytes: Buffer.byteLength(output),
    errorSha256: digest(error),
    errorBytes: Buffer.byteLength(error),
  }
  const payload = [
    body.jobId, body.requestId, body.deviceId, body.mappingId, String(body.credentialVersion),
    String(body.attempt), body.leaseToken, body.event, body.outcome, body.timestamp,
    body.acceptedAt, body.toolStartedAt, body.runtimeVersion, body.machineLabel,
    body.outputSha256, String(body.outputBytes), body.errorSha256, String(body.errorBytes),
  ].join('\n')
  return {
    ...body,
    signature: sign(null, Buffer.from(payload), createPrivateKey(device.privateKey)).toString('base64url'),
  }
}

export async function executeWorkbenchJob(
  job: WorkbenchRuntimeJob,
  device: WorkbenchDevice,
  registry: MappingRegistry,
  post: (path: string, body: Record<string, unknown>) => Promise<Response>,
  options: WorkbenchExecutorOptions = {},
) {
  const acceptedAt = new Date().toISOString()
  const toolStartedAt = new Date().toISOString()
  let result: WorkbenchOperationResult | undefined
  let error = ''
  let status: 'completed' | 'failed' = 'completed'
  try {
    if (job.operation.kind === 'shell.exec') {
      assertValidClaim(job)
      const root = mappedRoot(job, registry)
      result = await shellExecWithProgress(job, root, options, post)
    } else {
      result = await executeWorkbenchOperation(job, registry, options)
    }
  } catch (caught) {
    status = 'failed'
    error = boundedError(caught)
  }

  const output = result === undefined ? '' : JSON.stringify(result)
  const receipt = completionReceipt(job, device, status, acceptedAt, toolStartedAt, output, error)
  const body: Record<string, unknown> = {
    attempt: job.attempt,
    leaseToken: job.leaseToken,
    outcome: status,
    ...(result === undefined ? {} : { result }),
    ...(error ? { error } : {}),
    receipt,
  }
  let response: Response | undefined
  let transportError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      response = await post(`/workbench/jobs/${job.jobId}/complete`, body)
      if (response.ok || response.status === 409) break
    } catch (caught) {
      transportError = caught
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, options.retryDelayMs ?? 100 * (2 ** attempt)))
  }
  if ((!response?.ok && response?.status !== 409) || (!response && transportError)) {
    throw new Error('workbench completion retry exhausted')
  }
  return { status, result, error, receipt }
}

export function workbenchPollDelay(delay: number, random: () => number = Math.random): number {
  const bounded = Math.min(Math.max(250, delay), MAX_IDLE_CLAIM_BASE_DELAY_MS)
  return bounded + Math.floor(random() * bounded)
}

export async function pollWorkbenchForever(
  claim: () => Promise<WorkbenchRuntimeJob | null>,
  run: (job: WorkbenchRuntimeJob) => Promise<unknown>,
  stop: () => boolean = () => false,
  wait: (milliseconds: number) => Promise<unknown> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<void> {
  let delay = 250
  while (!stop()) {
    const claimed = await claim().catch(() => null)
    if (claimed) {
      delay = 250
      await run(claimed).catch(() => undefined)
    } else {
      await wait(workbenchPollDelay(delay))
      delay = Math.min(delay * 2, MAX_IDLE_CLAIM_BASE_DELAY_MS)
    }
  }
}
