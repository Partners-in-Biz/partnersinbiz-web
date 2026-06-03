import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TaskDetailPanel } from '@/components/kanban/TaskDetailPanel'
import type { Task } from '@/components/kanban/types'
import type { ContextReference } from '@/lib/context-references/types'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/admin/org/test-org/projects/project-1',
}))

const task: Task = {
  id: 'task-1',
  title: 'Mobile task',
  description: 'Task details',
  columnId: 'todo',
  order: 1,
  priority: 'medium',
}

const contextRef: ContextReference = {
  type: 'contact',
  id: 'contact-1',
  orgId: 'org-1',
  label: 'Jane Client',
  origin: 'mention',
  href: '/admin/crm/contacts/contact-1',
  summary: 'jane@example.com',
}

function renderPanel(overrides: Partial<React.ComponentProps<typeof TaskDetailPanel>> = {}) {
  const props: React.ComponentProps<typeof TaskDetailPanel> = {
    task,
    columnName: 'To Do',
    projectId: 'project-1',
    onClose: jest.fn(),
    onUpdate: jest.fn().mockResolvedValue(undefined),
    onDelete: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }

  render(<TaskDetailPanel {...props} />)
  return props
}

describe('TaskDetailPanel', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true, data: [] }),
    }) as jest.Mock
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('keeps an accessible close button available in the sticky header for mobile full-width panels', async () => {
    const props = renderPanel()

    await waitFor(() => expect(screen.queryByText('Loading comments...')).not.toBeInTheDocument())

    const closeButton = screen.getByRole('button', { name: /close task details/i })
    expect(closeButton.closest('[data-task-detail-header]')).toHaveClass('sticky', 'top-0', 'z-10')

    fireEvent.click(closeButton)

    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('shows a clear mobile back-to-board control that closes the detail panel', async () => {
    const props = renderPanel()

    await waitFor(() => expect(screen.queryByText('Loading comments...')).not.toBeInTheDocument())

    const backButton = screen.getByRole('button', { name: /back to board/i })
    expect(backButton.closest('[data-task-detail-header]')).toHaveClass('sticky', 'top-0', 'z-10')

    fireEvent.click(backButton)

    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('uses an in-page confirmation before deleting project tasks', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)
    const props = renderPanel()

    await waitFor(() => expect(screen.queryByText('Loading comments...')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Delete project task Mobile task' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(props.onDelete).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: 'Delete project task "Mobile task"?' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'This removes the task from the board for everyone. Comments, blockers, and assignments on this task will no longer be visible from the project workspace.',
      ),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete project task Mobile task' }))

    await waitFor(() => {
      expect(props.onDelete).toHaveBeenCalledWith('task-1')
    })
    expect(props.onClose).toHaveBeenCalled()

    confirmSpy.mockRestore()
  })

  it('does not crash when legacy task comments have no userName', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({
        success: true,
        data: [
          {
            id: 'legacy-comment',
            text: 'Legacy status update',
            userRole: 'system',
            createdAt: { _seconds: 20, _nanoseconds: 0 },
          },
        ],
      }),
    }) as jest.Mock

    renderPanel()

    expect(await screen.findByText('Legacy status update')).toBeInTheDocument()
    expect(screen.getAllByText('System').length).toBeGreaterThan(0)
  })

  it('attaches selected context refs to submitted task comments', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/projects/project-1/tasks/task-1/comments' && !init) {
        return { json: () => Promise.resolve({ success: true, data: [] }) } as Response
      }
      if (url.startsWith('/api/v1/context-references/search')) {
        return {
          ok: true,
          json: () => Promise.resolve({ success: true, data: { refs: [contextRef] } }),
        } as Response
      }
      if (url === '/api/v1/projects/project-1/tasks/task-1/comments' && init?.method === 'POST') {
        return {
          json: () => Promise.resolve({
            success: true,
            data: {
              id: 'comment-1',
              text: 'Jane confirmed the requirements.',
              contextRefs: [contextRef],
            },
          }),
        } as Response
      }
      throw new Error(`Unexpected fetch ${url}`)
    })

    renderPanel({ orgId: 'org-1' })

    await waitFor(() => expect(screen.queryByText('Loading comments...')).not.toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('Type a comment...'), {
      target: { value: 'Jane confirmed the requirements.' },
    })
    fireEvent.change(screen.getByLabelText('Add task comment context reference'), {
      target: { value: '@contacts:jane' },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Attach Jane Client' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/projects/project-1/tasks/task-1/comments',
      expect.objectContaining({ method: 'POST' }),
    ))
    const createCall = (global.fetch as jest.Mock).mock.calls.find(([url, init]) => (
      url === '/api/v1/projects/project-1/tasks/task-1/comments' && init?.method === 'POST'
    ))
    expect(JSON.parse(createCall[1].body)).toEqual(expect.objectContaining({
      contextRefs: [expect.objectContaining({ type: 'contact', id: 'contact-1', label: 'Jane Client' })],
    }))
  })

  it('shows actionable unblock guidance for blocked cards from the latest blocker comment', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({
        success: true,
        data: [
          {
            id: 'old-comment',
            text: 'Blocked: older reason',
            userId: 'theo',
            userName: 'Theo',
            userRole: 'ai',
            createdAt: { _seconds: 10, _nanoseconds: 0 },
            agentPickedUp: false,
          },
          {
            id: 'new-comment',
            text: 'Blocked: Waiting on Peet approval. Proof needed: screenshot of approved layout. When resolved tell Theo: approval granted and screenshot attached.',
            userId: 'theo',
            userName: 'Theo',
            userRole: 'ai',
            createdAt: { _seconds: 20, _nanoseconds: 0 },
            agentPickedUp: false,
          },
        ],
      }),
    }) as jest.Mock

    renderPanel({
      task: {
        ...task,
        columnId: 'blocked',
        assigneeAgentId: 'theo',
        agentStatus: 'blocked',
      },
      columnName: 'Blocked',
    })

    expect(await screen.findByText('Unblock guidance')).toBeInTheDocument()
    expect((await screen.findAllByText(/Waiting on Peet approval/i)).length).toBeGreaterThan(0)
    expect((await screen.findAllByText(/screenshot of approved layout/i)).length).toBeGreaterThan(0)
    expect((await screen.findAllByText(/approval granted and screenshot attached/i)).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /unblock/i })).toBeInTheDocument()
  })

  it('calls the unblock endpoint and reports dependency-gated failures instead of silently failing', async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce({ json: () => Promise.resolve({ success: true, data: [] }) })
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({
          success: false,
          error: 'Cannot unblock yet',
          data: { reasons: ['Dependency “Design approval” is still blocked.'] },
        }),
      })

    renderPanel({
      task: {
        ...task,
        columnId: 'blocked',
        assigneeAgentId: 'theo',
        agentStatus: 'awaiting-input',
        dependsOn: ['dep-1'],
      },
      columnName: 'Blocked',
    })

    fireEvent.click(await screen.findByRole('button', { name: /unblock/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/projects/project-1/tasks/task-1/unblock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    })
    expect(await screen.findByText(/Dependency “Design approval” is still blocked/i)).toBeInTheDocument()
  })
})
