import React from 'react'
import { render, screen, within } from '@testing-library/react'
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

describe('KanbanBoard task cards', () => {
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
})
