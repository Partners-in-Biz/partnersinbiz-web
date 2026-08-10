import { getTaskDispatchBlocker, getUnresolvedDependencyIds } from '../../../services/agent-watcher/src/eligibility'

describe('agent watcher task dispatch eligibility', () => {
  const validAgents = ['pip', 'theo', 'maya', 'sage', 'nora', 'ads', 'qa-release', 'support', 'data', 'docs', 'seo']

  it('allows only todo/pending tasks assigned to a known agent', () => {
    expect(getTaskDispatchBlocker({ assigneeAgentId: 'theo', agentStatus: 'pending', columnId: 'todo' }, validAgents)).toBeNull()

    expect(getTaskDispatchBlocker({ assigneeAgentId: 'unknown', agentStatus: 'pending', columnId: 'todo' }, validAgents)).toBe('invalid-assignee')
    expect(getTaskDispatchBlocker({ assigneeAgentId: 'theo', agentStatus: 'in-progress', columnId: 'todo' }, validAgents)).toBe('not-pending')
    expect(getTaskDispatchBlocker({ assigneeAgentId: 'theo', agentStatus: 'pending', columnId: 'review' }, validAgents)).toBe('not-todo')
    expect(getTaskDispatchBlocker({ assigneeAgentId: 'theo', agentStatus: 'pending', columnId: 'todo', deleted: true }, validAgents)).toBe('deleted')
  })

  it('does not pass approval-gated tasks until they are approved', () => {
    expect(getTaskDispatchBlocker({ assigneeAgentId: 'theo', agentStatus: 'pending', columnId: 'todo', requiresApproval: true, approvalStatus: 'pending' }, validAgents)).toBe('approval-pending')
    expect(getTaskDispatchBlocker({ assigneeAgentId: 'theo', agentStatus: 'pending', columnId: 'todo', approvalGate: { status: 'pending' } }, validAgents)).toBe('approval-pending')
    expect(getTaskDispatchBlocker({ assigneeAgentId: 'theo', agentStatus: 'pending', columnId: 'todo', requiresApproval: true, approvalStatus: 'approved' }, validAgents)).toBeNull()
    expect(getTaskDispatchBlocker({ assigneeAgentId: 'theo', agentStatus: 'pending', columnId: 'todo', approvalGate: { status: 'approved' } }, validAgents)).toBeNull()
  })

  it('fails closed for persisted string approval gates until approvalStatus is approved', () => {
    const base = { assigneeAgentId: 'theo', agentStatus: 'pending', columnId: 'todo' }

    expect(getTaskDispatchBlocker({ ...base, approvalGate: 'production-deploy', approvalStatus: 'pending' }, validAgents)).toBe('approval-pending')
    expect(getTaskDispatchBlocker({ ...base, approvalGate: 'production-deploy', approvalStatus: 'accepted' }, validAgents)).toBe('approval-pending')
    expect(getTaskDispatchBlocker({ ...base, approvalGate: 'production-deploy', approvalStatus: 'approved' }, validAgents)).toBeNull()
    expect(getTaskDispatchBlocker({ ...base, approvalGate: 'none', approvalStatus: 'pending' }, validAgents)).toBe('approval-pending')
  })

  it('does not pass scheduled backlog tasks before their release time', () => {
    expect(getTaskDispatchBlocker({
      assigneeAgentId: 'theo',
      agentStatus: 'pending',
      columnId: 'todo',
      agentReleaseStatus: 'scheduled',
      agentReleaseAt: '2099-05-26T09:30:00.000Z',
    }, validAgents)).toBe('scheduled-release-pending')

    expect(getTaskDispatchBlocker({
      assigneeAgentId: 'theo',
      agentStatus: 'pending',
      columnId: 'todo',
      agentReleaseStatus: 'scheduled',
      agentReleaseAt: '2020-05-26T09:30:00.000Z',
    }, validAgents)).toBeNull()
  })

  it('does not redispatch transiently failed tasks before their durable retry time', () => {
    const now = Date.parse('2026-07-27T06:00:00.000Z')
    const base = {
      assigneeAgentId: 'theo',
      agentStatus: 'pending',
      columnId: 'todo',
    }

    expect(getTaskDispatchBlocker({
      ...base,
      agentRetryAt: '2026-07-27T06:01:00.000Z',
    }, validAgents, now)).toBe('retry-backoff-pending')

    expect(getTaskDispatchBlocker({
      ...base,
      agentRetryAt: '2026-07-27T05:59:00.000Z',
    }, validAgents, now)).toBeNull()
  })

  it('returns only dependency IDs that are not complete yet', () => {
    expect(getUnresolvedDependencyIds(['done-column', 'done-agent', 'todo', 'missing'], {
      'done-column': { columnId: 'done', agentStatus: 'pending' },
      'done-agent': { columnId: 'review', agentStatus: 'done' },
      todo: { columnId: 'todo', agentStatus: 'pending' },
    })).toEqual(['todo', 'missing'])
  })

  it('requires reviewer approval before a reviewed dependency resolves', () => {
    expect(getUnresolvedDependencyIds(['review-pending', 'review-approved', 'ordinary-done', 'done-stale-review'], {
      'review-pending': { columnId: 'review', agentStatus: 'done', reviewerAgentId: 'qa-release', reviewStatus: 'pending' },
      'review-approved': { columnId: 'review', agentStatus: 'done', reviewerAgentId: 'qa-release', reviewStatus: 'approved' },
      'ordinary-done': { columnId: 'review', agentStatus: 'done' },
      // Board Done is an explicit acceptance — even with a stale pending reviewStatus.
      'done-stale-review': { columnId: 'done', agentStatus: 'done', reviewerAgentId: 'qa-release', reviewStatus: 'pending' },
    })).toEqual(['review-pending'])
  })

  it('requires approval before a completed approval-gate dependency resolves', () => {
    expect(getUnresolvedDependencyIds(['pending-gate', 'approved-gate', 'labelled-gate'], {
      'pending-gate': { columnId: 'done', agentStatus: 'done', approvalGate: 'production-deploy', approvalStatus: 'pending' },
      'approved-gate': { columnId: 'done', agentStatus: 'done', approvalGate: 'production-deploy', approvalStatus: 'approved' },
      'labelled-gate': { columnId: 'done', agentStatus: 'done', labels: ['approval-gate'], approvalStatus: 'pending' },
    })).toEqual(['pending-gate', 'labelled-gate'])
  })

  it('does not treat a human approval comment signal as resolved — only approvalStatus=approved', () => {
    // Board Done + agent done without approvalStatus still blocks gate dependents.
    expect(getUnresolvedDependencyIds(['comment-only-gate'], {
      'comment-only-gate': {
        columnId: 'done',
        agentStatus: 'done',
        reviewStatus: 'approved',
        labels: ['approval-gate'],
        approvalStatus: 'pending',
      },
    })).toEqual(['comment-only-gate'])

    expect(getUnresolvedDependencyIds(['canonical-gate'], {
      'canonical-gate': {
        columnId: 'done',
        agentStatus: 'done',
        reviewStatus: 'approved',
        labels: ['approval-gate'],
        approvalStatus: 'approved',
      },
    })).toEqual([])
  })

  it('does not treat topic labels containing approval-gate substring as gate cards', () => {
    expect(getUnresolvedDependencyIds(['module-contracts'], {
      'module-contracts': {
        columnId: 'done',
        agentStatus: 'done',
        reviewStatus: 'approved',
        labels: ['adapter', 'approval-gates', 'module-approval-gates', 'cross-org-collaboration'],
      },
    })).toEqual([])
  })

})
