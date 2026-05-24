import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import ProjectDetailPage from '@/app/(portal)/portal/projects/[projectId]/page'

let snapshotCallback: ((snap: { docChanges: () => Array<{ type: 'added' | 'modified' | 'removed'; doc: { id: string; data: () => Record<string, unknown> } }> }) => void) | null = null
const unsubscribe = jest.fn()

jest.mock('next/navigation', () => ({
  useParams: () => ({ projectId: 'project-1' }),
}))

jest.mock('firebase/firestore', () => ({
  collection: jest.fn((...segments: string[]) => segments),
  onSnapshot: jest.fn((_ref, onNext) => {
    snapshotCallback = onNext
    return unsubscribe
  }),
}))

jest.mock('@/lib/firebase/config', () => ({
  getClientDb: jest.fn(() => ({})),
}))

jest.mock('@/components/kanban/KanbanBoard', () => ({
  KanbanBoard: ({ tasks }: { tasks: Array<{ id: string; title: string }> }) => (
    <div data-testid="kanban-board">
      {tasks.map(task => <div key={task.id}>{task.title}</div>)}
    </div>
  ),
}))

jest.mock('@/components/kanban/TaskDetailPanel', () => ({
  TaskDetailPanel: () => <div data-testid="task-detail-panel" />,
}))

jest.mock('@/components/kanban/TaskComposer', () => ({
  TaskComposer: () => <div data-testid="task-composer" />,
}))

function mockSnapshotChange(type: 'added' | 'modified' | 'removed', id: string, data: Record<string, unknown>) {
  act(() => {
    snapshotCallback?.({
      docChanges: () => [
        {
          type,
          doc: { id, data: () => data },
        },
      ],
    })
  })
}

function mockFetch() {
  global.fetch = jest.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/api/v1/projects/project-1') {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          data: {
            id: 'project-1',
            name: 'Client Website',
            description: 'Initial board description',
            brief: 'Existing project brief',
            status: 'development',
            columns: [],
          },
        }),
      } as Response)
    }
    if (url === '/api/v1/projects/project-1/docs') {
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
    }
    if (url === '/api/v1/projects/project-1/tasks') {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'task-1',
              title: 'Open task',
              columnId: 'todo',
              order: 1,
              dueDate: '2026-05-25T00:00:00.000Z',
              attachments: [{ id: 'file-1' }],
            },
            {
              id: 'task-2',
              title: 'Done task with stale blocked label',
              columnId: 'done',
              order: 2,
              labels: ['blocked'],
              attachments: [],
            },
            {
              id: 'task-3',
              title: 'Board blocker',
              columnId: 'blocked',
              order: 3,
              attachments: [],
            },
          ],
        }),
      } as Response)
    }
    return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
  }) as jest.Mock
}

describe('Portal project detail kanban stat cards', () => {
  beforeEach(() => {
    snapshotCallback = null
    unsubscribe.mockClear()
    mockFetch()
  })

  it('uses separate board-parity stat cards and ignores stale blocked labels outside active blockers', async () => {
    render(<ProjectDetailPage />)

    await waitFor(() => expect(screen.getByText('Board blocker')).toBeInTheDocument())

    expect(screen.getByText('Tasks').nextElementSibling).toHaveTextContent('3')
    expect(screen.getByText('Due').nextElementSibling).toHaveTextContent('1')
    expect(screen.getByText('Blocked').nextElementSibling).toHaveTextContent('1')
    expect(screen.getByText('Done').nextElementSibling).toHaveTextContent('1')
    expect(screen.queryByText('Media')).not.toBeInTheDocument()
    expect(screen.queryByText('Done / blocked')).not.toBeInTheDocument()
  })

  it('keeps portal stat cards in sync with live board task changes', async () => {
    render(<ProjectDetailPage />)

    await waitFor(() => expect(snapshotCallback).toBeTruthy())
    mockSnapshotChange('added', 'task-live-1', {
      title: 'Live blocked task',
      columnId: 'blocked',
      order: 4,
    })

    expect(screen.getByText('Live blocked task')).toBeInTheDocument()
    expect(screen.getByText('Tasks').nextElementSibling).toHaveTextContent('4')
    expect(screen.getByText('Blocked').nextElementSibling).toHaveTextContent('2')
  })
})
