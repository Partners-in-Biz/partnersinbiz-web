import React from 'react'
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import ProjectsPage from '@/app/(admin)/admin/org/[slug]/projects/page'

let snapshotCallback: ((snap: { docChanges: () => Array<{ type: 'added' | 'modified' | 'removed'; doc: { id: string; data: () => Record<string, unknown> } }> }) => void) | null = null
const unsubscribe = jest.fn()

jest.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'acme-client' }),
}))

jest.mock('firebase/firestore', () => ({
  collection: jest.fn((...segments: string[]) => segments),
  query: jest.fn((ref, ...clauses) => ({ ref, clauses })),
  where: jest.fn((field, op, value) => ({ field, op, value })),
  onSnapshot: jest.fn((_ref, onNext) => {
    snapshotCallback = onNext
    return unsubscribe
  }),
}))

jest.mock('@/lib/firebase/config', () => ({
  getClientDb: jest.fn(() => ({})),
}))

jest.mock('@/components/projects/CrossProjectBoard', () => ({
  CrossProjectBoard: ({
    tasks,
    loading,
    sortMode,
  }: {
    tasks: Array<{ id: string; title: string; projectName?: string }>
    loading: boolean
    sortMode?: 'latest' | 'manual'
  }) => (
    <div data-testid="cross-project-board" data-loading={loading ? 'true' : 'false'} data-sort={sortMode ?? 'latest'}>
      {tasks.map(task => <div key={task.id}>{task.title} — {task.projectName}</div>)}
    </div>
  ),
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

describe('Admin client projects board view', () => {
  beforeEach(() => {
    snapshotCallback = null
    unsubscribe.mockClear()
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/projects?orgSlug=acme-client') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [{ id: 'project-1', orgId: 'org-acme', name: 'Client Website', status: 'development' }] }),
        } as Response)
      }
      if (url === '/api/v1/projects/project-1/tasks') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [] }),
        } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
    }) as jest.Mock
  })

  it('lets admins switch from project cards to a cross-project task board for the client', async () => {
    render(<ProjectsPage />)

    await waitFor(() => expect(screen.getByRole('button', { name: /board/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /board/i }))

    await waitFor(() => expect(snapshotCallback).toBeTruthy())

    mockSnapshotChange('added', 'task-live-1', {
      title: 'Live admin task',
      columnId: 'todo',
      order: 1,
    })

    expect(screen.getByTestId('cross-project-board')).toBeInTheDocument()
    expect(screen.getByText('Live admin task — Client Website')).toBeInTheDocument()
    expect(screen.getByTestId('cross-project-board')).toHaveAttribute('data-sort', 'latest')

    await waitFor(() => expect(screen.getByRole('button', { name: /manual order/i })).toBeInTheDocument())
    const boardButton = screen.getByRole('button', { name: /view_kanban\s+board/i })
    const manualOrderButton = screen.getByRole('button', { name: /manual order/i })
    const toolbar = boardButton.parentElement?.parentElement
    expect(toolbar).toHaveClass('justify-between')
    expect(toolbar).toHaveClass('gap-3')
    expect(toolbar).toContainElement(manualOrderButton)
    fireEvent.click(manualOrderButton)

    expect(screen.getByTestId('cross-project-board')).toHaveAttribute('data-sort', 'manual')
  })

  it('keeps live task changes that arrive before the REST fallback finishes', async () => {
    let resolveTasks: (response: Response) => void = () => {}
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/projects?orgSlug=acme-client') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [{ id: 'project-1', orgId: 'org-acme', name: 'Client Website', status: 'development' }] }),
        } as Response)
      }
      if (url === '/api/v1/projects/project-1/tasks') {
        return new Promise<Response>(resolve => { resolveTasks = resolve })
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
    }) as jest.Mock

    render(<ProjectsPage />)

    await waitFor(() => expect(screen.getByRole('button', { name: /board/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /board/i }))

    await waitFor(() => expect(snapshotCallback).toBeTruthy())
    mockSnapshotChange('added', 'task-live-1', {
      title: 'Live task survives fallback',
      columnId: 'todo',
      order: 1,
    })

    await act(async () => {
      resolveTasks({ ok: true, json: async () => ({ data: [] }) } as Response)
    })

    expect(screen.getByText('Live task survives fallback — Client Website')).toBeInTheDocument()
  })


  it('updates client project cards when Firestore project snapshots change', async () => {
    render(<ProjectsPage />)

    await waitFor(() => expect(screen.getByText('Client Website')).toBeInTheDocument())

    mockSnapshotChange('modified', 'project-1', {
      name: 'Client Website Live',
      status: 'review',
      description: 'This status changed live',
    })

    expect(screen.getByText('Client Website Live')).toBeInTheDocument()
    expect(screen.getByText('This status changed live')).toBeInTheDocument()
  })

  it('polls cross-project task cards when Firestore task listeners are not delivering changes', async () => {
    jest.useFakeTimers()
    let taskCalls = 0
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/projects?orgSlug=acme-client') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [{ id: 'project-1', orgId: 'org-acme', name: 'Client Website', status: 'development' }] }),
        } as Response)
      }
      if (url === '/api/v1/projects/project-1/tasks') {
        taskCalls += 1
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: taskCalls === 1 ? [] : [{ id: 'task-rest-1', title: 'REST fallback task', columnId: 'todo', order: 1 }],
          }),
        } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
    }) as jest.Mock

    render(<ProjectsPage />)

    await waitFor(() => expect(screen.getByRole('button', { name: /board/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /board/i }))
    await waitFor(() => expect(screen.getByTestId('cross-project-board')).toBeInTheDocument())

    await act(async () => {
      jest.advanceTimersByTime(10000)
    })

    await waitFor(() => expect(screen.getByText('REST fallback task — Client Website')).toBeInTheDocument())
    jest.useRealTimers()
  })

  it('polls the project list so cards update even when the Firestore listener is not delivering changes', async () => {
    jest.useFakeTimers()
    let listCalls = 0
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/projects?orgSlug=acme-client') {
        listCalls += 1
        const project = listCalls === 1
          ? { id: 'project-1', orgId: 'org-acme', name: 'Client Website', status: 'development' }
          : { id: 'project-1', orgId: 'org-acme', name: 'Client Website Live', status: 'review', description: 'Fresh from REST fallback' }
        return Promise.resolve({ ok: true, json: async () => ({ data: [project] }) } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
    }) as jest.Mock

    render(<ProjectsPage />)

    await waitFor(() => expect(screen.getByText('Client Website')).toBeInTheDocument())

    await act(async () => {
      jest.advanceTimersByTime(10000)
    })

    await waitFor(() => expect(screen.getByText('Client Website Live')).toBeInTheDocument())
    expect(screen.getByText('Fresh from REST fallback')).toBeInTheDocument()
    jest.useRealTimers()
  })
})
