import {
  assessCompletionIntegrity,
  validateCompletionEvidence,
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
