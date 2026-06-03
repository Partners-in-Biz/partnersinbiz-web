import React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ProjectDetailPage from '@/app/(portal)/portal/projects/[projectId]/page'

let snapshotCallback: ((snap: { docChanges: () => Array<{ type: 'added' | 'modified' | 'removed'; doc: { id: string; data: () => Record<string, unknown> } }> }) => void) | null = null
const unsubscribe = jest.fn()
const mockSearchParamsGet = jest.fn(() => null)

jest.mock('next/navigation', () => ({
  useParams: () => ({ projectId: 'project-1' }),
  useSearchParams: () => ({ get: mockSearchParamsGet }),
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
  TaskDetailPanel: ({ task }: { task: { title: string } }) => <div data-testid="task-detail-panel">{task.title}</div>,
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

function upcomingIsoDate() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
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
      return Promise.resolve({
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'doc-1',
              title: 'Launch brief',
              type: 'brief',
              content: 'Keep the campaign launch context visible for every contributor.',
              createdBy: 'user-1',
            },
          ],
        }),
      } as Response)
    }
    if (url === '/api/v1/projects/project-1/docs/doc-1') {
      return Promise.resolve({ ok: true, json: async () => ({ success: true }) } as Response)
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
              dueDate: upcomingIsoDate(),
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
            {
              id: 'task-4',
              title: 'Agent finished awaiting review',
              columnId: 'review',
              agentStatus: 'done',
              order: 4,
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
    mockSearchParamsGet.mockReset()
    mockSearchParamsGet.mockReturnValue(null)
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: jest.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    })
    mockFetch()
  })

  it('opens project task details from legacy task query links', async () => {
    mockSearchParamsGet.mockImplementation((key: string) => key === 'task' ? 'task-3' : null)

    render(<ProjectDetailPage />)

    await waitFor(() => expect(screen.getByTestId('task-detail-panel')).toHaveTextContent('Board blocker'))
  })

  it('uses a board-progress summary and ignores stale blocked labels outside active blockers', async () => {
    render(<ProjectDetailPage />)

    await waitFor(() => expect(screen.getByText('Board blocker')).toBeInTheDocument())

    expect(screen.getAllByText('Actually done').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Done task progress')).toHaveTextContent('2 / 4')
    expect(screen.getByLabelText('Open task count')).toHaveTextContent('2')
    expect(screen.getByLabelText('Blocked task count')).toHaveTextContent('1')
    expect(screen.getByLabelText('Done task count')).toHaveTextContent('2')
    expect(screen.getByText('Due this week', { exact: false })).toHaveTextContent('1 due this week')
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
    expect(screen.getByLabelText('Done task progress')).toHaveTextContent('2 / 5')
    expect(screen.getByLabelText('Blocked task count')).toHaveTextContent('2')
  })

  it('keeps the board/list toggle and manual order control on one spaced toolbar row', async () => {
    render(<ProjectDetailPage />)

    await waitFor(() => expect(screen.getByText('Board blocker')).toBeInTheDocument())

    const boardButton = screen.getByRole('button', { name: /view_kanban\s+board/i })
    const toolbar = boardButton.parentElement?.parentElement
    const manualSort = screen.getByRole('button', { name: /manual order/i })
    expect(toolbar).toHaveClass('justify-between')
    expect(toolbar).toContainElement(manualSort)

    fireEvent.click(manualSort)
    expect(screen.getByRole('button', { name: /latest first/i })).toHaveAttribute('aria-pressed', 'true')
  })

  it('uses a compact task-card list by default on phones', async () => {
    ;(window.matchMedia as jest.Mock).mockImplementation(query => ({
      matches: query === '(max-width: 767px)',
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }))

    render(<ProjectDetailPage />)

    await waitFor(() => expect(screen.getAllByText('Board blocker').length).toBeGreaterThan(0))
    expect(screen.queryByTestId('kanban-board')).not.toBeInTheDocument()
    const mobileList = screen.getByTestId('portal-mobile-task-list')
    expect(mobileList).toBeInTheDocument()
    expect(within(mobileList).getByRole('button', { name: /Board blocker/i })).toHaveTextContent('Blocked')
  })

  it('uses an in-page confirmation before deleting project documents', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)

    render(<ProjectDetailPage />)

    await waitFor(() => expect(screen.getByText('Board blocker')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('tab', { name: /docs/i }))
    expect(await screen.findByRole('button', { name: 'Preview Launch brief' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete project document Launch brief' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: 'Delete project document "Launch brief"?' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'This removes the document from the project workspace. Tasks, comments, and project history stay intact.',
      ),
    ).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/projects/project-1/docs/doc-1', { method: 'DELETE' })

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete project document Launch brief' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/projects/project-1/docs/doc-1', { method: 'DELETE' })
    })
    await waitFor(() => {
      expect(screen.queryByText('Launch brief')).not.toBeInTheDocument()
    })

    confirmSpy.mockRestore()
  })
})
