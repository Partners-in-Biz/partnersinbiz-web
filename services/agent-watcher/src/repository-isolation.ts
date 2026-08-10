/**
 * Watcher-side repository isolation for direct VPS Hermes dispatch.
 *
 * The linked-computer runtime (runtime-installers/runtime/worker.ts) already
 * moves Kanban tasks into task-scoped Git worktrees before calling Hermes.
 * Direct watcher → VPS Hermes dispatch had no equivalent contract: it posted
 * no working_directory and never created an isolated worktree, so two
 * concurrent VPS tasks would share the same checkout and could stash/pop,
 * checkpoint, rebase, or overwrite each other's in-flight changes.
 *
 * This module mirrors the runtime's prepareTaskWorktree contract but uses
 * async execFile (matching completion-integrity.ts) so the watcher event
 * loop is not blocked. It is invoked only for direct VPS dispatch —
 * linked-computer jobs are isolated by the runtime worker instead.
 */
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'

const execFile = promisify(execFileCallback)

export type WatcherWorktreeReady = {
  ok: true
  taskId: string
  branch: string
  workingDirectory: string
  reused: boolean
}

export type WatcherWorktreeBlocked = {
  ok: false
  taskId: string
  code:
    | 'invalid_task_id'
    | 'not_git_repository'
    | 'shared_worktree_dirty'
    | 'shared_worktree_branch_conflict'
    | 'base_ref_unavailable'
    | 'task_branch_conflict'
    | 'task_worktree_dirty'
    | 'task_worktree_conflict'
  message: string
}

export type WatcherWorktreeResult = WatcherWorktreeReady | WatcherWorktreeBlocked

const TASK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/
const TASK_BRANCH_PREFIX = 'pib-task/'

function taskBranch(taskId: string): string {
  return `${TASK_BRANCH_PREFIX}${taskId}`
}

function taskWorktreePath(repositoryRoot: string, taskId: string): string {
  return path.join(
    path.dirname(repositoryRoot),
    '.pib-agent-worktrees',
    path.basename(repositoryRoot),
    `pib-task-${taskId}`,
  )
}

function concise(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 400)
}

async function git(cwd: string, args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout } = await execFile('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: '0',
        GIT_TERMINAL_PROMPT: '0',
        GIT_PAGER: 'cat',
      },
    })
    return { ok: true, stdout: stdout || '', stderr: '' }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    return {
      ok: false,
      stdout: e.stdout || '',
      stderr: concise(e.stderr || e.message || String(err)),
    }
  }
}

function blocked(taskId: string, code: WatcherWorktreeBlocked['code'], message: string): WatcherWorktreeBlocked {
  return { ok: false, taskId, code, message }
}

async function hasNamedWorktree(repositoryRoot: string, worktreePath: string, branch: string): Promise<boolean> {
  const listed = await git(repositoryRoot, ['worktree', 'list', '--porcelain'])
  if (!listed.ok) return false
  const records = listed.stdout.split('\n\n').map((record) => record.split('\n'))
  return records.some((lines) =>
    lines.includes(`worktree ${worktreePath}`) && lines.includes(`branch refs/heads/${branch}`),
  )
}

async function worktreeIsClean(worktreePath: string): Promise<boolean> {
  const status = await git(worktreePath, ['status', '--porcelain=v1', '--untracked-files=all'])
  return status.ok && status.stdout.trim() === ''
}

export interface PrepareWatcherWorktreeInput {
  /** Kanban task id; used to derive the branch and worktree path. */
  taskId: string
  /** Repository root. Defaults to PIB_REPO_ROOT or process.cwd(). */
  repositoryRoot?: string
  /** Base ref to branch from. Defaults to origin/development. */
  baseRef?: string
  /**
   * Optional authorised subdirectory relative to the Git root. When set,
   * the returned workingDirectory is that same relative path inside the
   * isolated worktree, not the worktree root.
   */
  relativePath?: string
}

/**
 * Creates or reuses an isolated worktree for one Kanban task before the
 * watcher dispatches to VPS Hermes.
 *
 * This function never stashes, checks out, resets, rebases, stages, or
 * commits the shared checkout. A dirty or incompatible shared checkout is
 * returned as a stable blocker so the caller can persist it on the task
 * instead of mixing agent work.
 */
export async function prepareWatcherTaskWorktree(input: PrepareWatcherWorktreeInput): Promise<WatcherWorktreeResult> {
  const taskId = input.taskId.trim()
  if (!TASK_ID_RE.test(taskId)) {
    return blocked(input.taskId, 'invalid_task_id', 'Repository isolation requires a safe task id.')
  }

  const repositoryRootInput = input.repositoryRoot?.trim() || process.env.PIB_REPO_ROOT || process.cwd()
  let repositoryRoot: string
  try {
    repositoryRoot = fs.realpathSync(repositoryRootInput)
  } catch {
    return blocked(taskId, 'not_git_repository', `Repository root is unavailable: ${repositoryRootInput}`)
  }

  const topLevel = await git(repositoryRoot, ['rev-parse', '--show-toplevel'])
  if (!topLevel.ok) {
    return blocked(taskId, 'not_git_repository', `Repository isolation skipped: ${repositoryRoot} is not a Git checkout.`)
  }
  repositoryRoot = topLevel.stdout.trim()

  // Validate optional relative path against the resolved Git root.
  let selectedRelativePath = ''
  if (input.relativePath) {
    selectedRelativePath = path.relative(repositoryRoot, path.resolve(repositoryRoot, input.relativePath))
    if (
      selectedRelativePath === '..'
      || selectedRelativePath.startsWith(`..${path.sep}`)
      || path.isAbsolute(selectedRelativePath)
    ) {
      return blocked(taskId, 'task_worktree_conflict', `Selected directory is outside its resolved Git root and was left untouched: ${input.relativePath}.`)
    }
  }

  const resolveWorkingDirectory = (worktreePath: string): WatcherWorktreeReady | WatcherWorktreeBlocked => {
    const workingDirectory = path.resolve(worktreePath, selectedRelativePath)
    if (workingDirectory !== worktreePath && !workingDirectory.startsWith(`${worktreePath}${path.sep}`)) {
      return blocked(taskId, 'task_worktree_conflict', `Task working directory would escape its isolated worktree: ${selectedRelativePath}.`)
    }
    if (selectedRelativePath && !fs.existsSync(workingDirectory)) {
      return blocked(taskId, 'task_worktree_conflict', `Task worktree does not contain the authorised directory: ${selectedRelativePath}.`)
    }
    return { ok: true, taskId, branch: taskBranch(taskId), workingDirectory, reused: false }
  }

  const branch = taskBranch(taskId)

  // Shared checkout must remain on development.
  const sharedBranch = await git(repositoryRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  if (!sharedBranch.ok || sharedBranch.stdout.trim() !== 'development') {
    return blocked(
      taskId,
      'shared_worktree_branch_conflict',
      `Shared checkout must remain on development; found ${concise(sharedBranch.stdout || sharedBranch.stderr) || 'detached HEAD'}. No Git state was changed.`,
    )
  }

  // Shared checkout must be clean — no mixing agent work.
  const sharedStatus = await git(repositoryRoot, ['status', '--porcelain=v1', '--untracked-files=all'])
  if (!sharedStatus.ok) {
    return blocked(taskId, 'shared_worktree_dirty', `Could not inspect the shared checkout safely: ${concise(sharedStatus.stderr)}.`)
  }
  if (sharedStatus.stdout.trim()) {
    return blocked(
      taskId,
      'shared_worktree_dirty',
      `Shared checkout has in-flight changes (${concise(sharedStatus.stdout)}). Left untouched: no stash, checkpoint, rebase, reset, checkout, or overwrite was attempted.`,
    )
  }

  const worktreePath = taskWorktreePath(repositoryRoot, taskId)

  // Reuse an existing task worktree if it is clean and on the right branch.
  if (fs.existsSync(worktreePath)) {
    if (!(await hasNamedWorktree(repositoryRoot, worktreePath, branch))) {
      return blocked(taskId, 'task_worktree_conflict', `Task worktree path already exists but is not owned by ${branch}: ${worktreePath}.`)
    }
    if (!(await worktreeIsClean(worktreePath))) {
      return blocked(taskId, 'task_worktree_dirty', `Task worktree is dirty and was left untouched: ${worktreePath}.`)
    }
    const selected = resolveWorkingDirectory(worktreePath)
    if (!selected.ok) return selected
    return { ...selected, reused: true }
  }

  // No existing worktree — verify the task branch does not exist without one.
  const existingBranch = await git(repositoryRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])
  if (existingBranch.ok) {
    return blocked(taskId, 'task_branch_conflict', `Task branch ${branch} already exists without its expected worktree. Left it untouched.`)
  }

  const baseRef = input.baseRef?.trim() || 'origin/development'
  // Fetch origin/development so the worktree bases on the current remote tip.
  // The runtime worker deliberately does not fetch (to avoid shared ref
  // contention), but the watcher is the sole VPS writer and already fetches
  // origin/development in completion-integrity verification.
  if (baseRef === 'origin/development') {
    await git(repositoryRoot, ['fetch', '--quiet', 'origin', 'development']).catch(() => undefined)
  }
  const base = await git(repositoryRoot, ['rev-parse', '--verify', `${baseRef}^{commit}`])
  if (!base.ok) {
    return blocked(taskId, 'base_ref_unavailable', `Base ref ${baseRef} is unavailable locally: ${concise(base.stderr)}.`)
  }

  fs.mkdirSync(path.dirname(worktreePath), { recursive: true, mode: 0o700 })
  const created = await git(repositoryRoot, ['worktree', 'add', '-b', branch, worktreePath, baseRef])
  if (!created.ok) {
    return blocked(taskId, 'task_worktree_conflict', `Could not create isolated task worktree: ${concise(created.stderr)}.`)
  }
  if (!(await worktreeIsClean(worktreePath))) {
    return blocked(taskId, 'task_worktree_dirty', `New task worktree is unexpectedly dirty and was left untouched: ${worktreePath}.`)
  }
  const selected = resolveWorkingDirectory(worktreePath)
  if (!selected.ok) return selected
  return selected
}

/**
 * Remove a task worktree after the watcher dispatch completes. This is a
 * best-effort cleanup; the completion-integrity verifier may inspect the
 * worktree before it is removed.
 */
export async function removeWatcherTaskWorktree(repositoryRoot: string, taskId: string): Promise<void> {
  const root = repositoryRoot.trim() || process.env.PIB_REPO_ROOT || process.cwd()
  const branch = taskBranch(taskId)
  const worktreePath = taskWorktreePath(
    (() => {
      try {
        return fs.realpathSync(root)
      } catch {
        return root
      }
    })(),
    taskId,
  )
  if (!fs.existsSync(worktreePath)) return
  await git(root, ['worktree', 'remove', '--force', worktreePath]).catch(() => undefined)
  await git(root, ['branch', '-D', branch]).catch(() => undefined)
}
