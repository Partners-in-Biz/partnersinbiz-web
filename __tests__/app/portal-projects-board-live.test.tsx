import React from 'react'
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import ProjectsPage from '@/app/(portal)/portal/projects/page'
import { collection, onSnapshot } from 'firebase/firestore'

let snapshotCallback: ((snap: { docChanges: () => Array<{ type: 'added' | 'modified' | 'removed'; doc: { id: string; data: () => Record<string, unknown> } }> }) => void) | null = null
const unsubscribe = jest.fn()

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

jest.mock('@/components/projects/CrossProjectBoard', () => ({
  CrossProjectBoard: ({ tasks, loading }: { tasks: Array<{ id: string; title: string; projectName?: string }>; loading: boolean }) => (
    <div data-testid="cross-project-board" data-loading={loading ? 'true' : 'false'}>
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

describe('Portal projects board live data', () => {
  beforeEach(() => {
    snapshotCallback = null
    unsubscribe.mockClear()
    ;(collection as jest.Mock).mockClear()
    ;(onSnapshot as jest.Mock).mockClear()
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/projects?view=received') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [{ id: 'project-1', name: 'Launch Site', status: 'development' }] }),
        } as Response)
      }
      if (url === '/api/v1/projects/project-1/tasks') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [] }),
        } as Response)
      }
      if (url === '/api/v1/projects/reporting') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              summary: { totalProjects: 1, openTasks: 3, blockedTasks: 0, waitingApprovals: 1, highRisks: 0, trackedRevenue: 12000, currency: 'ZAR' },
              clients: [{ clientOrgId: 'client-org', companyId: 'company-client', clientName: 'Client workspace', projectCount: 1, trackedRevenue: 12000, openTasks: 3, blockedTasks: 0, highRisks: 0 }],
              people: [{ uid: 'contact-1', name: 'Client Contact', assignedTasks: 2, estimateMinutes: 180, capacityMinutes: 360, utilizationPercent: 50, overCapacity: false }],
              projects: [{ id: 'project-1', name: 'Launch Site', companyId: 'company-client', status: 'development', health: { status: 'healthy', score: 92 }, timeline: { driftCount: 0, dependencyCount: 1 }, reports: { tasks: { open: 3, blocked: 0 }, risks: { high: 0 }, revenue: { trackedAmount: 12000, currency: 'ZAR' } } }],
            },
          }),
        } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
    }) as jest.Mock
  })

  it('shows portfolio reporting in the client project workspace', async () => {
    render(<ProjectsPage />)

    await waitFor(() => expect(screen.getByRole('tab', { name: /portfolio report/i })).toBeInTheDocument())
    expect(screen.getByRole('tab', { name: /^projects$/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: /request project/i })).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/projects/reporting', expect.any(Object))

    fireEvent.click(screen.getByRole('tab', { name: /portfolio report/i }))

    expect(global.fetch).toHaveBeenCalledWith('/api/v1/projects/reporting', expect.any(Object))
    await waitFor(() => expect(screen.getByText('Client workspace')).toBeInTheDocument())
    expect(screen.getByText('Client Contact')).toBeInTheDocument()
    expect(screen.getByText('Approvals')).toBeInTheDocument()
    expect(screen.getByText('Client or internal decisions waiting.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open company Client workspace' })).toHaveAttribute('href', '/portal/companies/company-client')
    expect(screen.getByRole('link', { name: 'Open project Launch Site' })).toHaveAttribute('href', '/portal/projects/project-1')
  })

  it('updates the cross-project kanban board when Firestore task snapshots change', async () => {
    render(<ProjectsPage />)

    await waitFor(() => expect(screen.getByRole('button', { name: /board/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /board/i }))

    await waitFor(() => expect(snapshotCallback).toBeTruthy())

    mockSnapshotChange('added', 'task-live-1', {
      title: 'Live task from Firestore',
      columnId: 'todo',
      order: 1,
      projectId: 'project-1',
    })

    expect(screen.getByText('Live task from Firestore — Launch Site')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: /manual order/i })).toBeInTheDocument())
    const boardButton = screen.getByRole('button', { name: /view_kanban\s+board/i })
    const manualOrderButton = screen.getByRole('button', { name: /manual order/i })
    const toolbar = boardButton.parentElement?.parentElement
    expect(toolbar).toHaveClass('justify-between')
    expect(toolbar).toHaveClass('gap-3')
    expect(toolbar).toContainElement(manualOrderButton)
  })

  it('loads completed project history separately from the active portal workspace', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/projects?view=received') {
        return Promise.resolve({ ok: true, json: async () => ({ data: [{ id: 'project-1', name: 'Active Launch', status: 'development' }] }) } as Response)
      }
      if (url === '/api/v1/projects?view=received&archive=only') {
        return Promise.resolve({ ok: true, json: async () => ({ data: [{ id: 'project-done', name: 'Signed Off Launch', status: 'completed' }] }) } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
    }) as jest.Mock

    render(<ProjectsPage />)
    await waitFor(() => expect(screen.getByText('Active Launch')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('tab', { name: /archive/i }))

    expect(global.fetch).toHaveBeenCalledWith('/api/v1/projects?view=received&archive=only')
    await waitFor(() => expect(screen.getByText('Signed Off Launch')).toBeInTheDocument())
    expect(screen.queryByText('Active Launch')).not.toBeInTheDocument()
  })

  it('keeps live task changes that arrive before the REST fallback finishes', async () => {
    let resolveTasks: (response: Response) => void = () => {}
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/projects?view=received') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [{ id: 'project-1', name: 'Launch Site', status: 'development' }] }),
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
      projectId: 'project-1',
    })

    await act(async () => {
      resolveTasks({ ok: true, json: async () => ({ data: [] }) } as Response)
    })

    expect(screen.getByText('Live task survives fallback — Launch Site')).toBeInTheDocument()
  })


  it('does not subscribe to the unscoped top-level projects collection', async () => {
    render(<ProjectsPage />)

    await waitFor(() => expect(screen.getAllByText('Launch Site').length).toBeGreaterThan(0))

    expect(onSnapshot).not.toHaveBeenCalled()
    expect(collection).not.toHaveBeenCalledWith(expect.anything(), 'projects')
  })
})
