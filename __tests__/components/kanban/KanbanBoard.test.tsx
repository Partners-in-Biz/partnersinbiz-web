import React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { KanbanBoard } from '@/components/kanban/KanbanBoard'
import type { Column, Task } from '@/components/kanban/types'

const mockDndHandlers: {
  onDragStart?: (event: unknown) => void
  onDragOver?: (event: unknown) => void
  onDragEnd?: (event: unknown) => Promise<void> | void
} = {}

jest.mock('@dnd-kit/core', () => ({
  DndContext: ({
    children,
    onDragStart,
    onDragOver,
    onDragEnd,
  }: {
    children: React.ReactNode
    onDragStart?: (event: unknown) => void
    onDragOver?: (event: unknown) => void
    onDragEnd?: (event: unknown) => Promise<void> | void
  }) => {
    mockDndHandlers.onDragStart = onDragStart
    mockDndHandlers.onDragOver = onDragOver
    mockDndHandlers.onDragEnd = onDragEnd
    return <div>{children}</div>
  },
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

function dispatchBoardPointerEvent(
  element: HTMLElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  options: { button?: number; clientX: number; pointerId?: number; pointerType?: string },
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: options.button ?? 0,
    cancelable: true,
    clientX: options.clientX,
  })
  Object.defineProperty(event, 'pointerId', { value: options.pointerId ?? 1 })
  Object.defineProperty(event, 'pointerType', { value: options.pointerType ?? 'mouse' })
  fireEvent(element, event)
}

function taskCardTones(title: string): string[] {
  const cards = screen.getAllByText(title)
    .map((node) => node.closest('.pib-card'))
    .filter((card): card is HTMLElement => card instanceof HTMLElement)
  return Array.from(new Set(cards)).map((card) => card.getAttribute('data-state-tone') ?? '')
}

describe('KanbanBoard task cards', () => {
  beforeEach(() => {
    mockDndHandlers.onDragStart = undefined
    mockDndHandlers.onDragOver = undefined
    mockDndHandlers.onDragEnd = undefined
  })

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

  it('lets desktop users drag empty board space horizontally without using the bottom scrollbar', () => {
    render(
      <KanbanBoard
        columns={[
          { id: 'backlog', name: 'Backlog', color: '#64748b', order: 1 },
          { id: 'todo', name: 'To Do', color: '#60a5fa', order: 2 },
          { id: 'review', name: 'Review', color: '#a855f7', order: 3 },
        ]}
        tasks={[]}
        onTaskMove={jest.fn()}
        onTaskClick={jest.fn()}
        onAddTask={jest.fn()}
      />,
    )

    const scroller = screen.getByTestId('kanban-board-scroll')
    scroller.scrollLeft = 25

    dispatchBoardPointerEvent(scroller, 'pointerdown', { button: 0, clientX: 500 })
    dispatchBoardPointerEvent(scroller, 'pointermove', { clientX: 430 })
    dispatchBoardPointerEvent(scroller, 'pointerup', { clientX: 430 })

    expect(scroller.scrollLeft).toBe(95)
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

  it('shows review-passed tasks that still need business approval as decision items, not completed work', () => {
    render(
      <KanbanBoard
        columns={[{ id: 'review', name: 'Review', color: '#a855f7', order: 1 }]}
        tasks={[{
          ...task,
          id: 'decision-task',
          title: 'Review passed but approval pending',
          columnId: 'review',
          agentStatus: 'done',
          reviewStatus: 'approved',
          approvalStatus: 'pending',
          approvalGate: 'production-deploy',
          reviewerAgentId: 'qa-release',
        }]}
        onTaskMove={jest.fn()}
        onTaskClick={jest.fn()}
        onAddTask={jest.fn()}
      />,
    )

    const card = screen.getByText('Review passed but approval pending').closest('.pib-card')
    expect(card).not.toBeNull()
    expect(card).toHaveAttribute('data-state-tone', 'review')
    const scope = within(card as HTMLElement)
    expect(scope.getByText('Approval pending')).toBeInTheDocument()
    expect(scope.getByText('Review passed')).toBeInTheDocument()
  })

  it('rolls back drag state when the server rejects a board move', async () => {
    const rejectedMove = jest.fn(async () => {
      throw new Error('Only an admin approver can change approval-gate metadata on project tasks')
    })

    render(
      <KanbanBoard
        columns={[
          { id: 'todo', name: 'To Do', color: '#60a5fa', order: 1 },
          { id: 'done', name: 'Done', color: '#22c55e', order: 2 },
        ]}
        tasks={[{ ...task, id: 'gated-task', title: 'Gated task', columnId: 'todo', order: 1 }]}
        onTaskMove={rejectedMove}
        onTaskClick={jest.fn()}
        onAddTask={jest.fn()}
      />,
    )

    expect(taskCardTones('Gated task')).toContain('todo')

    act(() => {
      mockDndHandlers.onDragStart?.({ active: { id: 'gated-task' } })
      mockDndHandlers.onDragOver?.({ active: { id: 'gated-task' }, over: { id: 'done' } })
    })

    await waitFor(() => {
      expect(taskCardTones('Gated task')).toContain('done')
    })

    await act(async () => {
      await mockDndHandlers.onDragEnd?.({ active: { id: 'gated-task' }, over: { id: 'done' } })
    })

    expect(rejectedMove).toHaveBeenCalledWith('gated-task', 'done', expect.any(Number))
    await waitFor(() => {
      expect(taskCardTones('Gated task')).toEqual(['todo'])
    })
  })
})
