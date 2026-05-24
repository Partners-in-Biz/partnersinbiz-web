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
    fireEvent.click(screen.getByRole('button', { name: /manual order/i }))

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
})
