import { execFileSync } from 'node:child_process'
import {
  assessCompletionIntegrity,
  validateCompletionEvidence,
  verifyChangedFilesMatchCommit,
} from '../../../services/agent-watcher/src/completion-integrity'

const codeEvidence = {
  schemaVersion: 1,
  workKind: 'code',
  commitSha: 'a'.repeat(40),
  changedFiles: ['services/agent-watcher/src/watcher.ts'],
  testCommand: 'npx jest --runInBand __tests__/services/agent-watcher/watcher.test.ts',
  testResult: 'passed',
  worktreeState: 'clean',
}

describe('agent completion integrity', () => {
  it('rejects narrative-only code completion before it can reach done', () => {
    const result = assessCompletionIntegrity({
      summary: 'Implementation complete and ready for review.',
      evidence: null,
      commitReachable: false,
      currentAgentStatus: 'in-progress',
    })

    expect(result).toEqual(expect.objectContaining({
      outcome: 'changes-requested',
      reasons: expect.arrayContaining(['completion_evidence_missing']),
    }))
  })

  it('requires a development-reachable commit for code changes', () => {
    const result = assessCompletionIntegrity({
      summary: 'Implementation complete.',
      evidence: codeEvidence,
      commitReachable: false,
      currentAgentStatus: 'in-progress',
    })

    expect(result).toEqual(expect.objectContaining({
      outcome: 'changes-requested',
      reasons: expect.arrayContaining(['commit_not_reachable_on_origin_development']),
    }))
  })

  it('requires an explicit positive changed-file verifier result for code evidence', () => {
    const result = assessCompletionIntegrity({
      summary: 'Implementation complete.',
      evidence: codeEvidence,
      commitReachable: true,
      currentAgentStatus: 'in-progress',
    })

    expect(result).toEqual(expect.objectContaining({
      outcome: 'changes-requested',
      reasons: expect.arrayContaining(['changed_file_list_mismatch_with_commit']),
    }))
  })

  it('rejects non-canonical and duplicate changed-file claims before commit matching', () => {
    expect(validateCompletionEvidence({
      ...codeEvidence,
      changedFiles: ['services/agent-watcher/src/watcher.ts ', 'services/agent-watcher/src/watcher.ts'],
    })).toEqual(expect.objectContaining({
      ok: false,
      reasons: expect.arrayContaining(['changed_file_list_invalid']),
    }))
  })

  it('rejects a code claim whose changed-file list does not match the reachable commit', () => {
    const result = assessCompletionIntegrity({
      summary: 'Implementation complete.',
      evidence: codeEvidence,
      commitReachable: true,
      changedFilesMatch: false,
      currentAgentStatus: 'in-progress',
    } as never)

    expect(result).toEqual(expect.objectContaining({
      outcome: 'changes-requested',
      reasons: expect.arrayContaining(['changed_file_list_mismatch_with_commit']),
    }))
  })

  it('compares the claimed changed-file list against the submitted commit', async () => {
    const repoRoot = process.cwd()
    const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
    const changedFiles = execFileSync(
      'git',
      ['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', commitSha],
      { cwd: repoRoot, encoding: 'utf8' },
    ).split(/\r?\n/).filter(Boolean)

    await expect(verifyChangedFilesMatchCommit(commitSha, changedFiles, repoRoot)).resolves.toBe(true)
    await expect(verifyChangedFilesMatchCommit(commitSha, [...changedFiles, 'unexpected.ts'], repoRoot)).resolves.toBe(false)
  })

  it('accepts an attested no-code task without a commit while retaining scoped verification', () => {
    const evidence = {
      schemaVersion: 1,
      workKind: 'no-code',
      noCodeReason: 'Read-only audit; no repository files were changed.',
      changedFiles: [],
      testCommand: 'node scripts/verify-read-only-audit.mjs',
      testResult: 'passed',
      worktreeState: 'not-applicable',
    }

    expect(validateCompletionEvidence(evidence)).toEqual(expect.objectContaining({ ok: true }))
    expect(assessCompletionIntegrity({
      summary: 'Read-only audit complete.',
      evidence,
      commitReachable: null,
      currentAgentStatus: 'in-progress',
    })).toEqual(expect.objectContaining({ outcome: 'pass', reasons: [] }))
  })

  it('blocks a completion narrative that admits unresolved work', () => {
    const result = assessCompletionIntegrity({
      summary: 'Nothing is committed or pushed. The remaining work is unresolved.',
      evidence: codeEvidence,
      commitReachable: true,
      currentAgentStatus: 'in-progress',
    })

    expect(result).toEqual(expect.objectContaining({
      outcome: 'blocked',
      reasons: expect.arrayContaining(['agent_output_reports_unresolved_work']),
    }))
  })

  it('blocks completion when the watcher worktree conflicts with code evidence', () => {
    const result = assessCompletionIntegrity({
      summary: 'Implementation complete.',
      evidence: codeEvidence,
      commitReachable: true,
      worktreeClean: false,
      currentAgentStatus: 'in-progress',
    })

    expect(result).toEqual(expect.objectContaining({
      outcome: 'changes-requested',
      reasons: expect.arrayContaining(['watcher_worktree_state_conflicts_with_done']),
    }))
  })

  it('blocks completion when the watcher no longer owns an in-progress task', () => {
    const result = assessCompletionIntegrity({
      summary: 'Implementation complete.',
      evidence: codeEvidence,
      commitReachable: true,
      currentAgentStatus: 'done',
    })

    expect(result).toEqual(expect.objectContaining({
      outcome: 'blocked',
      reasons: expect.arrayContaining(['agent_state_conflicts_with_completion:done']),
    }))
  })
})
