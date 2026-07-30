import { projectTaskChatActions } from '@/lib/chat-context/adapters/project'
import type { ProjectChatTaskItem } from '@/lib/projects/chatProgress'

function task(overrides: Partial<ProjectChatTaskItem> = {}): ProjectChatTaskItem {
  return {
    id: 'task-1',
    title: 'Approve sender',
    state: 'ready',
    unresolvedDependencyIds: [],
    ...overrides,
  }
}

describe('project context chat actions', () => {
  it('offers exact human approval only to an authorised approver', () => {
    expect(projectTaskChatActions({
      projectId: 'project-1',
      task: task({ state: 'needs_input', approvalStatus: 'pending' }),
      canWrite: true,
      canApprove: true,
    })).toEqual([expect.objectContaining({
      label: 'Approve next step',
      href: '/api/v1/projects/project-1/tasks/task-1',
      method: 'PATCH',
      requiresApproval: true,
      body: { approvalStatus: 'approved' },
    })])
    expect(projectTaskChatActions({
      projectId: 'project-1',
      task: task({ state: 'needs_input', approvalStatus: 'pending' }),
      canWrite: true,
      canApprove: false,
    })).toEqual([])
  })

  it('offers review completion to project writers', () => {
    expect(projectTaskChatActions({
      projectId: 'project-1',
      task: task({ state: 'review', reviewStatus: 'pending' }),
      canWrite: true,
      canApprove: false,
    })).toEqual([expect.objectContaining({
      label: 'Approve and complete',
      body: { reviewStatus: 'approved', columnId: 'done' },
    })])
  })

  it('only offers unblock when the canonical route can evaluate a blocked task', () => {
    expect(projectTaskChatActions({
      projectId: 'project-1',
      task: task({ state: 'blocked', agentStatus: 'blocked', assigneeAgentId: 'pip' }),
      canWrite: true,
      canApprove: false,
    })).toEqual([expect.objectContaining({
      label: 'Unblock and requeue',
      href: '/api/v1/projects/project-1/tasks/task-1/unblock',
      method: 'POST',
    })])
    expect(projectTaskChatActions({
      projectId: 'project-1',
      task: task({ state: 'blocked', agentStatus: 'failed' }),
      canWrite: true,
      canApprove: false,
    })).toEqual([])
  })

  it('never exposes mutations to project viewers', () => {
    expect(projectTaskChatActions({
      projectId: 'project-1',
      task: task({ state: 'review' }),
      canWrite: false,
      canApprove: true,
    })).toEqual([])
  })
})
