import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { CrossProjectBoard } from '@/components/projects/CrossProjectBoard'
import type { Task } from '@/components/kanban/types'

jest.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DragOverlay: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  closestCorners: jest.fn(),
  PointerSensor: jest.fn(),
  KeyboardSensor: jest.fn(),
  useSensor: jest.fn(),
  useSensors: jest.fn(() => []),
  useDroppable: () => ({ setNodeRef: jest.fn(), isOver: false }),
}))
jest.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  sortableKeyboardCoordinates: jest.fn(),
  verticalListSortingStrategy: jest.fn(),
  useSortable: () => ({
    attributes: {}, listeners: {}, setNodeRef: jest.fn(),
    transform: null, transition: null, isDragging: false,
  }),
}))
jest.mock('@dnd-kit/utilities', () => ({ CSS: { Transform: { toString: () => '' } } }))
jest.mock('@/components/kanban/TaskDetailPanel', () => ({
  TaskDetailPanel: ({ task, onClose }: { task: Task; onClose: () => void }) => (
    <section aria-label="Task details">
      <h2>{task.title}</h2>
      <button type="button" onClick={onClose}>Back to board</button>
    </section>
  ),
}))

type BoardTask = Task & { projectId: string; projectName: string }

function expectBefore(firstText: string, secondText: string) {
  const first = screen.getByText(firstText)
  const second = screen.getByText(secondText)
  expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
}

const makeBoardTask = (overrides: Partial<BoardTask> = {}): BoardTask => ({
  id: 'task-1',
  title: 'Test task',
  columnId: 'todo',
  order: 1,
  projectId: 'proj-a',
  projectName: 'Test Project',
  ...overrides,
})

describe('CrossProjectBoard', () => {
  it('sorts latest first by default and uses manual order when requested by the toolbar', () => {
    const tasks = [
      makeBoardTask({ id: 'task-old', title: 'Old task', order: 1, createdAt: '2026-05-20T08:00:00.000Z' }),
      makeBoardTask({ id: 'task-new', title: 'Newest task', order: 3, createdAt: '2026-05-24T08:00:00.000Z' }),
      makeBoardTask({ id: 'task-middle', title: 'Middle task', order: 2, createdAt: '2026-05-22T08:00:00.000Z' }),
    ]

    const { rerender } = render(<CrossProjectBoard
      tasks={tasks}
      loading={false}
      onTaskUpdate={jest.fn()}
    />)

    expectBefore('Newest task', 'Middle task')
    expectBefore('Middle task', 'Old task')
    expect(screen.queryByRole('button', { name: /manual order/i })).not.toBeInTheDocument()

    rerender(<CrossProjectBoard
      tasks={tasks}
      loading={false}
      sortMode="manual"
      onTaskUpdate={jest.fn()}
    />)

    expectBefore('Old task', 'Middle task')
    expectBefore('Middle task', 'Newest task')
  })

  it('renders five column headers', () => {
    render(<CrossProjectBoard tasks={[]} loading={false} onTaskUpdate={jest.fn()} />)
    expect(screen.getByText('Backlog')).toBeInTheDocument()
    expect(screen.getByText('To Do')).toBeInTheDocument()
    expect(screen.getByText('In Progress')).toBeInTheDocument()
    expect(screen.getByText('Review')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
  })

  it('shows skeleton cards when loading', () => {
    const { container } = render(<CrossProjectBoard tasks={[]} loading={true} onTaskUpdate={jest.fn()} />)
    const skeletons = container.querySelectorAll('.pib-skeleton')
    expect(skeletons.length).toBe(18)
  })

  it('renders a task in the correct column', () => {
    const task = makeBoardTask({ columnId: 'todo', title: 'My board task' })
    render(<CrossProjectBoard tasks={[task]} loading={false} onTaskUpdate={jest.fn()} />)
    expect(screen.getByText('My board task')).toBeInTheDocument()
  })

  it('uses scoped project hrefs for project badges', () => {
    const task = makeBoardTask({ projectId: 'proj-a', projectName: 'Scoped Project' })

    render(
      <CrossProjectBoard
        tasks={[task]}
        loading={false}
        onTaskUpdate={jest.fn()}
        buildProjectHref={(projectId) => `/portal/projects/${projectId}?orgId=lumen-org&orgSlug=lumen-speeds`}
      />,
    )

    expect(screen.getByText('Scoped Project').closest('a')).toHaveAttribute(
      'href',
      '/portal/projects/proj-a?orgId=lumen-org&orgSlug=lumen-speeds',
    )
  })

  it('shows empty state when no tasks at all', () => {
    render(<CrossProjectBoard tasks={[]} loading={false} onTaskUpdate={jest.fn()} />)
    expect(screen.getByText(/No tasks yet/i)).toBeInTheDocument()
  })

  it('does not show empty state when tasks are present', () => {
    const task = makeBoardTask()
    render(<CrossProjectBoard tasks={[task]} loading={false} onTaskUpdate={jest.fn()} />)
    expect(screen.queryByText(/No tasks yet/i)).not.toBeInTheDocument()
  })

  it('returns to the board after closing an opened task detail', () => {
    const task = makeBoardTask({ title: 'Mobile board task' })
    render(<CrossProjectBoard tasks={[task]} loading={false} onTaskUpdate={jest.fn()} />)

    fireEvent.click(screen.getByText('Mobile board task'))
    expect(screen.getByRole('region', { name: /task details/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /back to board/i }))

    expect(screen.queryByRole('region', { name: /task details/i })).not.toBeInTheDocument()
    expect(screen.getByText('Mobile board task')).toBeInTheDocument()
  })
})
