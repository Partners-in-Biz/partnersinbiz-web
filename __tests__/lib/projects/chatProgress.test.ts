import {
  buildProjectChatProgress,
  selectActiveProjectId,
} from '@/lib/projects/chatProgress'

describe('project chat progress', () => {
  it('uses project scope before the latest tagged project', () => {
    expect(selectActiveProjectId({
      scope: 'project',
      scopeRefId: 'scoped-project',
      contextRefs: [
        { type: 'project', id: 'older-project' },
        { type: 'project', id: 'newer-project' },
      ],
    })).toBe('scoped-project')
  })

  it('uses the latest tagged project outside a project-scoped conversation', () => {
    expect(selectActiveProjectId({
      scope: 'general',
      contextRefs: [
        { type: 'project', id: 'older-project' },
        { type: 'task', id: 'task-1' },
        { type: 'project', id: 'newer-project' },
      ],
    })).toBe('newer-project')
  })

  it('counts only verified work as complete and identifies the next ready task', () => {
    const progress = buildProjectChatProgress({
      project: { id: 'project-1', name: 'Email Marketing V2', status: 'active' },
      tasks: [
        { id: 'manual-done', title: 'Approve brief', columnId: 'done' },
        { id: 'agent-done', title: 'Draft copy', columnId: 'review', agentStatus: 'done', assigneeAgentId: 'maya' },
        { id: 'agent-failed-in-done', title: 'Broken export', columnId: 'done', agentStatus: 'failed', assigneeAgentId: 'maya' },
        {
          id: 'review-pending',
          title: 'Build automation',
          columnId: 'review',
          agentStatus: 'done',
          assigneeAgentId: 'theo',
          reviewerAgentId: 'qa-release',
          reviewStatus: 'pending',
        },
        {
          id: 'ready-next',
          title: 'Run QA',
          columnId: 'todo',
          agentStatus: 'pending',
          assigneeAgentId: 'qa-release',
          dependsOn: ['agent-done'],
        },
      ],
    })

    expect(progress.counts).toMatchObject({ total: 5, complete: 2, running: 0, needsYou: 0 })
    expect(progress.tasks.find((task) => task.id === 'agent-failed-in-done')?.state).toBe('blocked')
    expect(progress.tasks.find((task) => task.id === 'review-pending')?.state).toBe('review')
    expect(progress.tasks.find((task) => task.id === 'ready-next')?.state).toBe('ready')
    expect(progress.next).toMatchObject({ id: 'ready-next', state: 'ready' })
    expect(progress.attention).toMatchObject({ id: 'agent-failed-in-done', state: 'blocked' })
  })

  it('keeps dependencies waiting and surfaces human attention ahead of ready work', () => {
    const progress = buildProjectChatProgress({
      project: { id: 'project-1', name: 'Email Marketing V2', status: 'active' },
      tasks: [
        { id: 'dependency', title: 'Write draft', columnId: 'in_progress', agentStatus: 'in-progress', assigneeAgentId: 'maya' },
        { id: 'waiting', title: 'Review draft', columnId: 'blocked', agentStatus: 'awaiting-input', dependsOn: ['dependency'] },
        { id: 'blocked', title: 'Approve sender', columnId: 'blocked', agentStatus: 'awaiting-input' },
      ],
    })

    expect(progress.tasks.find((task) => task.id === 'dependency')?.state).toBe('running')
    expect(progress.tasks.find((task) => task.id === 'waiting')?.state).toBe('waiting')
    expect(progress.tasks.find((task) => task.id === 'blocked')?.state).toBe('needs_input')
    expect(progress.counts).toMatchObject({ running: 1, waiting: 1, needsYou: 1 })
    expect(progress.attention).toMatchObject({ id: 'blocked', state: 'needs_input' })
    expect(progress.next).toBeNull()
  })

  it('uses approval gates and scheduled releases from the existing watcher state', () => {
    const progress = buildProjectChatProgress({
      project: { id: 'project-1', name: 'Launch' },
      tasks: [
        { id: 'gate', title: 'Approve launch', columnId: 'review', approvalStatus: 'pending' },
        { id: 'gated', title: 'Publish launch', columnId: 'todo', agentStatus: 'pending', approvalGateTaskId: 'gate' },
        { id: 'scheduled', title: 'Send follow-up', columnId: 'todo', agentStatus: 'pending', agentReleaseStatus: 'scheduled' },
      ],
    })

    expect(progress.tasks.find((task) => task.id === 'gate')?.state).toBe('needs_input')
    expect(progress.tasks.find((task) => task.id === 'gated')).toMatchObject({ state: 'waiting', unresolvedDependencyIds: ['gate'] })
    expect(progress.tasks.find((task) => task.id === 'scheduled')?.state).toBe('waiting')
    expect(progress.attention).toMatchObject({ id: 'gate', state: 'needs_input' })
    expect(progress.counts.approvals).toBe(1)
    expect(progress.next).toBeNull()
  })
})
