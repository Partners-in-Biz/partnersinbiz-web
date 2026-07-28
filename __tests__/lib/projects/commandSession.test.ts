import {
  commandEventTypeForAgentStatus,
  formatCommandEventContent,
  normalizeCommandSession,
  taskHrefFor,
} from '@/lib/projects/commandSession'

describe('commandSession helpers', () => {
  it('normalises a stored command session binding', () => {
    expect(normalizeCommandSession({
      conversationId: 'conv-1',
      orgId: 'org-1',
      enabled: true,
      boundAt: '2026-07-28T00:00:00.000Z',
      boundBy: 'user-1',
      autoWake: true,
      autoWakeAgentId: 'pip',
      autoWakeOn: ['blocked', 'awaiting_input'],
    })).toEqual({
      conversationId: 'conv-1',
      orgId: 'org-1',
      enabled: true,
      boundAt: '2026-07-28T00:00:00.000Z',
      boundBy: 'user-1',
      autoWake: true,
      autoWakeAgentId: 'pip',
      autoWakeOn: ['blocked', 'awaiting_input'],
    })
  })

  it('maps agent status transitions to command event types', () => {
    expect(commandEventTypeForAgentStatus('done', 'in-progress')).toBe('task.done')
    expect(commandEventTypeForAgentStatus('blocked', 'in-progress')).toBe('task.blocked')
    expect(commandEventTypeForAgentStatus('awaiting-input', 'in-progress')).toBe('task.awaiting_input')
    expect(commandEventTypeForAgentStatus('in-progress', 'pending')).toBe('task.started')
    expect(commandEventTypeForAgentStatus('done', 'done')).toBeNull()
  })

  it('formats blocked events with blocker and proof', () => {
    const content = formatCommandEventContent({
      schemaVersion: 1,
      type: 'task.blocked',
      projectId: 'project-1',
      taskId: 'task-1',
      taskTitle: 'Ship release',
      agentId: 'theo',
      blockingReason: 'Missing API key',
      requiredEvidence: 'Peet must paste the key',
      taskHref: '/portal/projects/project-1?taskId=task-1',
      occurredAt: '2026-07-28T00:00:00.000Z',
      idempotencyKey: 'k1',
    })
    expect(content).toContain('Blocked')
    expect(content).toContain('Missing API key')
    expect(content).toContain('Peet must paste the key')
    expect(content).toContain('Open task')
  })

  it('builds portal task links', () => {
    expect(taskHrefFor('project-1', 'task-1')).toBe('/portal/projects/project-1?taskId=task-1')
    expect(taskHrefFor('project-1', 'task-1', 'partners')).toContain('/admin/org/partners/projects/project-1')
  })
})
