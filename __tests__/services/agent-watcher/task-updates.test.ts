import { agentStatusUpdate, columnForAgentStatus } from '@/services/agent-watcher/src/task-updates'

describe('agent watcher task updates', () => {
  it('keeps the kanban column in sync with agent lifecycle status', () => {
    expect(columnForAgentStatus('pending')).toBe('todo')
    expect(columnForAgentStatus('picked-up')).toBe('in_progress')
    expect(columnForAgentStatus('in-progress')).toBe('in_progress')
    expect(columnForAgentStatus('awaiting-input')).toBe('blocked')
    expect(columnForAgentStatus('blocked')).toBe('blocked')
    expect(columnForAgentStatus('done')).toBe('review')
  })

  it('builds Firestore updates that include both agentStatus and columnId', () => {
    expect(agentStatusUpdate('done')).toEqual({
      agentStatus: 'done',
      columnId: 'review',
      reviewStatus: 'pending',
    })
    expect(agentStatusUpdate('blocked')).toEqual({
      agentStatus: 'blocked',
      columnId: 'blocked',
    })
    expect(agentStatusUpdate('in-progress')).toEqual({
      agentStatus: 'in-progress',
      columnId: 'in_progress',
    })
  })
})
