import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { createHash, createPrivateKey, randomUUID, sign } from 'node:crypto'
import { TextDecoder } from 'node:util'
import { MappingRegistry } from './bridge'

const DEFAULT_MAX_FILE_BYTES = 1024 * 1024
const DEFAULT_MAX_LIST_ENTRIES = 1_000
const DEFAULT_MAX_GIT_OUTPUT_BYTES = 2 * 1024 * 1024
const DEFAULT_GIT_TIMEOUT_MS = 5_000
const MAX_ERROR_BYTES = 400
const MAX_IDLE_CLAIM_BASE_DELAY_MS = 1_000

export type WorkbenchRuntimeOperation =
  | { kind: 'fs.list'; path: string }
  | { kind: 'fs.read'; path: string }
  | { kind: 'fs.write'; path: string; content: string; expectedSha256?: string | null }
  | { kind: 'git.status' }
  | { kind: 'git.diff'; path?: string; staged?: boolean }

export type WorkbenchRuntimeJob = {
  jobId: string
  requestId?: string
  mappingId: string
  relativeFolder?: string
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

export type WorkbenchExecutorOptions = {
  maxFileBytes?: number
  maxListEntries?: number
  maxGitOutputBytes?: number
  gitTimeoutMs?: number
  retryDelayMs?: number
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
    || !['fs.list', 'fs.read', 'fs.write', 'git.status', 'git.diff'].includes(job.kind)
    || job.kind !== job.operation.kind) {
    throw new Error('invalid workbench claim')
  }
}

function normalizeRelativePath(value: unknown, allowRoot: boolean): string {
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

function mappedRoot(job: WorkbenchRuntimeJob, registry: MappingRegistry): string {
  const relativeFolder = normalizeRelativePath(job.relativeFolder ?? '', true)
  const resolved = registry.resolve(job.mappingId, relativeFolder)
  const root = fs.realpathSync(resolved)
  if (!fs.statSync(root).isDirectory()) throw new Error('workbench mapping must resolve to a directory')
  return root
}

function resolveExisting(root: string, relativePath: string): string {
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

export async function executeWorkbenchOperation(
  job: WorkbenchRuntimeJob,
  registry: MappingRegistry,
  options: WorkbenchExecutorOptions = {},
): Promise<WorkbenchOperationResult> {
  assertValidClaim(job)
  const root = mappedRoot(job, registry)
  switch (job.operation.kind) {
    case 'fs.list': return listFiles(job.operation, root, options)
    case 'fs.read': return readFile(job.operation, root, options)
    case 'fs.write': return writeFile(job.operation, root, options)
    case 'git.status': return gitStatus(job.operation, root, options)
    case 'git.diff': return gitDiff(job.operation, root, options)
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
    runtimeVersion: process.env.PIB_RUNTIME_VERSION || '1.1.6',
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
    result = await executeWorkbenchOperation(job, registry, options)
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
