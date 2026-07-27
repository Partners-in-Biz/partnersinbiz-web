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
})
