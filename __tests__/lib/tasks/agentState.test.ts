import {
  applyAgentColumnForCreate,
  applyAgentColumnForUpdate,
  applyAgentDispatchDefaultsForStandaloneAssignment,
  applyAgentTodoRequeue,
  applyStandaloneTaskStatusForAgentStatus,
  columnForAgentStatus,
  taskStatusForAgentStatus,
} from '@/lib/tasks/agentState'

describe('standalone agent task state helpers', () => {
  it.each([
    ['pending', 'todo'],
    ['picked-up', 'in_progress'],
    ['in-progress', 'in_progress'],
    ['awaiting-input', 'blocked'],
    ['blocked', 'blocked'],
    ['done', 'review'],
  ] as const)('maps agentStatus %s to kanban column %s', (status, columnId) => {
    expect(columnForAgentStatus(status)).toBe(columnId)
  })

  it.each([
    ['pending', 'todo'],
    ['picked-up', 'in_progress'],
    ['in-progress', 'in_progress'],
    ['awaiting-input', 'todo'],
    ['blocked', 'todo'],
    ['done', 'done'],
  ] as const)('maps agentStatus %s to standalone task status %s', (status, taskStatus) => {
    expect(taskStatusForAgentStatus(status)).toBe(taskStatus)
  })

  it('puts new standalone agent tasks in the pickup-ready todo column by default', () => {
    const value: Record<string, unknown> = { assigneeAgentId: 'theo', agentStatus: 'pending', columnId: 'todo' }
    applyAgentColumnForCreate(value, {})
    expect(value.columnId).toBe('todo')
  })

  it('honours explicit gated statuses on create instead of silently queueing them', () => {
    const value: Record<string, unknown> = { assigneeAgentId: 'theo', agentStatus: 'awaiting-input', columnId: 'todo' }
    applyAgentColumnForCreate(value, { agentStatus: 'awaiting-input' })
    expect(value.columnId).toBe('blocked')
  })

  it('moves done agent updates into review and marks standalone status done', () => {
    const updates: Record<string, unknown> = { agentStatus: 'done' }
    applyAgentColumnForUpdate(updates, { agentStatus: 'done' })
    applyStandaloneTaskStatusForAgentStatus(updates, { agentStatus: 'done' })
    expect(updates).toEqual({ agentStatus: 'done', columnId: 'review', reviewStatus: 'pending', status: 'done' })
  })

  it('requeues completed standalone agent work when moved back to todo', () => {
    const result = applyAgentTodoRequeue(
      { assigneeAgentId: 'theo', agentStatus: 'done' },
      { columnId: 'todo' },
      { columnId: 'todo' },
    )
    expect(result).toEqual({
      columnId: 'todo',
      agentStatus: 'pending',
      status: 'todo',
      reviewStatus: 'changes-requested',
      agentOutput: null,
      agentConversationId: null,
      agentHeartbeatAt: null,
    })
  })

  it('makes standalone tasks assigned to agents watcher-ready on create', () => {
    const value: Record<string, unknown> = {
      assignedTo: { type: 'agent', id: 'pip' },
      title: 'Research Athleet competitors',
      description: 'Find similar businesses and summarize positioning.',
      columnId: 'todo',
    }

    applyAgentDispatchDefaultsForStandaloneAssignment(value, {})

    expect(value.assigneeAgentId).toBe('pip')
    expect(value.agentStatus).toBe('pending')
    expect(value.columnId).toBe('todo')
    expect(value.agentInput).toEqual({
      spec: 'Research Athleet competitors\n\nFind similar businesses and summarize positioning.',
    })
  })

  it('makes existing standalone tasks watcher-ready when assigned to an agent', () => {
    const updates: Record<string, unknown> = { assignedTo: { type: 'agent', id: 'theo' } }

    applyAgentDispatchDefaultsForStandaloneAssignment(updates, {}, {
      title: 'Fix notification routing',
      description: '',
    })

    expect(updates).toEqual({
      assignedTo: { type: 'agent', id: 'theo' },
      assigneeAgentId: 'theo',
      agentStatus: 'pending',
      columnId: 'todo',
      status: 'todo',
      agentInput: { spec: 'Fix notification routing' },
      agentOutput: null,
      agentConversationId: null,
      agentHeartbeatAt: null,
    })
  })
})
