import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { KanbanBoard } from '@/components/kanban/KanbanBoard'
import type { Column, Task } from '@/components/kanban/types'

jest.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DragOverlay: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  closestCorners: jest.fn(),
  KeyboardSensor: jest.fn(),
  PointerSensor: jest.fn(),
  useSensor: jest.fn(),
  useSensors: jest.fn(() => []),
  useDroppable: () => ({ setNodeRef: jest.fn(), isOver: false }),
}))

jest.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  sortableKeyboardCoordinates: jest.fn(),
  verticalListSortingStrategy: jest.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: jest.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}))

jest.mock('@dnd-kit/utilities', () => ({ CSS: { Transform: { toString: () => '' } } }))

const columns: Column[] = [
  { id: 'todo', name: 'To Do', color: '#60a5fa', order: 1 },
]

const task: Task = {
  id: 'task-1',
  title: 'Timed task',
  columnId: 'todo',
  order: 1,
  startDate: '2026-05-22T08:15:00.000Z',
  dueDate: '2026-05-22T10:45:00.000Z',
}

function expectBefore(firstText: string, secondText: string) {
  const first = screen.getByText(firstText)
  const second = screen.getByText(secondText)
  expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
}

describe('KanbanBoard task cards', () => {
  it('keeps kanban column overflow inside the board scroller on small screens', () => {
    render(
      <KanbanBoard
        columns={[
          { id: 'todo', name: 'To Do', color: '#60a5fa', order: 1 },
          { id: 'in_progress', name: 'In Progress', color: '#f59e0b', order: 2 },
          { id: 'done', name: 'Done', color: '#22c55e', order: 3 },
        ]}
        tasks={[task]}
        onTaskMove={jest.fn()}
        onTaskClick={jest.fn()}
        onAddTask={jest.fn()}
      />,
    )

    expect(screen.getByTestId('kanban-board-scroll')).toHaveClass(
      'min-w-0',
      'max-w-full',
      'overflow-x-auto',
      'overscroll-x-contain',
    )
  })

  it('shows latest tasks first by default and can toggle back to manual order', () => {
    render(
      <KanbanBoard
        columns={columns}
        tasks={[
          { id: 'task-old', title: 'Old task', columnId: 'todo', order: 1, createdAt: '2026-05-20T08:00:00.000Z' },
          { id: 'task-new', title: 'Newest task', columnId: 'todo', order: 3, createdAt: '2026-05-24T08:00:00.000Z' },
          { id: 'task-middle', title: 'Middle task', columnId: 'todo', order: 2, createdAt: '2026-05-22T08:00:00.000Z' },
        ]}
        onTaskMove={jest.fn()}
        onTaskClick={jest.fn()}
        onAddTask={jest.fn()}
      />,
    )

    expectBefore('Newest task', 'Middle task')
    expectBefore('Middle task', 'Old task')

    fireEvent.click(screen.getByRole('button', { name: /manual order/i }))

    expectBefore('Old task', 'Middle task')
    expectBefore('Middle task', 'Newest task')
  })

  it('shows start and end date-times on task cards', () => {
    render(
      <KanbanBoard
        columns={columns}
        tasks={[task]}
        onTaskMove={jest.fn()}
        onTaskClick={jest.fn()}
        onAddTask={jest.fn()}
      />,
    )

    const card = screen.getByText('Timed task').closest('.pib-card')
    expect(card).not.toBeNull()
    const scope = within(card as HTMLElement)
    expect(scope.getByText('Start')).toBeInTheDocument()
    expect(scope.getByText('End')).toBeInTheDocument()
    expect(scope.getAllByText(/\d{1,2}:\d{2}/).length).toBeGreaterThanOrEqual(2)
  })

  it('shows blocked cards with visible unblock guidance on the board', () => {
    render(
      <KanbanBoard
        columns={[{ id: 'blocked', name: 'Blocked', color: '#ef4444', order: 1 }]}
        tasks={[{
          ...task,
          id: 'task-blocked',
          title: 'Blocked card',
          columnId: 'blocked',
          agentStatus: 'blocked',
          assigneeAgentId: 'theo',
          agentOutput: { summary: 'Waiting on client confirmation. Evidence required: approval comment. Message for agent: confirmation received.' },
        }]}
        onTaskMove={jest.fn()}
        onTaskClick={jest.fn()}
        onAddTask={jest.fn()}
      />,
    )

    const card = screen.getByText('Blocked card').closest('.pib-card')
    expect(card).not.toBeNull()
    const scope = within(card as HTMLElement)
    expect(scope.getByText(/Blocked:/)).toBeInTheDocument()
    expect(scope.getByText(/Waiting on client confirmation/i)).toBeInTheDocument()
    expect(scope.getByText(/Unblock:/)).toBeInTheDocument()
    expect(scope.getAllByText(/client confirmation/i).length).toBeGreaterThan(0)
  })

  it('uses task state rather than priority for the card rail and tint', () => {
    render(
      <KanbanBoard
        columns={[
          { id: 'todo', name: 'To Do', color: '#64748b', order: 1 },
          { id: 'in_progress', name: 'In Progress', color: '#60a5fa', order: 2 },
          { id: 'blocked', name: 'Blocked', color: '#ef4444', order: 3 },
          { id: 'review', name: 'Review', color: '#a855f7', order: 4 },
          { id: 'done', name: 'Done', color: '#22c55e', order: 5 },
        ]}
        tasks={[
          { ...task, id: 'todo-task', title: 'Todo task', columnId: 'todo', priority: 'urgent' },
          { ...task, id: 'working-task', title: 'Working task', columnId: 'in_progress', agentStatus: 'in-progress', priority: 'low' },
          { ...task, id: 'blocked-task', title: 'Blocked task state', columnId: 'todo', agentStatus: 'awaiting-input', priority: 'low' },
          { ...task, id: 'review-task', title: 'Review task', columnId: 'review', agentStatus: 'done', priority: 'low' },
          { ...task, id: 'done-task', title: 'Done task', columnId: 'done', priority: 'urgent' },
        ]}
        onTaskMove={jest.fn()}
        onTaskClick={jest.fn()}
        onAddTask={jest.fn()}
      />,
    )

    expect(screen.getByText('Todo task').closest('.pib-card')).toHaveAttribute('data-state-tone', 'todo')
    expect(screen.getByText('Working task').closest('.pib-card')).toHaveAttribute('data-state-tone', 'in-progress')
    expect(screen.getByText('Blocked task state').closest('.pib-card')).toHaveAttribute('data-state-tone', 'blocked')
    expect(screen.getByText('Review task').closest('.pib-card')).toHaveAttribute('data-state-tone', 'review')
    expect(screen.getByText('Done task').closest('.pib-card')).toHaveAttribute('data-state-tone', 'done')
    expect(screen.getByText('Blocked task state').closest('.pib-card')).toHaveStyle({ borderLeftColor: '#ef4444' })
    expect(screen.getByText('Done task').closest('.pib-card')).toHaveStyle({ borderLeftColor: '#22c55e' })
  })
})
