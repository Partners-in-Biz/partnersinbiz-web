import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

export type TaskWorktreeRequest = {
  repositoryRoot: string
  taskId: string
  baseRef?: string
}

export type TaskWorktreeReady = {
  ok: true
  taskId: string
  branch: string
  workingDirectory: string
  reused: boolean
}

export type TaskWorktreeBlocked = {
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

export type TaskWorktreeResult = TaskWorktreeReady | TaskWorktreeBlocked

type GitResult = { ok: boolean; stdout: string; stderr: string }

function runGit(cwd: string, args: string[]): GitResult {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_OPTIONAL_LOCKS: '0',
      GIT_TERMINAL_PROMPT: '0',
      GIT_PAGER: 'cat',
    },
  })
  return {
    ok: result.status === 0 && !result.error,
    stdout: result.stdout || '',
    stderr: result.stderr || result.error?.message || '',
  }
}

function concise(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 400)
}

function normalizedTaskId(taskId: string): string | null {
  const trimmed = taskId.trim()
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(trimmed) ? trimmed : null
}

function taskBranch(taskId: string): string {
  return `pib-task/${taskId}`
}

function taskWorktreePath(repositoryRoot: string, taskId: string): string {
  // Keep agent worktrees outside the source checkout so creating one never makes
  // the shared checkout look dirty. The path is deterministic for safe resume.
  return path.join(path.dirname(repositoryRoot), '.pib-agent-worktrees', path.basename(repositoryRoot), `pib-task-${taskId}`)
}

function blocked(taskId: string, code: TaskWorktreeBlocked['code'], message: string): TaskWorktreeBlocked {
  return { ok: false, taskId, code, message }
}

function hasNamedWorktree(repositoryRoot: string, worktreePath: string, branch: string): boolean {
  const listed = runGit(repositoryRoot, ['worktree', 'list', '--porcelain'])
  if (!listed.ok) return false
  const records = listed.stdout.split('\n\n').map((record) => record.split('\n'))
  return records.some((lines) =>
    lines.includes(`worktree ${worktreePath}`) && lines.includes(`branch refs/heads/${branch}`),
  )
}

function worktreeIsClean(worktreePath: string): boolean {
  const status = runGit(worktreePath, ['status', '--porcelain=v1', '--untracked-files=all'])
  return status.ok && status.stdout.trim() === ''
}

/**
 * Creates or reuses an isolated worktree for one Kanban task.
 *
 * This function never stashes, checks out, resets, rebases, stages, or commits the
 * shared checkout. A dirty or incompatible shared checkout is returned as a stable
 * blocker so the caller can persist it on the task instead of mixing agent work.
 */
export function prepareTaskWorktree(input: TaskWorktreeRequest): TaskWorktreeResult {
  const taskId = normalizedTaskId(input.taskId)
  if (!taskId) {
    return blocked(input.taskId, 'invalid_task_id', 'Repository isolation requires a safe task id.')
  }

  let repositoryRoot: string
  let selectedDirectory: string
  try {
    selectedDirectory = fs.realpathSync(input.repositoryRoot)
    repositoryRoot = selectedDirectory
  } catch {
    return blocked(taskId, 'not_git_repository', `Repository root is unavailable: ${input.repositoryRoot}`)
  }

  const topLevel = runGit(repositoryRoot, ['rev-parse', '--show-toplevel'])
  if (!topLevel.ok) {
    return blocked(taskId, 'not_git_repository', `Repository isolation skipped: ${repositoryRoot} is not a Git checkout.`)
  }
  repositoryRoot = topLevel.stdout.trim()
  const selectedRelativePath = path.relative(repositoryRoot, selectedDirectory)
  if (selectedRelativePath === '..' || selectedRelativePath.startsWith(`..${path.sep}`) || path.isAbsolute(selectedRelativePath)) {
    return blocked(taskId, 'task_worktree_conflict', `Selected directory is outside its resolved Git root and was left untouched: ${selectedDirectory}.`)
  }
  const taskWorkingDirectory = (worktreePath: string): TaskWorktreeReady | TaskWorktreeBlocked => {
    const workingDirectory = path.resolve(worktreePath, selectedRelativePath)
    if (workingDirectory !== worktreePath && !workingDirectory.startsWith(`${worktreePath}${path.sep}`)) {
      return blocked(taskId, 'task_worktree_conflict', `Task working directory would escape its isolated worktree: ${selectedRelativePath}.`)
    }
    if (!fs.existsSync(workingDirectory)) {
      return blocked(taskId, 'task_worktree_conflict', `Task worktree does not contain the authorised directory: ${selectedRelativePath || '.'}.`)
    }
    return { ok: true, taskId, branch: taskBranch(taskId), workingDirectory, reused: false }
  }

  const branch = taskBranch(taskId)
  const sharedBranch = runGit(repositoryRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  if (!sharedBranch.ok || sharedBranch.stdout.trim() !== 'development') {
    return blocked(
      taskId,
      'shared_worktree_branch_conflict',
      `Shared checkout must remain on development; found ${concise(sharedBranch.stdout || sharedBranch.stderr) || 'detached HEAD'}. No Git state was changed.`,
    )
  }

  const sharedStatus = runGit(repositoryRoot, ['status', '--porcelain=v1', '--untracked-files=all'])
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
  if (fs.existsSync(worktreePath)) {
    if (!hasNamedWorktree(repositoryRoot, worktreePath, branch)) {
      return blocked(taskId, 'task_worktree_conflict', `Task worktree path already exists but is not owned by ${branch}: ${worktreePath}.`)
    }
    if (!worktreeIsClean(worktreePath)) {
      return blocked(taskId, 'task_worktree_dirty', `Task worktree is dirty and was left untouched: ${worktreePath}.`)
    }
    const selected = taskWorkingDirectory(worktreePath)
    if (!selected.ok) return selected
    return { ...selected, reused: true }
  }

  const existingBranch = runGit(repositoryRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])
  if (existingBranch.ok) {
    return blocked(taskId, 'task_branch_conflict', `Task branch ${branch} already exists without its expected worktree. Left it untouched.`)
  }

  const baseRef = input.baseRef?.trim() || 'origin/development'
  // Do not fetch here: fetching mutates shared refs and can contend with another
  // task's fetch. The watcher/runtime bootstrap owns syncing origin/development.
  const base = runGit(repositoryRoot, ['rev-parse', '--verify', `${baseRef}^{commit}`])
  if (!base.ok) {
    return blocked(taskId, 'base_ref_unavailable', `Base ref ${baseRef} is unavailable locally: ${concise(base.stderr)}.`)
  }

  fs.mkdirSync(path.dirname(worktreePath), { recursive: true, mode: 0o700 })
  const created = runGit(repositoryRoot, ['worktree', 'add', '-b', branch, worktreePath, baseRef])
  if (!created.ok) {
    return blocked(taskId, 'task_worktree_conflict', `Could not create isolated task worktree: ${concise(created.stderr)}.`)
  }
  if (!worktreeIsClean(worktreePath)) {
    return blocked(taskId, 'task_worktree_dirty', `New task worktree is unexpectedly dirty and was left untouched: ${worktreePath}.`)
  }
  const selected = taskWorkingDirectory(worktreePath)
  if (!selected.ok) return selected
  return selected
}
