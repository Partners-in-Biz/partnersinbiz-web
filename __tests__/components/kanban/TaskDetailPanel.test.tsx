import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TaskDetailPanel } from '@/components/kanban/TaskDetailPanel'
import type { Task } from '@/components/kanban/types'

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
})
