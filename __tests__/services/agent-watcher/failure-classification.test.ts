import {
  classificationMatrix,
  decideAutomaticRequeue,
  isTransientHermesError,
  MAX_TRANSIENT_RETRIES,
  transientRetryAt,
} from '../../../services/agent-watcher/src/failure-classification'

describe('failure-classification matrix', () => {
  const now = Date.parse('2026-08-10T12:00:00.000Z')

  it('exposes the operator-facing classification matrix', () => {
    const matrix = classificationMatrix()
    expect(matrix.find((row) => row.class === 'session_storage_busy')?.autoRequeue).toBe(true)
    expect(matrix.find((row) => row.class === 'worktree_safety')?.autoRequeue).toBe(false)
    expect(matrix.find((row) => row.class === 'dispatch_acceptance_unknown')?.autoRequeue).toBe(false)
  })

  it('classifies session-storage busy as bounded requeue with exponential backoff', () => {
    const decision = decideAutomaticRequeue({
      error: 'session-storage busy: database is locked (SQLITE_BUSY)',
      dispatchAcceptance: 'not-accepted',
      runId: null,
      priorRetryCount: 0,
      now,
      phase: 'pre-execution',
      task: { title: 'Investigate runtime flake', requiredCapability: 'write' },
    })
    expect(decision.action).toBe('requeue')
    if (decision.action !== 'requeue') return
    expect(decision.class).toBe('session_storage_busy')
    expect(decision.nextRetryCount).toBe(1)
    expect(decision.retryAt).toBe(transientRetryAt(0, now, decision.record.error))
    expect(decision.record.policy.maxAttempts).toBe(MAX_TRANSIENT_RETRIES)
    expect(decision.record.policy.usesAtMostOnceKey).toBe(true)
    expect(decision.record.retryEligible).toBe(true)
  })

  it('classifies runner timeout with no evidenced output as requeueable', () => {
    const decision = decideAutomaticRequeue({
      error: 'Agent run timed out after 90 minutes',
      dispatchAcceptance: 'not-accepted',
      runId: null,
      output: '',
      priorRetryCount: 1,
      now,
      phase: 'run-failure',
      task: { title: 'Debug watcher prompt budget', requiredCapability: 'write' },
    })
    expect(decision).toMatchObject({
      action: 'requeue',
      class: 'runner_timeout_no_evidence',
      nextRetryCount: 2,
    })
  })

  it('does not requeue runner timeout when commits/artifacts are evidenced', () => {
    const decision = decideAutomaticRequeue({
      error: 'Agent run timed out after 90 minutes',
      dispatchAcceptance: 'not-accepted',
      runId: null,
      output: 'Committed abcdef1 and pushed to origin/development',
      priorRetryCount: 0,
      now,
      task: { title: 'Ship feature', requiredCapability: 'write' },
    })
    expect(decision.action).toBe('block')
    expect(decision.class).toBe('business_or_test_blocker')
    expect(decision.retryEligible).toBe(false)
  })

  it('requeues proven not-accepted transient queue/host faults', () => {
    expect(isTransientHermesError('Hermes /v1/runs returned 502: upstream unavailable')).toBe(true)
    const decision = decideAutomaticRequeue({
      error: 'Hermes /v1/runs returned 502: upstream unavailable',
      dispatchAcceptance: 'not-accepted',
      runId: null,
      priorRetryCount: 0,
      now,
      phase: 'pre-execution',
      dispatchKey: 'pib-dispatch-v1-test',
      task: { title: 'Investigate project health', requiredCapability: 'write' },
    })
    expect(decision.action).toBe('requeue')
    if (decision.action !== 'requeue') return
    expect(decision.class).toBe('transient_queue_host')
    expect(decision.record.acceptance).toBe('not-accepted')
    expect(decision.summary).toContain('Automatic retry 1/3')
  })

  it('never auto-requeues unknown dispatch acceptance (duplicate-dispatch prevention)', () => {
    const decision = decideAutomaticRequeue({
      error: 'Hermes dispatch acceptance is unknown after reconciliation: lookup unavailable',
      dispatchAcceptance: 'unknown',
      runId: null,
      priorRetryCount: 0,
      now,
      phase: 'dispatch-acceptance-unknown',
      dispatchKey: 'pib-dispatch-v1-ambiguous',
      task: { title: 'Repair watcher transport safety', requiredCapability: 'write' },
    })
    expect(decision.action).toBe('block')
    expect(decision.class).toBe('dispatch_acceptance_unknown')
    expect(decision.summary).toContain('not retried because dispatch acceptance is unknown')
    expect(decision.record.retryEligible).toBe(false)
  })

  it('never auto-requeues after an accepted run id', () => {
    const decision = decideAutomaticRequeue({
      error: 'Hermes run run-1 was not found on the agent gateway',
      dispatchAcceptance: 'accepted',
      runId: 'run-1',
      priorRetryCount: 0,
      now,
      phase: 'accepted-run-polling',
      task: { title: 'Continue implementation', requiredCapability: 'write' },
    })
    expect(decision.action).toBe('block')
    expect(decision.class).toBe('accepted_run_unresolved')
    expect(decision.summary).toContain('will not dispatch a second run')
  })

  it('blocks worktree safety conflicts', () => {
    const decision = decideAutomaticRequeue({
      error: 'TASK_WORKTREE_BLOCKED:shared_worktree_dirty: dirty shared checkout',
      dispatchAcceptance: 'not-accepted',
      runId: null,
      priorRetryCount: 0,
      now,
      task: { title: 'Implement feature', requiredCapability: 'write' },
    })
    expect(decision).toMatchObject({ action: 'block', class: 'worktree_safety', retryEligible: false })
  })

  it('blocks dependency and approval/review/side-effect safeguards', () => {
    expect(decideAutomaticRequeue({
      error: 'Unresolved dependency task_abc is still blocked',
      dispatchAcceptance: 'not-accepted',
      priorRetryCount: 0,
      now,
      task: { title: 'Downstream work', requiredCapability: 'write' },
    }).class).toBe('dependency_blocker')

    expect(decideAutomaticRequeue({
      error: 'Hermes /v1/runs returned 502: upstream unavailable',
      dispatchAcceptance: 'not-accepted',
      priorRetryCount: 0,
      now,
      task: { title: 'Publish approved client campaign', requiredCapability: 'publish' },
    })).toMatchObject({ action: 'block', class: 'side_effect_sensitive' })

    expect(decideAutomaticRequeue({
      error: 'Hermes /v1/runs returned 502: upstream unavailable',
      dispatchAcceptance: 'not-accepted',
      priorRetryCount: 0,
      now,
      task: {
        title: 'Investigate project health',
        requiredCapability: 'write',
        reviewStatus: 'changes-requested',
      },
    })).toMatchObject({ action: 'block', class: 'review_changes_requested' })

    expect(decideAutomaticRequeue({
      error: 'Hermes /v1/runs returned 502: upstream unavailable',
      dispatchAcceptance: 'not-accepted',
      priorRetryCount: 0,
      now,
      task: {
        title: 'Investigate project health',
        requiredCapability: 'write',
        requiresApproval: true,
        approvalStatus: 'pending',
      },
    })).toMatchObject({ action: 'block', class: 'approval_gate' })
  })

  it('surfaces terminal exhaustion with operator action after max attempts', () => {
    const decision = decideAutomaticRequeue({
      error: 'Hermes /v1/runs returned 503: service unavailable',
      dispatchAcceptance: 'not-accepted',
      runId: null,
      priorRetryCount: MAX_TRANSIENT_RETRIES,
      now,
      phase: 'pre-execution',
      dispatchKey: 'pib-dispatch-v1-exhausted',
      task: { title: 'Investigate project health', requiredCapability: 'write' },
    })
    expect(decision.action).toBe('block')
    expect(decision.class).toBe('terminal_retry_exhausted')
    expect(decision.summary).toContain('Automatic retry budget exhausted')
    expect(decision.operatorAction).toContain('Retry budget exhausted')
    expect(decision.record.operatorAction).toContain('pib-dispatch-v1-exhausted')
  })

  it('uses longer gateway-storm backoff table', () => {
    const first = transientRetryAt(0, now, 'Hermes run run-1 was not found on the agent gateway')
    const normal = transientRetryAt(0, now, 'Hermes /v1/runs returned 502: upstream unavailable')
    expect(Date.parse(first) - now).toBe(5 * 60_000)
    expect(Date.parse(normal) - now).toBe(60_000)
  })
})
