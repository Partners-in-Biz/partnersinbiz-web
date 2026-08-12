import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { prepareTaskWorktree } from '@/runtime-installers/runtime/repository-worktree'

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function createDevelopmentRepository(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-task-worktree-'))
  git(root, ['init', '-b', 'development'])
  git(root, ['config', 'user.email', 'test@example.com'])
  git(root, ['config', 'user.name', 'PiB test'])
  fs.writeFileSync(path.join(root, 'README.md'), '# task worktree harness\n')
  git(root, ['add', 'README.md'])
  git(root, ['commit', '-m', 'seed'])
  return root
}

function removeRepository(root: string): void {
  try {
    const listed = git(root, ['worktree', 'list', '--porcelain'])
    for (const line of listed.split('\n')) {
      if (!line.startsWith('worktree ')) continue
      const worktree = line.slice('worktree '.length)
      if (worktree !== root && fs.existsSync(worktree)) {
        execFileSync('git', ['worktree', 'remove', '--force', worktree], { cwd: root, stdio: 'ignore' })
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

describe('repository task worktree preflight', () => {
  let repositoryRoot: string

  beforeEach(() => {
    repositoryRoot = createDevelopmentRepository()
  })

  afterEach(() => {
    removeRepository(repositoryRoot)
  })

  it('creates independent task-scoped worktrees without changing either task workspace', () => {
    const taskA = prepareTaskWorktree({ repositoryRoot, taskId: 'task-a', baseRef: 'HEAD' })
    const taskB = prepareTaskWorktree({ repositoryRoot, taskId: 'task-b', baseRef: 'HEAD' })

    expect(taskA).toMatchObject({ ok: true, taskId: 'task-a', branch: 'pib-task/task-a' })
    expect(taskB).toMatchObject({ ok: true, taskId: 'task-b', branch: 'pib-task/task-b' })
    if (!taskA.ok || !taskB.ok) throw new Error('expected both task worktrees to be ready')

    expect(taskA.workingDirectory).not.toBe(taskB.workingDirectory)
    fs.writeFileSync(path.join(taskA.workingDirectory, 'only-task-a.txt'), 'A\n')
    expect(fs.existsSync(path.join(taskB.workingDirectory, 'only-task-a.txt'))).toBe(false)
    expect(git(taskB.workingDirectory, ['status', '--porcelain'])).toBe('')
    expect(git(repositoryRoot, ['status', '--porcelain'])).toBe('')
  })

  it('uses the matching nested directory in the task worktree when the authorised mapping targets a repository subdirectory', () => {
    const selectedDirectory = path.join(repositoryRoot, 'packages', 'app')
    fs.mkdirSync(selectedDirectory, { recursive: true })
    fs.writeFileSync(path.join(selectedDirectory, 'package.json'), '{"name":"app"}\n')
    git(repositoryRoot, ['add', 'packages/app/package.json'])
    git(repositoryRoot, ['commit', '-m', 'add nested app'])

    const task = prepareTaskWorktree({ repositoryRoot: selectedDirectory, taskId: 'task-nested', baseRef: 'HEAD' })

    expect(task).toMatchObject({ ok: true, taskId: 'task-nested' })
    if (!task.ok) throw new Error('expected nested task worktree to be ready')
    expect(task.workingDirectory).toContain(`${path.sep}pib-task-task-nested${path.sep}packages${path.sep}app`)
    expect(fs.readFileSync(path.join(task.workingDirectory, 'package.json'), 'utf8')).toContain('"name":"app"')
  })

  it('rejects a dirty shared checkout without stashing, rebasing, or touching its in-flight changes', () => {
    const dirtyPath = path.join(repositoryRoot, 'in-flight-sibling.txt')
    fs.writeFileSync(dirtyPath, 'do not mix this task\n')

    const result = prepareTaskWorktree({ repositoryRoot, taskId: 'task-conflict', baseRef: 'HEAD' })

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      code: 'shared_worktree_dirty',
      taskId: 'task-conflict',
    }))
    expect(fs.readFileSync(dirtyPath, 'utf8')).toBe('do not mix this task\n')
    expect(git(repositoryRoot, ['status', '--porcelain'])).toContain('?? in-flight-sibling.txt')
    expect(fs.existsSync(path.join(repositoryRoot, '.worktrees', 'pib-task-task-conflict'))).toBe(false)
  })
})
