import { fireEvent, render, screen } from '@testing-library/react'

import {
  LivingTaskBundle,
  ProjectLens,
  ProjectPulse,
} from '@/components/chat/project/ProjectChatExperience'
import type { ProjectChatProgress } from '@/lib/projects/chatProgress'

const progress: ProjectChatProgress = {
  project: { id: 'project-1', name: 'Email Marketing V2', status: 'active' },
  counts: { total: 5, complete: 2, running: 1, waiting: 1, blocked: 0, needsYou: 1, approvals: 1 },
  next: {
    id: 'approval', title: 'Approve sender', columnId: 'blocked', agentStatus: 'awaiting-input',
    state: 'needs_input', unresolvedDependencyIds: [], assigneeAgentId: 'pip',
  },
  tasks: [
    {
      id: 'running', title: 'Draft copy', columnId: 'in_progress', agentStatus: 'in-progress',
      state: 'running', unresolvedDependencyIds: [], assigneeAgentId: 'maya', agentModel: 'claude-sonnet-4-6',
      chatOrigin: { conversationId: 'conv-1', requestMessageId: 'm-1', responseMessageId: 'm-2', bundleId: 'bundle-1', sequence: 0 },
    },
    {
      id: 'waiting', title: 'Run QA', columnId: 'blocked', agentStatus: 'pending',
      state: 'waiting', unresolvedDependencyIds: ['running'], assigneeAgentId: 'qa-release', dependsOn: ['running'],
      chatOrigin: { conversationId: 'conv-1', requestMessageId: 'm-1', responseMessageId: 'm-2', bundleId: 'bundle-1', sequence: 1 },
    },
    {
      id: 'approval', title: 'Approve sender', columnId: 'blocked', agentStatus: 'awaiting-input',
      state: 'needs_input', unresolvedDependencyIds: [], assigneeAgentId: 'pip', approvalStatus: 'pending', labels: ['approval-gate'],
      chatOrigin: { conversationId: 'conv-1', requestMessageId: 'm-1', responseMessageId: 'm-2', bundleId: 'bundle-1', sequence: 2 },
    },
    {
      id: 'done', title: 'Campaign brief', columnId: 'done', state: 'complete', unresolvedDependencyIds: [],
      agentOutput: { summary: 'Brief verified', artifacts: [{ type: 'url', ref: 'https://example.com/brief', label: 'Verified brief' }] },
    },
  ],
}

describe('Project chat experience', () => {
  it('renders the compact pulse and supports multiple project selection', () => {
    const open = jest.fn()
    const select = jest.fn()
    render(
      <ProjectPulse
        progress={progress}
        projects={[{ id: 'project-1', label: 'Email Marketing V2' }, { id: 'project-2', label: 'Website launch' }]}
        activeProjectId="project-1"
        onProjectChange={select}
        onOpen={open}
      />,
    )

    expect(screen.getByText('2/5 complete')).toBeInTheDocument()
    expect(screen.getByText('1 running')).toBeInTheDocument()
    expect(screen.getByText('1 needs you')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Active project'), { target: { value: 'project-2' } })
    expect(select).toHaveBeenCalledWith('project-2')
    fireEvent.click(screen.getByRole('button', { name: /Open project lens/i }))
    expect(open).toHaveBeenCalled()
  })

  it('groups project tasks in the lens and reveals model details on demand', () => {
    const close = jest.fn()
    render(<ProjectLens progress={progress} open onClose={close} onTaskAction={jest.fn()} taskHref={(id) => `/tasks/${id}`} />)

    expect(screen.getByRole('dialog', { name: 'Email Marketing V2 project tasks' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Now' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Waiting' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Done' })).toBeInTheDocument()
    expect(screen.queryByText('claude-sonnet-4-6')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Show details for Draft copy/i }))
    expect(screen.getByText('claude-sonnet-4-6')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Close project lens/i }))
    expect(close).toHaveBeenCalled()
  })

  it('focuses the drawer close control, closes on Escape, and restores focus', () => {
    const close = jest.fn()
    const { rerender } = render(
      <>
        <button type="button">Open project lens</button>
        <ProjectLens progress={progress} open={false} onClose={close} onTaskAction={jest.fn()} taskHref={(id) => `/tasks/${id}`} />
      </>,
    )
    const trigger = screen.getByRole('button', { name: 'Open project lens' })
    trigger.focus()

    rerender(
      <>
        <button type="button">Open project lens</button>
        <ProjectLens progress={progress} open onClose={close} onTaskAction={jest.fn()} taskHref={(id) => `/tasks/${id}`} />
      </>,
    )

    expect(screen.getByRole('button', { name: 'Close project lens' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(close).toHaveBeenCalledTimes(1)

    rerender(
      <>
        <button type="button">Open project lens</button>
        <ProjectLens progress={progress} open={false} onClose={close} onTaskAction={jest.fn()} taskHref={(id) => `/tasks/${id}`} />
      </>,
    )
    expect(screen.getByRole('button', { name: 'Open project lens' })).toHaveFocus()
  })

  it('does not offer approval actions when the current role cannot approve', () => {
    render(
      <ProjectLens
        progress={progress}
        open
        canApprove={false}
        onClose={jest.fn()}
        onTaskAction={jest.fn()}
        taskHref={(id) => `/tasks/${id}`}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Approve next step' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Show details for Approve sender/i }))
    expect(screen.getByRole('link', { name: /Open task/i })).toHaveAttribute('href', '/tasks/approval')
  })

  it('renders a living bundle with dependencies, artifacts, and an attention action', () => {
    const action = jest.fn()
    render(<LivingTaskBundle tasks={progress.tasks} onTaskAction={action} taskHref={(id) => `/tasks/${id}`} />)

    expect(screen.getByText('4 linked tasks')).toBeInTheDocument()
    expect(screen.getByText('After Draft copy')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Verified brief' })).toHaveAttribute('href', 'https://example.com/brief')
    expect(screen.getByText('Your approval is needed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Approve next step' }))
    expect(action).toHaveBeenCalledWith(expect.objectContaining({ id: 'approval' }))
  })

  it('keeps approval controls out of living bundles for non-approvers', () => {
    render(<LivingTaskBundle tasks={progress.tasks} canApprove={false} onTaskAction={jest.fn()} taskHref={(id) => `/tasks/${id}`} />)

    expect(screen.queryByRole('button', { name: 'Approve next step' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review blocker' })).toHaveAttribute('href', '/tasks/approval')
  })
})
