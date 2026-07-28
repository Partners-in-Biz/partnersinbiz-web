/**
 * Client-safe helpers for the Messages workbench (Phase 2b). These functions
 * only ever call the public `/api/v1/conversations/[convId]/workbench/*`
 * endpoints from the browser — they never touch `firebase-admin`, durable
 * job storage, or device credentials, so this module is safe to import from
 * client components (`UnifiedChat`, the workbench rail panels) without
 * pulling server-only dependencies into the browser bundle.
 *
 * Pure mapping helpers (`gitStatusResultToChanges`,
 * `mapTerminalCommandToOperation`) have no `fetch` dependency and are also
 * safe to import from server routes that need to translate an allowlisted
 * terminal command into a typed workbench operation.
 */
import type { WorkbenchChangeFile, WorkbenchChangeStatus } from './types'
import type { PublicWorkbenchJob, WorkbenchJobStatus, WorkbenchOperation } from './jobs'
import { mapShellCommandToArgv } from './shell-allowlist'

const TERMINAL_JOB_STATUSES: ReadonlySet<WorkbenchJobStatus> = new Set([
  'completed', 'failed', 'cancelled', 'expired', 'awaiting_approval',
])

export interface WorkbenchOperationRunOptions {
  /** Overrides the auto-generated `Idempotency-Key` header for the enqueue call. */
  idempotencyKey?: string
  /** Total time budget (ms) for `pollWorkbenchJob`/`runWorkbenchOperation` before giving up. Default 20s. */
  timeoutMs?: number
  /** Delay (ms) between polls. Default 350ms. */
  intervalMs?: number
  signal?: AbortSignal
  /** Invoked on each poll while the job is still claimed/queued (Phase 3 shell.exec progress). */
  onProgress?: (job: PublicWorkbenchJob) => void
}

/** Random, header-safe idempotency key, e.g. `createWorkbenchIdempotencyKey('terminal')`. */
export function createWorkbenchIdempotencyKey(prefix: string): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${random}`
}

function workbenchJobsBase(conversationId: string): string {
  return `/api/v1/conversations/${encodeURIComponent(conversationId)}/workbench/jobs`
}

async function readWorkbenchJobResponse(response: Response): Promise<PublicWorkbenchJob> {
  const body = await response.json().catch(() => null) as { data?: PublicWorkbenchJob; error?: string } | null
  if (!response.ok || !body?.data) throw new Error(body?.error || `Workbench request failed (${response.status})`)
  return body.data
}

function wait(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}

/** POSTs a typed workbench operation and returns the created (queued/awaiting_approval) job. */
export async function enqueueWorkbenchOperation(
  conversationId: string,
  operation: WorkbenchOperation,
  options: Pick<WorkbenchOperationRunOptions, 'idempotencyKey' | 'signal'> = {},
): Promise<PublicWorkbenchJob> {
  const response = await fetch(workbenchJobsBase(conversationId), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': options.idempotencyKey ?? createWorkbenchIdempotencyKey('workbench'),
    },
    body: JSON.stringify({ operation }),
    signal: options.signal,
  })
  return readWorkbenchJobResponse(response)
}

/** Polls a job until it reaches a terminal (or awaiting-approval) status, or `timeoutMs` elapses. */
export async function pollWorkbenchJob(
  conversationId: string,
  jobId: string,
  options: Pick<WorkbenchOperationRunOptions, 'timeoutMs' | 'intervalMs' | 'signal' | 'onProgress'> = {},
): Promise<PublicWorkbenchJob> {
  const timeoutMs = options.timeoutMs ?? 60_000
  const intervalMs = options.intervalMs ?? 350
  const deadline = Date.now() + timeoutMs
  const jobUrl = `${workbenchJobsBase(conversationId)}/${encodeURIComponent(jobId)}`

  let job = await readWorkbenchJobResponse(await fetch(jobUrl, { cache: 'no-store', signal: options.signal }))
  options.onProgress?.(job)
  while (!TERMINAL_JOB_STATUSES.has(job.status)) {
    if (Date.now() >= deadline) throw new Error('Workbench job timed out waiting for the linked computer')
    await wait(intervalMs, options.signal)
    job = await readWorkbenchJobResponse(await fetch(jobUrl, { cache: 'no-store', signal: options.signal }))
    options.onProgress?.(job)
  }
  return job
}

/** Renders in-flight shell.exec progress chunks into a live transcript body. */
export function formatWorkbenchProgressBody(command: string, job: PublicWorkbenchJob): string {
  const chunks = Array.isArray(job.progress) ? job.progress : []
  const streamed = chunks
    .slice()
    .sort((left, right) => left.seq - right.seq)
    .map((chunk) => chunk.text)
    .join('')
    .replace(/\n+$/, '')
  return streamed ? `$ ${command}\n${streamed}` : `$ ${command}\n… ${job.status}`
}

/** Enqueues a typed operation and polls it through to a terminal/awaiting-approval status. */
export async function runWorkbenchOperation(
  conversationId: string,
  operation: WorkbenchOperation,
  options: WorkbenchOperationRunOptions = {},
): Promise<PublicWorkbenchJob> {
  const created = await enqueueWorkbenchOperation(conversationId, operation, options)
  if (TERMINAL_JOB_STATUSES.has(created.status)) return created
  return pollWorkbenchJob(conversationId, created.jobId, options)
}

function statusFromGitResultStatus(value: string): WorkbenchChangeStatus {
  const normalized = value.toLowerCase()
  if (normalized.includes('rename')) return 'renamed'
  if (normalized.includes('delete')) return 'deleted'
  if (normalized.includes('untracked') || normalized.includes('add') || normalized === '??') return 'added'
  if (normalized.includes('modif') || normalized.includes('staged')) return 'modified'
  return 'unknown'
}

export interface WorkbenchGitStatusResult {
  branch?: string
  changes: Array<{ path: string; status: string }>
}

/** Maps a completed `git.status` job result into the workbench Changes list shape. */
export function gitStatusResultToChanges(result: WorkbenchGitStatusResult | null | undefined): WorkbenchChangeFile[] {
  if (!result || !Array.isArray(result.changes)) return []
  return result.changes.map((change) => ({ path: change.path, status: statusFromGitResultStatus(change.status) }))
}

/**
 * Allowlisted terminal commands, mapped to a workbench operation. `git
 * status` / `git diff` / `ls` map onto typed FS/git operations (Phase 2b);
 * everything else falls back to an allowlisted one-shot `shell.exec` job
 * (Phase 3 MVP — exact argv templates only, still no free-form PTY). `pwd`
 * intentionally returns `null` — it needs no device round trip since the
 * conversation's bound relative folder already answers it (see the
 * terminal route's special case).
 */
export function mapTerminalCommandToOperation(
  command: string,
  allowedShellArgv?: readonly (readonly string[])[],
): WorkbenchOperation | null {
  const trimmed = command.trim()
  switch (trimmed) {
    case 'git status':
      return { kind: 'git.status' }
    case 'git diff':
    case 'git diff --stat':
      return { kind: 'git.diff' }
    case 'ls':
      return { kind: 'fs.list', path: '.' }
    default: {
      const argv = mapShellCommandToArgv(trimmed, allowedShellArgv)
      return argv ? { kind: 'shell.exec', argv } : null
    }
  }
}

/** Renders a completed workbench job result as plain text for the terminal transcript. */
export function formatWorkbenchOperationResult(job: PublicWorkbenchJob): string {
  if (job.status === 'awaiting_approval') return 'This command requires approval before it can run.'
  if (job.status !== 'completed') return job.error || `Command ${job.status}.`
  const result = job.result
  if (!result) return '(no output)'
  if (job.kind === 'git.status' && 'changes' in result && Array.isArray(result.changes)) {
    if (result.changes.length === 0) return 'nothing to commit, working tree clean'
    return result.changes.map((change) => `${change.status.padEnd(10)} ${change.path}`).join('\n')
  }
  if (job.kind === 'git.diff' && 'diff' in result && typeof result.diff === 'string') {
    return result.diff.trim() || '(no differences)'
  }
  if (job.kind === 'fs.list' && 'entries' in result && Array.isArray(result.entries)) {
    if (result.entries.length === 0) return '(empty directory)'
    return result.entries.map((entry) => (entry.type === 'directory' ? `${entry.path}/` : entry.path)).join('\n')
  }
  if (job.kind === 'shell.exec' && 'exitCode' in result) {
    const operation = job.operation
    const cmd = operation && operation.kind === 'shell.exec' ? operation.argv.join(' ') : 'shell.exec'
    const stdout = 'stdout' in result && typeof result.stdout === 'string' ? result.stdout.replace(/\n+$/, '') : ''
    const stderr = 'stderr' in result && typeof result.stderr === 'string' ? result.stderr.replace(/\n+$/, '') : ''
    return [`$ ${cmd}`, ...(stdout ? [stdout] : []), ...(stderr ? [stderr] : []), `exit ${result.exitCode}`].join('\n')
  }
  return JSON.stringify(result, null, 2)
}
