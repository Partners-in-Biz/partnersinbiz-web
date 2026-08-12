jest.mock('../../../services/agent-watcher/src/repository-isolation', () => ({
  prepareWatcherTaskWorktree: jest.fn(async ({ taskId }: { taskId: string }) => ({
    ok: true,
    taskId,
    branch: `pib-task-${taskId}`,
    worktreePath: `/tmp/pib-agent-worktrees/demo/pib-task-${taskId}`,
    workingDirectory: `/tmp/pib-agent-worktrees/demo/pib-task-${taskId}`,
    reused: false,
  })),
}))

jest.mock('../../../services/agent-watcher/src/config', () => ({
  AGENT_IDS: ['pip', 'theo', 'maya', 'sage', 'nora', 'ads', 'qa-release', 'support', 'data', 'docs', 'seo'],
  getAgentConfig: jest.fn(),
  loadEnabledAgentIds: jest.fn(async () => ['pip', 'theo', 'maya', 'sage', 'nora', 'ads', 'qa-release', 'support', 'data', 'docs', 'seo']),
}))

jest.mock('../../../services/agent-watcher/src/claim', () => ({
  claimTask: jest.fn(),
  claimReviewTask: jest.fn(),
  startHeartbeat: jest.fn(),
}))

jest.mock('../../../services/agent-watcher/src/hermes', () => ({
  runAndPoll: jest.fn(),
}))

jest.mock('../../../services/agent-watcher/src/firestore', () => ({
  db: {
    runTransaction: jest.fn(async (work) => work({
      get: (ref: { get: () => unknown }) => ref.get(),
      update: (ref: { update: (patch: Record<string, unknown>) => unknown }, patch: Record<string, unknown>) => ref.update(patch),
    })),
  },
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIME'),
    delete: jest.fn(() => 'DELETE_FIELD'),
  },
}))

jest.mock('../../../services/agent-watcher/src/task-updates', () => ({
  agentStatusUpdate: (status: string, options?: { hasReviewer?: boolean }) => {
    if (status === 'done' && options?.hasReviewer === false) {
      return { agentStatus: status, columnId: 'done', reviewStatus: 'approved' }
    }
    return {
      agentStatus: status,
      columnId: status === 'pending'
        ? 'todo'
        : status === 'done'
          ? 'review'
          : status === 'blocked' || status === 'awaiting-input'
            ? 'blocked'
            : 'in_progress',
      ...(status === 'done' ? { reviewStatus: 'pending' } : {}),
    }
  },
}))

jest.mock('../../../services/agent-watcher/src/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock('../../../services/agent-watcher/src/completion-integrity', () => ({
  ...jest.requireActual('../../../services/agent-watcher/src/completion-integrity'),
  verifyReachableDevelopmentCommit: jest.fn(),
  verifyCleanWatcherWorktree: jest.fn(),
}))

import { getAgentConfig } from '../../../services/agent-watcher/src/config'
import { claimTask, claimReviewTask, startHeartbeat } from '../../../services/agent-watcher/src/claim'
import { db } from '../../../services/agent-watcher/src/firestore'
import { runAndPoll } from '../../../services/agent-watcher/src/hermes'
import { verifyCleanWatcherWorktree, verifyReachableDevelopmentCommit } from '../../../services/agent-watcher/src/completion-integrity'
import {
  dispatchReview,
  dispatchTask,
  isTransientHermesError,
  reviewApproved,
  reviewFailed,
  startWatcher,
  sweepReadyPendingTasks,
} from '../../../services/agent-watcher/src/watcher'

const getAgentConfigMock = getAgentConfig as jest.Mock
const claimTaskMock = claimTask as jest.Mock
const claimReviewTaskMock = claimReviewTask as jest.Mock
const startHeartbeatMock = startHeartbeat as jest.Mock
const runAndPollMock = runAndPoll as jest.Mock
const verifyCleanWatcherWorktreeMock = verifyCleanWatcherWorktree as jest.Mock
const verifyReachableDevelopmentCommitMock = verifyReachableDevelopmentCommit as jest.Mock

describe('agent watcher transient Hermes errors', () => {
  it('treats a gateway-lost run as retryable after an upstream outage', () => {
    expect(isTransientHermesError('Hermes run run-1 was not found on the agent gateway')).toBe(true)
  })

  it('treats provider authentication repair as retryable', () => {
    expect(isTransientHermesError(
      'Provider authentication failed: xAI OAuth state is missing access_token.',
    )).toBe(true)
  })
})

describe('agent watcher dispatchReview verdict hygiene', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getAgentConfigMock.mockResolvedValue({ enabled: true, baseUrl: 'https://hermes.local', apiKey: 'k' })
    claimReviewTaskMock.mockResolvedValue(true)
    runAndPollMock.mockResolvedValue({ runId: 'rev-1', output: 'APPROVED', error: null })
  })

  it('parses explicit product verdicts', () => {
    expect(reviewApproved('APPROVED — looks good')).toBe(true)
    expect(reviewFailed('CHANGES_REQUESTED: fix tests')).toBe(true)
    expect(reviewApproved('LGTM')).toBe(false)
  })

  it('does not requeue implementer when reviewer hits xAI OAuth auth failure', async () => {
    const taskRef = makeTaskRef()
    runAndPollMock.mockResolvedValue({
      runId: 'rev-oauth',
      output: null,
      error: 'Provider authentication failed: xAI OAuth state is missing refresh_token. Re-authenticate with `hermes model`.',
    })

    await dispatchReview(taskRef as never, {
      orgId: 'org-1',
      projectId: 'project-1',
      reviewerAgentId: 'qa-release',
      agentStatus: 'done',
      columnId: 'review',
      reviewStatus: 'pending',
      title: 'Phase 3 authoring',
      agentOutput: { summary: 'done' },
    })

    expect(claimReviewTaskMock).toHaveBeenCalled()
    expect(taskRef.update).toHaveBeenCalledWith(expect.objectContaining({
      columnId: 'review',
      agentStatus: 'done',
      reviewStatus: 'pending',
      reviewRetryCount: 1,
      reviewRetryAt: expect.any(String),
    }))
    const updates = taskRef.update.mock.calls.map((call: unknown[]) => call[0] as Record<string, unknown>)
    expect(updates.some((u) => u.columnId === 'todo' || u.agentStatus === 'pending' || u.reviewStatus === 'changes-requested')).toBe(false)
  })

  it('requeues implementer only on explicit CHANGES_REQUESTED', async () => {
    const taskRef = makeTaskRef()
    runAndPollMock.mockResolvedValue({
      runId: 'rev-cr',
      output: 'CHANGES_REQUESTED: missing Nora SLA fields in UI',
      error: null,
    })

    await dispatchReview(taskRef as never, {
      orgId: 'org-1',
      projectId: 'project-1',
      reviewerAgentId: 'qa-release',
      agentStatus: 'done',
      columnId: 'review',
      reviewStatus: 'pending',
      title: 'Phase 3 authoring',
      agentOutput: { summary: 'done' },
    })

    expect(taskRef.update).toHaveBeenCalledWith(expect.objectContaining({
      columnId: 'todo',
      agentStatus: 'pending',
      reviewStatus: 'changes-requested',
    }))
  })

  it('approves without touching implementer assignee state', async () => {
    const taskRef = makeTaskRef()
    runAndPollMock.mockResolvedValue({
      runId: 'rev-ok',
      output: 'APPROVED',
      error: null,
    })

    await dispatchReview(taskRef as never, {
      orgId: 'org-1',
      projectId: 'project-1',
      reviewerAgentId: 'qa-release',
      agentStatus: 'done',
      columnId: 'review',
      reviewStatus: 'pending',
      title: 'Phase 3 authoring',
      agentOutput: { summary: 'done' },
    })

    expect(taskRef.update).toHaveBeenCalledWith(expect.objectContaining({
      columnId: 'done',
      reviewStatus: 'approved',
      completionVerification: expect.objectContaining({
        verifierIdentity: 'qa-release',
        verifierResult: 'approved',
        reviewerHandoffFrom: 'agent-watcher',
      }),
    }))
  })

  it('blocks reviewer handoff until watcher verification has passed', async () => {
    const taskRef = makeTaskRef([], {
      completionVerification: {
        verifierIdentity: 'agent-watcher',
        verifierResult: 'failed',
        reasons: ['completion_evidence_missing'],
      },
    })

    await dispatchReview(taskRef as never, {
      orgId: 'org-1',
      projectId: 'project-1',
      reviewerAgentId: 'qa-release',
      agentStatus: 'done',
      columnId: 'review',
      reviewStatus: 'pending',
      title: 'Phase 3 authoring',
      agentOutput: { summary: 'done' },
    })

    expect(runAndPollMock).not.toHaveBeenCalled()
    expect(taskRef.update).toHaveBeenCalledWith(expect.objectContaining({
      agentStatus: 'blocked',
      columnId: 'blocked',
      reviewStatus: 'changes-requested',
      completionIntegrityFailureReasons: ['completion_integrity_verification_required_before_reviewer_handoff'],
    }))
  })

  it('skips dispatch while reviewRetryAt backoff is active', async () => {
    const taskRef = makeTaskRef()
    const future = new Date(Date.now() + 60_000).toISOString()

    await dispatchReview(taskRef as never, {
      orgId: 'org-1',
      projectId: 'project-1',
      reviewerAgentId: 'qa-release',
      agentStatus: 'done',
      columnId: 'review',
      reviewStatus: 'pending',
      reviewRetryAt: future,
      title: 'Phase 3 authoring',
    })

    expect(claimReviewTaskMock).not.toHaveBeenCalled()
    expect(runAndPollMock).not.toHaveBeenCalled()
  })
})

const dbMock = db as unknown as { collectionGroup?: jest.Mock; collection?: jest.Mock }

type FilteringQueryDoc = { ref: Record<string, unknown>; data: () => Record<string, unknown> }
type FilteringQuery = {
  wheres: Array<[string, string, unknown]>
  where: jest.Mock
  limit: jest.Mock
  get: jest.Mock
}

function makeTaskRef(
  comments: Array<Record<string, unknown>> = [],
  initialData: Record<string, unknown> = {},
) {
  let data: Record<string, unknown> = {
    completionEvidence: {
      schemaVersion: 1,
      workKind: 'no-code',
      noCodeReason: 'Watcher fixture: no repository files were changed.',
      changedFiles: [],
      testCommand: 'node scripts/verify-watcher-fixture.mjs',
      testResult: 'passed',
      worktreeState: 'not-applicable',
    },
    completionVerification: {
      verifierIdentity: 'agent-watcher',
      verifierResult: 'passed',
      reasons: [],
      commitReachable: null,
    },
    ...initialData,
  }
  const update = jest.fn(async (patch: Record<string, unknown>) => {
    data = { ...data, ...patch }
  })
  return {
    id: 'task-1',
    path: 'orgs/org-1/projects/project-1/tasks/task-1',
    parent: {
      doc: jest.fn(),
    },
    collection: jest.fn(() => ({
      add: jest.fn(async () => ({ id: 'comment-1' })),
      orderBy: jest.fn(() => ({
        limit: jest.fn(() => ({
          get: jest.fn(async () => ({
            docs: comments.map(comment => ({ data: () => comment })),
          })),
        })),
      })),
    })),
    // dispatchReview re-reads live store before/after reviewer runs (thrash guard).
    get: jest.fn(async () => ({
      exists: true,
      data: () => data,
    })),
    update,
  }
}

function makeFilteringCollectionQuery(docs: FilteringQueryDoc[]): FilteringQuery {
  const query: FilteringQuery = {
    wheres: [],
    where: jest.fn(function (this: FilteringQuery, field: string, op: string, value: unknown) {
      this.wheres.push([field, op, value])
      return this
    }),
    limit: jest.fn(function (this: FilteringQuery) { return this }),
    get: jest.fn(async function (this: FilteringQuery) {
      const wheres = [...this.wheres]
      this.wheres = []
      return {
        docs: docs.filter(doc => wheres.every(([field, op, value]) => {
          const actual = doc.data()[field]
          if (op === '==') return actual === value
          if (op === 'in' && Array.isArray(value)) return value.includes(actual)
          return true
        })),
      }
    }),
  }
  return query
}

describe('agent watcher dispatchTask', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    dbMock.collection = undefined
    getAgentConfigMock.mockResolvedValue({ enabled: true, baseUrl: 'https://hermes.local', apiKey: 'secret' })
    claimTaskMock.mockResolvedValue(true)
    startHeartbeatMock.mockReturnValue(jest.fn())
    verifyCleanWatcherWorktreeMock.mockResolvedValue(true)
    verifyReachableDevelopmentCommitMock.mockResolvedValue(true)
    runAndPollMock.mockImplementation(async (_cfg, _input, onRunCreated) => {
      await onRunCreated('run-live-1')
      return {
        runId: 'run-live-1',
        output: 'done summary',
        error: null,
        dispatchAcceptance: 'accepted',
        telemetry: {
          provider: null,
          model: null,
          reasoningEffort: null,
          inputTokens: null,
          outputTokens: null,
          reasoningTokens: null,
          totalTokens: null,
          costUsd: null,
          durationMs: 10,
          retryCount: 0,
          toolCallCount: null,
          tokenSource: 'unavailable',
          costSource: 'unavailable',
          exactTokenUsageAvailable: false,
          exactCostAvailable: false,
          exactUsageAvailable: false,
          missing: ['token_usage', 'cost_usd'],
        },
      }
    })
  })

  it('ignores pending tasks that are not eligible for dispatch', async () => {
    const taskRef = makeTaskRef()

    await dispatchTask(taskRef as never, {
      orgId: 'org-1',
      assigneeAgentId: 'theo',
      agentStatus: 'pending',
      columnId: 'todo',
      requiresApproval: true,
      approvalStatus: 'pending',
    })

    expect(claimTaskMock).not.toHaveBeenCalled()
    expect(runAndPollMock).not.toHaveBeenCalled()
    expect(taskRef.update).not.toHaveBeenCalled()
  })

  it('writes the live run id, heartbeats while running, and marks successful tasks done with the run id', async () => {
    const taskRef = makeTaskRef()
    const stopHeartbeat = jest.fn()
    startHeartbeatMock.mockReturnValue(stopHeartbeat)

    await dispatchTask(taskRef as never, {
      orgId: 'org-1',
      assigneeAgentId: 'theo',
      agentStatus: 'pending',
      columnId: 'todo',
      title: 'Ship watcher hardening',
    })

    expect(claimTaskMock).toHaveBeenCalledWith(taskRef, 'theo')
    expect(startHeartbeatMock).toHaveBeenCalledWith(taskRef)
    expect(stopHeartbeat).toHaveBeenCalledTimes(1)
    expect(taskRef.update).toHaveBeenNthCalledWith(1, expect.objectContaining({
      agentStatus: 'in-progress',
      agentHeartbeatAt: 'SERVER_TIME',
    }))
    expect(taskRef.update).toHaveBeenCalledWith(expect.objectContaining({
      agentConversationId: 'run-live-1',
    }))
    expect(taskRef.update).toHaveBeenLastCalledWith(expect.objectContaining({
      agentStatus: 'done',
      agentConversationId: 'run-live-1',
      agentOutput: expect.objectContaining({ summary: 'done summary' }),
    }))
  })

  it('does not write done when the task claim changes during asynchronous verification', async () => {
    const taskRef = makeTaskRef()
    const initialGet = taskRef.get.getMockImplementation()
    taskRef.get
      .mockImplementationOnce(initialGet)
      .mockImplementationOnce(async () => {
        await taskRef.update({
          agentStatus: 'pending',
          agentOutput: { summary: 'Remaining work is unresolved.' },
        })
        return { exists: true, data: () => ({ agentStatus: 'pending', agentOutput: { summary: 'Remaining work is unresolved.' } }) }
      })

    await dispatchTask(taskRef as never, {
      orgId: 'org-1', assigneeAgentId: 'theo', agentStatus: 'pending', columnId: 'todo', title: 'Ship integrity control',
    })

    const updates = taskRef.update.mock.calls.map((call: unknown[]) => call[0] as Record<string, unknown>)
    expect(updates.some((update) => update.agentStatus === 'done')).toBe(false)
    expect(updates).toContainEqual(expect.objectContaining({
      completionIntegrityFailureReasons: ['completion_state_changed_during_verification'],
      completionVerification: expect.objectContaining({ verifierResult: 'failed' }),
    }))
  })


  it('uses completion-time reviewer assignment so a mid-run reviewer lands in Review, not Done', async () => {
    const taskRef = makeTaskRef()
    taskRef.get.mockImplementation(async () => ({
      exists: true,
      data: () => ({
        completionEvidence: {
          schemaVersion: 1,
          workKind: 'no-code',
          noCodeReason: 'Watcher fixture: no repository files were changed.',
          changedFiles: [],
          testCommand: 'node scripts/verify-watcher-fixture.mjs',
          testResult: 'passed',
          worktreeState: 'not-applicable',
        },
        agentStatus: 'in-progress',
        assigneeAgentId: 'theo',
        reviewerAgentId: 'qa-release',
        reviewStatus: 'pending',
        agentOutput: { summary: 'done summary' },
      }),
    }))

    await dispatchTask(taskRef as never, {
      orgId: 'org-1',
      assigneeAgentId: 'theo',
      agentStatus: 'pending',
      columnId: 'todo',
      title: 'Ship integrity control',
    })

    expect(taskRef.update).toHaveBeenCalledWith(expect.objectContaining({
      agentStatus: 'done',
      columnId: 'review',
      reviewStatus: 'pending',
    }))
    const terminal = taskRef.update.mock.calls
      .map((call: unknown[]) => call[0] as Record<string, unknown>)
      .find((update) => update.agentStatus === 'done')
    expect(terminal).not.toEqual(expect.objectContaining({ columnId: 'done', reviewStatus: 'approved' }))
  })

  it('does not write done when typed agentOutput claim fields change during verification', async () => {
    const taskRef = makeTaskRef()
    const initialGet = taskRef.get.getMockImplementation()
    taskRef.get
      .mockImplementationOnce(initialGet)
      .mockImplementationOnce(async () => {
        await taskRef.update({
          agentOutput: { summary: 'done summary', go_no_go: 'NO-GO' },
        })
        return {
          exists: true,
          data: () => ({
            agentStatus: 'in-progress',
            agentOutput: { summary: 'done summary', go_no_go: 'NO-GO' },
          }),
        }
      })

    await dispatchTask(taskRef as never, {
      orgId: 'org-1', assigneeAgentId: 'theo', agentStatus: 'pending', columnId: 'todo', title: 'Ship integrity control',
    })

    const updates = taskRef.update.mock.calls.map((call: unknown[]) => call[0] as Record<string, unknown>)
    expect(updates.some((update) => update.agentStatus === 'done')).toBe(false)
    expect(updates).toContainEqual(expect.objectContaining({
      completionIntegrityFailureReasons: ['completion_state_changed_during_verification'],
    }))
  })

  it('requeues code completion with bounded backoff when its commit is not reachable from origin/development', async () => {
    const taskRef = makeTaskRef([], {
      completionEvidence: {
        schemaVersion: 1,
        workKind: 'code',
        commitSha: 'b'.repeat(40),
        changedFiles: ['services/agent-watcher/src/watcher.ts'],
        testCommand: 'npx jest --runInBand __tests__/services/agent-watcher/watcher.test.ts',
        testResult: 'passed',
        worktreeState: 'clean',
      },
    })
    verifyReachableDevelopmentCommitMock.mockResolvedValue(false)

    await dispatchTask(taskRef as never, {
      orgId: 'org-1', assigneeAgentId: 'theo', agentStatus: 'pending', columnId: 'todo', title: 'Ship integrity control',
    })

    expect(verifyReachableDevelopmentCommitMock).toHaveBeenCalledWith('b'.repeat(40))
    const update = taskRef.update.mock.calls.map((call: unknown[]) => call[0] as Record<string, unknown>).at(-1)
    expect(update).toEqual(expect.objectContaining({
      agentStatus: 'pending',
      columnId: 'todo',
      agentRetryCount: 1,
      agentRetryAt: expect.any(String),
      completionIntegrityFailureReasons: expect.arrayContaining(['commit_not_reachable_on_origin_development']),
      completionVerification: expect.objectContaining({ verifierIdentity: 'agent-watcher', verifierResult: 'failed', commitReachable: false }),
    }))
    // Recoverable completion failures must not be parked terminal in review.
    expect(update).not.toEqual(expect.objectContaining({ reviewStatus: 'changes-requested' }))
  })

  it('rejects code completion when the watcher worktree is dirty', async () => {
    const taskRef = makeTaskRef([], {
      completionEvidence: {
        schemaVersion: 1,
        workKind: 'code',
        commitSha: 'c'.repeat(40),
        changedFiles: ['services/agent-watcher/src/watcher.ts'],
        testCommand: 'npx jest --runInBand __tests__/services/agent-watcher/watcher.test.ts',
        testResult: 'passed',
        worktreeState: 'clean',
      },
    })
    verifyCleanWatcherWorktreeMock.mockResolvedValue(false)

    await dispatchTask(taskRef as never, {
      orgId: 'org-1', assigneeAgentId: 'theo', agentStatus: 'pending', columnId: 'todo', title: 'Ship integrity control',
    })

    expect(taskRef.update).toHaveBeenLastCalledWith(expect.objectContaining({
      agentStatus: 'blocked',
      columnId: 'blocked',
      reviewStatus: 'changes-requested',
      completionIntegrityFailureReasons: expect.arrayContaining(['watcher_worktree_state_conflicts_with_done']),
      completionVerification: expect.objectContaining({ verifierIdentity: 'agent-watcher', verifierResult: 'failed', worktreeClean: false }),
    }))
  })

  it('persists exact Hermes run telemetry on the task output and loop run ledger', async () => {
    const taskRef = makeTaskRef()
    const loopRunSet = jest.fn(async () => undefined)
    const loopRunDoc = jest.fn(() => ({ set: loopRunSet }))
    dbMock.collection = jest.fn((name: string) => {
      if (name !== 'loop_engine_runs') throw new Error(`Unexpected collection ${name}`)
      return { doc: loopRunDoc }
    })
    runAndPollMock.mockImplementation(async (_cfg, _input, onRunCreated) => {
      await onRunCreated('run-metered-1')
      return {
        runId: 'run-metered-1',
        output: 'done summary',
        error: null,
        telemetry: {
          provider: 'openai',
          model: 'openai/gpt-5.1',
          reasoningEffort: 'high',
          inputTokens: 1200,
          outputTokens: 320,
          reasoningTokens: 280,
          totalTokens: 1800,
          costUsd: 0.0425,
          durationMs: 3456,
          retryCount: 0,
          toolCallCount: null,
          tokenSource: 'upstream',
          costSource: 'upstream',
          exactTokenUsageAvailable: true,
          exactCostAvailable: true,
          exactUsageAvailable: true,
          missing: [],
        },
      }
    })

    await dispatchTask(taskRef as never, {
      orgId: 'org-1',
      projectId: 'project-1',
      assigneeAgentId: 'theo',
      reviewerAgentId: 'qa-release',
      agentStatus: 'pending',
      columnId: 'todo',
      title: 'Ship telemetry',
      agentEffort: 'high',
      agentModel: 'openai/gpt-5.1',
      riskLevel: 'high',
    })

    expect(taskRef.update).toHaveBeenLastCalledWith(expect.objectContaining({
      agentStatus: 'done',
      agentConversationId: 'run-metered-1',
      agentOutput: expect.objectContaining({
        summary: 'done summary',
        telemetry: expect.objectContaining({
          provider: 'openai',
          model: 'openai/gpt-5.1',
          inputTokens: 1200,
          outputTokens: 320,
          reasoningTokens: 280,
          totalTokens: 1800,
          costUsd: 0.0425,
          exactUsageAvailable: true,
        }),
      }),
    }))
    expect(loopRunDoc).toHaveBeenCalledWith('agent-task-dispatch:task-1:run-metered-1')
    expect(loopRunSet).toHaveBeenCalledWith(expect.objectContaining({
      loopId: 'agent-task-dispatch',
      orgId: 'org-1',
      projectId: 'project-1',
      status: 'executed',
      usage: expect.objectContaining({
        inputTokens: 1200,
        outputTokens: 320,
        reasoningTokens: 280,
        totalTokens: 1800,
        costUsd: 0.0425,
        durationMs: 3456,
      }),
      runtime: expect.objectContaining({
        source: 'agent-watcher',
        taskId: 'task-1',
        agentId: 'theo',
        runId: 'run-metered-1',
        provider: 'openai',
        model: 'openai/gpt-5.1',
        requiresExactModelTelemetry: true,
      }),
      telemetry: expect.objectContaining({
        tokenSource: 'upstream',
        costSource: 'upstream',
        exactUsageAvailable: true,
      }),
    }), { merge: true })
  })

  it('includes recent task comments in the dispatched prompt', async () => {
    const taskRef = makeTaskRef([
      {
        text: 'Please fix the mobile spacing and keep the hero compact.',
        userName: 'Peet',
        createdAt: { _seconds: 1779421000 },
      },
    ])

    await dispatchTask(taskRef as never, {
      orgId: 'org-1',
      assigneeAgentId: 'theo',
      agentStatus: 'pending',
      columnId: 'todo',
      agentInput: { spec: 'Original implementation task' },
    })

    expect(runAndPollMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        spec: expect.stringContaining('Recent task comments / revision notes:'),
      }),
      expect.any(Function),
    )
    expect(runAndPollMock.mock.calls[0][1].spec).toContain('Please fix the mobile spacing')
  })

  it('fails over once to a healthy local runtime after a pre-execution VPS gateway 502', async () => {
    const taskRef = makeTaskRef()
    getAgentConfigMock
      .mockResolvedValueOnce({ enabled: true, targetId: 'vps', baseUrl: 'https://vps.hermes.local', apiKey: 'vps-key' })
      .mockResolvedValueOnce({ enabled: true, targetId: 'local', baseUrl: 'https://local.hermes.local', apiKey: 'local-key' })
    runAndPollMock
      .mockResolvedValueOnce({ runId: null, output: null, error: 'Hermes /v1/runs returned 502: upstream unavailable', dispatchAcceptance: 'not-accepted', telemetry: { durationMs: 4 } })
      .mockImplementationOnce(async (_cfg, _input, onRunCreated) => {
        await onRunCreated('run-local-1')
        return {
          runId: 'run-local-1',
          output: 'done after safe failover',
          error: null,
          dispatchAcceptance: 'accepted',
          telemetry: { durationMs: 9 },
        }
      })

    await dispatchTask(taskRef as never, {
      orgId: 'org-1',
      assigneeAgentId: 'theo',
      agentStatus: 'pending',
      columnId: 'todo',
      title: 'Repair watcher test fixture',
      requiredCapability: 'write',
    })

    expect(getAgentConfigMock).toHaveBeenNthCalledWith(1, 'theo', null)
    expect(getAgentConfigMock).toHaveBeenNthCalledWith(2, 'theo', 'local')
    expect(runAndPollMock).toHaveBeenCalledTimes(2)
    expect(runAndPollMock.mock.calls[1][0]).toEqual(expect.objectContaining({ targetId: 'local' }))
    expect(runAndPollMock.mock.calls[1][1]).toEqual(expect.objectContaining({ runtimeTargetId: 'local' }))
    expect(taskRef.update).toHaveBeenLastCalledWith(expect.objectContaining({
      agentStatus: 'done',
      agentConversationId: 'run-local-1',
    }))
  })

  it('blocks an ambiguous no-run-id dispatch instead of failing over or scheduling a new POST', async () => {
    const taskRef = makeTaskRef()
    getAgentConfigMock.mockResolvedValue({ enabled: true, targetId: 'vps', baseUrl: 'https://vps.hermes.local', apiKey: 'vps-key' })
    runAndPollMock.mockResolvedValue({
      runId: null,
      output: null,
      error: 'Hermes dispatch acceptance is unknown after reconciliation: lookup unavailable',
      dispatchAcceptance: 'unknown',
      telemetry: { durationMs: 4 },
    })

    await dispatchTask(taskRef as never, {
      orgId: 'org-1',
      assigneeAgentId: 'theo',
      agentStatus: 'pending',
      columnId: 'todo',
      title: 'Repair watcher transport safety',
      requiredCapability: 'write',
    })

    expect(getAgentConfigMock).toHaveBeenCalledTimes(1)
    expect(runAndPollMock).toHaveBeenCalledTimes(1)
    expect(taskRef.update).toHaveBeenLastCalledWith(expect.objectContaining({
      agentStatus: 'blocked',
      columnId: 'blocked',
      agentDispatchFailure: expect.objectContaining({
        phase: 'dispatch-acceptance-unknown',
        retryEligible: false,
      }),
      agentOutput: expect.objectContaining({
        summary: expect.stringContaining('not retried because dispatch acceptance is unknown'),
      }),
    }))
  })

  it('derives and passes one stable dispatch key for a logical task attempt', async () => {
    const taskRef = makeTaskRef()

    await dispatchTask(taskRef as never, {
      orgId: 'org-1',
      assigneeAgentId: 'theo',
      agentStatus: 'pending',
      columnId: 'todo',
      title: 'Repair watcher transport safety',
      agentRetryCount: 2,
    })

    expect(runAndPollMock.mock.calls[0][1]).toEqual(expect.objectContaining({
      dispatchKey: expect.stringMatching(/^pib-dispatch-v1-[a-f0-9]{64}$/),
    }))
  })

  it('does not fail over or automatically retry a sensitive task after a pre-execution VPS gateway 502', async () => {
    const taskRef = makeTaskRef()
    getAgentConfigMock.mockResolvedValue({ enabled: true, targetId: 'vps', baseUrl: 'https://vps.hermes.local', apiKey: 'test-key' })
    runAndPollMock.mockResolvedValue({
      runId: null,
      output: null,
      error: 'Hermes /v1/runs returned 502: upstream unavailable',
      dispatchAcceptance: 'not-accepted',
      telemetry: { durationMs: 4 },
    })

    await dispatchTask(taskRef as never, {
      orgId: 'org-1',
      assigneeAgentId: 'theo',
      agentStatus: 'pending',
      columnId: 'todo',
      title: 'Publish approved client campaign',
      requiredCapability: 'publish',
    })

    expect(getAgentConfigMock).toHaveBeenCalledTimes(1)
    expect(runAndPollMock).toHaveBeenCalledTimes(1)
    expect(taskRef.update).toHaveBeenLastCalledWith(expect.objectContaining({
      agentStatus: 'blocked',
      columnId: 'blocked',
      agentDispatchFailure: expect.objectContaining({
        phase: 'pre-execution',
        targetId: 'vps',
        retryEligible: false,
      }),
      agentOutput: expect.objectContaining({
        summary: expect.stringContaining('not retried because this task is approval-gated or side-effect-sensitive'),
      }),
    }))
  })

  it('injects the CEO data-decision operating rule into every Hermes task dispatch', async () => {
    const taskRef = makeTaskRef()

    await dispatchTask(taskRef as never, {
      orgId: 'pib-platform-owner',
      assigneeAgentId: 'maya',
      agentStatus: 'pending',
      columnId: 'todo',
      agentInput: { spec: 'Analyze the Marketing Studio queue and recommend the next action.' },
    })

    const spec = runAndPollMock.mock.calls[0][1].spec as string
    expect(spec).toContain('CEO data-decision operating rule:')
    expect(spec).toContain('Do not create or maintain a permanent dashboard by default.')
    expect(spec).toContain('If the database does not contain the required facts, do not infer or fabricate the answer.')
    expect(spec).toContain('Temporary throw-away HTML is allowed only for a named one-off question where visual comparison materially improves the answer')
    expect(spec).toContain('GET /api/v1/agent/growth-command-queue with orgId=pib-platform-owner')
    expect(spec).toContain('Return the decision first, followed by evidence, reusable workflow, next actions, and safety readback in the dynamic Messages window.')
    expect(spec).toContain('structured approval_card rich part')
  })

  it('passes provenance, risk, capability, and reviewer context into Hermes dispatch', async () => {
    const taskRef = makeTaskRef()

    await dispatchTask(taskRef as never, {
      orgId: 'org-1',
      projectId: 'project-1',
      assigneeAgentId: 'theo',
      agentStatus: 'pending',
      columnId: 'todo',
      reviewerAgentId: 'qa-release',
      agentInput: {
        spec: 'Implement approved spec',
        context: {
          sourceDocumentId: 'doc-1',
          sourceSpecVersion: 'v3',
          approvalGateTaskId: 'gate-1',
          sourceResearchItemId: 'research-1',
        },
      },
      riskLevel: 'critical',
      agentEffort: 'high',
      agentModel: 'claude-sonnet-4-6',
      requiredCapability: 'deploy',
      requestedByAgentId: 'pip',
      expectedArtifacts: ['pull_request', 'preview_url', 'test_report'],
    })

    expect(runAndPollMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        context: expect.objectContaining({
          projectId: 'project-1',
          reviewerAgentId: 'qa-release',
          riskLevel: 'critical',
          requiredCapability: 'deploy',
          requestedByAgentId: 'pip',
          expectedArtifacts: ['pull_request', 'preview_url', 'test_report'],
          sourceDocumentId: 'doc-1',
          sourceSpecVersion: 'v3',
          approvalGateTaskId: 'gate-1',
          sourceResearchItemId: 'research-1',
        }),
        agentEffort: 'high',
        agentModel: 'claude-sonnet-4-6',
      }),
      expect.any(Function),
    )
  })

  it('injects project docs and dependency outputs into the dispatch prompt', async () => {
    const dependencySnap = {
      exists: true,
      data: () => ({
        title: 'Research baseline',
        agentStatus: 'done',
        columnId: 'review',
        agentOutput: { summary: 'Competitor research says lead with proof.' },
      }),
    }
    const taskRef = {
      ...makeTaskRef(),
      parent: {
        doc: jest.fn(() => ({ get: jest.fn(async () => dependencySnap) })),
      },
    }
    const docsGet = jest.fn(async () => ({
      empty: false,
      docs: [
        { id: 'doc-1', data: () => ({ title: 'Approved spec', type: 'requirements' }) },
      ],
    }))
    const docsCollection = {
      orderBy: jest.fn(() => ({
        limit: jest.fn(() => ({ get: docsGet })),
      })),
    }
    dbMock.collection = jest.fn(() => ({
      doc: jest.fn(() => ({
        get: jest.fn(async () => ({
          exists: true,
          data: () => ({ name: 'Launch project', brief: 'Approved project brief.', surfaceMode: 'persuade' }),
        })),
        collection: jest.fn(() => docsCollection),
      })),
    }))

    await dispatchTask(taskRef as never, {
      orgId: 'org-1',
      projectId: 'project-1',
      assigneeAgentId: 'theo',
      agentStatus: 'pending',
      columnId: 'todo',
      agentInput: { spec: 'Implement next step' },
      dependsOn: ['dep-1'],
    })

    const spec = runAndPollMock.mock.calls[0][1].spec as string
    expect(spec).toContain('Project context:')
    expect(spec).toContain('Launch project')
    expect(spec).toContain('/api/v1/agent/project/project-1/task/task-1/context')
    expect(spec).toContain('approved source references, dependency evidence')
    expect(spec).toContain('## Surface mode: Persuade')
  })

  it('injects the project surface-mode standard into the dispatch prompt', async () => {
    const taskRef = makeTaskRef()
    dbMock.collection = jest.fn(() => ({
      doc: jest.fn(() => ({
        get: jest.fn(async () => ({
          exists: true,
          data: () => ({ name: 'Dashboard rebuild', surfaceMode: 'operate' }),
        })),
        collection: jest.fn(() => ({
          orderBy: jest.fn(() => ({
            limit: jest.fn(() => ({ get: jest.fn(async () => ({ empty: true, docs: [] })) })),
          })),
        })),
      })),
    }))

    await dispatchTask(taskRef as never, {
      orgId: 'org-1',
      projectId: 'project-1',
      assigneeAgentId: 'theo',
      agentStatus: 'pending',
      columnId: 'todo',
      agentInput: { spec: 'Make the dashboard usable' },
    })

    const spec = runAndPollMock.mock.calls[0][1].spec as string
    expect(spec).toContain('## Surface mode: Operate')
    expect(spec).toContain('disappears into the task')
    expect(spec).toContain('Avoid:')
  })

  it('marks human approval/input stalls as Needs Peet instead of silently completing the task', async () => {
    const taskRef = makeTaskRef()
    const notificationsSet = jest.fn(async () => undefined)
    const notificationsDoc = jest.fn(() => ({ set: notificationsSet }))
    dbMock.collection = jest.fn((name: string) => {
      if (name === 'loop_engine_runs') return { doc: jest.fn(() => ({ set: jest.fn(async () => undefined) })) }
      if (name === 'notifications') return { doc: notificationsDoc }
      throw new Error(`Unexpected collection ${name}`)
    })
    runAndPollMock.mockImplementation(async (_cfg, _input, onRunCreated) => {
      await onRunCreated('run-needs-peet-1')
      return {
        runId: 'run-needs-peet-1',
        output: 'Cannot continue until Peet approves the production deploy. Exact blocker: release approval is missing. Proof needed: approval comment on this task. Message for agent: continue only after approved.',
        error: null,
      }
    })

    await dispatchTask(taskRef as never, {
      orgId: 'org-1',
      projectId: 'project-1',
      assigneeAgentId: 'theo',
      agentStatus: 'pending',
      columnId: 'todo',
      title: 'Deploy verified build',
      createdBy: 'peet-user-1',
      requiredCapability: 'production-deploy',
    } as never)

    expect(taskRef.update).toHaveBeenLastCalledWith(expect.objectContaining({
      agentStatus: 'awaiting-input',
      columnId: 'blocked',
      agentConversationId: 'run-needs-peet-1',
      agentOutput: expect.objectContaining({
        summary: expect.stringContaining('Cannot continue until Peet approves'),
        needsPeet: true,
        blockingReason: 'release approval is missing',
        safeContinuePath: expect.stringContaining('Do not bypass approval gates'),
      }),
    }))
    expect(notificationsDoc).toHaveBeenCalledWith('agent-needs-peet-org-1-task-1')
    expect(notificationsSet).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      userId: 'peet-user-1',
      agentId: 'theo',
      type: 'task.agent_needs_input',
      title: 'Needs Peet: Theo cannot continue',
      body: expect.stringContaining('Exact blocker: release approval is missing'),
      link: '/admin/projects/project-1?taskId=task-1',
      data: expect.objectContaining({
        blockerReason: 'release approval is missing',
        requiredCapability: 'production-deploy',
        safeContinuePath: expect.stringContaining('approval/input evidence'),
      }),
      priority: 'urgent',
      status: 'unread',
    }), { merge: true })
  })

  it('does not treat routine approval-gate guardrail copy as a stall when the task actually completed', async () => {
    const taskRef = makeTaskRef()
    runAndPollMock.mockImplementation(async (_cfg, _input, onRunCreated) => {
      await onRunCreated('run-complete-guardrail-1')
      return {
        runId: 'run-complete-guardrail-1',
        output: 'Implemented and verified on development. No production deployment without explicit release approval.',
        error: null,
      }
    })

    await dispatchTask(taskRef as never, {
      orgId: 'org-1',
      projectId: 'project-1',
      assigneeAgentId: 'theo',
      agentStatus: 'pending',
      columnId: 'todo',
      title: 'Implement development fix',
    })

    // No reviewer on the task → completion lands in Done so dependents can start.
    expect(taskRef.update).toHaveBeenLastCalledWith(expect.objectContaining({
      agentStatus: 'done',
      columnId: 'done',
      reviewStatus: 'approved',
      agentOutput: expect.objectContaining({
        summary: expect.stringContaining('Implemented and verified'),
      }),
    }))
  })

  it('routes completed agent work into Review when a reviewer is assigned', async () => {
    const taskRef = makeTaskRef([], { reviewerAgentId: 'qa-release', reviewStatus: 'pending' })
    runAndPollMock.mockImplementation(async (_cfg, _input, onRunCreated) => {
      await onRunCreated('run-complete-reviewer-1')
      return {
        runId: 'run-complete-reviewer-1',
        output: 'Implementation complete and ready for review.',
        error: null,
      }
    })

    await dispatchTask(taskRef as never, {
      orgId: 'org-1',
      projectId: 'project-1',
      assigneeAgentId: 'theo',
      reviewerAgentId: 'qa-release',
      agentStatus: 'pending',
      columnId: 'todo',
      title: 'Implement development fix',
    })

    expect(taskRef.update).toHaveBeenLastCalledWith(expect.objectContaining({
      agentStatus: 'done',
      columnId: 'review',
      reviewStatus: 'pending',
      agentOutput: expect.objectContaining({
        summary: expect.stringContaining('ready for review'),
      }),
    }))
  })

  it('marks failed Hermes runs blocked while preserving the live run id and stopping the heartbeat', async () => {
    const taskRef = makeTaskRef()
    const stopHeartbeat = jest.fn()
    startHeartbeatMock.mockReturnValue(stopHeartbeat)
    runAndPollMock.mockImplementation(async (_cfg, _input, onRunCreated) => {
      await onRunCreated('run-failed-1')
      return {
        runId: 'run-failed-1',
        output: null,
        error: 'gateway failed',
        dispatchAcceptance: 'accepted',
      }
    })

    await dispatchTask(taskRef as never, {
      orgId: 'org-1',
      assigneeAgentId: 'theo',
      agentStatus: 'pending',
      columnId: 'todo',
      title: 'Ship watcher hardening',
    })

    expect(stopHeartbeat).toHaveBeenCalledTimes(1)
    expect(taskRef.update).toHaveBeenLastCalledWith(expect.objectContaining({
      agentStatus: 'blocked',
      agentConversationId: 'run-failed-1',
      agentDispatchFailure: expect.objectContaining({
        phase: 'accepted-run-polling',
        retryEligible: false,
      }),
      agentOutput: expect.objectContaining({
        summary: expect.stringContaining('Watcher error after accepted run run-failed-1: gateway failed'),
      }),
    }))
  })

  it('blocks an accepted-run transient failure instead of scheduling a second POST', async () => {
    const taskRef = makeTaskRef()
    const stopHeartbeat = jest.fn()
    startHeartbeatMock.mockReturnValue(stopHeartbeat)
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-27T06:00:00.000Z'))
    runAndPollMock.mockImplementation(async (_cfg, _input, onRunCreated) => {
      await onRunCreated('run-connection-1')
      return {
        runId: 'run-connection-1',
        output: null,
        error: 'Connection error.',
        dispatchAcceptance: 'accepted',
      }
    })

    await dispatchTask(taskRef as never, {
      orgId: 'org-1',
      assigneeAgentId: 'pip',
      agentStatus: 'pending',
      columnId: 'todo',
      title: 'Investigate project blockers',
    })

    expect(stopHeartbeat).toHaveBeenCalledTimes(1)
    expect(taskRef.update).toHaveBeenLastCalledWith(expect.objectContaining({
      agentStatus: 'blocked',
      columnId: 'blocked',
      agentConversationId: 'run-connection-1',
      agentDispatchFailure: expect.objectContaining({
        phase: 'accepted-run-polling',
        retryEligible: false,
      }),
      agentHeartbeatAt: 'DELETE_FIELD',
      agentOutput: expect.objectContaining({
        summary: expect.stringContaining('will not dispatch a second run'),
      }),
    }))
  })

  it('durably requeues a proven not-accepted pre-execution transient failure', async () => {
    const taskRef = makeTaskRef()
    const stopHeartbeat = jest.fn()
    startHeartbeatMock.mockReturnValue(stopHeartbeat)
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-27T06:00:00.000Z'))
    runAndPollMock.mockResolvedValue({
      runId: null,
      output: null,
      error: 'Hermes /v1/runs returned 502: upstream unavailable',
      dispatchAcceptance: 'not-accepted',
      telemetry: { durationMs: 4 },
    })

    await dispatchTask(taskRef as never, {
      orgId: 'org-1',
      assigneeAgentId: 'pip',
      agentStatus: 'pending',
      columnId: 'todo',
      title: 'Investigate project health',
      requiredCapability: 'write',
    })

    expect(stopHeartbeat).toHaveBeenCalledTimes(1)
    expect(taskRef.update).toHaveBeenLastCalledWith(expect.objectContaining({
      agentStatus: 'pending',
      columnId: 'todo',
      agentRetryCount: 1,
      agentRetryAt: '2026-07-27T06:01:00.000Z',
      agentHeartbeatAt: 'DELETE_FIELD',
      agentDispatchFailure: expect.objectContaining({
        phase: 'pre-execution',
        acceptance: 'not-accepted',
        retryEligible: true,
        class: 'transient_queue_host',
      }),
      agentOutput: expect.objectContaining({
        summary: expect.stringContaining('Transient watcher error: Hermes /v1/runs returned 502'),
      }),
    }))
  })

  it('does not automatically requeue when review changes are still requested', async () => {
    const taskRef = makeTaskRef()
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-27T06:00:00.000Z'))
    runAndPollMock.mockResolvedValue({
      runId: null,
      output: null,
      error: 'Hermes /v1/runs returned 502: upstream unavailable',
      dispatchAcceptance: 'not-accepted',
      telemetry: { durationMs: 4 },
    })

    await dispatchTask(taskRef as never, {
      orgId: 'org-1',
      assigneeAgentId: 'pip',
      agentStatus: 'pending',
      columnId: 'todo',
      title: 'Investigate project health',
      requiredCapability: 'write',
      reviewStatus: 'changes-requested',
    })

    expect(taskRef.update).toHaveBeenLastCalledWith(expect.objectContaining({
      agentStatus: 'blocked',
      columnId: 'blocked',
      agentDispatchFailure: expect.objectContaining({
        class: 'review_changes_requested',
        retryEligible: false,
      }),
      agentOutput: expect.objectContaining({
        summary: expect.stringContaining('review changes are unresolved'),
      }),
    }))
  })

  it('blocks with terminal exhaustion after the bounded retry budget', async () => {
    const taskRef = makeTaskRef()
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-27T06:00:00.000Z'))
    runAndPollMock.mockResolvedValue({
      runId: null,
      output: null,
      error: 'session-storage busy: database is locked',
      dispatchAcceptance: 'not-accepted',
      telemetry: { durationMs: 4 },
    })

    await dispatchTask(taskRef as never, {
      orgId: 'org-1',
      assigneeAgentId: 'pip',
      agentStatus: 'pending',
      columnId: 'todo',
      title: 'Investigate project health',
      requiredCapability: 'write',
      agentRetryCount: 3,
    })

    expect(taskRef.update).toHaveBeenLastCalledWith(expect.objectContaining({
      agentStatus: 'blocked',
      columnId: 'blocked',
      agentDispatchFailure: expect.objectContaining({
        class: 'terminal_retry_exhausted',
        retryEligible: false,
      }),
      agentOutput: expect.objectContaining({
        summary: expect.stringContaining('Automatic retry budget exhausted'),
      }),
    }))
  })

  it('retries a pending task that arrives while the agent is at concurrency capacity', async () => {
    const running: Array<(value: { runId: string; output: string; error: null }) => void> = []
    runAndPollMock.mockImplementation(async (_cfg, _input, onRunCreated) => {
      const runId = `run-live-${running.length + 1}`
      await onRunCreated(runId)
      return new Promise(resolve => running.push(resolve))
    })

    const taskData = {
      orgId: 'org-1',
      assigneeAgentId: 'theo',
      agentStatus: 'pending',
      columnId: 'todo',
      title: 'Ship watcher hardening',
    }
    const activeRefs = Array.from({ length: 5 }, (_value, index) => ({
      ...makeTaskRef(),
      id: `active-${index}`,
      path: `projects/project-1/tasks/active-${index}`,
    }))
    const queuedRef = {
      ...makeTaskRef(),
      id: 'queued-1',
      path: 'projects/project-1/tasks/queued-1',
    }

    const flush = () => new Promise(resolve => setImmediate(resolve))
    const activeDispatches = activeRefs.map(ref => dispatchTask(ref as never, taskData))
    await flush()
    await flush()
    expect(runAndPollMock).toHaveBeenCalledTimes(5)

    await dispatchTask(queuedRef as never, taskData)
    expect(claimTaskMock).not.toHaveBeenCalledWith(queuedRef, 'theo')

    running[0]({ runId: 'run-live-1', output: 'done summary', error: null })
    await activeDispatches[0]
    await Promise.resolve()
    await Promise.resolve()

    expect(claimTaskMock).toHaveBeenCalledWith(queuedRef, 'theo')
    await flush()
    expect(runAndPollMock).toHaveBeenCalledTimes(6)

    running.slice(1).forEach((resolve, index) => resolve({ runId: `run-live-${index + 2}`, output: 'done summary', error: null }))
    running[5]({ runId: 'run-live-6', output: 'done summary', error: null })
    await Promise.all(activeDispatches.slice(1))
  })
  it('releases due scheduled backlog tasks into todo with an audit comment before pickup', async () => {
    const taskRef = {
      ...makeTaskRef(),
      id: 'scheduled-1',
      path: 'projects/project-1/tasks/scheduled-1',
      collection: jest.fn(() => ({
        add: jest.fn(async () => undefined),
      })),
    }
    const taskData = {
      orgId: 'org-1',
      assigneeAgentId: 'theo',
      agentStatus: 'pending',
      columnId: 'backlog',
      title: 'Scheduled task',
      agentReleaseStatus: 'scheduled',
      agentReleaseAt: '2026-05-26T09:30:00.000Z',
    }
    const query = makeFilteringCollectionQuery([{ ref: taskRef, data: () => taskData }])
    dbMock.collectionGroup = jest.fn(() => query)

    await sweepReadyPendingTasks(Date.parse('2026-05-26T09:31:00.000Z'))
    await new Promise(resolve => setImmediate(resolve))

    expect(query.where).toHaveBeenCalledWith('agentReleaseStatus', '==', 'scheduled')
    expect(taskRef.update).toHaveBeenCalledWith(expect.objectContaining({
      columnId: 'todo',
      agentReleaseStatus: 'released',
      agentReleasedAt: 'SERVER_TIME',
    }))
    expect(taskRef.collection).toHaveBeenCalledWith('comments')
  })

  it('periodically sweeps pending todo tasks so missed dependency transitions are retried', async () => {
    const dependencySnap = { exists: true, data: () => ({ agentStatus: 'done', columnId: 'review' }) }
    const taskRef = {
      ...makeTaskRef(),
      id: 'follow-up-1',
      path: 'projects/project-1/tasks/follow-up-1',
      parent: {
        doc: jest.fn(() => ({ get: jest.fn(async () => dependencySnap) })),
      },
    }
    const taskData = {
      orgId: 'org-1',
      assigneeAgentId: 'theo',
      agentStatus: 'pending',
      columnId: 'todo',
      title: 'Follow-up task',
      dependsOn: ['dependency-1'],
    }
    const query = makeFilteringCollectionQuery([{ ref: taskRef, data: () => taskData }])
    dbMock.collectionGroup = jest.fn(() => query)

    await sweepReadyPendingTasks()
    await new Promise(resolve => setImmediate(resolve))

    expect(dbMock.collectionGroup).toHaveBeenCalledWith('tasks')
    expect(query.where).toHaveBeenCalledWith('assigneeAgentId', 'in', expect.arrayContaining(['theo']))
    expect(query.where).toHaveBeenCalledWith('agentStatus', '==', 'pending')
    expect(query.where).toHaveBeenCalledWith('columnId', '==', 'todo')
    expect(claimTaskMock).toHaveBeenCalledWith(taskRef, 'theo')
    expect(runAndPollMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ taskId: 'follow-up-1' }),
      expect.any(Function),
    )
  })

  it('releases blocked tasks when dependencies clear and immediately retries pickup', async () => {
    const dependencySnap = { exists: true, data: () => ({ agentStatus: 'done', columnId: 'review' }) }
    const commentCollection = {
      add: jest.fn(async () => undefined),
      orderBy: jest.fn(() => ({
        limit: jest.fn(() => ({
          get: jest.fn(async () => ({ docs: [] })),
        })),
      })),
    }
    const taskRef = {
      ...makeTaskRef(),
      id: 'blocked-follow-up-1',
      path: 'projects/project-1/tasks/blocked-follow-up-1',
      parent: {
        doc: jest.fn(() => ({ get: jest.fn(async () => dependencySnap) })),
      },
      collection: jest.fn(() => commentCollection),
    }
    const taskData = {
      orgId: 'org-1',
      assigneeAgentId: 'theo',
      agentStatus: 'awaiting-input',
      columnId: 'blocked',
      title: 'Blocked follow-up task',
      dependsOn: ['dependency-1'],
    }
    const query = makeFilteringCollectionQuery([{ ref: taskRef, data: () => taskData }])
    dbMock.collectionGroup = jest.fn(() => query)

    await sweepReadyPendingTasks()
    await new Promise(resolve => setImmediate(resolve))

    expect(query.where).toHaveBeenCalledWith('agentStatus', '==', 'awaiting-input')
    expect(taskRef.update).toHaveBeenCalledWith(expect.objectContaining({
      agentStatus: 'pending',
      columnId: 'todo',
      agentHeartbeatAt: 'DELETE_FIELD',
    }))
    expect(commentCollection.add).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'system:agent-watcher',
      text: expect.stringContaining('Dependency gate cleared'),
    }))
    expect(claimTaskMock).toHaveBeenCalledWith(taskRef, 'theo')
    expect(runAndPollMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ taskId: 'blocked-follow-up-1' }),
      expect.any(Function),
    )
  })

  it('releases dependency-gated awaiting-input tasks parked in the todo column when deps clear', async () => {
    // Workflow-graph / playbook planners create dependency-gated cards with
    // agentStatus=awaiting-input but leave columnId=todo. Neither the blocked
    // sweep nor the ready-pending sweep used to read these, so projects stalled
    // at every gate boundary. The sweep must now release them once deps clear.
    const dependencySnap = { exists: true, data: () => ({ agentStatus: 'done', columnId: 'review' }) }
    const commentCollection = {
      add: jest.fn(async () => undefined),
      orderBy: jest.fn(() => ({
        limit: jest.fn(() => ({
          get: jest.fn(async () => ({ docs: [] })),
        })),
      })),
    }
    const taskRef = {
      ...makeTaskRef(),
      id: 'gate-impl-awaiting-todo-1',
      path: 'projects/project-1/tasks/gate-impl-awaiting-todo-1',
      parent: {
        doc: jest.fn(() => ({ get: jest.fn(async () => dependencySnap) })),
      },
      collection: jest.fn(() => commentCollection),
    }
    const taskData = {
      orgId: 'org-1',
      assigneeAgentId: 'theo',
      agentStatus: 'awaiting-input',
      columnId: 'todo',
      title: '[Gate 4] 4.1 Impl waiting on prior qa',
      dependsOn: ['dependency-1'],
      // No agentOutput.summary — genuinely dependency-gated, not human-waiting.
    }
    const query = makeFilteringCollectionQuery([{ ref: taskRef, data: () => taskData }])
    dbMock.collectionGroup = jest.fn(() => query)

    await sweepReadyPendingTasks()
    await new Promise(resolve => setImmediate(resolve))

    expect(query.where).toHaveBeenCalledWith('agentStatus', '==', 'awaiting-input')
    expect(query.where).toHaveBeenCalledWith('columnId', '==', 'todo')
    expect(taskRef.update).toHaveBeenCalledWith(expect.objectContaining({
      agentStatus: 'pending',
      columnId: 'todo',
      agentHeartbeatAt: 'DELETE_FIELD',
    }))
    expect(commentCollection.add).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'system:agent-watcher',
      text: expect.stringContaining('Dependency gate cleared'),
    }))
    expect(claimTaskMock).toHaveBeenCalledWith(taskRef, 'theo')
    expect(runAndPollMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ taskId: 'gate-impl-awaiting-todo-1' }),
      expect.any(Function),
    )
  })

  it('does not auto-release an awaiting-input todo-column card that is genuinely waiting on a human', async () => {
    // Guard: an awaiting-input card carrying a human-waiting output (summary +
    // needsPeet) must NOT be swept forward just because it sits in the todo column.
    const taskRef = {
      ...makeTaskRef(),
      id: 'human-waiting-todo-1',
      path: 'projects/project-1/tasks/human-waiting-todo-1',
    }
    const taskData = {
      orgId: 'org-1',
      assigneeAgentId: 'theo',
      agentStatus: 'awaiting-input',
      columnId: 'todo',
      title: 'Waiting for Peet approval',
      dependsOn: ['dependency-1'],
      agentOutput: { summary: 'Cannot continue until Peet approves the release.', needsPeet: true },
    }
    const query = makeFilteringCollectionQuery([{ ref: taskRef, data: () => taskData }])
    dbMock.collectionGroup = jest.fn(() => query)

    await sweepReadyPendingTasks()
    await new Promise(resolve => setImmediate(resolve))

    expect(taskRef.update).not.toHaveBeenCalled()
    expect(claimTaskMock).not.toHaveBeenCalledWith(taskRef, 'theo')
  })

  it('recovers a dep-less blocked task with a retryable completion-integrity failure into todo with bounded backoff', async () => {
    const commentCollection = {
      add: jest.fn(async () => undefined),
      orderBy: jest.fn(() => ({
        limit: jest.fn(() => ({
          get: jest.fn(async () => ({ docs: [] })),
        })),
      })),
    }
    const taskRef = {
      ...makeTaskRef(),
      id: 'dep-less-blocked-recoverable-1',
      path: 'projects/project-1/tasks/dep-less-blocked-recoverable-1',
      collection: jest.fn(() => commentCollection),
    }
    const taskData = {
      orgId: 'org-1',
      assigneeAgentId: 'theo',
      agentStatus: 'blocked',
      columnId: 'blocked',
      title: 'Dep-less recoverable blocked task',
      // No dependsOn — the pre-fix terminal dead end.
      reviewStatus: 'changes-requested',
      completionIntegrityFailureReasons: ['completion_evidence_missing'],
      agentOutput: { summary: 'Ran out of tool budget before attaching evidence.' },
    }
    const query = makeFilteringCollectionQuery([{ ref: taskRef, data: () => taskData }])
    dbMock.collectionGroup = jest.fn(() => query)

    await sweepReadyPendingTasks(Date.parse('2026-08-12T10:00:00.000Z'))
    await new Promise(resolve => setImmediate(resolve))

    expect(taskRef.update).toHaveBeenCalledWith(expect.objectContaining({
      agentStatus: 'pending',
      columnId: 'todo',
      agentHeartbeatAt: 'DELETE_FIELD',
      agentRetryCount: 1,
      reviewStatus: 'DELETE_FIELD',
      completionIntegrityFailureReasons: 'DELETE_FIELD',
      agentDispatchKey: 'DELETE_FIELD',
    }))
    expect(commentCollection.add).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'system:agent-watcher',
      text: expect.stringContaining('retryable completion-integrity'),
    }))
    // The recovery schedules the next bounded attempt; it must not dispatch
    // immediately while agentRetryAt is still in the future.
    expect(claimTaskMock).not.toHaveBeenCalled()
  })

  it('does not recover a dep-less blocked task without a recoverable completion-integrity reason', async () => {
    const taskRef = {
      ...makeTaskRef(),
      id: 'dep-less-blocked-nonrecoverable-1',
      path: 'projects/project-1/tasks/dep-less-blocked-nonrecoverable-1',
    }
    const taskData = {
      orgId: 'org-1',
      assigneeAgentId: 'theo',
      agentStatus: 'blocked',
      columnId: 'blocked',
      title: 'Dep-less human-gated blocked task',
      agentOutput: { summary: 'Needs Peet to approve the approach before continuing.' },
    }
    const query = makeFilteringCollectionQuery([{ ref: taskRef, data: () => taskData }])
    dbMock.collectionGroup = jest.fn(() => query)

    await sweepReadyPendingTasks(Date.parse('2026-08-12T10:00:00.000Z'))
    await new Promise(resolve => setImmediate(resolve))

    expect(taskRef.update).not.toHaveBeenCalled()
    expect(claimTaskMock).not.toHaveBeenCalled()
  })

  it('does not release blocked tasks whose completed approval-gate dependency is unapproved', async () => {
    const dependencySnap = {
      exists: true,
      data: () => ({
        agentStatus: 'done',
        columnId: 'done',
        approvalGate: 'production-deploy',
        approvalStatus: 'pending',
        labels: ['approval-gate'],
      }),
    }
    const taskRef = {
      ...makeTaskRef(),
      id: 'blocked-approval-follow-up',
      path: 'projects/project-1/tasks/blocked-approval-follow-up',
      parent: {
        doc: jest.fn(() => ({ get: jest.fn(async () => dependencySnap) })),
      },
    }
    const taskData = {
      orgId: 'org-1',
      assigneeAgentId: 'theo',
      agentStatus: 'awaiting-input',
      columnId: 'blocked',
      title: 'Blocked approval follow-up',
      dependsOn: ['approval-dependency-1'],
    }
    const query = makeFilteringCollectionQuery([{ ref: taskRef, data: () => taskData }])
    dbMock.collectionGroup = jest.fn(() => query)

    await sweepReadyPendingTasks()
    await new Promise(resolve => setImmediate(resolve))

    expect(taskRef.update).not.toHaveBeenCalledWith(expect.objectContaining({
      agentStatus: 'pending',
      columnId: 'todo',
    }))
    expect(claimTaskMock).not.toHaveBeenCalledWith(taskRef, 'theo')
  })

  it('does not sweep pending work through an unapproved reviewer dependency', async () => {
    const dependencySnap = {
      exists: true,
      data: () => ({
        agentStatus: 'done',
        columnId: 'review',
        reviewerAgentId: 'qa-release',
        reviewStatus: 'pending',
      }),
    }
    const taskRef = {
      ...makeTaskRef(),
      id: 'review-dependent-follow-up',
      path: 'projects/project-1/tasks/review-dependent-follow-up',
      parent: {
        doc: jest.fn(() => ({ get: jest.fn(async () => dependencySnap) })),
      },
    }
    const taskData = {
      orgId: 'org-1',
      assigneeAgentId: 'theo',
      agentStatus: 'pending',
      columnId: 'todo',
      title: 'Reviewer-dependent follow-up',
      dependsOn: ['review-dependency-1'],
    }
    const query = makeFilteringCollectionQuery([{ ref: taskRef, data: () => taskData }])
    dbMock.collectionGroup = jest.fn(() => query)

    await sweepReadyPendingTasks()
    await new Promise(resolve => setImmediate(resolve))

    expect(claimTaskMock).not.toHaveBeenCalledWith(taskRef, 'theo')
    expect(runAndPollMock).not.toHaveBeenCalled()
  })

  it('does not auto-release blocked error cards just because their dependencies are done', async () => {
    const dependencySnap = { exists: true, data: () => ({ agentStatus: 'done', columnId: 'review' }) }
    const taskRef = {
      ...makeTaskRef(),
      id: 'error-blocked-1',
      path: 'projects/project-1/tasks/error-blocked-1',
      parent: {
        doc: jest.fn(() => ({ get: jest.fn(async () => dependencySnap) })),
      },
    }
    const taskData = {
      orgId: 'org-1',
      assigneeAgentId: 'theo',
      agentStatus: 'blocked',
      columnId: 'blocked',
      title: 'Errored task',
      dependsOn: ['dependency-1'],
      agentOutput: { summary: 'Watcher error: gateway failed' },
    }
    const query = makeFilteringCollectionQuery([{ ref: taskRef, data: () => taskData }])
    dbMock.collectionGroup = jest.fn(() => query)

    await sweepReadyPendingTasks()
    await new Promise(resolve => setImmediate(resolve))

    expect(taskRef.update).not.toHaveBeenCalledWith(expect.objectContaining({
      agentStatus: 'pending',
      columnId: 'todo',
    }))
    expect(claimTaskMock).not.toHaveBeenCalledWith(taskRef, 'theo')
  })

  it('falls back to a single-field blocked sweep if the indexed dependency-release query is unavailable', async () => {
    const dependencySnaps: Record<string, { exists: boolean; data: () => Record<string, unknown> }> = {
      'approval-gate-1': { exists: true, data: () => ({ columnId: 'done', status: 'done' }) },
      'agent-review-1': { exists: true, data: () => ({ agentStatus: 'done', columnId: 'review', status: 'review', reviewStatus: 'pending' }) },
    }
    const commentCollection = {
      add: jest.fn(async () => undefined),
      orderBy: jest.fn(() => ({
        limit: jest.fn(() => ({
          get: jest.fn(async () => ({ docs: [] })),
        })),
      })),
    }
    const taskRef = {
      ...makeTaskRef(),
      id: 'book-studio-follow-up',
      path: 'projects/5GDIUtHdAlt6KNfZpoXt/tasks/book-studio-follow-up',
      parent: {
        doc: jest.fn((dependencyId: string) => ({ get: jest.fn(async () => dependencySnaps[dependencyId] ?? { exists: false }) })),
      },
      collection: jest.fn(() => commentCollection),
    }
    const taskData = {
      orgId: 'pib-platform-owner',
      assigneeAgentId: 'theo',
      agentStatus: 'awaiting-input',
      columnId: 'blocked',
      status: 'blocked',
      title: 'Theo portal surface: Book Studio review experience',
      dependsOn: ['approval-gate-1', 'agent-review-1'],
    }
    const scheduledQuery = makeFilteringCollectionQuery([])
    const indexedQuery = makeFilteringCollectionQuery([{ ref: taskRef, data: () => taskData }])
    indexedQuery.get.mockRejectedValueOnce(new Error('9 FAILED_PRECONDITION: The query requires an index.'))
    const fallbackQuery = makeFilteringCollectionQuery([{ ref: taskRef, data: () => taskData }])
    const readyQuery = makeFilteringCollectionQuery([])
    dbMock.collectionGroup = jest
      .fn()
      .mockReturnValueOnce(scheduledQuery)
      .mockReturnValueOnce(indexedQuery)
      .mockReturnValueOnce(fallbackQuery)
      .mockReturnValueOnce(readyQuery)

    await sweepReadyPendingTasks()
    await new Promise(resolve => setImmediate(resolve))

    expect(fallbackQuery.where).toHaveBeenCalledWith('agentStatus', '==', 'awaiting-input')
    expect(taskRef.update).toHaveBeenCalledWith(expect.objectContaining({
      agentStatus: 'pending',
      columnId: 'todo',
      agentHeartbeatAt: 'DELETE_FIELD',
    }))
    expect(commentCollection.add).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'system:agent-watcher',
      text: expect.stringContaining('Dependency gate cleared'),
    }))
    expect(claimTaskMock).toHaveBeenCalledWith(taskRef, 'theo')
  })
})

describe('agent watcher dependency retry strategy', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('does not subscribe to broad done-task queries because periodic sweeps retry dependents', async () => {
    const queries: Array<{ wheres: Array<[string, string, unknown]>; unsubscribe: jest.Mock }> = []
    dbMock.collectionGroup = jest.fn(() => {
      type SnapshotQuery = {
        wheres: Array<[string, string, unknown]>
        unsubscribe: jest.Mock
        where: (field: string, op: string, value: unknown) => SnapshotQuery
        onSnapshot: jest.Mock
      }
      const query: SnapshotQuery = {
        wheres: [],
        unsubscribe: jest.fn(),
        where(field: string, op: string, value: unknown) {
          this.wheres.push([field, op, value])
          return this
        },
        onSnapshot: jest.fn(() => {
          queries.push({ wheres: [...query.wheres], unsubscribe: query.unsubscribe })
          return query.unsubscribe
        }),
      }
      return query
    })

    const stop = await startWatcher(['theo'])

    expect(queries).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ wheres: [['columnId', '==', 'done']] }),
    ]))
    expect(queries).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ wheres: [['agentStatus', '==', 'done']] }),
    ]))
    expect(queries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        wheres: expect.arrayContaining([
          ['assigneeAgentId', 'in', ['theo']],
          ['agentStatus', '==', 'pending'],
          ['columnId', '==', 'todo'],
        ]),
      }),
      expect.objectContaining({
        wheres: expect.arrayContaining([
          ['reviewerAgentId', 'in', ['theo']],
          ['columnId', '==', 'review'],
          ['reviewStatus', '==', 'pending'],
        ]),
      }),
    ]))

    stop()
    expect(queries.every((query) => query.unsubscribe.mock.calls.length === 1)).toBe(true)
  })
})
