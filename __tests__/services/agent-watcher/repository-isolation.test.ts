import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { prepareWatcherTaskWorktree, usesPlatformRepoIsolation } from '../../../services/agent-watcher/src/repository-isolation'

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}

function createDevelopmentRepository(): string {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-watcher-isolation-'))
  const origin = path.join(parent, 'origin.git')
  const root = path.join(parent, 'repo')
  execFileSync('git', ['init', '--bare', origin], { stdio: 'ignore' })
  fs.mkdirSync(root)
  git(root, ['init', '-b', 'development'])
  git(root, ['config', 'user.email', 'watcher-test@example.com'])
  git(root, ['config', 'user.name', 'Watcher test'])
  fs.writeFileSync(path.join(root, 'README.md'), '# watcher isolation\n')
  git(root, ['add', 'README.md'])
  git(root, ['commit', '-m', 'seed'])
  git(root, ['remote', 'add', 'origin', origin])
  git(root, ['push', '-u', 'origin', 'development'])
  return root
}

function removeRepository(root: string): void {
  const parent = path.dirname(root)
  try {
    const listed = git(root, ['worktree', 'list', '--porcelain'])
    for (const line of listed.split('\n')) {
      if (!line.startsWith('worktree ')) continue
      const worktree = line.slice('worktree '.length)
      if (worktree !== root && fs.existsSync(worktree)) {
        execFileSync('git', ['worktree', 'remove', '--force', worktree], { cwd: root, stdio: 'ignore' })
      }
    }
  } catch {
    // ignore
  }
  fs.rmSync(parent, { recursive: true, force: true })
}

describe('watcher repository isolation for direct VPS dispatch', () => {
  let repositoryRoot: string

  beforeEach(() => {
    repositoryRoot = createDevelopmentRepository()
  })

  afterEach(() => {
    removeRepository(repositoryRoot)
  })

  it('creates two independent task-scoped worktrees without changing the shared checkout', async () => {
    const taskA = await prepareWatcherTaskWorktree({ taskId: 'task-a', repositoryRoot, baseRef: 'HEAD' })
    const taskB = await prepareWatcherTaskWorktree({ taskId: 'task-b', repositoryRoot, baseRef: 'HEAD' })

    expect(taskA).toMatchObject({ ok: true, taskId: 'task-a', branch: 'pib-task/task-a' })
    expect(taskB).toMatchObject({ ok: true, taskId: 'task-b', branch: 'pib-task/task-b' })
    if (!taskA.ok || !taskB.ok) throw new Error('expected both watcher task worktrees to be ready')

    expect(taskA.workingDirectory).not.toBe(taskB.workingDirectory)
    fs.writeFileSync(path.join(taskA.workingDirectory, 'only-task-a.txt'), 'A\n')
    expect(fs.existsSync(path.join(taskB.workingDirectory, 'only-task-a.txt'))).toBe(false)
    expect(git(taskB.workingDirectory, ['status', '--porcelain'])).toBe('')
    expect(git(repositoryRoot, ['status', '--porcelain'])).toBe('')
  })

  it('preserves a nested authorised directory in the isolated worktree', async () => {
    const nested = path.join(repositoryRoot, 'packages', 'app')
    fs.mkdirSync(nested, { recursive: true })
    fs.writeFileSync(path.join(nested, 'package.json'), '{"name":"app"}\n')
    git(repositoryRoot, ['add', 'packages/app/package.json'])
    git(repositoryRoot, ['commit', '-m', 'add nested app'])
    git(repositoryRoot, ['push', 'origin', 'development'])

    const task = await prepareWatcherTaskWorktree({
      taskId: 'task-nested',
      repositoryRoot,
      baseRef: 'HEAD',
      relativePath: 'packages/app',
    })

    expect(task).toMatchObject({ ok: true, taskId: 'task-nested' })
    if (!task.ok) throw new Error('expected nested watcher task worktree to be ready')
    expect(task.workingDirectory).toContain(`${path.sep}pib-task-task-nested${path.sep}packages${path.sep}app`)
    expect(fs.readFileSync(path.join(task.workingDirectory, 'package.json'), 'utf8')).toContain('"name":"app"')
  })

  it('rejects a dirty shared checkout without stashing, rebasing, or touching its in-flight changes', async () => {
    const dirtyPath = path.join(repositoryRoot, 'in-flight-sibling.txt')
    fs.writeFileSync(dirtyPath, 'do not mix this task\n')

    const result = await prepareWatcherTaskWorktree({ taskId: 'task-conflict', repositoryRoot, baseRef: 'HEAD' })

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      code: 'shared_worktree_dirty',
      taskId: 'task-conflict',
    }))
    if (!result.ok) {
      expect(fs.readFileSync(dirtyPath, 'utf8')).toBe('do not mix this task\n')
      expect(git(repositoryRoot, ['status', '--porcelain'])).toContain('?? in-flight-sibling.txt')
      expect(fs.existsSync(path.join(path.dirname(repositoryRoot), '.pib-agent-worktrees'))).toBe(false)
    }
  })

  it('rejects an invalid task id', async () => {
    const result = await prepareWatcherTaskWorktree({ taskId: '../escape', repositoryRoot, baseRef: 'HEAD' })
    expect(result).toEqual(expect.objectContaining({ ok: false, code: 'invalid_task_id' }))
  })

  it('rejects a non-git directory', async () => {
    const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-watcher-nongit-'))
    try {
      const result = await prepareWatcherTaskWorktree({ taskId: 'task-x', repositoryRoot: nonGit, baseRef: 'HEAD' })
      expect(result).toEqual(expect.objectContaining({ ok: false, code: 'not_git_repository' }))
    } finally {
      fs.rmSync(nonGit, { recursive: true, force: true })
    }
  })

  it('rejects a shared checkout on the wrong branch', async () => {
    git(repositoryRoot, ['checkout', '-b', 'main'])
    const result = await prepareWatcherTaskWorktree({ taskId: 'task-branch', repositoryRoot, baseRef: 'HEAD' })
    expect(result).toEqual(expect.objectContaining({ ok: false, code: 'shared_worktree_branch_conflict' }))
    git(repositoryRoot, ['checkout', 'development'])
  })
})

describe('usesPlatformRepoIsolation', () => {
  const original = process.env.PIB_PLATFORM_PROJECT_IDS

  afterEach(() => {
    if (original === undefined) delete process.env.PIB_PLATFORM_PROJECT_IDS
    else process.env.PIB_PLATFORM_PROJECT_IDS = original
  })

  it('isolates only PiB website boards and never SA Gun Auctions', () => {
    delete process.env.PIB_PLATFORM_PROJECT_IDS
    expect(usesPlatformRepoIsolation('UhlEQl2fsZbhfAcnKmt2')).toBe(true)
    expect(usesPlatformRepoIsolation('o9oakSxDgF3iHwlKmW1T')).toBe(true)
    expect(usesPlatformRepoIsolation('IKZxZvKIyr21yMhYywNJ')).toBe(false)
    expect(usesPlatformRepoIsolation('project-1')).toBe(false)
    expect(usesPlatformRepoIsolation(undefined)).toBe(false)
  })

  it('accepts extra platform project ids from PIB_PLATFORM_PROJECT_IDS', () => {
    process.env.PIB_PLATFORM_PROJECT_IDS = ' extra-pib ,another '
    expect(usesPlatformRepoIsolation('extra-pib')).toBe(true)
    expect(usesPlatformRepoIsolation('IKZxZvKIyr21yMhYywNJ')).toBe(false)
  })
})
